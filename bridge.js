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
import { computeAllowlist, enabledGroups, actionLabel } from './toolcatalog.js'
import { DEFAULT_CHANNEL_PROMPT, DEFAULT_TOOL_MEDIA_PROMPT, DEFAULT_INTERJECT_PROMPT, mediaParagraph, inboundParagraph, senderPrefixParagraph, toolsParagraph, renderPrompt, renderToolCallPrompt } from './prompt.js'
import { buildInboundText } from './inbound.js'

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
/**
 * The identity that decides whether two messages may merge.
 *
 * In a group it is the sender, so different people never share a window; in a
 * private chat there is only one speaker, so a constant is enough.
 * @param frame - the inbound event.
 * @param chatKind - `private` or `group`.
 * @returns a stable key for the speaker.
 */
export function speakerKey(frame, chatKind) {
  if (chatKind !== 'group') return 'private'
  return String(frame?.user_id ?? '')
}

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
    /** Last workspace verified, and when (epoch ms); avoids a stat per message. */
    this.workspaceCheckedPath = ''
    this.workspaceCheckedAt = 0
  }

  /**
   * Apply live config changes (the config page can save while running).
   * @param config - the new effective config.
   */
  reconfigure(config) {
    // A save is an explicit "re-check now": drop the workspace verification cache
    // so a workspace deleted in the meantime is recreated on the next message.
    this.workspaceCheckedPath = ''
    this.workspaceCheckedAt = 0
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

    // Access gate, deny before allow: a blacklisted chat is always refused, and
    // a non-empty whitelist restricts the channel to the ids on it. An empty
    // whitelist means "no restriction", which is the default.
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

    // Incoming media is downloaded to a local inbox and rewritten to a readable
    // path, so the model can open an image with read_image or a file with read.
    // Turned off, it degrades to the bare placeholders that name nothing.
    let body
    if (this.config.inboundMedia !== false) {
      const outcome = await buildInboundText({
        segments: frame.message,
        chatId,
        chat,
        connection: this.connection,
        config: this.config,
        getSpeech: () => {
          try {
            return this.ctx.get?.('speechToText')
          } catch {
            return undefined
          }
        },
        log: (note) => this.log.record('bridge', { note, chatId }),
      })
      for (const warning of outcome.warnings) {
        this.log.record('warn', { note: 'inbound media skipped: ' + warning, chatId })
      }
      body = outcome.text
    } else {
      body = flattenMessage(frame.message)
    }
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
    // A workspace can be deleted at any time; re-verify before delivering so an
    // existing chat also lands in a real workspace after a delete.
    await this.ensureWorkspace()
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
    // A private chat steers straight into a running answer: the same person is
    // correcting or adding to what is still being written, so waiting for a
    // separate turn would answer twice. No model judgement is involved.
    const interjectOn = chat.kind === 'private' && this.config.privateAutoInterject !== false
    if (interjectOn && record.agent?.status === 'running' && typeof record.agent?.steer === 'function') {
      try {
        const message = await createPluginUserMessage({ content: [{ type: 'text', text }], source: PLUGIN_SOURCE })
        record.agent.steer(message)
        this.log.record('bridge', { note: 'steered into the running turn', chatId, length: text.length })
        return
      } catch (error) {
        this.log.record('warn', { note: 'steer failed; falling back to a follow-up', chatId, error: this.describeError(error) })
      }
    }

    await this.sendToAgent(chatId, record, text, frame)
  }

  /**
   * Send one message straight to the chat's agent.
   * @param chatId - canonical chat id.
   * @param record - the chat record.
   * @param text - the message text.
   * @param frame - the originating event, for logging.
   */
  async sendToAgent(chatId, record, text, frame) {
    try {
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
      this.log.record('error', { note: 'delivery failed for ' + chatId, error: this.describeError(error) })
    }
  }

  /**
   * Resolve the provider/model used for the lightweight interject judge.
   *
   * Preference: the chat's configured model, then the deployment default, then
   * the first advertised provider/model. Undefined means "no judge available".
   * @param llm - the live `llm` service.
   * @returns `{ provider, model }` or undefined.
   */
  async resolveJudgeModel(llm) {
    const configured = String(this.config.agentModel ?? '').trim()
    if (configured.includes('::')) {
      const [provider, ...rest] = configured.split('::')
      if (provider !== '' && rest.length > 0) return { provider, model: rest.join('::') }
    }
    try {
      const selection = this.ctx.get('agentDefaultModel')?.currentSelection?.()
      if (selection?.provider && selection?.model) {
        return { provider: String(selection.provider), model: String(selection.model) }
      }
    } catch {
      // fall through to the advertised catalog
    }
    try {
      for (const provider of await llm.listProviders()) {
        const models = await llm.listModels(provider.id)
        if (models.length > 0) return { provider: String(provider.id), model: String(models[0].id) }
      }
    } catch {
      // no catalog is a normal condition on a bare deployment
    }
    return undefined
  }

  /**
   * Ask a small model whether a new message should steer the running turn.
   *
   * The call is capped in size and time; anything unusual (no service, no model,
   * timeout, error) resolves to `followup`, which is always safe.
   * @param chatId - canonical chat id, for logging.
   * @param text - the new message text.
   * @returns `'steer'` or `'followup'`.
   */
  async judgeInterject(chatId, text) {
    let timer
    try {
      const llm = this.ctx.get('llm')
      if (llm === undefined || typeof llm.stream !== 'function') return 'followup'
      const target = await this.resolveJudgeModel(llm)
      if (target === undefined) return 'followup'
      const prompt = String(this.config.interjectPrompt ?? '').trim() !== ''
        ? String(this.config.interjectPrompt)
        : DEFAULT_INTERJECT_PROMPT
      const controller = new AbortController()
      timer = setTimeout(() => controller.abort(), 4000)
      if (typeof timer.unref === 'function') timer.unref()
      let out = ''
      const stream = llm.stream({
        provider: target.provider,
        model: target.model,
        system: prompt,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'New message: ' + text }] }],
        temperature: 0,
        maxTokens: 16,
        signal: controller.signal,
      })
      for await (const chunk of stream) {
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') out += chunk.text
      }
      const verdict = /steer/i.test(out) && !/followup/i.test(out) ? 'steer' : 'followup'
      this.log.record('bridge', { note: 'interject judge', chatId, verdict, raw: out.trim().slice(0, 24) })
      return verdict
    } catch (error) {
      this.log.record('warn', { note: 'interject judge failed; queueing instead', chatId, error: this.describeError(error) })
      return 'followup'
    } finally {
      if (timer !== undefined) clearTimeout(timer)
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
    // The configured workspace is required, but its registration may have been
    // deleted since — recreate it so the Session always lands in a real
    // workspace instead of falling back to the host cwd.
    await this.ensureWorkspace(true)
    const meta = {}
    if (this.config.workspacePath !== '') meta.cwd = this.config.workspacePath
    // Resolve once, then use the same id for both the header and the mount so a
    // preset deleted after configuration falls back to the deployment default in
    // both places instead of diverging.
    const presetId = await this.resolveAgentPreset()
    if (presetId !== undefined) meta.agentPreset = presetId

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
    let created = false
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
      // A reused agent was probably created before any setup ran (an old version,
      // or opened directly in the Web UI), so its tools were never registered.
      // Register them at the plugin/global scope so every agent sees them. The
      // disposers live as long as the plugin does, which is fine: registration is
      // idempotent per name and the plugin does not unload per chat.
      // A reused agent keeps the tool view it was built with, so registering now
      // may be a no-op for it. Re-running the whole setup against the live agent's
      // ctx re-announces the tools and the channel prompt for this conversation.
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
    // Permission and plan mode are session-scoped intents: apply them only when
    // this plugin created the session, never on a resume (a user may have changed
    // them deliberately in the Web UI since).
    if (created) this.applySessionSettings(handle.agent, chatId)
    return record
  }

  /**
   * Apply the configured permission preset to a new agent.
   *
   * Best-effort: a missing service or an unknown preset name must not break the
   * chat, so failures are logged and the Host default stays in force.
   * @param agent - the freshly created agent.
   * @param chatId - canonical chat id, for logging.
   */
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

  /**
   * Make sure the configured workspace exists and is registered.
   *
   * A deleted registration (or a deleted directory) must not leave the chat with
   * no workspace, so this recreates whichever part is missing. Failures are
   * logged and swallowed: a workspace problem must not block the conversation.
   */
  async ensureWorkspace(force = false) {
    const registry = typeof this.getWorkspaceRegistry === 'function' ? this.getWorkspaceRegistry() : undefined
    const path = String(this.config.workspacePath ?? '').trim()
    if (registry === undefined || path === '') return
    // Verified within the last minute against the same path: skip the stat.
    if (!force && this.workspaceCheckedPath === path && Date.now() - this.workspaceCheckedAt < 60000) return
    const { mkdir, stat } = await import('node:fs/promises')

    // A missing directory makes `resolveByPath` reject (its realpath fails), so
    // the directory check comes first and its absence is not an error.
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
        this.log.record('error', { note: 'workspace directory create failed for ' + path, error: this.describeError(error) })
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
      this.log.record('error', { note: 'workspace ensure failed for ' + path, error: this.describeError(error) })
    }
  }

  /**
   * Put the Session under the configured workspace so the sidebar groups it.
   *
   * Attaching is best-effort: a workspace mismatch must not break the chat.
   * @param sessionId - the live session to record.
   */
  async attachWorkspace(sessionId) {
    const registry = typeof this.getWorkspaceRegistry === 'function' ? this.getWorkspaceRegistry() : undefined
    const path = String(this.config.workspacePath ?? '').trim()
    if (registry === undefined || path === '') return
    try {
      const workspace = await registry.resolveByPath(path)
      if (workspace === undefined) return
      await workspace.attachSession(sessionId)
    } catch (error) {
      this.log.record('bridge', { note: 'workspace attach skipped', sessionId, error: this.describeError(error) })
    }
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
    // An explicit per-chat model wins over the deployment default. The value is
    // "provider::model" so a model id that itself contains a slash stays intact.
    const configured = String(this.config.agentModel ?? '').trim()
    if (configured !== '') {
      const at = configured.indexOf('::')
      if (at > 0) {
        const provider = configured.slice(0, at)
        const model = configured.slice(at + 2)
        if (provider !== '' && model !== '') return { provider, model }
      }
    }
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
  /**
   * Register the plugin's tools at the global scope, for agents whose setup
   * never ran (a reused live agent). Safe to call repeatedly: `register` returns
   * a disposer and duplicate names within one layer are replaced.
   */
  async registerToolsFor(scopeCtx, chatId) {
    const allow = computeAllowlist(this.config)
    if (allow === null) return
    const { registerTools } = await requireToolsOnce()
    // Record what actually happened: a silent no-op here is exactly what made the
    // model claim it had no permission to send images.
    const toolsService = scopeCtx?.tools ?? scopeCtx?.get?.('tools')
    if (toolsService === undefined || typeof toolsService.register !== 'function') {
      this.log.record('warn', { note: 'tool registration skipped: no tools service on that ctx', chatId })
      return
    }
    registerTools(scopeCtx, {
      connection: this.connection,
      allow,
      chatId,
      deleteSentMedia: this.config.deleteSentMedia === true,
      prompts: {
        call: renderToolCallPrompt(this.config.toolCallPrompt, allow),
        media: String(this.config.toolMediaPrompt ?? '').trim() !== ''
          ? String(this.config.toolMediaPrompt)
          : DEFAULT_TOOL_MEDIA_PROMPT,
      },
      recordLog: (note) => this.log.record('bridge', { note }),
    })
    this.log.record('bridge', { note: 'tools registered for the reused agent', chatId, actions: allow.size })
  }

  /**
   * Resolve the preset id to mount: the configured one when it still exists,
   * otherwise the deployment default. A deleted or broken preset must not leave
   * the agent without its composition.
   * @returns the preset id, or undefined to let the Host use its default.
   */
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

  /**
   * The per-agent setup: channel prompt, the OneBot tool, and the preset mount.
   *
   * Mounting is what makes `agentPreset` real: writing it into the session
   * header alone records intent but never loads that preset's plugins.
   * @param presetId - resolved preset id, or undefined for the Host default.
   * @returns the setup callback.
   */
  buildSetup(presetId, chatId) {
    return async (agentCtx) => {
      // The tool is registered only when at least one action is enabled, so a
      // chat never sees a `onebot_call` that can do nothing. Evaluated per agent
      // at creation time: an existing chat keeps the tool set it was created with.
      const allow = computeAllowlist(this.config)
      // Record what the agent ctx actually exposes: a missing tools service here
      // silently costs the model every OneBot tool.
      this.log.record('bridge', {
        note: 'setup ctx probe',
        chatId,
        hasTools: typeof (agentCtx?.tools ?? agentCtx?.get?.('tools'))?.register === 'function',
        hasSystemPrompt: typeof agentCtx?.systemPrompt?.section === 'function',
        keys: Object.keys(agentCtx ?? {}).slice(0, 8).join(','),
      })
      if (allow !== null) {
        const { registerTools } = await requireToolsOnce()
        registerTools(agentCtx, {
          connection: this.connection,
          allow,
          chatId,
          deleteSentMedia: this.config.deleteSentMedia === true,
          recordLog: (note) => this.log.record('bridge', { note, chatId }),
          prompts: {
            call: renderToolCallPrompt(this.config.toolCallPrompt, allow),
            media: String(this.config.toolMediaPrompt ?? '').trim() !== ''
              ? String(this.config.toolMediaPrompt)
              : DEFAULT_TOOL_MEDIA_PROMPT,
          },
        })
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
      // A reply may carry `[[image:…]]`-style markers; those become real message
      // segments so a caption and its picture go out as one message.
      const { buildReplySegments, safeUnlink } = await import('./media.js')
      const { segments, warnings, sourcePaths } = await buildReplySegments(text)
      if (segments.length === 0) return
      for (const warning of warnings) {
        this.log.record('warn', { note: 'reply media skipped: ' + warning, chatId })
      }
      const data = await this.connection.sendMessage(chat, segments)
      // Only after the gateway accepted the message: remove the source files the
      // reply attached, when the operator asked for that.
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
        messageId: String(data?.message_id ?? ''),
        length: text.length,
        segments: segments.length,
        media: segments.filter((segment) => segment.type !== 'text').length,
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
   * Forget one chat's mapping so the next message starts a clean conversation.
   *
   * A conversation that has accumulated many failed turns keeps steering the
   * model down the same wrong path (for example, repeatedly insisting it may not
   * send media). Dropping the mapping makes the next message open a fresh
   * session, which is the cheapest way to break that loop without editing the
   * stored transcript.
   * @param chatId - canonical chat id.
   * @returns whether a mapping existed.
   */
  forgetChat(chatId) {
    const existed = this.chats.delete(chatId)
    for (const [sessionId, mapped] of this.bySession.entries()) {
      if (mapped === chatId) this.bySession.delete(sessionId)
    }
    this.buffers.delete(chatId)
    this.log.record('bridge', { note: 'chat mapping forgotten; the next message starts a fresh session', chatId })
    return existed
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
/** Load the tools module once; subsequent calls reuse the cached ESM binding. */
let toolsModule
async function requireToolsOnce() {
  toolsModule ??= await import('./tools.js')
  return toolsModule
}

export function buildPlatformPrompt(config) {
  // The prose lives in the config now (editable from the Prompt page); the code
  // only fills the dynamic parts, so an operator can rewrite the wording without
  // touching a build.
  const template = String(config?.channelPrompt ?? '').trim() !== ''
    ? String(config.channelPrompt)
    : DEFAULT_CHANNEL_PROMPT
  const allow = computeAllowlist(config)

  const senderPrefix = config?.senderPrefix ? senderPrefixParagraph() : ''
  const inbound = config?.inboundMedia === false
    ? ''
    : (String(config?.inboundPrompt ?? '').trim() !== '' ? String(config.inboundPrompt) : inboundParagraph())
  let media = ''
  let tools = ''
  let actions = ''
  if (allow === null) {
    actions = '- 本通道已关闭 onebot_call 工具：你无法调用任何 OneBot 动作（发图/发文件、群管理、查询等），只能用纯文本回复。'
  } else {
    media = mediaParagraph()
    tools = toolsParagraph(allow)
    const lines = ['- 除纯文本回复外的任何操作，都要调用 onebot_call 工具，并在 action 填 OneBot 动作名、params 填参数。'
      + '下面只接受已启用的动作，其他一律拒绝。']
    // Advertise exactly what the operator left enabled, so the model never
    // wastes a turn on an action that would be refused.
    for (const group of enabledGroups(allow)) {
      const names = group.actions.map((action) => action.name + ' (' + actionLabel(action.name) + ')').join('、')
      lines.push('  - ' + group.id + '：' + names)
    }
    actions = lines.join('\n')
  }

  return renderPrompt(template, { senderPrefix, media, tools, actions, inbound })
}
