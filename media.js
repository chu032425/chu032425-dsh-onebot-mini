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
    return { ok: true, data: await connection.call(action, params) }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}
