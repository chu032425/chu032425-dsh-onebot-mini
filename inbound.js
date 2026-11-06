/**
 * 入站媒体：把 QQ 消息段落成本地文件，供 agent 直接读取。
 *
 * 一条 OneBot 消息常带有文字以外的内容：图片、语音、视频或文件各自成段，
 * 段里往往只有 URL 或网关侧文件 id。只留 `[图片]` 这样的占位符模型无法处理，
 * 因此本模块把每个媒体段下载到会话工作区下的缓存目录，并把占位符改写成
 * 真实路径：
 *
 *   [图片: /workspace/QQ/onebot-mini-cache/QQ/2000001/1712345678-0-image.png]
 *   [语音: …/…-0-record.amr]（转写：你好）
 *   [视频: …/…-0-video.mp4]
 *   [文件: 报告.pdf, …/…-0-file.pdf]
 *
 * 模型随后用自带工具读取字节：`read_image` 看图，`read`/`bash` 读文本与压缩包。
 * 语音只下载并附上网关消息 id，由提示词引导模型自行调用 `onebot_call` 的
 * `fetch_ptt_text` 取 QQ 转写；本模块不自行发起非标准 action。
 *
 * 只抓取网关帧里的 http(s) URL；下载失败退化为原占位符，不丢消息。
 */

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { accountDir } from './cachepaths.js'
import { MEDIA_KINDS } from './media.js'

/**
 * 从富卡片段（`json` / `xml`）里取出人类可读的标签。
 *
 * 小程序/分享卡片常带 `prompt`（如「[QQ小程序]」）、`desc` 与
 * `meta.detail_*.title`；解析尽力而为，取不到就返回空串由调用方回退。
 * @param data - 段的 `data` 对象。
 * @returns 短标签，或 ''。
 */
function cardLabel(data) {
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
 * 本插件能表示的消息段类型。
 *
 * 不在集合内的类型会回「暂时不能处理」，而不是被静默丢弃 —— 见
 * `unknownSegmentTypes`。
 */
export const KNOWN_SEGMENT_TYPES = Object.freeze([
  'text', 'at', 'face', 'mface', 'image', 'record', 'video', 'file',
  'json', 'xml', 'forward', 'node', 'reply', 'music', 'location', 'contact',
  'dice', 'rps', 'shake', 'poke',
])

/**
 * 一条消息里未识别过的段类型，按首次出现顺序。
 * @param segments - `message` 字段（段数组，或 CQ 字符串）。
 * @returns 未识别的类型名；全部识别时为空。
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
 * 给非文本段类型一个面向模型的占位符。
 *
 * `text`/`at` 在别处内联处理；媒体段在此前已完成下载。未识别的类型
 * 故意返回 ''，好让调用方回「暂时不能处理」而不是假装看懂了。
 * @param type - 段类型。
 * @param data - 段的 `data`。
 * @returns 方括号占位符；类型为空或未识别时为 ''。
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
  // 未识别的类型：交给调用方回「暂时不能处理」，不臆造占位符。
  return ''
}

/** 单次下载超过此毫秒数即放弃。 */
const FETCH_TIMEOUT_MS = 20000

/** 进程内自增序号，避免同一毫秒内的多份媒体文件名相撞。 */
let sequence = 0

/**
 * 一个会话的入站媒体缓存目录。
 *
 * 遵循插件统一的缓存约定（见 cachepaths.js）：
 * `{workspacePath}/onebot-mini-cache/QQ/{qq号或群号}/`。目录位于会话工作区内，
 * 模型可直接用 `read_image`/`read` 读取。
 *
 * `config.inboundDir` 是内部覆盖项（测试/高级用法），不是对外设置项。
 * @param config - 生效配置。
 * @param chat - 会话的 `{ kind, id }`，id 为 QQ 号或群号。
 * @param chatId - 规范会话 id，仅覆盖路径使用。
 * @returns 该会话媒体目录的绝对路径。
 */
export function inboxRoot(config, chat, chatId) {
  const override = String(config?.inboundDir ?? '').trim()
  if (override !== '') return join(override, chatFolder(chatId))
  const key = chat !== null && typeof chat === 'object' && chat.id !== undefined ? String(chat.id) : String(chatId ?? '')
  return accountDir(config, key)
}

/**
 * 单个会话的目录名：只保留安全字符。
 * @param chatId - `private:<id>` 或 `group:<id>`。
 * @returns 文件系统安全的目录名。
 */
export function chatFolder(chatId) {
  return String(chatId ?? '').replace(/[^A-Za-z0-9-]/g, '-')
}

/**
 * 去掉建议文件名里的路径成分。
 * @param name - 网关给出的原始文件名。
 * @returns 安全的基本名（可能为空）。
 */
export function safeFileName(name) {
  const raw = String(name ?? '').replace(/[:\\/]+/g, '_').replace(/[^\w.\-\u4e00-\u9fa5]/g, '_')
  return raw.replace(/^\.+/, '').slice(0, 80)
}

/**
 * 按内容类型挑扩展名，取不到时按类型回退。
 * @param kind - image / record / video / file。
 * @param contentType - 响应的 `content-type`。
 * @param suggested - 建议的原始文件名。
 * @returns 不带点的扩展名，永不为空。
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
 * 按魔数识别受支持的图片格式。
 *
 * 网关常常不给 content-type，而存成 `.jpg` 的 PNG 会过不了 `read_image`
 * 的「声明类型对字节」校验，嗅探字节可让扩展名诚实。
 * @param bytes - 文件字节。
 * @returns `png|jpg|gif|webp|bmp`，或空串。
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
 * 从段字段里读出载荷。
 *
 * OneBot 把图片/语音/视频的载荷放在 `data.url`，有时也放在 `data.file`（
 * http、base64 或 file URL）。本机确实存在的裸 `/abs/path` 也接受。
 * @param data - 段的数据对象。
 * @returns `{ url } | { base64 } | { path }`，或 undefined。
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
 * 从 `get_file` 一类响应里读出载荷。
 * @param response - action 的 `data`。
 * @returns 载荷来源，或 undefined。
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
 * 把一个 URL 抓成 Buffer，流式读取时即守住字节上限。
 * @param url - http(s) URL。
 * @param maxBytes - 字节上限。
 * @param timeoutMs - 中止期限。
 * @returns `{ ok: true, bytes, contentType }` 或 `{ ok: false, reason }`。
 */
async function fetchToBuffer(url, maxBytes, timeoutMs = FETCH_TIMEOUT_MS) {
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
 * 解析一个段的字节来源：先看段字段，再走网关 `get_file` 往返，
 * 最后才是群/私聊的文件 URL action。
 * @param connection - 传输门面（`call`）。
 * @param segment - OneBot 消息段。
 * @param chat - `{ kind, id }`。
 * @returns `{ source }`（url/base64/path 之一）或 `{ reason }`。
 */
async function resolveSegmentSource(connection, segment, chat) {
  const data = segment?.data !== null && typeof segment?.data === 'object' ? segment.data : {}
  const direct = sourceFromData(data)
  if (direct !== undefined) return { source: direct }

  const fileId = String(data.file_id ?? data.file ?? '')
  if (fileId === '' || typeof connection?.call !== 'function') {
    return { reason: 'no downloadable source on the segment' }
  }

  // 图片/语音/视频/文件：get_file 把网关侧 id 解析成 URL。
  try {
    const response = await connection.call('get_file', { file_id: fileId })
    const got = sourceFromResponse(response)
    if (got !== undefined) return { source: got }
  } catch {
    // 继续走文件专用的 action
  }

  if (segment.type === 'file') {
    // 这两个是插件自己发起的传输调用，不在 `onebot_call` 的允许清单里：
    // `get_group_file_url` / `get_private_file_url` 故意不进目录，这样裁剪
    // 目录不会弄坏入站下载，此处也不该被读成工具名。
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
      // 文件 URL 也没拿到
    }
  }
  return { reason: 'the gateway did not return a download URL' }
}

/**
 * 取到一个已解析来源的字节，同时守住大小上限。
 * @param source - `{ url } | { base64 } | { path }`。
 * @param maxBytes - 字节上限。
 * @returns `{ ok: true, bytes, contentType }` 或 `{ ok: false, reason }`。
 */
async function readSourceBytes(source, maxBytes) {
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
 * 一个已保存（或失败）媒体段的占位符文本。
 * @param kind - image / record / video / file。
 * @param path - 已保存的路径；失败时为 undefined。
 * @param name - 文件的展示名。
 * @param transcript - 语音转写文本，若已取得。
 * @returns 面向模型的占位符。
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
 * 下载并保存一个媒体段。
 * @param options - `{ segment, chatId, chat, connection, config, messageId, log }`。
 * @returns `{ placeholder, saved?, warning? }`。
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

  // 语音：只走标准协议下载文件，不自行调用非标准 action；把本地路径与网关
  // 消息 id 交给模型，提示词再引导它调用 `fetch_ptt_text` 取 QQ 的转写，
  // 这样插件里硬编码的 action 全是标准接口。
  let placeholder = mediaPlaceholder(kind, path, suggested !== '' ? suggested : undefined)
  if (kind === 'record' && typeof messageId === 'string' && messageId !== '') {
    placeholder += '（消息ID: ' + messageId + '）'
  }
  return {
    placeholder,
    saved: { kind, path, bytes: read.bytes.length },
  }
}

/**
 * 为一条入站消息生成面向模型的文本，沿途把媒体落盘。
 *
 * 文本/at/表情等段与 `flattenMessage` 对齐，但每个媒体段都会下载并改写成
 * 本地路径，模型可直接读取。
 * @param options - `{ segments, chatId, chat, connection, config, messageId, log }`。
 * @returns `{ text, saved, warnings }`。
 */
export async function buildInboundText({ segments, chatId, chat, connection, config, messageId, log }) {
  const saved = []
  const warnings = []
  const record = (note) => {
    if (typeof log === 'function') log(note)
  }
  if (typeof segments === 'string') return { text: unescapeCq(segments), saved, warnings }
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
    if (type === 'face' || type === 'mface') {
      parts.push('[表情]')
      continue
    }
    if (type === 'reply') continue
    if (type === 'forward' || type === 'node') {
      parts.push('[合并转发]')
      continue
    }
    if (MEDIA_KINDS.includes(type)) {
      const outcome = await ingestSegment({ segment, chatId, chat, connection, config, messageId, log: record })
      if (outcome.warning !== undefined) warnings.push(outcome.warning)
      if (outcome.saved !== undefined) saved.push(outcome.saved)
      parts.push(outcome.placeholder)
      continue
    }
    // 其余段（json/xml 卡片、音乐、位置、名片等）也要有占位符，
    // 否则整条消息会被摊成 '' 并被静默丢弃。
    if (type !== '') {
      const placeholder = segmentPlaceholder(type, data)
      if (placeholder !== '') parts.push(placeholder)
    }
  }
  return { text: parts.join('').trim(), saved, warnings }
}

/**
 * CQ 字符串的最小回退解析（没有 URL 时无法下载媒体）。
 * @param raw - CQ 字符串。
 * @returns 带方括号占位符的纯文本。
 */
export function unescapeCq(raw) {
  return String(raw)
    // 富卡片段先匹配，再解码实体 —— 此时其载荷里的方括号还是 `&#91;`/`&#93;`。
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
 * 删除一个已保存的入站文件（回合结束后的清理与测试在用）。
 * @param path - 要删除的文件。
 */
export async function removeInbound(path) {
  try {
    await rm(path, { force: true })
  } catch {
    // 尽力而为
  }
}
