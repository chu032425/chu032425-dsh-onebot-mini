/**
 * Incoming media: turn QQ message segments into files the agent can actually read.
 *
 * A OneBot message often carries more than文字: an image, a voice clip, a video
 * or a file arrives as its own segment whose payload is only a URL (or a
 * gateway-side file id). Flattened to a bare `[图片]` placeholder the model can
 * do nothing with it. This module downloads each media segment to a local inbox
 * under the chat's workspace and rewrites the placeholder to carry the real
 * path:
 *
 *   [图片: /workspace/QQ/qq-inbox/private-2000001/1712345678-0-image.png]
 *   [语音: /workspace/QQ/qq-inbox/…/…-0-record.amr]（转写：你好）
 *   [视频: /workspace/QQ/qq-inbox/…/…-0-video.mp4]
 *   [文件: 报告.pdf, /workspace/QQ/qq-inbox/…/…-0-file.pdf]
 *
 * The agent then reaches the bytes with its normal tools — `read_image` for a
 * picture, `read`/`bash` for text and archives. A voice clip is additionally
 * transcribed by the gateway itself (`fetch_ptt_text`, QQ's own voice-to-text),
 * so a spoken message becomes readable text too — no local model, no ffmpeg.
 *
 * Only http(s) URLs from the gateway frame are fetched. Nothing here trusts the
 * model, and a failed download degrades to the old placeholder instead of
 * dropping the message.
 */

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { accountDir } from './cachepaths.js'
import { transcribeViaGateway } from './stt.js'

/** Segment kinds handled here. */
export const INBOUND_KINDS = Object.freeze(['image', 'record', 'video', 'file'])

/**
 * Pull a human label out of a rich-card segment (`json` / `xml`).
 *
 * A QQ mini-program / share card arrives as a segment whose payload is a JSON
 * string with a `prompt` like "[QQ小程序]" plus `desc` and `meta.detail_*.title`.
 * Parsing is best effort: anything unusable yields an empty string and the
 * caller falls back to a bare "卡片" placeholder. Never throws.
 * @param data - the segment's `data` object.
 * @returns a short label, or ''.
 */
export function cardLabel(data) {
  if (data === null || typeof data !== 'object') return ''
  let parsed = data.data ?? data.content ?? data
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      parsed = undefined
    }
  }
  const candidates = []
  if (parsed !== null && typeof parsed === 'object') {
    if (typeof parsed.prompt === 'string') candidates.push(parsed.prompt)
    if (typeof parsed.desc === 'string') candidates.push(parsed.desc)
    if (typeof parsed.title === 'string') candidates.push(parsed.title)
    const meta = parsed.meta
    if (meta !== null && typeof meta === 'object') {
      for (const key of ['detail_1', 'detail', 'news', 'music']) {
        const block = meta[key]
        if (block === null || typeof block !== 'object') continue
        if (typeof block.title === 'string') candidates.push(block.title)
        if (typeof block.desc === 'string') candidates.push(block.desc)
      }
    }
  }
  for (const candidate of candidates) {
    const clean = String(candidate)
      .replace(/^[\[【\s]+/, '')
      .replace(/[\]】\s]+$/, '')
      .trim()
    if (clean !== '') return clean.slice(0, 40)
  }
  return ''
}

/**
 * Segment kinds this plugin knows how to represent.
 *
 * Anything outside this set is reported as "暂时不能处理" instead of being
 * silently dropped — see `unknownSegmentTypes`.
 */
export const KNOWN_SEGMENT_TYPES = Object.freeze([
  'text', 'at', 'face', 'mface', 'image', 'record', 'video', 'file',
  'json', 'xml', 'forward', 'node', 'reply', 'music', 'location', 'contact',
  'dice', 'rps', 'shake', 'poke',
])

/**
 * The unseen segment types in one message, in first-seen order.
 * @param segments - the `message` field (array of segments, or a CQ string).
 * @returns the unknown type names; empty when everything is recognised.
 */
export function unknownSegmentTypes(segments) {
  if (!Array.isArray(segments)) return []
  const unknown = []
  for (const segment of segments) {
    if (segment === null || typeof segment !== 'object') continue
    const type = String(segment.type ?? '')
    if (type !== '' && !KNOWN_SEGMENT_TYPES.includes(type) && !unknown.includes(type)) unknown.push(type)
  }
  return unknown
}

/**
 * A model-facing placeholder for a non-text segment kind we handle.
 *
 * `text`/`at` are handled inline; media is downloaded before this is called.
 * Unknown kinds return '' on purpose so the bridge can answer "暂时不能处理"
 * instead of pretending it understood them.
 * @param type - the segment type.
 * @param data - the segment's `data`.
 * @returns a bracketed placeholder, or '' for an empty/unknown type.
 */
export function segmentPlaceholder(type, data) {
  const kind = String(type ?? '')
  if (kind === '') return ''
  if (kind === 'json') {
    const label = cardLabel(data)
    return '[卡片: ' + (label !== '' ? label : '小程序') + ']'
  }
  if (kind === 'xml') {
    const label = cardLabel(data)
    return '[' + (label !== '' ? '卡片: ' + label : '卡片') + ']'
  }
  if (kind === 'forward' || kind === 'node') return '[合并转发]'
  if (kind === 'music') return '[音乐分享]'
  if (kind === 'location') return '[位置]'
  if (kind === 'contact') return '[名片]'
  if (kind === 'mface' || kind === 'face') return '[表情]'
  if (kind === 'dice') return '[骰子]'
  if (kind === 'rps') return '[猜拳]'
  if (kind === 'shake') return '[窗口抖动]'
  if (kind === 'poke') return '[戳一戳]'
  // Unknown kind: let the caller answer "暂时不能处理" instead of inventing one.
  return ''
}

/** A download longer than this is abandoned. */
const FETCH_TIMEOUT_MS = 20000

/** A running counter so several media in the same millisecond never collide. */
let sequence = 0

/**
 * The cache directory for one chat's incoming media.
 *
 * Follows the plugin-wide cache convention (see cachepaths.js):
 * `{workspacePath}/onebot-mini-cache/QQ/{qq号或群号}/`. Because it lives inside
 * the session workspace, the agent can `read_image`/`read` these files directly.
 *
 * `config.inboundDir` is an internal override (tests / advanced setups) and is
 * not a documented setting, so a normal config object has no such key.
 * @param config - the effective config.
 * @param chat - `{ kind, id }` for the chat, whose id is the QQ号 or 群号.
 * @param chatId - canonical chat id, used by the override path only.
 * @returns the absolute cache directory for this chat's media.
 */
export function inboxRoot(config, chat, chatId) {
  const override = String(config?.inboundDir ?? '').trim()
  if (override !== '') return join(override, chatFolder(chatId))
  const key = chat !== null && typeof chat === 'object' && chat.id !== undefined ? String(chat.id) : String(chatId ?? '')
  return accountDir(config, key)
}

/**
 * The per-chat folder name: only safe characters survive.
 * @param chatId - `private:<id>` or `group:<id>`.
 * @returns a filesystem-safe folder name.
 */
export function chatFolder(chatId) {
  return String(chatId ?? '').replace(/[^A-Za-z0-9-]/g, '-')
}

/**
 * Strip anything path-like from a suggested file name.
 * @param name - the raw name from the gateway.
 * @returns a safe base name (may be empty).
 */
export function safeFileName(name) {
  const raw = String(name ?? '').replace(/[:\\/]+/g, '_').replace(/[^\w.\-\u4e00-\u9fa5]/g, '_')
  return raw.replace(/^\.+/, '').slice(0, 80)
}

/**
 * Pick a file extension from the content type, falling back per kind.
 * @param kind - image / record / video / file.
 * @param contentType - the response `content-type`.
 * @param suggested - a suggested original name.
 * @returns an extension without the dot, always non-empty.
 */
export function extensionFor(kind, contentType, suggested) {
  const type = String(contentType ?? '').toLowerCase()
  if (type.includes('png')) return 'png'
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg'
  if (type.includes('gif')) return 'gif'
  if (type.includes('webp')) return 'webp'
  if (type.includes('bmp')) return 'bmp'
  if (type.includes('amr')) return 'amr'
  if (type.includes('silk')) return 'silk'
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3'
  if (type.includes('wav')) return 'wav'
  if (type.includes('ogg')) return 'ogg'
  if (type.includes('mp4')) return 'mp4'
  if (type.includes('quicktime')) return 'mov'
  if (type.includes('webm')) return 'webm'
  if (type.includes('pdf')) return 'pdf'
  const fromName = /\.([A-Za-z0-9]{1,8})$/.exec(String(suggested ?? ''))
  if (fromName !== null) return fromName[1].toLowerCase()
  if (kind === 'image') return 'jpg'
  if (kind === 'record') return 'amr'
  if (kind === 'video') return 'mp4'
  return 'bin'
}

/**
 * Identify a supported image format from its magic bytes.
 *
 * The gateway often omits a content type, and a PNG saved as `.jpg` would fail
 * `read_image`'s declared-type-vs-bytes check. Sniffing the bytes keeps the
 * extension honest.
 * @param bytes - the file bytes.
 * @returns `png|jpg|gif|webp|bmp`, or an empty string.
 */
export function sniffImageExtension(bytes) {
  const b = bytes
  if (b === undefined || b === null || b.length < 4) return ''
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif'
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp'
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp'
  return ''
}

/**
 * Read a payload from a direct segment field.
 *
 * OneBot puts the payload in `data.url` for image/record/video, and sometimes in
 * `data.file` as an http, base64 or file URL. A bare `/abs/path` is also accepted
 * when it happens to exist on this host.
 * @param data - the segment data object.
 * @returns `{ url } | { base64 } | { path }`, or undefined.
 */
export function sourceFromData(data) {
  if (data === null || typeof data !== 'object') return undefined
  const asUrl = (value) => (typeof value === 'string' && /^https?:\/\//i.test(value) ? value : '')
  const direct = asUrl(data.url) || asUrl(data.file)
  if (direct !== '') return { url: direct }
  const file = String(data.file ?? '')
  if (/^base64:\/\//i.test(file)) {
    const payload = file.slice('base64://'.length)
    if (payload !== '') return { base64: payload }
  }
  if (/^file:\/\//i.test(file)) return { path: decodeURIComponent(file.slice('file://'.length)) }
  for (const candidate of [file, String(data.path ?? '')]) {
    if (candidate.startsWith('/')) return { path: candidate }
  }
  return undefined
}

/**
 * Read a payload from a `get_file`-style response.
 * @param response - the action's `data`.
 * @returns a source, or undefined.
 */
export function sourceFromResponse(response) {
  if (response === null || typeof response !== 'object') return undefined
  if (typeof response.base64 === 'string' && response.base64 !== '') return { base64: response.base64 }
  const url = String(response.url ?? response.file ?? '')
  if (/^https?:\/\//i.test(url)) return { url }
  if (/^base64:\/\//i.test(url)) return { base64: url.slice('base64://'.length) }
  return undefined
}

/**
 * Fetch one URL into a Buffer, enforcing the byte ceiling while streaming.
 * @param url - an http(s) URL.
 * @param maxBytes - the ceiling in bytes.
 * @param timeoutMs - abort deadline.
 * @returns `{ ok: true, bytes, contentType }` or `{ ok: false, reason }`.
 */
export async function fetchToBuffer(url, maxBytes, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  if (typeof timer.unref === 'function') timer.unref()
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return { ok: false, reason: 'HTTP ' + response.status }
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (declared > maxBytes) return { ok: false, reason: 'too large: ' + declared + ' bytes' }
    const chunks = []
    let total = 0
    if (response.body !== null) {
      for await (const chunk of response.body) {
        total += chunk.length
        if (total > maxBytes) {
          controller.abort()
          return { ok: false, reason: 'too large while reading' }
        }
        chunks.push(Buffer.from(chunk))
      }
    }
    return { ok: true, bytes: Buffer.concat(chunks), contentType: String(response.headers.get('content-type') ?? '') }
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Resolve a segment's bytes: direct field first, then a gateway `get_file`
 * round-trip, then the group/private file-URL actions.
 * @param connection - the transport facade (`call`).
 * @param segment - the OneBot segment.
 * @param chat - `{ kind, id }`.
 * @returns `{ source }` (a url/base64/path object) or `{ reason }`.
 */
export async function resolveSegmentSource(connection, segment, chat) {
  const data = segment?.data !== null && typeof segment?.data === 'object' ? segment.data : {}
  const direct = sourceFromData(data)
  if (direct !== undefined) return { source: direct }

  const fileId = String(data.file_id ?? data.file ?? '')
  if (fileId === '' || typeof connection?.call !== 'function') {
    return { reason: 'no downloadable source on the segment' }
  }

  // image / record / video / file: get_file resolves a gateway-side id to a URL.
  try {
    const response = await connection.call('get_file', { file_id: fileId })
    const got = sourceFromResponse(response)
    if (got !== undefined) return { source: got }
  } catch {
    // fall through to the file-specific actions
  }

  if (segment.type === 'file') {
    try {
      if (chat.kind === 'group') {
        const response = await connection.call('get_group_file_url', {
          group_id: Number(chat.id),
          file_id: fileId,
          busid: Number(data.busid ?? 0),
        })
        const got = sourceFromResponse(response)
        if (got !== undefined) return { source: got }
      } else {
        const response = await connection.call('get_private_file_url', {
          user_id: Number(chat.id),
          file_id: fileId,
        })
        const got = sourceFromResponse(response)
        if (got !== undefined) return { source: got }
      }
    } catch {
      // no file URL either
    }
  }
  return { reason: 'the gateway did not return a download URL' }
}

/**
 * Obtain the bytes for one resolved source, honoring the size ceiling.
 * @param source - `{ url } | { base64 } | { path }`.
 * @param maxBytes - the ceiling in bytes.
 * @returns `{ ok: true, bytes, contentType }` or `{ ok: false, reason }`.
 */
export async function readSourceBytes(source, maxBytes) {
  if (typeof source.base64 === 'string') {
    const bytes = Buffer.from(source.base64, 'base64')
    if (bytes.length > maxBytes) return { ok: false, reason: 'too large: ' + bytes.length + ' bytes' }
    return { ok: true, bytes, contentType: '' }
  }
  if (typeof source.path === 'string') {
    try {
      const info = await stat(source.path)
      if (!info.isFile()) return { ok: false, reason: 'not a file: ' + source.path }
      if (info.size > maxBytes) return { ok: false, reason: 'too large: ' + info.size + ' bytes' }
      return { ok: true, bytes: await readFile(source.path), contentType: '' }
    } catch (error) {
      return { ok: false, reason: String(error?.message ?? error) }
    }
  }
  if (typeof source.url === 'string') {
    return fetchToBuffer(source.url, maxBytes)
  }
  return { ok: false, reason: 'no usable source' }
}

/**
 * The placeholder text for one saved (or failed) media segment.
 * @param kind - image / record / video / file.
 * @param path - the saved path, or undefined on failure.
 * @param name - a display name for a file.
 * @param transcript - a voice transcript, when available.
 * @returns the model-facing placeholder.
 */
export function mediaPlaceholder(kind, path, name, transcript) {
  if (path === undefined) {
    if (kind === 'image') return '[图片]'
    if (kind === 'record') return '[语音]'
    if (kind === 'video') return '[视频]'
    return '[文件]'
  }
  if (kind === 'image') return '[图片: ' + path + ']'
  if (kind === 'video') return '[视频: ' + path + ']'
  if (kind === 'record') {
    return '[语音: ' + path + ']' + (transcript ? '（转写：' + transcript + '）' : '')
  }
  const label = name !== undefined && name !== '' ? name : basename(path)
  return '[文件: ' + label + ', ' + path + ']'
}

/**
 * Download and save one media segment.
 * @param options - `{ segment, chatId, chat, connection, config, messageId, log }`.
 * @returns `{ placeholder, saved?, warning? }`.
 */
async function ingestSegment({ segment, chatId, chat, connection, config, messageId, log }) {
  const kind = segment.type
  const maxBytes = Math.max(1, Number(config?.inboundMediaMaxMb ?? 20)) * 1024 * 1024
  const resolved = await resolveSegmentSource(connection, segment, chat)
  if (resolved.source === undefined) {
    if (typeof log === 'function') log('media download skipped (' + kind + '): ' + resolved.reason)
    return { placeholder: mediaPlaceholder(kind), warning: kind + ': ' + resolved.reason }
  }
  const read = await readSourceBytes(resolved.source, maxBytes)
  if (read.ok !== true) {
    if (typeof log === 'function') log('media download failed (' + kind + '): ' + read.reason)
    return { placeholder: mediaPlaceholder(kind), warning: kind + ': ' + read.reason }
  }

  const data = segment?.data !== null && typeof segment?.data === 'object' ? segment.data : {}
  const suggested = safeFileName(data.name ?? (typeof data.file === 'string' && !/^(https?|base64|file):/i.test(data.file) ? data.file : ''))
  const extension = (kind === 'image' ? sniffImageExtension(read.bytes) : '') || extensionFor(kind, read.contentType, suggested)
  const folder = inboxRoot(config, chat, chatId)
  sequence += 1
  const stem = Date.now() + '-' + sequence + '-' + kind
  const fileName = suggested !== '' ? stem + '-' + suggested : stem + '.' + extension
  const path = join(folder, fileName.endsWith('.' + extension) ? fileName : fileName + '.' + extension)
  try {
    await mkdir(folder, { recursive: true })
    await writeFile(path, read.bytes)
  } catch (error) {
    const reason = 'cannot write ' + path + ': ' + String(error?.message ?? error)
    if (typeof log === 'function') log('media save failed (' + kind + '): ' + reason)
    return { placeholder: mediaPlaceholder(kind), warning: kind + ': ' + reason }
  }

  let transcript = ''
  if (kind === 'record' && config?.sttEnabled !== false && typeof messageId === 'string' && messageId !== '') {
    // Ask the gateway (NapCat) for QQ's own voice-to-text result of this message.
    // Clean and portable: it is an action on the gateway we already talk to — no
    // extra plugin, npm package, local model, or system ffmpeg.
    transcript = await transcribeViaGateway(connection, messageId, { log })
  }
  return {
    placeholder: mediaPlaceholder(kind, path, suggested !== '' ? suggested : undefined, transcript),
    saved: { kind, path, bytes: read.bytes.length, transcript },
  }
}

/**
 * Build the model-facing text for one inbound message, saving media on the way.
 *
 * Mirrors `flattenMessage` for text/at/face/other segments, but each media
 * segment is downloaded and rewritten to a local path so the model can read it.
 * @param options - `{ segments, chatId, chat, connection, config, messageId, log }`.
 * @returns `{ text, saved, warnings }`.
 */
export async function buildInboundText({ segments, chatId, chat, connection, config, messageId, log }) {
  const saved = []
  const warnings = []
  const record = (note) => {
    if (typeof log === 'function') log(note)
  }
  if (typeof segments === 'string') return { text: unescapeCqLite(segments), saved, warnings }
  if (!Array.isArray(segments)) return { text: '', saved, warnings }

  const parts = []
  for (const segment of segments) {
    if (segment === null || typeof segment !== 'object') continue
    const type = String(segment.type ?? '')
    const data = segment.data !== null && typeof segment.data === 'object' ? segment.data : {}
    if (type === 'text') {
      parts.push(String(data.text ?? ''))
      continue
    }
    if (type === 'at') {
      if (String(data.qq ?? '') === 'all') parts.push('@全体成员')
      continue
    }
    if (type === 'face') {
      parts.push('[表情]')
      continue
    }
    if (type === 'reply') continue
    if (type === 'forward' || type === 'node') {
      parts.push('[合并转发]')
      continue
    }
    if (INBOUND_KINDS.includes(type)) {
      const outcome = await ingestSegment({ segment, chatId, chat, connection, config, messageId, log: record })
      if (outcome.warning !== undefined) warnings.push(outcome.warning)
      if (outcome.saved !== undefined) saved.push(outcome.saved)
      parts.push(outcome.placeholder)
      continue
    }
    // Any other segment (json/xml card, music, location, contact, …) still gets a
    // placeholder so the message is not flattened to '' and silently dropped.
    if (type !== '') {
      const placeholder = segmentPlaceholder(type, data)
      if (placeholder !== '') parts.push(placeholder)
    }
  }
  return { text: parts.join('').trim(), saved, warnings }
}

/**
 * A minimal CQ-string fallback (no media download is possible without URLs).
 * @param raw - the CQ string.
 * @returns plain text with bracketed placeholders.
 */
export function unescapeCqLite(raw) {
  return String(raw)
    // Card / rich segments are matched before entities are decoded, while any
    // brackets inside their payload are still `&#91;`/`&#93;`.
    .replace(/\[CQ:json,[^\]]*\]/gi, '[卡片]')
    .replace(/\[CQ:xml,[^\]]*\]/gi, '[卡片]')
    .replace(/\[CQ:forward,[^\]]*\]/gi, '[合并转发]')
    .replace(/&#91;/g, '[')
    .replace(/&#93;/g, ']')
    .replace(/&#44;/g, ',')
    .replace(/&amp;/g, '&')
    .replace(/\[CQ:image[^\]]*\]/g, '[图片]')
    .replace(/\[CQ:record[^\]]*\]/g, '[语音]')
    .replace(/\[CQ:video[^\]]*\]/g, '[视频]')
    .replace(/\[CQ:file[^\]]*\]/g, '[文件]')
    .replace(/\[CQ:face[^\]]*\]/g, '[表情]')
    .replace(/\[CQ:at,qq=all[^\]]*\]/g, '@全体成员')
    .replace(/\[CQ:[^\]]*\]/g, '')
    .trim()
}

/**
 * Remove a saved inbound file (used by tests and by a future prune).
 * @param path - the file to remove.
 */
export async function removeInbound(path) {
  try {
    await rm(path, { force: true })
  } catch {
    // best effort
  }
}
