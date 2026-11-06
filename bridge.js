/** 聊天 ↔ 会话桥：每个 OneBot 聊天对应一个持久 dsh Session。
 * 入站：推送来的消息事件先过分级闸（自己 → 策略 → @提及 → 去重），摊平成文本，
 * 作为一个 follow-up 回合交给该聊天的 agent。
 * 出站：助手文本怎么到聊天里由 `replyMode` 决定。
 * - `stream`（默认）：每条助手消息一产生就发，聊天里能看到回答逐步展开。
 * - `final`：文本块先缓存，回合结束时一次性发出，多步回合只产生一条 QQ 消息。
 * `turn/end` 释放剩余缓冲与这一回合的入站文件。
 * session id 由 chat id 派生，所以重启后无需映射文件即可恢复同一段对话：
 * `agents.resume` 找已落盘的日志，`agents.create` 只在没有时运行。 */

import { mkdir, stat } from 'node:fs/promises'
import { createPluginUserMessage, PLUGIN_SOURCE } from './message.js'
import { computeAllowlist, enabledGroups, GROUP_LABELS } from './toolcatalog.js'
import { DEFAULT_CHANNEL_PROMPT, mediaParagraph, inboundParagraph, senderPrefixParagraph, toolsParagraph, replyModeParagraph, adminParagraph, pokeParagraph, renderPrompt, renderToolCallPrompt } from './prompt.js'
import { buildInboundText, removeInbound, segmentPlaceholder, unknownSegmentTypes, unescapeCq } from './inbound.js'
import { buildReplySegments, groupReplySegments, safeUnlink } from './media.js'

/** 非字母数字一律变成 `-`，让 id 保持文件系统安全。 */
const ID_SAFE = /[^A-Za-z0-9-]/g

/** 为一个入站事件构造规范 chat id。
 * @param messageType - `private` 或 `group`。
 * @param target - 用户或群号。
 * @returns `private:<id>` 或 `group:<id>`。 */
export function chatIdOf(messageType, target) {
  return (messageType === 'group' ? 'group:' : 'private:') + String(target)
}

/** 把规范 chat id 拆回各段。
 * @param chatId - `private:<id>` 或 `group:<id>`。
 * @returns 拆出的 `{ kind, id }` 两段。 */
export function splitChatId(chatId) {
  const at = chatId.indexOf(':')
  if (at <= 0) return { kind: 'private', id: chatId }
  const kind = chatId.slice(0, at)
  return { kind: kind === 'group' ? 'group' : 'private', id: chatId.slice(at + 1) }
}

/** 派生一个聊天的持久 session id。
 * 前缀可配，因为它决定每段对话在侧边栏里的位置：短而好认的前缀让 QQ 会话在
 * 同一 profile 的其他工作里一眼可辨。
 * @param chatId - 规范 chat id。
 * @param prefix - 配置的会话前缀；空前缀表示不加前缀。
 * @returns session id 字符串。 */
export function sessionIdOf(chatId, prefix = 'onebot') {
  const body = chatId.replace(ID_SAFE, '-')
  const head = String(prefix ?? '').trim()
  return head === '' ? body : head + '-' + body
}

/** 判断已消耗上下文是否达到压力阈值。
 * @param threshold - (0, 1] 区间的比例；0 或负数表示关闭检查。
 * @param used - 已测得的压力 token 数。
 * @param window - 模型的上下文窗口 token 数。
 * @returns `used / window >= threshold` 时返回 true。 */
export function ratioReached(threshold, used, window) {
  const limit = Number(threshold)
  const consumed = Number(used)
  const capacity = Number(window)
  if (!(limit > 0) || !Number.isFinite(consumed) || !Number.isFinite(capacity) || capacity <= 0) return false
  return consumed / capacity >= limit
}

/** 把 OneBot 消息段摊平成模型可读的文本。
 * 非文本段变成方括号占位符：模型因此知道来了图片或语音，而插件不必下载任何东西。
 * @param segments - `message` 字段（段数组或 CQ 字符串）。
 * @returns 摊平后的文本。 */
export function flattenMessage(segments) {
  if (typeof segments === 'string') return unescapeCq(segments)
  if (!Array.isArray(segments)) return ''
  const parts = []
  for (const seg of segments) {
    if (seg === null || typeof seg !== 'object') continue
    const type = String(seg.type ?? '')
    const data = seg.data !== null && typeof seg.data === 'object' ? seg.data : {}
    if (type === 'text') {
      parts.push(String(data.text ?? ''))
      continue
    }
    if (type === 'at') {
      const qq = String(data.qq ?? '')
      if (qq === 'all') parts.push('@全体成员')
      continue
    }
    if (type === 'image') {
      parts.push('[图片]')
      continue
    }
    if (type === 'record') {
      parts.push('[语音]')
      continue
    }
    if (type === 'video') {
      parts.push('[视频]')
      continue
    }
    if (type === 'file') {
      parts.push('[文件]')
      continue
    }
    if (type === 'face') {
      parts.push('[表情]')
      continue
    }
    // 其余非文本段（json/xml 卡片、合并转发、音乐、位置…）也要占位，
    // 否则只有一张卡片的消息会被摊成 '' 并在到达模型前被静默丢弃。
    if (type !== '') {
      const placeholder = segmentPlaceholder(type, data)
      if (placeholder !== '') parts.push(placeholder)
    }
  }
  return parts.join('').trim()
}

/** 判断群消息是否在叫机器人。
 * 失败即闭嘴：拿不到机器人账号时群消息永远不算被提及，机器人宁可沉默，也不要
 * 对每条消息都应答。
 * @param frame - 消息事件。
 * @param botId - 机器人自己的账号 id，可能为空。
 * @returns 是否被叫到。 */
export function isAddressed(frame, botId) {
  if (botId === '') return false
  const segments = frame.message
  if (Array.isArray(segments)) {
    for (const seg of segments) {
      if (seg === null || typeof seg !== 'object') continue
      if (seg.type !== 'at') continue
      if (String(seg?.data?.qq ?? '') === botId) return true
    }
  } else if (typeof segments === 'string') {
    if (/\[CQ:at,qq=([^\],]+)/.test(segments)) {
      const match = /\[CQ:at,qq=([^\],]+)/.exec(segments)
      if (match !== null && match[1] === botId) return true
    }
  }
  if (typeof frame.raw_message === 'string') {
    const match = /\[CQ:at,qq=([^\],]+)/.exec(frame.raw_message)
    if (match !== null && match[1] === botId) return true
  }
  return false
}

/**
 * 判断一帧是不是戳一戳通知。
 *
 * OneBot 11 把戳一戳报成通知事件：`post_type: notice`、`notice_type: notify`、
 * `sub_type: poke`。有的实现会省掉 `sub_type`，所以只要通知类型是 notify 且同时
 * 带了戳人者与被戳者就认。
 * @param frame - 事件帧。
 * @returns 是戳一戳则为 true。
 */
export function isPoke(frame) {
  if (frame === null || typeof frame !== 'object') return false
  if (frame.post_type !== 'notice') return false
  if (String(frame.notice_type ?? '') !== 'notify') return false
  const sub = String(frame.sub_type ?? '')
  if (sub !== '' && sub !== 'poke') return false
  // `target_id` 不是每台网关都给（实测有的只带 user_id / group_id），所以只要求
  // 有戳人者；缺 target_id 时按「戳的是机器人」处理，否则整条事件会被漏掉。
  return String(frame.user_id ?? '') !== ''
}

/**
 * 戳一戳事件涉及的聊天：带群号算群聊，其余算私聊。
 * @param frame - 戳一戳事件。
 * @returns `{ chatId, chat, poker, target }`。
 */
export function pokeTarget(frame) {
  const groupId = String(frame.group_id ?? '')
  const poker = String(frame.user_id ?? '')
  const target = String(frame.target_id ?? '')
  const kind = groupId !== '' ? 'group' : 'private'
  const chatId = chatIdOf(kind, kind === 'group' ? groupId : poker)
  return { chatId, chat: splitChatId(chatId), poker, target }
}

/**
 * 戳一戳交给模型看的文本。
 *
 * 群里要带上戳人者，否则模型不知道是谁在戳；戳自己的那次值得回答，戳别人的
 * 只作为上下文。
 * @param frame - 戳一戳事件。
 * @param botId - 机器人自己的账号，可能为空。
 * @param chatKind - `private` 或 `group`。
 * @returns 一行模型可读的描述。
 */
export function pokeText(frame, botId, chatKind) {
  const poker = String(frame.user_id ?? '')
  const name = String(frame.sender?.card || frame.sender?.nickname || poker)
  const self = botId !== '' && poker === botId
  if (chatKind === 'group') {
    return self ? '[戳一戳] 你在群里戳了别人' : '[戳一戳] ' + name + '(' + poker + ') 在群里戳了你'
  }
  return self ? '[戳一戳] 你戳了对方' : '[戳一戳] ' + name + '(' + poker + ') 戳了你'
}

/** 给群消息加上发言人前缀，让模型能区分参与者。私聊不需要前缀。
 * @param frame - 消息事件。
 * @param chatKind - `private` 或 `group`。
 * @param enabled - 前缀是否配置为开。
 * @returns 前缀（可能为空）。 */
export function speakerPrefix(frame, chatKind, enabled) {
  if (!enabled || chatKind !== 'group') return ''
  const sender = frame.sender !== null && typeof frame.sender === 'object' ? frame.sender : {}
  const name = String(sender.card || sender.nickname || 'unknown')
  const id = String(frame.user_id ?? '')
  const clock = new Date(typeof frame.time === 'number' ? frame.time * 1000 : Date.now())
  const hh = String(clock.getHours()).padStart(2, '0')
  const mm = String(clock.getMinutes()).padStart(2, '0')
  return '[' + hh + ':' + mm + ' ' + name + '(' + id + ')] '
}

/** 解析一个 `provider::model` 配置串。
 * 用 `::` 分隔，模型 id 里自带的斜杠因此不会被截断。
 * @param text - 配置值。
 * @returns `{ provider, model }`；格式不完整时返回 undefined。 */
function parseModelRef(text) {
  const configured = String(text ?? '').trim()
  const at = configured.indexOf('::')
  if (at <= 0) return undefined
  const provider = configured.slice(0, at)
  const model = configured.slice(at + 2)
  if (provider === '' || model === '') return undefined
  return { provider, model }
}

/** 删除一回合的入站文件（尽力而为）。
 * @param log - 日志总线。
 * @param chatId - 规范 chat id。
 * @param paths - 要删除的路径。 */
function unlinkInbound(log, chatId, paths) {
  if (!Array.isArray(paths) || paths.length === 0) return
  for (const path of paths) {
    removeInbound(path).then(() => {
      log.record('bridge', { note: 'inbound media source removed', chatId, path })
    }).catch(() => {
      // removeInbound 不会抛，但清理也绝不能打断一个回合。
    })
  }
}

/** 桥。每次插件挂载一个实例。
 * 桥。每次插件挂载一个实例。 */
export class ChatBridge {
  /** 依赖注入：`ctx`、`config`、`connection`、`log`、`sessionTitle`
 * （可选服务）、`describeError`。 */
  constructor({ ctx, config, connection, log, sessionTitle, getWorkspaceRegistry, getAgentPresets, getPermissionPresets, describeError }) {
    this.ctx = ctx
    this.config = config
    this.connection = connection
    this.log = log
    this.sessionTitle = sessionTitle
    this.getWorkspaceRegistry = getWorkspaceRegistry
    this.getAgentPresets = getAgentPresets
    this.getPermissionPresets = getPermissionPresets
    this.describeError = describeError ?? ((error) => String(error?.message ?? error))

    /** chatId → 聊天记录。 */
    this.chats = new Map()
    /** sessionId → chatId，供会话事件流反查。 */
    this.bySession = new Map()
    /** chatId → 进行中的创建 promise（并发首条消息折叠成一次创建）。 */
    this.pendingCreates = new Map()
    /** chatId → 当前回合累积的助手文本（`final` 模式）。 */
    this.buffers = new Map()
    /** `stream` 模式的投递状态，每个聊天一项：
 * - streamQueues：chatId → 串行化流式发送的 promise 链，两条助手消息绝不会
 * 乱序；
 * - sentThisTurn：本回合已经流式发过的 chatId，出错的回合因此不必再补一条
 * 「回合失败」提示。 */
    this.streamQueues = new Map()
    this.sentThisTurn = new Set()
    /** 入站媒体清理，只在 `deleteInboundMedia` 打开时使用：
 * - inboundQueue：chatId → 待开始回合的文件批次 FIFO（每条排队消息一批）；
 * - inboundCurrent：chatId → 正在运行的这一回合的路径。
 * 把路径绑到回合上，排队消息的文件才不会在自己的回合读到之前就被删掉。 */
    this.inboundQueue = new Map()
    this.inboundCurrent = new Map()
    /** chatId → 已处理过的消息 id（重连重放防护）。 */
    this.seen = new Map()
    this.dedupWindowMs = 300000
    this.dedupMax = 2000
    this.stopping = false
    /** 最近一次校验过的工作区路径与时刻（epoch 毫秒），避免每条消息都 stat。 */
    this.workspaceCheckedPath = ''
    this.workspaceCheckedAt = 0
  }

  /** 应用运行中的配置变更（配置页可以在运行时保存）。
 * @param config - 新的生效配置。 */
  reconfigure(config) {
    // 一次保存就是一次「现在重新校验」：丢掉工作区校验缓存，
    // 于是期间被删掉的工作区会在下一条消息时重建。
    this.workspaceCheckedPath = ''
    this.workspaceCheckedAt = 0
    this.config = config
  }

  /** 订阅会话事件流。
 * @returns 取消订阅用的 disposer。 */
  start() {
    this.stopping = false
    return this.ctx.on('session/event', (session, event) => this.onSessionEvent(session, event))
  }

  /** 释放每个聊天并停止响应事件。
 * 释放每个聊天并停止响应事件。 */
  async stop() {
    this.stopping = true
    const chats = [...this.chats.values()]
    this.chats.clear()
    this.bySession.clear()
    this.buffers.clear()
    this.streamQueues.clear()
    this.sentThisTurn.clear()
    this.inboundQueue.clear()
    this.inboundCurrent.clear()
    this.seen.clear()
    this.pendingCreates.clear()
    for (const chat of chats) {
      try {
        await chat.dispose()
      } catch {
        // 单个 dispose 失败不得挡住其余收尾。
      }
    }
  }

  /** 记录一条错误日志（统一 `X failed for <id>` 模板）。
 * @param stage - 失败环节，如 `agent creation failed`。
 * @param chatId - 目标 chat id（也用于工作区路径等标识）。
 * @param error - 原始错误。 */
  recordError(stage, chatId, error) {
    this.log.record('error', { note: stage + ' for ' + chatId, error: this.describeError(error) })
  }

  /**
   * 处理一次戳一戳：过闸 → 可选反戳 → 交给模型回答。
   *
   * 戳一戳没有消息段，所以不走消息闸里的去重、@ 判定与媒体下载；但访问闸
   * （黑白名单）照旧生效，否则戳一下就能绕过访问控制。
   * @param frame - 戳一戳事件帧。
   */
  async handlePoke(frame) {
    if (this.config.pokeEvents === false) return
    const { chatId, chat, poker, target } = pokeTarget(frame)
    const botId = this.connection.selfId
    // 戳的是不是机器人。缺 `target_id` 的网关无法区分「戳我」与「戳别人」，按戳我
    // 处理：宁可多答一句，也不要让真实的戳一戳被吞掉。
    const pokedMe = target === '' || botId === '' || target === botId
    // 戳别人的那次只是群里的互动，没有要模型回答的事，不打扰它。
    if (!pokedMe && chat.kind === 'group') return
    // 自己戳自己（机器人发起的那次）同样不必再答一遍。
    if (botId !== '' && poker === botId) return

    const allow = chat.kind === 'private' ? this.config.allowFrom : this.config.allowGroups
    const deny = chat.kind === 'private' ? this.config.denyFrom : this.config.denyGroups
    if (Array.isArray(deny) && deny.length > 0 && deny.includes(chat.id)) {
      this.log.record('bridge', { note: 'poke ignored: chat is blacklisted', chatId, poker })
      return
    }
    if (Array.isArray(allow) && allow.length > 0 && !allow.includes(chat.id)) {
      this.log.record('bridge', { note: 'poke ignored: chat is not allowed', chatId, poker })
      return
    }
    this.log.record('bridge', { note: 'poke received', chatId, poker, target: target === '' ? '(unknown)' : target })

    // 反戳：只有运营方打开开关、且戳的确实是机器人时才戳回去，否则两个机器人
    // 会互相戳个没完。
    if (this.config.pokeBack === true && pokedMe) {
      try {
        const params = chat.kind === 'group'
          ? { group_id: Number(chat.id), user_id: Number(poker) }
          : { user_id: Number(poker) }
        await this.connection.call('send_poke', params)
        this.log.record('bridge', { note: 'poked back', chatId, poker })
      } catch (error) {
        // 有的网关不实现 send_poke；戳不回去不该影响后面把话说完。
        this.log.record('warn', { note: 'poke back failed: ' + this.describeError(error), chatId })
      }
    }

    const text = pokeText(frame, botId, chat.kind)
    await this.dispatch(chatId, chat, text, frame, [])
  }

  /** 处理一个推送来的 OneBot 事件。
 * @param frame - 事件帧。 */
  async handleInbound(frame) {
    if (this.stopping) return
    if (frame === null || typeof frame !== 'object') return
    // 戳一戳是通知类事件而不是消息，单独处理：它没有 message 段，也不该走消息闸。
    if (isPoke(frame)) return this.handlePoke(frame)
    if (frame.post_type !== 'message') return
    if (frame.message_type !== 'private' && frame.message_type !== 'group') return

    const userId = String(frame.user_id ?? '')
    const groupId = String(frame.group_id ?? '')
    if (userId === '') return

    const botId = this.connection.selfId
    if (botId !== '' && userId === botId) return

    const chatId = chatIdOf(frame.message_type, frame.message_type === 'group' ? groupId : userId)
    const chat = splitChatId(chatId)

    // 访问闸，先拒后允：黑名单里的聊天永远拒绝，非空白名单则把通道收窄到名单内。
    // 空白名单表示「不限制」，这也是默认值。
    const allow = chat.kind === 'private' ? this.config.allowFrom : this.config.allowGroups
    const deny = chat.kind === 'private' ? this.config.denyFrom : this.config.denyGroups
    if (Array.isArray(deny) && deny.length > 0 && deny.includes(chat.id)) {
      this.log.record('bridge', { note: (chat.kind === 'private' ? 'private chat' : 'group') + ' is blacklisted', chatId })
      return
    }
    if (Array.isArray(allow) && allow.length > 0 && !allow.includes(chat.id)) {
      this.log.record('bridge', { note: (chat.kind === 'private' ? 'private chat not in allowFrom' : 'group not in allowGroups'), chatId })
      return
    }

    const messageId = String(frame.message_id ?? '')
    if (messageId !== '' && this.duplicated(chatId, messageId)) {
      this.log.record('bridge', { note: 'duplicate message skipped', chatId, messageId })
      return
    }

    if (chat.kind === 'group' && this.config.requireMention && !isAddressed(frame, botId)) {
      return
    }

    // 入站媒体会下载到本地收件箱并改写成可读路径，模型因此能用 read_image 看图、
    // 用 read 读文件。关掉后降级为不指名的裸占位符。
    let body
    // 本条消息刚下载的文件路径；只有运营方打开 `deleteInboundMedia` 时才跟踪清理。
    let savedPaths = []
    if (this.config.inboundMedia !== false) {
      const outcome = await buildInboundText({
        segments: frame.message,
        chatId,
        chat,
        connection: this.connection,
        config: this.config,
        messageId,
        log: (note) => this.log.record('bridge', { note, chatId }),
      })
      for (const warning of outcome.warnings) {
        this.log.record('warn', { note: 'inbound media skipped: ' + warning, chatId })
      }
      body = outcome.text
      if (this.config.deleteInboundMedia === true) {
        savedPaths = outcome.saved
          .map((item) => (item !== null && typeof item === 'object' ? item.path : undefined))
          .filter((path) => typeof path === 'string' && path !== '')
      }
    } else {
      body = flattenMessage(frame.message)
    }
    // 绝不能让聊天无人应答：一条消息若什么都变不成模型输入（没见过的段类型、
    // 只有一个回复标记、空文本），就明确回一句「暂时不能处理」而不是沉默。
    if (body === '') {
      const unknown = unknownSegmentTypes(frame.message)
      const notice = unknown.length > 0
        ? '暂时不能处理这种消息（' + unknown.join('/') + '）'
        : '暂时不能处理这条消息'
      this.log.record('bridge', { note: 'unsupported message; sending notice', chatId, kinds: unknown.join(',') })
      await this.sendNotice(chatId, chat, notice)
      return
    }

    const text = speakerPrefix(frame, chat.kind, this.config.senderPrefix) + body
    await this.dispatch(chatId, chat, text, frame, savedPaths)
  }

  /** 记录一个消息 id 并报告它是否刚刚出现过。
 * @param chatId - 规范 chat id。
 * @param messageId - 网关消息 id。
 * @returns 这个 id 是否已处理过。 */
  duplicated(chatId, messageId) {
    const now = Date.now()
    const key = chatId + '#' + messageId
    const previous = this.seen.get(key)
    if (previous !== undefined && now - previous < this.dedupWindowMs) return true
    this.seen.set(key, now)
    if (this.seen.size > this.dedupMax) {
      for (const [staleKey, at] of this.seen) {
        if (now - at >= this.dedupWindowMs) this.seen.delete(staleKey)
      }
      while (this.seen.size > this.dedupMax) {
        const oldest = this.seen.keys().next()
        if (oldest.done === true) break
        this.seen.delete(oldest.value)
      }
    }
    return false
  }

  /** 把一条用户消息投递给该聊天的 agent。
 * @param chatId - 规范 chat id。
 * @param chat - 拆开的 chat id。
 * @param text - 面向模型的文本。
 * @param frame - 源事件（用于日志）。
 * @param savedPaths - 本条消息产生的入站文件，供清理用。 */
  async dispatch(chatId, chat, text, frame, savedPaths = []) {
    // 工作区随时可能被删；投递前重新校验，已存在的聊天因此也能在删除后落回真实工作区。
    await this.ensureWorkspace()
    let record
    try {
      record = await this.ensureChat(chatId)
    } catch (error) {
      this.recordError('agent creation failed', chatId, error)
      return
    }
    this.log.record('bridge', {
      note: 'dispatching to agent',
      chatId,
      sessionId: record.sessionId,
      length: text.length,
      messageId: String(frame.message_id ?? ''),
    })
    // 幂等：每条消息都重挂一次，让落成未分组（例如 resume 造出了新 id、或挂载
    // 早于工作区注册表就绪）的会话在下一条消息时自愈。
    await this.attachWorkspace(record.sessionId)
    // 私聊直接插话进正在写的回答：同一个人是在补充或修正，另起回合会答两遍。
    // 这里不涉及任何模型判断。
    const interjectOn = chat.kind === 'private' && this.config.privateAutoInterject !== false
    if (interjectOn && record.agent?.status === 'running' && typeof record.agent?.steer === 'function') {
      try {
        const message = await createPluginUserMessage({ content: [{ type: 'text', text }], source: PLUGIN_SOURCE })
        record.agent.steer(message)
        // 插话的消息并入正在运行的回合，因此它的文件在该回合结束时清理。
        if (savedPaths.length > 0) this.bindTurnInbound(chatId, savedPaths)
        this.log.record('bridge', { note: 'steered into the running turn', chatId, length: text.length })
        return
      } catch (error) {
        this.log.record('warn', { note: 'steer failed; falling back to a follow-up', chatId, error: this.describeError(error) })
      }
    }

    await this.sendToAgent(chatId, record, text, frame, savedPaths)
  }

  /** 把一条消息直接送给该聊天的 agent。
 * @param chatId - 规范 chat id。
 * @param record - 聊天记录。
 * @param text - 消息文本。
 * @param frame - 来源事件，用于日志。
 * @param savedPaths - 本条消息产生的入站文件，供清理用。 */
  async sendToAgent(chatId, record, text, frame, savedPaths = []) {
    // 把本条消息的文件排到它的 follow-up 将开启的那个回合上。批次在 `turn/start`
    // 弹出，因此还堵在运行中回合后面的消息，其文件不会被前一个回合的结束带走。
    if (savedPaths.length > 0) this.queueInbound(chatId, savedPaths)
    try {
      // 「先压缩再作答」：会话压力达到配置比例时，在这条消息变成下一回合前先压缩。
      try {
        await this.maybeCompact(chatId, record)
      } catch {
        // 压缩是尽力而为；这里失败绝不能挡住回答。
      }
      const message = await createPluginUserMessage({
        content: [{ type: 'text', text }],
        source: PLUGIN_SOURCE,
      })
      record.agent.followup(message)
      this.log.record('bridge', {
        note: 'delivered to agent',
        chatId,
        length: text.length,
        messageId: String(frame?.message_id ?? ''),
      })
    } catch (error) {
      // 这一批永远不会等到 turn/start，撤销入队，而不是把文件占位泄漏出去。
      if (savedPaths.length > 0) this.dropLastInbound(chatId)
      this.recordError('delivery failed', chatId, error)
    }
  }

  /** 上下文压力达到 `compactRatio` 时，在下一个回答前压缩该聊天的会话。
 * 用 harness 的 token 计量器读最近一次压力，用活的压缩服务压缩空闲历史。全部
 * 尽力而为：服务缺失、会话未计量、比例关闭、agent 忙，都不动这个回合，用户照
 * 样拿到回答。
 * @param chatId - 规范 chat id（用于日志）。
 * @param record - 持有活 agent 的聊天记录。 */
  async maybeCompact(chatId, record) {
    const threshold = Number(this.config.compactRatio)
    if (!(threshold > 0)) return
    const agent = record?.agent
    if (agent === undefined || agent === null) return
    if (typeof this.ctx?.get !== 'function') return
    const meter = this.ctx.get('tokenMeter')
    if (meter === undefined || typeof meter.contextPressure !== 'function') return
    let pressure
    try {
      pressure = meter.contextPressure(agent.session)
    } catch {
      return
    }
    const used = Number(pressure?.pressureTokens)
    const window = Number(pressure?.contextWindow)
    if (!ratioReached(threshold, used, window)) return
    const ratio = Number((used / window).toFixed(3))
    const compaction = this.ctx.get('compaction')
    if (compaction === undefined || typeof compaction.compactNow !== 'function') {
      this.log.record('warn', { note: 'context ratio reached but no compaction service; answering without compacting', chatId, ratio })
      return
    }
    try {
      const result = await compaction.compactNow(agent, new AbortController().signal)
      this.log.record('bridge', {
        note: result === null ? 'context ratio reached; nothing safe to compact' : 'context compacted before reply',
        chatId,
        ratio,
      })
    } catch (error) {
      // 忙（回合或排队工作占着 agent）或摘要器失败，都不能挡住用户的消息；
      // 记一笔，然后用当前历史作答。
      this.log.record('warn', { note: 'pre-reply compaction skipped: ' + this.describeError(error), chatId, ratio })
    }
  }

  /** 把一条消息的文件批次排进该聊天尚未开始的队列。 */
  queueInbound(chatId, paths) {
    const queue = this.inboundQueue.get(chatId) ?? []
    queue.push(paths)
    this.inboundQueue.set(chatId, queue)
  }

  /** 撤销最近一次入队（投递失败时用）。 */
  dropLastInbound(chatId) {
    const queue = this.inboundQueue.get(chatId)
    if (queue === undefined) return
    queue.pop()
    if (queue.length === 0) this.inboundQueue.delete(chatId)
  }

  /** 把文件绑到正在运行的回合。
 * 传 `paths` 时把插话消息的文件追加进当前回合；不传时在 `turn/start` 把最老的
 * 一批排队文件移入当前回合（没有排队批次就清空，免得上一回合的路径串台）。
 * @param chatId - 规范 chat id。
 * @param paths - 插话消息带来的路径；空表示 turn/start 的队列弹出。 */
  bindTurnInbound(chatId, paths = []) {
    if (paths.length > 0) {
      const current = this.inboundCurrent.get(chatId) ?? []
      current.push(...paths)
      this.inboundCurrent.set(chatId, current)
      return
    }
    const queue = this.inboundQueue.get(chatId)
    const next = queue !== undefined && queue.length > 0 ? queue.shift() : undefined
    if (queue !== undefined && queue.length === 0) this.inboundQueue.delete(chatId)
    if (next !== undefined) this.inboundCurrent.set(chatId, next)
    else this.inboundCurrent.delete(chatId)
  }

  /** 取走（并忘掉）即将结束的回合绑定的文件。
 * @returns 要删除的路径，可能为空。 */
  takeInbound(chatId) {
    const paths = this.inboundCurrent.get(chatId)
    this.inboundCurrent.delete(chatId)
    return Array.isArray(paths) ? paths : []
  }

  /** 让聊天拿到一个新 agent，或复用已存在的那个。
 * @param chatId - 规范 chat id。
 * @returns 聊天记录。 */
  async ensureChat(chatId) {
    const existing = this.chats.get(chatId)
    if (existing !== undefined) return existing
    const pending = this.pendingCreates.get(chatId)
    if (pending !== undefined) return pending
    const creation = this.createChat(chatId)
    this.pendingCreates.set(chatId, creation)
    try {
      return await creation
    } finally {
      this.pendingCreates.delete(chatId)
    }
  }

  /** 恢复该聊天已落盘的会话，或新建一个。
 * @param chatId - 规范 chat id。
 * @returns 聊天记录。 */
  async createChat(chatId) {
    const sessionId = sessionIdOf(chatId, this.config.sessionPrefix)
    // 配置的工作区是必需的，但它的注册可能已被删除 —— 重建它，让 Session 永远
    // 落在真实工作区里，而不是退回宿主 cwd。
    await this.ensureWorkspace(true)
    const meta = {}
    if (this.config.workspacePath !== '') meta.cwd = this.config.workspacePath
    // 只解析一次，然后 header 与 mount 用同一个 id：这样配置后被删掉的 preset
    // 在两边都退回部署默认值，而不是各走一条。
    const presetId = await this.resolveAgentPreset()
    if (presetId !== undefined) meta.agentPreset = presetId

    // 分三步，因为「resume 失败」与「没有这个会话」是两件事：日志存在时 resume
    // 也可能失败（被别处占用、尾部不可读），此时对同一 id 再 create 会报
    // 「already exists」。聊天必须总有一个 agent，所以最后一步退役裸 id 改用带
    // 后缀的 id。
    // 全新 agent 需要 provider 与 model：没有它们第一回合就会以「has no
    // provider/model」失败。恢复的会话已经记录了自己的。
    const agentOptions = this.modelOptions()
    if (agentOptions === undefined) {
      this.log.record('error', {
        note: 'no default model is configured; the agent will fail its first turn',
        chatId,
      })
    }

    let handle
    let created = false
    // 会话可能已经活着：用户可以在 Web UI 里打开某个 QQ 聊天的 Session，那个活
    // agent 占着写句柄。这种状态下 resume 与 create 都会失败（「already owned by
    // an active write handle」/「already exists」），于是改为复用这个活 agent。
    const live = this.ctx.agents.get(sessionId)
    if (live !== undefined) {
      const record = {
        chatId,
        sessionId,
        agent: live,
        // 活 agent 归它的创建者（Web 会话控制器）所有，本插件不得 dispose 它。
        dispose: async () => {},
      }
      this.chats.set(chatId, record)
      this.bySession.set(sessionId, chatId)
      this.log.record('bridge', { note: 'reusing a live agent for this chat', chatId, sessionId })
      // 被复用的 agent 很可能在任何 setup 跑之前就建好了（旧版本，或直接从 Web
      // UI 打开），于是它的工具从未注册。这里把工具注册到插件/全局作用域，让每
      // 个 agent 都能看到。disposer 活到插件结束，这没问题：注册按名字幂等，而
      // 插件不会按聊天卸载。
      // 复用的 agent 保留它被建时的工具视图，所以现在注册可能对它无效。对活
      // agent 的 ctx 重跑整套 setup，会把工具与通道提示词为这段对话重新宣告一遍。
      try {
        const setup = this.buildSetup(await this.resolveAgentPreset(), chatId)
        await setup(live.ctx)
        this.log.record('bridge', { note: 'setup re-applied to the reused agent', chatId })
      } catch (e) {
        this.log.record('warn', { note: 'setup re-apply for the reused agent failed', chatId, error: this.describeError(e) })
      }
      if (this.config.titleEqualsId) this.pinTitle(live.session, sessionId)
      return record
    }

    try {
      handle = await this.ctx.agents.resume({ resumeSessionId: sessionId, setup: this.buildSetup(presetId, chatId) })
      this.log.record('bridge', { note: 'session resumed', chatId, sessionId })
    } catch (resumeError) {
      this.log.record('bridge', {
        note: 'resume failed, trying a fresh session',
        chatId,
        sessionId,
        error: this.describeError(resumeError),
      })
      try {
        handle = await this.ctx.agents.create({ sessionId, meta, agentOptions, setup: this.buildSetup(presetId, chatId) })
        created = true
        this.log.record('bridge', { note: 'session created', chatId, sessionId })
      } catch (createError) {
        const fresh = sessionId + '-' + Date.now().toString(36)
        this.log.record('error', {
          note: 'create failed, falling back to a suffixed session id',
          chatId,
          sessionId,
          fallback: fresh,
          error: this.describeError(createError),
        })
        handle = await this.ctx.agents.create({ sessionId: fresh, meta, agentOptions, setup: this.buildSetup(presetId, chatId) })
        created = true
        this.log.record('bridge', { note: 'session created with a fallback id', chatId, sessionId: fresh })
      }
    }

    const record = {
      chatId,
      sessionId: handle.agent.session.id,
      agent: handle.agent,
      dispose: () => handle.dispose(),
    }
    this.chats.set(chatId, record)
    this.bySession.set(record.sessionId, chatId)

    if (this.config.titleEqualsId) this.pinTitle(handle.agent.session, record.sessionId)
    await this.attachWorkspace(record.sessionId)
    // 权限是会话级意图：只在本插件自己创建会话时施加，绝不在 resume 时施加
    // （用户可能已经在 Web UI 里刻意改过）。
    if (created) this.applySessionSettings(handle.agent, chatId)
    return record
  }

  /** 把配置的权限预设施加到新 agent 上。
 * 尽力而为：服务缺失或预设名未知都不能弄坏这个聊天，因此失败只记日志，宿主
 * 默认值继续生效。
 * @param agent - 刚创建的 agent。
 * @param chatId - 规范 chat id，用于日志。 */
  applySessionSettings(agent, chatId) {
    const permissionName = String(this.config.sessionPermission ?? '').trim()
    if (permissionName !== '') {
      const service = typeof this.getPermissionPresets === 'function' ? this.getPermissionPresets() : undefined
      if (service === undefined) {
        this.log.record('bridge', { note: 'permission presets unavailable; keeping the Host default', chatId })
      } else {
        try {
          service.set(agent.session, permissionName)
          this.log.record('bridge', { note: 'session permission applied', chatId, permission: permissionName })
        } catch (error) {
          this.log.record('warn', { note: 'session permission apply failed; keeping the Host default', chatId, permission: permissionName, error: this.describeError(error) })
        }
      }
    }

  }

  /** 确保配置的工作区存在且已注册。
 * 注册被删（或目录被删）不能让聊天没有工作区，因此缺哪部分就补哪部分。失败只
 * 记日志并吞掉：工作区问题不得阻塞对话。 */
  async ensureWorkspace(force = false) {
    const registry = typeof this.getWorkspaceRegistry === 'function' ? this.getWorkspaceRegistry() : undefined
    const path = String(this.config.workspacePath ?? '').trim()
    if (registry === undefined || path === '') return
    // 一分钟内对同一路径校验过：跳过 stat。
    if (!force && this.workspaceCheckedPath === path && Date.now() - this.workspaceCheckedAt < 60000) return

    // 目录缺失会让 `resolveByPath` 拒绝（其 realpath 失败），所以先查目录，
    // 且它的缺失不算错误。
    let directoryExists = true
    try {
      await stat(path)
    } catch {
      directoryExists = false
    }
    if (!directoryExists) {
      try {
        await mkdir(path, { recursive: true })
        this.log.record('bridge', { note: 'workspace directory created', path })
      } catch (error) {
        this.recordError('workspace directory create failed', path, error)
        return
      }
    }

    try {
      const existing = await registry.resolveByPath(path)
      if (existing !== undefined) {
        this.workspaceCheckedPath = path
        this.workspaceCheckedAt = Date.now()
        return
      }
      await registry.create(path)
      this.workspaceCheckedPath = path
      this.workspaceCheckedAt = Date.now()
      this.log.record('bridge', { note: 'workspace recreated', path })
    } catch (error) {
      this.recordError('workspace ensure failed', path, error)
    }
  }

  /** 把 Session 放到配置的工作区下，好让侧边栏归组。
 * 挂载是尽力而为：工作区不匹配不能弄坏聊天。
 * @param sessionId - 要登记的活会话。 */
  async attachWorkspace(sessionId) {
    const registry = typeof this.getWorkspaceRegistry === 'function' ? this.getWorkspaceRegistry() : undefined
    const path = String(this.config.workspacePath ?? '').trim()
    if (registry === undefined || path === '') {
      return { ok: false, reason: registry === undefined ? 'the workspace registry is not available yet' : 'no workspacePath configured' }
    }
    try {
      let workspace = await registry.resolveByPath(path)
      // 注册被删不能让会话失联：重建它并重试一次，再放弃。
      if (workspace === undefined) {
        await this.ensureWorkspace(true)
        workspace = await registry.resolveByPath(path)
        if (workspace === undefined && typeof registry.create === 'function') workspace = await registry.create(path)
      }
      if (workspace === undefined) {
        this.log.record('warn', { note: 'workspace attach skipped: cannot resolve the workspace', sessionId, path })
        return { ok: false, reason: 'cannot resolve or create the workspace at ' + path }
      }
      const before = Array.isArray(workspace.sessionIds) && workspace.sessionIds.includes(sessionId)
      await workspace.attachSession(sessionId)
      const after = Array.isArray(workspace.sessionIds) ? workspace.sessionIds.includes(sessionId) : undefined
      if (!before) this.log.record('bridge', { note: 'workspace attached', sessionId, path, verified: after })
      return { ok: true, added: !before, verified: after }
    } catch (error) {
      this.log.record('warn', { note: 'workspace attach skipped', sessionId, path, error: this.describeError(error) })
      return { ok: false, reason: this.describeError(error) }
    }
  }

  /** 把某个聊天的会话重挂到配置的工作区。
 * 即使没有活记录（重启之后），session id 也能由 chat id 派生，因此可以修复一
 * 个落成未分组的会话。
 * @param chatId - 规范 chat id。
 * @returns 挂载结果。 */
  async reattachWorkspace(chatId) {
    const sessionId = this.sessionOf(chatId) ?? sessionIdOf(chatId, this.config.sessionPrefix)
    const result = await this.attachWorkspace(sessionId)
    this.log.record('bridge', { note: 'workspace reattach requested', chatId, sessionId, ok: result.ok, verified: result.verified, reason: result.reason })
    return { chatId, sessionId, ...result }
  }

  /** 新 agent 起步用的 provider 与 model。
 * 与宿主自己的调用方一致：每次创建聊天时读一次部署默认值。`undefined` 表示部
 * 署没有默认值，由调用方记日志而不是乱猜。
 * @returns agent 选项，没有默认模型时返回 undefined。 */
  modelOptions() {
    // 显式的每聊天模型优先于部署默认值。
    const explicit = parseModelRef(this.config.agentModel)
    if (explicit !== undefined) return explicit
    const service = this.ctx.get('agentDefaultModel')
    if (service === undefined) return undefined
    try {
      const selection = service.currentSelection()
      if (selection === undefined || selection === null) return undefined
      const provider = String(selection.provider ?? '')
      const model = String(selection.model ?? '')
      if (provider === '' || model === '') return undefined
      const options = { provider, model }
      if (typeof selection.reasoningEffort === 'string' && selection.reasoningEffort !== '') {
        options.reasoningEffort = selection.reasoningEffort
      }
      return options
    } catch {
      return undefined
    }
  }

  /** 把会话标题钉成 session id：标题服务接受显式用户标题后不再安排自动标题。
   * @param session - 活会话。
   * @param title - 要钉的标题。 */
  pinTitle(session, title) {
    const service = this.sessionTitle
    if (service === undefined) return
    try {
      service.rename(session, title)
      this.log.record('bridge', { note: 'session title pinned to id', sessionId: session.id })
    } catch (error) {
      this.log.record('bridge', { note: 'title pin failed: ' + this.describeError(error), sessionId: session.id })
    }
  }

  /** 给 `onebot_call` 工具准备注册选项（setup 与全局注册共用一份）。
 * @param chatId - 规范 chat id；空串表示全局注册。
 * @param allow - 允许的 action 集合。
 * @returns registerTools 的选项对象。 */
  toolRegistrationOptions(chatId, allow) {
    return {
      connection: this.connection,
      allow,
      chatId,
      deleteSentMedia: this.config.deleteSentMedia === true,
      prompts: {
        call: renderToolCallPrompt(this.config.toolCallPrompt, allow),
      },
      recordLog: chatId === ''
        ? (note) => this.log.record('bridge', { note })
        : (note) => this.log.record('bridge', { note, chatId }),
    }
  }

  /** 在全局作用域注册本插件的工具，供 setup 从未跑过的 agent（被复用的活 agent）
 * 使用。可以重复调用：`register` 返回 disposer，同一层里的重名会被替换。 */
  async registerToolsFor(scopeCtx, chatId) {
    const allow = computeAllowlist(this.config)
    if (allow === null) return
    const { registerTools } = await requireToolsOnce()
    // 记下实际发生了什么：这里的静默空转，正是模型声称自己没权限发图的成因。
    const toolsService = scopeCtx?.tools ?? scopeCtx?.get?.('tools')
    if (toolsService === undefined || typeof toolsService.register !== 'function') {
      this.log.record('warn', { note: 'tool registration skipped: no tools service on that ctx', chatId })
      return
    }
    registerTools(scopeCtx, this.toolRegistrationOptions(chatId, allow))
    this.log.record('bridge', { note: 'tools registered for the reused agent', chatId, actions: allow.size })
  }

  /** 解析要挂载的 preset id：配置的那个若还在就用它，否则用部署默认值。被删或坏
 * 掉的 preset 不能让 agent 失去自己的组合。
 * @returns preset id，或 undefined 表示交给宿主默认值。 */
  async resolveAgentPreset() {
    const registry = typeof this.getAgentPresets === 'function' ? this.getAgentPresets() : undefined
    const configured = String(this.config.agentPreset ?? '').trim()
    if (registry === undefined) return configured === '' ? undefined : configured
    if (configured === '') return undefined
    try {
      const preset = await registry.resolve(configured)
      if (preset !== undefined && preset.broken === undefined) return configured
      this.log.record('bridge', { note: 'configured agent preset is broken; using the default', preset: configured, error: String(preset?.broken ?? '') })
    } catch (error) {
      this.log.record('bridge', { note: 'configured agent preset is gone; using the default', preset: configured, error: this.describeError(error) })
    }
    return undefined
  }

  /** 每个 agent 的 setup：通道提示词、`onebot_call` 工具与 preset 挂载。
 * 挂载才让 `agentPreset` 真正生效：只把 id 写进会话 header 只记录了意图，从不
 * 加载该 preset 的插件。
 * @param presetId - 解析后的 preset id，undefined 表示宿主默认值。
 * @returns setup 回调。 */
  buildSetup(presetId, chatId) {
    return async (agentCtx) => {
      // 工具只在至少有一个 action 启用时注册，聊天因此永远看不到一个什么都做不
      // 了的 `onebot_call`。按 agent 在创建时求值：已存在的聊天保留它被建时的
      // 工具集。
      const allow = computeAllowlist(this.config)
      if (allow !== null) {
        const { registerTools } = await requireToolsOnce()
        registerTools(agentCtx, this.toolRegistrationOptions(chatId, allow))
      }
      agentCtx.systemPrompt.section({
        name: 'channel:dsh-onebot-mini',
        order: 90,
        text: buildPlatformPrompt(this.config),
      })
      const registry = typeof this.getAgentPresets === 'function' ? this.getAgentPresets() : undefined
      if (registry === undefined) return
      try {
        const mounted = await registry.mount(agentCtx, presetId)
        this.log.record('bridge', { note: 'agent joined preset', preset: mounted?.id ?? String(presetId ?? 'default') })
      } catch (error) {
        this.log.record('warn', { note: 'agent preset mount failed; falling back to the global tool layer', error: this.describeError(error) })
      }
    }
  }

  /** 响应一条会话事件。
 * @param session - 发出该事件的会话。
 * @param event - 已提交的事件。 */
  onSessionEvent(session, event) {
    if (this.stopping) return
    const chatId = this.bySession.get(session.id)
    if (chatId === undefined) return
    const chat = splitChatId(chatId)

    if (event.type === 'turn/start') {
      // 在这里重置而不是在 dispatch：回合运行期间排队的消息，不得抹掉该回合已经
      // 累积的文本。
      this.buffers.set(chatId, '')
      this.sentThisTurn.delete(chatId)
      // 把本回合绑到最老那条排队消息的入站文件上。
      this.bindTurnInbound(chatId)
      return
    }

    if (event.type === 'assistant/message') {
      const text = textOfMessage(event.data?.message)
      if (text === '') return
      // `stream`（默认）在消息出现的那一刻就发；`final` 先收集，让 `turn/end`
      // 一次发出整段回答。
      if (this.config.replyMode === 'final') {
        this.buffers.set(chatId, (this.buffers.get(chatId) ?? '') + text)
      } else {
        this.sentThisTurn.add(chatId)
        this.enqueueStream(chatId, chat, text)
      }
      return
    }

    if (event.type === 'turn/end') {
      return this.finishTurn(chatId, chat, event)
    }
  }

  /** 把一次流式投递排在该聊天上一条流式发送之后。
 * 按聊天串行，让两条助手消息即使 `deliver` 是异步的也保持生产顺序。
 * @param chatId - 规范 chat id。
 * @param chat - 拆开的 chat id。
 * @param text - 要立刻发送的助手文本。 */
  enqueueStream(chatId, chat, text) {
    const previous = this.streamQueues.get(chatId) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(() => this.deliver(chatId, chat, text))
    this.streamQueues.set(chatId, next)
  }

  /** 在 `turn/end` 冲刷一个回合。
 * `final` 模式把缓存的文本作为一条消息发出；`stream` 模式则等待已排队的发送结
 * 束，好让入站文件留在盘上直到每一条可能回显它们的回复都已发出。什么都没产生
 * 的回合仍要报一条错误提示，而已经流式发过文本的错误回合不再补一条冗余提示。
 * @param chatId - 规范 chat id。
 * @param chat - 拆开的 chat id。
 * @param event - `turn/end` 事件。
 * @returns 该回合的发送与清理都完成后 resolve 的 promise。 */
  async finishTurn(chatId, chat, event) {
    const pending = this.streamQueues.get(chatId)
    this.streamQueues.delete(chatId)
    const buffered = this.buffers.get(chatId) ?? ''
    this.buffers.delete(chatId)
    const streamed = this.sentThisTurn.delete(chatId)
    // 现在就把本回合的入站文件摘下来；等回复发出后再删，因为回复可能回显其中
    // 某个文件。
    const inboundPaths = this.takeInbound(chatId)
    const reason = event.data?.reason
    try {
      if (pending !== undefined) await pending.catch(() => {})
      if (buffered.trim() !== '') {
        // 覆盖 `final` 模式，以及一个在已缓存文本之后才切到 `stream` 的回合。
        await this.deliver(chatId, chat, buffered)
      } else if (!streamed && reason?.kind === 'error') {
        const message = String(reason?.error?.message ?? 'turn failed')
        await this.sendNotice(chatId, chat, '⚠️ 本轮出错：' + message)
      }
    } finally {
      unlinkInbound(this.log, chatId, inboundPaths)
    }
  }

  /** 发送一段缓存的回复。
 * @param chatId - 规范 chat id。
 * @param chat - 拆开的 chat id。
 * @param text - 回复文本。 */
  async deliver(chatId, chat, text) {
    try {
      // 回复里可能带 `[[image:…]]` 这类标记，它们会变成真实的消息段。只有图片能
      // 与文本同条发送，所以段列表会拆成 QQ 能接受的多条消息（见
      // `groupReplySegments` 里的拆分规则）。
      const { segments, warnings, sourcePaths } = await buildReplySegments(text)
      if (segments.length === 0) return
      for (const warning of warnings) {
        this.log.record('warn', { note: 'reply media skipped: ' + warning, chatId })
      }
      const messages = groupReplySegments(segments)
      let lastMessageId = ''
      for (const message of messages) {
        const data = await this.connection.sendMessage(chat, message)
        lastMessageId = String(data?.message_id ?? '')
      }
      // 只在网关接受消息之后，才删除回复附带的源文件 —— 前提是运营方要求这么做。
      if (this.config.deleteSentMedia === true && sourcePaths.length > 0) {
        for (const path of sourcePaths) {
          const result = await safeUnlink(path)
          this.log.record('bridge', {
            note: result.ok === true ? 'reply media source removed' : 'reply media source kept: ' + result.reason,
            chatId,
          })
        }
      }
      this.log.record('bridge', {
        note: 'reply sent',
        chatId,
        messageId: lastMessageId,
        length: text.length,
        segments: segments.length,
        messages: messages.length,
        media: segments.filter((segment) => segment.type !== 'text').length,
      })
    } catch (error) {
      this.recordError('reply send failed', chatId, error)
    }
  }

  /** 向聊天发一条诊断提示。
 * @param chatId - 规范 chat id。
 * @param chat - 拆开的 chat id。
 * @param text - 提示文本。 */
  async sendNotice(chatId, chat, text) {
    try {
      await this.connection.sendText(chat, text)
      this.log.record('bridge', { note: 'notice sent', chatId })
    } catch (error) {
      this.recordError('notice send failed', chatId, error)
    }
  }

  /** 忘掉一个聊天的映射，让下一条消息开启一段干净的对话。
 * 累积了很多失败回合的对话会把模型持续带偏（例如反复坚称自己不能发媒体）。
 * 丢掉映射后下一条消息会开新会话，这是打破该循环最便宜的办法，不必编辑已存
 * 的转录。
 * @param chatId - 规范 chat id。
 * @returns 是否原本存在映射。 */
  forgetChat(chatId) {
    const existed = this.chats.delete(chatId)
    for (const [sessionId, mapped] of this.bySession.entries()) {
      if (mapped === chatId) this.bySession.delete(sessionId)
    }
    this.buffers.delete(chatId)
    this.streamQueues.delete(chatId)
    this.sentThisTurn.delete(chatId)
    this.inboundQueue.delete(chatId)
    this.inboundCurrent.delete(chatId)
    this.log.record('bridge', { note: 'chat mapping forgotten; the next message starts a fresh session', chatId })
    return existed
  }

  /** 为日志页（诊断）解析某个聊天的 session id。
 * @param chatId - 规范 chat id。
 * @returns session id；该聊天还没有 agent 时返回 undefined。 */
  sessionOf(chatId) {
    return this.chats.get(chatId)?.sessionId
  }
}

/** 拼合一条助手消息里的文本块。
 * 刻意跳过推理块与工具调用块：把它们发到聊天里会泄漏思维链与原始工具参数。
 * @param message - 助手消息。
 * @returns 拼合后的文本。 */
export function textOfMessage(message) {
  if (message === null || typeof message !== 'object') return ''
  const content = message.content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    if (block.type !== 'text') continue
    parts.push(String(block.text ?? ''))
  }
  return parts.join('\n').trim()
}

/** 只加载一次 tools 模块；后续调用复用缓存后的 ESM 绑定。 */
let toolsModule
async function requireToolsOnce() {
  toolsModule ??= await import('./tools.js')
  return toolsModule
}

/** 注入到每个 OneBot 聊天 agent 里的平台说明。
 * @param config - 生效配置。
 * @returns 说明文本。 */
export function buildPlatformPrompt(config) {
  // 文案现在住在配置里（可在提示词页编辑），代码只填动态部分，
  // 于是运营方不必重新构建就能改写措辞。
  const template = String(config?.channelPrompt ?? '').trim() !== ''
    ? String(config.channelPrompt)
    : DEFAULT_CHANNEL_PROMPT
  const allow = computeAllowlist(config)

  const replyMode = replyModeParagraph(
    config?.replyMode,
    config?.replyMode === 'final' ? config?.replyModeFinalPrompt : config?.replyModeStreamPrompt,
  )
  const admin = adminParagraph(config?.adminUserId, config?.adminPrompt)
  const senderPrefix = config?.senderPrefix ? senderPrefixParagraph(config?.senderPrefixPrompt) : ''
  const inbound = config?.inboundMedia === false ? '' : inboundParagraph(config?.inboundPrompt)
  let media = ''
  let tools = ''
  let actions = ''
  if (allow === null) {
    actions = '- 本通道已关闭 onebot_call 工具：你无法调用任何 OneBot 动作（发图/发文件、群管理、查询等），只能用纯文本回复。'
  } else {
    media = mediaParagraph(config?.mediaPrompt)
    tools = toolsParagraph(allow, config?.toolsPrompt)
    const overrides = config?.actionPrompts !== null && typeof config?.actionPrompts === 'object' && !Array.isArray(config.actionPrompts)
      ? config.actionPrompts
      : {}
    const lines = []
    // 只宣告运营方真正留下的 action，并附上各自的提示词（内置文档或运营方覆
    // 盖），模型因此不会把回合浪费在一个会被拒的动作上，也知道参数。
    for (const group of enabledGroups(allow)) {
      lines.push('【' + (GROUP_LABELS[group.id] ?? group.id) + '】')
      for (const action of group.actions) {
        const override = overrides[action.name]
        const body = (typeof override === 'string' && override.trim() !== '')
          ? override.trim()
          : action.defaultPrompt
        lines.push('- ' + action.name + '：' + String(body ?? '').replace(/\s*\n+\s*/g, ' '))
      }
    }
    actions = lines.join('\n')
  }

  // 戳一戳段落跟着「是否接收戳一戳」走：关掉后整段从提示词里消失。
  const poke = pokeParagraph(config?.pokeEvents !== false, config?.pokePrompt)

  return renderPrompt(template, { replyMode, admin, senderPrefix, media, tools, actions, inbound, poke })
}
