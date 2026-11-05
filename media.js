import { tmpdir } from 'node:os'
import { isAbsolute, basename, resolve } from 'node:path'
import { lstat, unlink } from 'node:fs/promises'
import { dshHome } from './config.js'

/**
 * Sending media segments on a bridged chat.
 *
 * The reply path only ever produces text: the bridge buffers the assistant's
 * text blocks and sends one text segment. Anything else — an image, a voice
 * clip, a file — has to be an explicit message segment, and the gateway must
 * receive the bytes in a form it can read.
 *
 * The plugin runs on the DSH host while NapCat usually runs in another
 * container, so a path on this host is not readable by the gateway. The
 * therefore-supported sources are:
 *
 *  - `url`:    an http(s) URL the gateway can reach;
 *  - `base64`: raw bytes carried inline as `base64://…`, which needs no shared
 *    filesystem at all;
 *  - `path`:   a file on the DSH host, read here and inlined as base64, so the
 *    caller can pass a local file without caring where NapCat runs.
 *
 * A hard size ceiling keeps one call from pushing a multi-hundred-megabyte
 * payload through the WebSocket.
 */

/** The largest media payload this module will relay, in bytes. */
export const MAX_MEDIA_BYTES = 20 * 1024 * 1024

/** Segment types accepted by `buildSegment`. */
export const MEDIA_KINDS = Object.freeze(['image', 'record', 'video', 'file'])

/**
 * Build one OneBot media segment.
 *
 * `file` is the field every OneBot media segment uses; the value may be a URL,
 * a `file:///` path, or `base64://<payload>`. `name` only matters for a file.
 * @param kind - image / record / video / file.
 * @param source - `{ url?, base64? }`.
 * @param name - optional display name for a file.
 * @returns the message segment.
 */
export function buildSegment(kind, source, name) {
  const data = {}
  if (typeof source.base64 === 'string' && source.base64 !== '') {
    data.file = 'base64://' + source.base64
  } else {
    data.file = String(source.url ?? '')
  }
  if (typeof name === 'string' && name !== '') data.name = name
  return { type: kind, data }
}

/**
 * Read a local file into base64, enforcing the size ceiling.
 * @param path - the file path on this host.
 * @returns `{ ok: true, base64 }` or `{ ok: false, reason }`.
 */
export async function readFileAsBase64(path) {
  const { readFile, stat } = await import('node:fs/promises')
  try {
    const info = await stat(path)
    if (!info.isFile()) return { ok: false, reason: 'not a file: ' + path }
    if (info.size > MAX_MEDIA_BYTES) return { ok: false, reason: 'too large: ' + info.size + ' bytes' }
    const buffer = await readFile(path)
    return { ok: true, base64: buffer.toString('base64') }
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) }
  }
}

/**
 * Send one media segment to a chat.
 * @param connection - the live `connection` facade (`call`).
 * @param options - `{ chatType, chatId, kind, url?, base64?, path?, name? }`.
 * @returns `{ ok, data?, error? }`.
 */
export async function sendMedia(connection, options) {
  const chatType = options.chatType === 'group' ? 'group' : (options.chatType === 'private' ? 'private' : '')
  const chatId = String(options.chatId ?? '').trim()
  const kind = String(options.kind ?? '')
  if (chatType === '') return { ok: false, error: 'chatType must be group or private' }
  if (!/^[0-9]+$/.test(chatId)) return { ok: false, error: 'chatId must be numeric' }
  if (!MEDIA_KINDS.includes(kind)) return { ok: false, error: 'kind must be one of ' + MEDIA_KINDS.join(', ') }

  let source
  if (typeof options.path === 'string' && options.path !== '') {
    const read = await readFileAsBase64(options.path)
    if (read.ok !== true) return { ok: false, error: read.reason }
    source = { base64: read.base64 }
  } else if (typeof options.base64 === 'string' && options.base64 !== '') {
    if (options.base64.length > Math.ceil(MAX_MEDIA_BYTES * 4 / 3) + 4) {
      return { ok: false, error: 'the base64 payload is above the size ceiling' }
    }
    source = { base64: options.base64 }
  } else if (typeof options.url === 'string' && options.url !== '') {
    source = { url: options.url }
  } else {
    return { ok: false, error: 'one of url, base64 or path is required' }
  }

  const segment = buildSegment(kind, source, options.name)
  const action = chatType === 'group' ? 'send_group_msg' : 'send_private_msg'
  const params = chatType === 'group'
    ? { group_id: Number(chatId), message: [segment] }
    : { user_id: Number(chatId), message: [segment] }
  try {
    const data = await connection.call(action, params)
    // A source file is only removed after the gateway accepted the send, and
    // only when the caller asked for it. A URL or inline base64 has nothing to
    // clean up.
    let deleted
    if (options.deleteSource === true && typeof options.path === 'string' && options.path !== '') {
      const result = await safeUnlink(options.path)
      deleted = result.ok === true ? 'deleted' : 'kept: ' + result.reason
    }
    return deleted === undefined ? { ok: true, data } : { ok: true, data, source: deleted }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}

/**
 * The directories a sent source file may be deleted from.
 *
 * Deleting an arbitrary absolute path a model produced would be one bad prompt
 * away from wiping something important, so deletion is limited to scratch and
 * workspace areas. Anything else is left alone and reported back.
 * @returns the allowed roots, fully resolved.
 */
function allowedDeleteRoots() {
  return [resolve(tmpdir()), '/workspace', resolve(dshHome())]
}

/**
 * Delete one sent source file, refusing anything outside the allowed roots.
 * @param target - the configured path.
 * @returns `{ ok: true }` or `{ ok: false, reason }`.
 */
export async function safeUnlink(target) {
  const absolute = resolve(String(target ?? ''))
  if (!isAbsolute(absolute)) return { ok: false, reason: 'not an absolute path' }
  const roots = allowedDeleteRoots()
  const inside = roots.some((root) => absolute === root || absolute.startsWith(root + '/'))
  if (!inside) return { ok: false, reason: 'outside the allowed roots' }
  if (roots.includes(absolute)) return { ok: false, reason: 'refusing to delete a root' }
  try {
    const info = await lstat(absolute)
    if (info.isDirectory()) return { ok: false, reason: 'is a directory' }
    await unlink(absolute)
    return { ok: true }
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: true }  // already gone: nothing to do
    return { ok: false, reason: String(error?.message ?? error) }
  }
}


/**
 * The marker a reply can carry to attach media, e.g. `[[image:/tmp/a.png]]`.
 *
 * The assistant only produces text, so a reply that should carry media needs a
 * convention the bridge can parse. Doubled brackets keep it from colliding with
 * ordinary prose, and the four kind names match the tool's `kind` values.
 */
export const MEDIA_MARKER_PATTERN = /\[\[(image|record|video|file):([^\[\]]+)\]\]/g

/**
 * Turn a reply's text into an ordered segment list.
 *
 * Text around a marker is kept in order, so a caption can sit before or after
 * its picture. A marker whose file is missing or too large is replaced by a
 * short text note instead of failing the whole reply — losing one attachment
 * must not lose the message.
 * @param text - the buffered reply text.
 * @param options - `{ maxBytes? }`.
 * @returns `{ segments, warnings, sourcePaths }`; `sourcePaths` lists the local
 *   files that were inlined, so the caller can remove them after a successful
 *   send.
 */
export async function buildReplySegments(text, options = {}) {
  const input = String(text ?? '')
  const segments = []
  const warnings = []
  const sourcePaths = []
  const pushText = (value) => {
    const trimmed = String(value ?? '').trim()
    if (trimmed !== '') segments.push({ type: 'text', data: { text: trimmed } })
  }

  let lastIndex = 0
  const pattern = new RegExp(MEDIA_MARKER_PATTERN.source, 'g')
  let match
  while ((match = pattern.exec(input)) !== null) {
    pushText(input.slice(lastIndex, match.index))
    lastIndex = match.index + match[0].length
    const kind = match[1]
    const source = match[2].trim()
    const isUrl = /^https?:\/\//i.test(source)
    let built
    if (isUrl) {
      built = buildSegment(kind, { url: source })
    } else {
      const read = await readFileAsBase64(source)
      if (read.ok !== true) {
        warnings.push(kind + ': ' + read.reason)
        pushText('[' + kind + ' failed: ' + read.reason + ']')
        continue
      }
      built = buildSegment(kind, { base64: read.base64 }, kind === 'file' ? basename(source) : undefined)
      sourcePaths.push(source)
    }
    segments.push(built)
  }
  pushText(input.slice(lastIndex))

  return { segments, warnings, sourcePaths }
}
