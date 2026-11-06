import { tmpdir } from 'node:os'
import { basename, resolve } from 'node:path'
import { lstat, readFile, stat, unlink } from 'node:fs/promises'
import { dshHome } from './config.js'

/**
 * 桥接聊天里的媒体段发送。
 *
 * 回复通道只产出文本，图片 / 语音 / 文件必须作为显式消息段发出，并让网关
 * 拿到它读得懂的字节。支持三种来源：`url`、`base64`、本机 `path`（就地读成
 * base64）。硬性大小上限防止一次调用把几百兆塞进 WebSocket。
 */

/** 本模块单次转发的媒体上限（字节）。 */
export const MAX_MEDIA_BYTES = 20 * 1024 * 1024

/** `buildSegment` 接受的段类型。 */
export const MEDIA_KINDS = Object.freeze(['image', 'record', 'video', 'file'])

/**
 * 构造一个 OneBot 媒体段。
 *
 * `file` 是所有媒体段通用的字段，值可以是 URL、`file:///` 路径或
 * `base64://<payload>`；`name` 只对文件有意义。
 * @param kind - image / record / video / file。
 * @param source - `{ url?, base64? }`。
 * @param name - 可选的文件显示名。
 * @returns 消息段。
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
 * 把本机文件读成 base64，并执行大小上限。
 * @param path - 本机文件路径。
 * @returns `{ ok: true, base64 }` 或 `{ ok: false, reason }`。
 */
export async function readFileAsBase64(path) {
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
 * 构造一条待发消息的有序段列表。
 *
 * `send_msg` 接受混合段数组，所以文字和它的图片作为一条消息发出，而不是两条。
 * @param options - `{ text?, kind?, url?, base64?, name? }`。
 * @returns 段数组；既无文字也无媒体时为空。
 */
export function buildMessageSegments(options) {
  const segments = []
  const text = String(options?.text ?? '').trim()
  if (text !== '') segments.push({ type: 'text', data: { text } })
  const kind = String(options?.kind ?? '')
  if (MEDIA_KINDS.includes(kind)) {
    if (typeof options.base64 === 'string' && options.base64 !== '') {
      segments.push(buildSegment(kind, { base64: options.base64 }, options.name))
    } else if (typeof options.url === 'string' && options.url !== '') {
      segments.push(buildSegment(kind, { url: options.url }, options.name))
    }
  }
  return segments
}

/**
 * 一次 `send_msg` 调用的参数。
 *
 * `send_msg` 是唯一的发送接口：它接受 `message_type` 加上对应 id，以及一个
 * 可混排文字与图片 / 语音 / 视频 / 文件的段数组。
 * @param chatType - `private` 或 `group`。
 * @param chatId - 数字目标。
 * @param segments - 有序段数组。
 * @returns 动作参数。
 */
export function sendMsgParams(chatType, chatId, segments) {
  const id = Number(chatId)
  return chatType === 'group'
    ? { message_type: 'group', group_id: id, message: segments }
    : { message_type: 'private', user_id: id, message: segments }
}

/**
 * 通过统一的 `send_msg` 动作发送一条消息。
 *
 * 复用网关已有的单一发送接口，而不是分别拼 `send_group_msg` /
 * `send_private_msg`：这样文字、图片、语音、视频、文件可以共用一个段数组。
 * @param connection - 在线 `connection` 门面（提供 `call`）。
 * @param options - `{ chatType, chatId, text?, kind?, url?, base64?, path?, name? }`。
 * @returns `{ ok, data?, error? }`。
 */
export async function sendMedia(connection, options) {
  const chatType = options.chatType === 'group' ? 'group' : (options.chatType === 'private' ? 'private' : '')
  const chatId = String(options.chatId ?? '').trim()
  if (chatType === '') return { ok: false, error: 'chatType must be group or private' }
  if (!/^[0-9]+$/.test(chatId)) return { ok: false, error: 'chatId must be numeric' }

  const text = String(options.text ?? '')
  const kind = String(options.kind ?? '')
  if (text.trim() === '' && kind === '') {
    return { ok: false, error: 'give text, a media item, or both' }
  }
  if (kind !== '' && !MEDIA_KINDS.includes(kind)) {
    return { ok: false, error: 'kind must be one of ' + MEDIA_KINDS.join(', ') }
  }
  // 只有图片能和文字同条发送；语音、视频、文件各自单发，客户端不会把说明和
  // 它们并排呈现，所以这里直接拒绝而不是发出奇怪的东西。
  if (text.trim() !== '' && kind !== '' && kind !== 'image') {
    return { ok: false, error: 'text can only accompany an image; send ' + kind + ' on its own' }
  }

  // 只有媒体项才需要读取载荷，纯文字跳过全部这一步。
  let source
  if (kind !== '') {
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
  }

  const segments = buildMessageSegments({ text, kind, ...source, name: options.name })
  if (segments.length === 0) return { ok: false, error: 'nothing to send' }
  const params = sendMsgParams(chatType, chatId, segments)
  try {
    const data = await connection.call('send_msg', params)
    // 源文件只在网关确认接收、且调用方要求时才删除；结果经 `onCleanup` 进日志，
    // 不进工具结果——模型只需要知道发没发出去。
    if (options.deleteSource === true && typeof options.path === 'string' && options.path !== '') {
      const result = await safeUnlink(options.path)
      if (typeof options.onCleanup === 'function') {
        options.onCleanup(result.ok === true ? 'deleted' : 'kept: ' + result.reason)
      }
    }
    return { ok: true, data }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}

/**
 * 允许删除源文件的目录白名单。
 *
 * 删除模型给出的任意绝对路径，离误删重要文件只差一次糟糕的提示词，所以删除
 * 只限临时目录与工作区；其余一律保留并如实回报。
 * @returns 允许的根目录，已 resolve。
 */
function allowedDeleteRoots() {
  return [resolve(tmpdir()), '/workspace', resolve(dshHome())]
}

/**
 * 删除一个已发送的源文件，越出白名单即拒绝。
 * @param target - 配置里给出的路径。
 * @returns `{ ok: true }` 或 `{ ok: false, reason }`。
 */
export async function safeUnlink(target) {
  const absolute = resolve(String(target ?? ''))
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
    if (error?.code === 'ENOENT') return { ok: true }  // 已经不在了：无事可做
    return { ok: false, reason: String(error?.message ?? error) }
  }
}


/**
 * 回复里用来附带媒体的标记，例如 `[[image:/tmp/a.png]]`。
 *
 * 助手只产出文本，因此需要一套桥接层可解析的约定；双方括号避免与正文冲突，
 * 四个类型名与工具的 `kind` 取值一致。
 */
const MEDIA_MARKER_PATTERN = /\[\[(image|record|video|file):([^\[\]]+)\]\]/g

/**
 * 把一条扁平回复的段列表切成它实际可发的若干条消息。
 *
 * 只有图片能和文字同条；语音、视频、文件各自单发，因此文本串会在非图片媒体
 * 处断开：它之前的段成一条，媒体项自成一条，其后的段重新开始。
 * @param segments - `buildReplySegments` 产出的有序段。
 * @returns 段数组的数组，每项对应一条外发消息。
 */
export function groupReplySegments(segments) {
  const list = Array.isArray(segments) ? segments : []
  const messages = []
  let current = []
  const flush = () => {
    if (current.length > 0) messages.push(current)
    current = []
  }
  for (const segment of list) {
    if (segment !== null && typeof segment === 'object' && segment.type !== 'text' && segment.type !== 'image') {
      // 独立附件：不能与任何文字同行。
      flush()
      messages.push([segment])
      continue
    }
    current.push(segment)
  }
  flush()
  return messages
}

/**
 * 把一条回复的文字转成有序段列表。
 *
 * 标记两侧的文字保持原序，说明可以在图片之前或之后。标记指向的文件缺失或过大
 * 时，替换成一句简短提示，而不是让整条回复失败。
 * @param text - 缓冲的回复文本。
 * @returns `{ segments, warnings, sourcePaths }`；`sourcePaths` 列出被内联的本机
 *   文件，供调用方在发送成功后删除。
 */
export async function buildReplySegments(text) {
  const input = String(text ?? '')
  const segments = []
  const warnings = []
  const sourcePaths = []
  const pushText = (value) => {
    const trimmed = String(value ?? '').trim()
    if (trimmed !== '') segments.push({ type: 'text', data: { text: trimmed } })
  }

  let cursor = 0
  for (const match of input.matchAll(MEDIA_MARKER_PATTERN)) {
    pushText(input.slice(cursor, match.index))
    cursor = match.index + match[0].length
    const kind = match[1]
    const source = match[2].trim()
    const isUrl = /^https?:\/\//i.test(source)
    let built
    if (isUrl) {
      built = buildSegment(kind, { url: source })
    } else {
      const read = await readFileAsBase64(source)
      if (read.ok !== true) {
        // 原始原因带着绝对路径与 errno 字符串，进聊天既无用又泄露目录结构，
        // 所以聊天只看简短提示，完整原因进日志。
        warnings.push(kind + ': ' + read.reason)
        pushText(mediaFailureNotice(kind))
        continue
      }
      built = buildSegment(kind, { base64: read.base64 }, kind === 'file' ? basename(source) : undefined)
      sourcePaths.push(source)
    }
    segments.push(built)
  }
  pushText(input.slice(cursor))

  return { segments, warnings, sourcePaths }
}


/**
 * 媒体附件发不出去时给聊天看的提示。
 *
 * 保持简短且不含路径与 errno：聊天不该知道宿主目录结构，真实原因在日志里。
 * @param kind - image / record / video / file。
 * @returns 一句短提示。
 */
export function mediaFailureNotice(kind) {
  const noun = kind === 'image' ? '图片' : (kind === 'record' ? '语音' : (kind === 'video' ? '视频' : '文件'))
  return '（' + noun + '没发出去：文件不存在或无法读取）'
}
