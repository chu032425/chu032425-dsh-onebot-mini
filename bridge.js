/**
 * The chat ↔ session bridge: one durable dsh Session per OneBot chat.
 *
 * Inbound: a pushed message event is gated (self → policy → mention → dedup),
 * flattened to text and handed to the chat's agent as one follow-up turn.
 *
 * Outbound: the assistant's text blocks for that session are buffered and sent
 * once the turn ends, so a multi-step turn produces one QQ message instead of
 * one per step. `turn/end` also releases the buffer on an errored turn.
 *
 * The session id is derived from the chat id, so a restart resumes the same
 * conversation with no mapping file: `agents.resume` finds the persisted log,
 * and `agents.create` only runs when there is none.
 */

import { createPluginUserMessage, PLUGIN_SOURCE } from './message.js'

/** Non-alphanumerics become `-` so the id stays filesystem-safe. */
const ID_SAFE = /[^A-Za-z0-9-]/g

/**
 * Build the canonical chat id for one inbound event.
 * @param messageType - `private` or `group`.
 * @param target - the user or group id.
 * @returns `private:<id>` or `group:<id>`.
 */
export function chatIdOf(messageType, target) {
  return (messageType === 'group' ? 'group:' : 'private:') + String(target)
}

/**
 * Split a canonical chat id back into its parts.
 * @param chatId - `private:<id>` or `group:<id>`.
 * @returns `{ kind, id }`.
 */
export function splitChatId(chatId) {
  const at = chatId.indexOf(':')
  if (at <= 0) return { kind: 'private', id: chatId }
  const kind = chatId.slice(0, at)
  return { kind: kind === 'group' ? 'group' : 'private', id: chatId.slice(at + 1) }
}

/**
 * Derive the durable session id for a chat.
 *
 * The prefix is configurable because it decides where every conversation shows
 * up in the sidebar: a short, recognizable prefix makes QQ Sessions easy to
 * pick out from other work in the same profile.
 * @param chatId - canonical chat id.
 * @param prefix - configured session prefix; an empty prefix means no prefix.
 * @returns the session id string.
 */
export function sessionIdOf(chatId, prefix = 'onebot') {
  const body = chatId.replace(ID_SAFE, '-')
  const head = String(prefix ?? '').trim()
  return head === '' ? body : head + '-' + body
}

/**
 * Flatten OneBot message segments to model-facing text.
 *
 * Non-text segments become bracketed placeholders: the model gets to know an
 * image or a voice message arrived, without the plugin downloading anything.
 * @param segments - the `message` field (array of segments or a CQ string).
 * @returns the flattened text.
 */
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
  }
  return parts.join('').trim()
}

/**
 * Turn a CQ-coded string into plain text (the fallback path for gateways that
 * report messages as CQ strings instead of segment arrays).
 * @param raw - the CQ string.
 * @returns plain text with bracketed media placeholders.
 */
export function unescapeCq(raw) {
  return String(raw)
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
 * Whether a group message addresses the bot.
 *
 * Fail-closed: with no known bot account, a group message never counts as a
 * mention, so the bot stays quiet instead of answering every message.
 * @param frame - the message event.
 * @param botId - the bot's own account id, possibly empty.
 * @returns whether the bot was addressed.
 */
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
 * Prefix a group message with the speaker so the model can tell participants
 * apart. Private chats need no prefix.
 * @param frame - the message event.
 * @param chatKind - `private` or `group`.
 * @param enabled - whether the prefix is configured on.
 * @returns the prefix (possibly empty).
 */
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

/**
 * The bridge. One instance per plugin mount.
 */
export class ChatBridge {
  /**
   * @param options - `ctx`, `config`, `connection`, `log`, `sessionTitle`
   * (optional service), `describeError`.
   */
  constructor({ ctx, config, connection, log, sessionTitle, describeError }) {
    this.ctx = ctx
    this.config = config
    this.connection = connection
    this.log = log
    this.sessionTitle = sessionTitle
    this.describeError = describeError ?? ((error) => String(error?.message ?? error))

    /** chatId → chat record. */
    this.chats = new Map()
    /** sessionId → chatId, for the session event feed. */
    this.bySession = new Map()
    /** chatId → in-flight creation promise (collapses concurrent first messages). */
    this.pendingCreates = new Map()
    /** chatId → accumulated assistant text for the open turn. */
    this.buffers = new Map()
    /** chatId → message ids already handled (reconnect replay guard). */
    this.seen = new Map()
    this.dedupWindowMs = 300000
    this.dedupMax = 2000
    this.stopping = false
  }

  /**
   * Apply live config changes (the config page can save while running).
   * @param config - the new effective config.
   */
  reconfigure(config) {
    this.config = config
  }

  /**
   * Subscribe to the session event feed.
   * @returns the disposer.
   */
  start() {
    this.stopping = false
    return this.ctx.on('session/event', (session, event) => this.onSessionEvent(session, event))
  }

  /**
   * Release every chat and stop reacting to events.
   */
  async stop() {
    this.stopping = true
    const chats = [...this.chats.values()]
    this.chats.clear()
    this.bySession.clear()
    this.buffers.clear()
    for (const chat of chats) {
      try {
        await chat.dispose()
      } catch {
        // A failing dispose must not block the remaining teardown.
      }
    }
  }

  /**
   * Handle one pushed OneBot event.
   * @param frame - the event frame.
   */
  async handleInbound(frame) {
    if (this.stopping) return
    if (frame === null || typeof frame !== 'object') return
    if (frame.post_type !== 'message') return
    if (frame.message_type !== 'private' && frame.message_type !== 'group') return

    const userId = String(frame.user_id ?? '')
    const groupId = String(frame.group_id ?? '')
    if (userId === '') return

    const botId = this.connection.selfId
    if (botId !== '' && userId === botId) return

    const chatId = chatIdOf(frame.message_type, frame.message_type === 'group' ? groupId : userId)
    const chat = splitChatId(chatId)

    if (chat.kind === 'private') {
      const allow = this.config.allowFrom
      if (allow.length > 0 && !allow.includes(chat.id)) {
        this.log.record('bridge', { note: 'private chat not in allowFrom', chatId })
        return
      }
    } else {
      const allow = this.config.allowGroups
      if (allow.length > 0 && !allow.includes(chat.id)) {
        this.log.record('bridge', { note: 'group not in allowGroups', chatId })
        return
      }
    }

    const messageId = String(frame.message_id ?? '')
    if (messageId !== '' && this.duplicated(chatId, messageId)) {
      this.log.record('bridge', { note: 'duplicate message skipped', chatId, messageId })
      return
    }

    if (chat.kind === 'group' && this.config.requireMention && !isAddressed(frame, botId)) {
      return
    }

    const body = flattenMessage(frame.message)
    if (body === '') return

    const text = speakerPrefix(frame, chat.kind, this.config.senderPrefix) + body
    await this.dispatch(chatId, chat, text, frame)
  }

  /**
   * Record one message id and report whether it was seen recently.
   * @param chatId - canonical chat id.
   * @param messageId - gateway message id.
   * @returns whether this id was already handled.
   */
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

  /**
   * Deliver one user message to the chat's agent.
   * @param chatId - canonical chat id.
   * @param chat - split chat id.
   * @param text - the model-facing text.
   * @param frame - the source event (for logging).
   */
  async dispatch(chatId, chat, text, frame) {
    let record
    try {
      record = await this.ensureChat(chatId)
    } catch (error) {
      this.log.record('error', { note: 'agent creation failed for ' + chatId, error: this.describeError(error) })
      return
    }
    this.log.record('bridge', {
      note: 'dispatching to agent',
      chatId,
      sessionId: record.sessionId,
      length: text.length,
      messageId: String(frame.message_id ?? ''),
    })
    try {
      const message = await createPluginUserMessage({
        content: [{ type: 'text', text }],
        source: PLUGIN_SOURCE,
      })
      record.agent.followup(message)
    } catch (error) {
      this.log.record('error', { note: 'followup failed for ' + chatId, error: this.describeError(error) })
    }
  }

  /**
   * Get or create the chat's agent.
   * @param chatId - canonical chat id.
   * @returns the chat record.
   */
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

  /**
   * Resume the persisted session for a chat, or create a fresh one.
   * @param chatId - canonical chat id.
   * @returns the chat record.
   */
  async createChat(chatId) {
    const sessionId = sessionIdOf(chatId, this.config.sessionPrefix)
    const meta = {}
    if (this.config.workspacePath !== '') meta.cwd = this.config.workspacePath
    if (this.config.agentPreset !== '') meta.agentPreset = this.config.agentPreset

    // Three steps, because "resume failed" and "no such session" are different
    // facts: a resume can fail while the log exists (owned elsewhere, unreadable
    // tail), and then `create` on the same id fails with "already exists". A chat
    // must always end up with an agent, so the last step retires the plain id and
    // takes a suffixed one.
    // A fresh agent needs a provider and model: without them the first turn fails
    // with "has no provider/model". A resumed session already recorded its own.
    const agentOptions = this.modelOptions()
    if (agentOptions === undefined) {
      this.log.record('error', {
        note: 'no default model is configured; the agent will fail its first turn',
        chatId,
      })
    }

    let handle
    // The session may already be live: the user can open a QQ chat's Session in
    // the Web UI, and that live agent owns the write handle. Resume and create
    // both fail in that state ("already owned by an active write handle" /
    // "already exists"), so an existing live agent is reused instead.
    const live = this.ctx.agents.get(sessionId)
    if (live !== undefined) {
      const record = {
        chatId,
        sessionId,
        agent: live,
        // The live agent is owned by whoever created it (the Web session
        // controller); this plugin must not dispose it.
        dispose: async () => {},
        borrowed: true,
      }
      this.chats.set(chatId, record)
      this.bySession.set(sessionId, chatId)
      this.log.record('bridge', { note: 'reusing a live agent for this chat', chatId, sessionId })
      if (this.config.titleEqualsId) this.pinTitle(live.session, sessionId)
      return record
    }

    try {
      handle = await this.ctx.agents.resume({ resumeSessionId: sessionId, setup: this.buildSetup() })
      this.log.record('bridge', { note: 'session resumed', chatId, sessionId })
    } catch (resumeError) {
      this.log.record('bridge', {
        note: 'resume failed, trying a fresh session',
        chatId,
        sessionId,
        error: this.describeError(resumeError),
      })
      try {
        handle = await this.ctx.agents.create({ sessionId, meta, agentOptions, setup: this.buildSetup() })
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
        handle = await this.ctx.agents.create({ sessionId: fresh, meta, agentOptions, setup: this.buildSetup() })
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
    return record
  }

  /**
   * The provider and model a fresh agent starts on.
   *
   * Mirrors the Host's own callers: read the deployment default once per chat
   * creation. `undefined` means the deployment has no default, which the caller
   * logs rather than guessing.
   * @returns agent options, or undefined when no default model is configured.
   */
  modelOptions() {
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

  /**
   * Pin the session title to the session id.
   *
   * The title service accepts an explicit user title and stops scheduling
   * automatic ones afterwards, which is exactly "the name equals the id".
   * @param session - the live session.
   * @param title - the title to pin.
   */
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

  /**
   * The per-agent setup: the channel prompt section and the OneBot tool.
   *
   * Registered on `agentCtx` so disposal removes them with the agent.
   * @returns the setup callback.
   */
  buildSetup() {
    return async (agentCtx) => {
      agentCtx.systemPrompt.section({
        name: 'channel:dsh-onebot-mini',
        order: 90,
        text: buildPlatformPrompt(this.config),
      })
      const { registerTools } = await import('./tools.js')
      registerTools(agentCtx, { connection: this.connection })
    }
  }

  /**
   * React to one session event.
   * @param session - the session that emitted it.
   * @param event - the committed event.
   */
  onSessionEvent(session, event) {
    if (this.stopping) return
    const chatId = this.bySession.get(session.id)
    if (chatId === undefined) return
    const chat = splitChatId(chatId)

    if (event.type === 'turn/start') {
      // Reset here, not at dispatch: a message queued while a turn runs must not
      // wipe the text that turn has already accumulated.
      this.buffers.set(chatId, '')
      return
    }

    if (event.type === 'assistant/message') {
      const text = textOfMessage(event.data?.message)
      if (text === '') return
      this.buffers.set(chatId, (this.buffers.get(chatId) ?? '') + text)
      return
    }

    if (event.type === 'turn/end') {
      const buffered = this.buffers.get(chatId) ?? ''
      this.buffers.delete(chatId)
      const reason = event.data?.reason
      if (buffered.trim() === '') {
        if (reason?.kind === 'error') {
          const message = String(reason?.error?.message ?? 'turn failed')
          void this.sendNotice(chatId, chat, '⚠️ 本轮出错：' + message)
        }
        return
      }
      void this.deliver(chatId, chat, buffered)
    }
  }

  /**
   * Send one buffered reply.
   * @param chatId - canonical chat id.
   * @param chat - split chat id.
   * @param text - reply text.
   */
  async deliver(chatId, chat, text) {
    try {
      const data = await this.connection.sendText(chat, text.trim())
      this.log.record('bridge', {
        note: 'reply sent',
        chatId,
        messageId: String(data?.message_id ?? ''),
        length: text.length,
      })
    } catch (error) {
      this.log.record('error', { note: 'reply send failed for ' + chatId, error: this.describeError(error) })
    }
  }

  /**
   * Send one diagnostic notice to a chat.
   * @param chatId - canonical chat id.
   * @param chat - split chat id.
   * @param text - notice text.
   */
  async sendNotice(chatId, chat, text) {
    try {
      await this.connection.sendText(chat, text)
      this.log.record('bridge', { note: 'notice sent', chatId })
    } catch (error) {
      this.log.record('error', { note: 'notice send failed for ' + chatId, error: this.describeError(error) })
    }
  }

  /**
   * Resolve one chat's session id for the log page (diagnostics).
   * @param chatId - canonical chat id.
   * @returns the session id, or undefined when the chat has no agent yet.
   */
  sessionOf(chatId) {
    return this.chats.get(chatId)?.sessionId
  }
}

/**
 * Join an assistant message's text blocks.
 *
 * Reasoning and tool-call blocks are skipped on purpose: sending them to a chat
 * would leak chain-of-thought and raw tool arguments.
 * @param message - the assistant message.
 * @returns the joined text.
 */
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

/**
 * The platform guidance section injected into every OneBot chat's agent.
 * @param config - the effective config.
 * @returns the section text.
 */
export function buildPlatformPrompt(config) {
  let text = '## OneBot (QQ) channel\n'
  text += 'You are talking to a user through a QQ chat bridged by OneBot 11.\n'
  text += '- QQ does not render Markdown. Answer in plain text; use numbered or dashed lists.\n'
  text += '- One reply turn produces ONE outgoing message: the plugin buffers your text blocks and sends them when the turn ends. Do not try to split a reply into several messages.\n'
  text += '- Incoming images, voices, videos and files appear as [图片] / [语音] / [视频] / [文件] placeholders. The plugin does not download them, so you cannot see their content; say so if the user asks about them.\n'
  if (config.senderPrefix) {
    text += '- Group messages are prefixed with [HH:MM nickname(QQ)] so you can tell speakers apart.\n'
  }
  text += '- To send an image or a file, call the onebot_call tool with the OneBot action (send_group_msg / send_private_msg / send_msg and friends) and its params.\n'
  text += '- There is no Web approval card on this channel: do not call exit_plan_mode. Write any plan as plain text instead.\n'
  return text
}
