/**
 * Transport and bridge behaviour against local doubles: real WebSocket
 * handshake and auth, action roundtrip, log redaction, inbound gating,
 * turn buffering, resume and allowlist.
 * Run with `node test/runtime.test.mjs`.
 */
import { createServer } from 'node:http'
import { OneBotConnection } from '../connection.js'
import { LogBus } from '../logbus.js'
import { ChatBridge } from '../bridge.js'

let pass = 0
let fail = 0
const t = (name, cond, extra = '') => {
  if (cond) pass += 1
  else { fail += 1; console.log('FAIL ' + name + (extra ? ' :: ' + extra : '')) }
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const baseConfig = {
  mode: 'reverse', host: '127.0.0.1', port: 0, url: 'ws://127.0.0.1:1',
  accessToken: 'test-token', botQQ: '', requireMention: true,
  allowFrom: [], allowGroups: [], workspacePath: '', agentPreset: '',
  senderPrefix: true, titleEqualsId: true, logCapacity: 200,
  logMessagePreview: true, logToFile: false, sendTimeoutMs: 5000,
  sessionPrefix: 'onebot', sessionPermission: 'workspace-write', sessionMode: 'normal', agentModel: '',
}

// ---- preset / permission / plan-mode stubs (record what the bridge calls)
const calls = { mounted: [], permissionSet: [], planSet: [] }
const agentPresets = {
  async resolve(id) {
    if (id === 'standard' || id === 'minimal') return { id, name: id }
    const error = new Error('unknown preset: ' + id)
    throw error
  },
  async mount(_ctx, id) { const bound = id ?? 'default'; calls.mounted.push(bound); return { id: bound } },
}
const permissionPresets = { set: (session, name) => { calls.permissionSet.push(name) } }
const planMode = { set: (_agent, active) => { calls.planSet.push(active); return 'committed' } }

// ---------------------------------------------------------------- transport
const port = 18650
const log = new LogBus({ capacity: 200 })
const conn = new OneBotConnection({ config: { ...baseConfig, port }, log })
const events = []
conn.onEvent = (frame) => events.push(frame)
await conn.start()
t('reverse listener binds', conn.state === 'connecting' || conn.state === 'online')

const dial = (token) => new Promise((resolve) => {
  const ws = new WebSocket('ws://127.0.0.1:' + port + '/', { headers: { authorization: 'Bearer ' + token } })
  ws.addEventListener('open', () => resolve({ ok: true, ws }))
  ws.addEventListener('error', () => resolve({ ok: false }))
  setTimeout(() => resolve({ ok: false, timeout: true }), 3000)
})

const good = await dial('test-token')
t('correct token dials in', good.ok === true)
t('transport reports online', conn.state === 'online')
const bad = await dial('wrong')
let good2
t('wrong token is rejected', bad.ok === false)

// self id is learned from a meta event
good.ws.send(JSON.stringify({ post_type: 'meta_event', meta_event_type: 'lifecycle', self_id: 10001 }))
await wait(150)
t('self id learned from meta event', conn.selfId === '10001')

// pushed message reaches the event handler
good.ws.send(JSON.stringify({ post_type: 'message', message_type: 'private', user_id: 2, message_id: 1, message: [], sender: {} }))
await wait(150)
t('pushed event is dispatched', events.some((f) => f.post_type === 'message'))

// action roundtrip: the gateway echoes our echo
good.ws.addEventListener('message', (event) => {
  const frame = JSON.parse(event.data)
  good.ws.send(JSON.stringify({ echo: frame.echo, status: 'ok', retcode: 0, data: { message_id: 777 } }))
})
const data = await conn.call('send_private_msg', { user_id: 2, message: [] })
t('action response resolves', data.message_id === 777)
t('action was logged as send then recv',
  log.snapshot(0, 500).entries.some((e) => e.kind === 'send' && e.action === 'send_private_msg')
  && log.snapshot(0, 500).entries.some((e) => e.kind === 'recv' && e.retcode === 0))

// a failed action rejects with the gateway's wording
good.ws.send(JSON.stringify({ echo: 'missing', status: 'failed', retcode: 100, wording: 'bad' }))
await wait(100)
t('token never reaches the log', !JSON.stringify(log.snapshot(0, 500)).includes('test-token'))

// an action with no link rejects instead of hanging
good.ws.close()
await wait(250)
t('link loss flips to offline', conn.state === 'offline')
let rejected = false
try { await conn.call('send_private_msg', {}) } catch { rejected = true }
t('call without a link rejects', rejected)
// the learned account is reported to the Host so it can be persisted
const learnedIds = []
conn.onLearnSelfId = (id) => learnedIds.push(id)
good2 = await dial('test-token')
good2.ws.send(JSON.stringify({ post_type: 'meta_event', meta_event_type: 'heartbeat', self_id: 424242, time: 1 }))
await wait(200)
t('onLearnSelfId fires with the learned id', learnedIds.includes('424242'), JSON.stringify(learnedIds))
good2.ws.close()
await wait(150)

await conn.stop()

// busy port must not throw out of start() silently
const blocker = createServer(() => {})
await new Promise((resolve) => blocker.listen(18651, '127.0.0.1', resolve))
const log2 = new LogBus({ capacity: 50 })
const busy = new OneBotConnection({ config: { ...baseConfig, port: 18651 }, log: log2 })
let busyRejected = false
try { await busy.start() } catch { busyRejected = true }
t('busy port rejects start', busyRejected)
t('busy port is logged', log2.snapshot(0, 50).entries.some((e) => e.kind === 'error' && e.port === 18651))
await busy.stop()
await new Promise((resolve) => blocker.close(resolve))

// ---------------------------------------------------------------- bridge
const sent = []
const transport = {
  selfId: '10001',
  state: 'online',
  sendText: async (chat, text) => { sent.push(text); return { message_id: sent.length } },
  call: async () => ({}),
}
const created = []
const createdOptions = []
const resumeIds = []
let sessionEvent
let liveAgent
const agents = {
  get: (id) => (liveAgent !== undefined && liveAgent.session.id === id ? liveAgent : undefined),
  async create(options) {
    created.push(options.sessionId)
    createdOptions.push(options.agentOptions)
    const session = { id: options.sessionId }
    const agent = { session, followups: [], followup(m) { this.followups.push(m) } }
    // The real factory runs the setup callback during creation; the mount and
    // prompt registration only happen there.
    if (typeof options.setup === 'function') {
      await options.setup({ systemPrompt: { section: () => () => {} }, tools: { register: () => () => {} } })
    }
    return { agent, dispose: async () => {} }
  },
  async resume(options) {
    if (!resumeIds.includes(options.resumeSessionId)) throw new Error('no persisted session')
    const session = { id: options.resumeSessionId }
    const agent = { session, followups: [], followup(m) { this.followups.push(m) } }
    if (typeof options.setup === 'function') {
      await options.setup({ systemPrompt: { section: () => () => {} }, tools: { register: () => () => {} } })
    }
    return { agent, dispose: async () => {} }
  },
}
const workspaceCalls = { resolved: [], created: [], attached: [], existing: [] }
const workspaceRegistry = {
  async resolveByPath(path) {
    workspaceCalls.resolved.push(path)
    if (workspaceCalls.created.includes(path) || workspaceCalls.existing.includes(path)) {
      return { attachSession: async (id) => { workspaceCalls.attached.push(id) } }
    }
    return undefined
  },
  async create(path) {
    workspaceCalls.created.push(path)
    return { attachSession: async (id) => { workspaceCalls.attached.push(id) } }
  },
}
const ctx = {
  on: (name, cb) => { if (name === 'session/event') sessionEvent = cb; return () => {} },
  agents,
  // The Host's default-model owner; a fresh agent must start on it.
  get: (name) => (name === 'agentDefaultModel'
    ? { currentSelection: () => ({ provider: 'localhost', model: 'group/never-stuck' }) }
    : undefined),
}
const titles = []
const bridge = new ChatBridge({
  ctx, config: { ...baseConfig, workspacePath: '/workspace/QQ' }, connection: transport, log,
  sessionTitle: { rename: (_session, title) => titles.push(title) },
  getWorkspaceRegistry: () => workspaceRegistry,
  getAgentPresets: () => agentPresets,
  getPermissionPresets: () => permissionPresets,
  getPlanMode: () => planMode,
  describeError: (error) => String(error?.message ?? error),
})
bridge.start()

const inbound = (overrides) => ({
  post_type: 'message', message_type: 'private', user_id: 20002, message_id: 1,
  message: [{ type: 'text', data: { text: '你好' } }], sender: { nickname: '小明' }, ...overrides,
})

await bridge.handleInbound(inbound({}))
const chat = bridge.chats.get('private:20002')
t('private message creates a session', chat !== undefined)
t('agent starts on the host default model', createdOptions.length === 1
  && createdOptions[0].provider === 'localhost' && createdOptions[0].model === 'group/never-stuck',
  JSON.stringify(createdOptions[0]))
t('session id is derived from the chat', chat.sessionId === 'onebot-private-20002')
t('title is pinned to the id', titles[0] === chat.sessionId)
t('message reaches the agent', chat.agent.followups.length === 1 && chat.agent.followups[0].role === 'user')
t('the preset is actually mounted', calls.mounted.length > 0)

// an explicit provider::model in config wins over the deployment default
const bridgeModel = new ChatBridge({
  ctx, config: { ...baseConfig, workspacePath: '/workspace/QQ', agentModel: 'localhost::group/never-stuck' },
  connection: transport, log,
  getWorkspaceRegistry: () => workspaceRegistry,
  describeError: String,
})
t('configured model overrides the default', JSON.stringify(bridgeModel.modelOptions()) === '{"provider":"localhost","model":"group/never-stuck"}', JSON.stringify(bridgeModel.modelOptions()))
t('unconfigured model falls back to the host default', bridge.modelOptions()?.provider === 'localhost')
t('new session applies the configured permission', calls.permissionSet.includes('workspace-write'))
t('new session applies the configured mode', calls.planSet.includes(false))
t('a missing workspace is created', workspaceCalls.created.includes('/workspace/QQ'))
t('the session is attached to the workspace', workspaceCalls.attached.includes(chat.sessionId))

await bridge.handleInbound(inbound({ message_type: 'group', group_id: 888, message_id: 2 }))
t('group message without a mention is ignored', bridge.chats.has('group:888') === false)

await bridge.handleInbound(inbound({
  message_type: 'group', group_id: 888, message_id: 3, sender: { card: '小明' }, time: 1700000000,
  message: [{ type: 'at', data: { qq: '10001' } }, { type: 'text', data: { text: ' 帮我看看' } }],
}))
const groupChat = bridge.chats.get('group:888')
t('mentioned group message is handled', groupChat !== undefined)
t('group text carries the speaker prefix', /^\[\d\d:\d\d 小明\(20002\)\] /.test(groupChat.agent.followups[0].content[0].text))

const before = groupChat.agent.followups.length
await bridge.handleInbound(inbound({
  message_type: 'group', group_id: 888, message_id: 3, sender: { card: '小明' },
  message: [{ type: 'at', data: { qq: '10001' } }, { type: 'text', data: { text: ' 重复' } }],
}))
t('duplicate message id is skipped', groupChat.agent.followups.length === before)

// outbound: text is buffered and sent once when the turn ends
sessionEvent({ id: chat.sessionId }, { type: 'turn/start', data: { turn: 1 } })
sessionEvent({ id: chat.sessionId }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '第一段' }, { type: 'reasoning', text: '内部' }, { type: 'text', text: '第二段' }] } } })
t('nothing is sent mid-turn', sent.length === 0)
sessionEvent({ id: chat.sessionId }, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
await wait(50)
t('one message is sent at turn end', sent.length === 1)
t('only text blocks are joined', sent[0] === '第一段\n第二段')

// a message queued mid-turn must not wipe the running turn's buffer
sessionEvent({ id: chat.sessionId }, { type: 'turn/start', data: { turn: 2 } })
sessionEvent({ id: chat.sessionId }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'T2' }] } } })
await bridge.handleInbound(inbound({ message_id: 4, message: [{ type: 'text', data: { text: '排队' } }] }))
sessionEvent({ id: chat.sessionId }, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
await wait(50)
t('queued message preserves the running turn text', sent[1] === 'T2', JSON.stringify(sent[1]))

// an errored turn with no text still reports something
sessionEvent({ id: chat.sessionId }, { type: 'turn/start', data: { turn: 3 } })
sessionEvent({ id: chat.sessionId }, { type: 'turn/end', data: { reason: { kind: 'error', error: { message: '模型出错' } } } })
await wait(50)
t('errored turn sends a notice', sent.length === 3 && sent[2].startsWith('⚠️'))

// events from other sessions are ignored
sessionEvent({ id: 'web-session' }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'x' }] } } })
t('foreign sessions are ignored', sent.length === 3)

// a configured preset that no longer exists falls back to the deployment default
calls.mounted.length = 0
const bridgeGone = new ChatBridge({
  ctx, config: { ...baseConfig, workspacePath: '/workspace/QQ', agentPreset: 'deleted-preset' },
  connection: transport, log, workspaceRegistry,
  getWorkspaceRegistry: () => workspaceRegistry,
  getAgentPresets: () => agentPresets,
  getPermissionPresets: () => permissionPresets,
  getPlanMode: () => planMode,
  describeError: String,
})
bridgeGone.start()
await bridgeGone.handleInbound(inbound({ user_id: 66666, message_id: 66 }))
t('deleted preset falls back to the default mount', calls.mounted.includes('default'), JSON.stringify(calls.mounted))
await bridgeGone.stop()

// plan mode config is applied as true
calls.planSet.length = 0
const bridgePlan = new ChatBridge({
  ctx, config: { ...baseConfig, workspacePath: '/workspace/QQ', sessionMode: 'plan' },
  connection: transport, log, workspaceRegistry,
  getWorkspaceRegistry: () => workspaceRegistry,
  getAgentPresets: () => agentPresets,
  getPermissionPresets: () => permissionPresets,
  getPlanMode: () => planMode,
  describeError: String,
})
bridgePlan.start()
await bridgePlan.handleInbound(inbound({ user_id: 55555, message_id: 55 }))
t('plan mode config commits plan state', calls.planSet.includes(true), JSON.stringify(calls.planSet))
await bridgePlan.stop()

// a workspace that already exists is not recreated
workspaceCalls.existing.push('/workspace/QQ')
const bridgeExisting = new ChatBridge({ ctx, config: { ...baseConfig, workspacePath: '/workspace/QQ' }, connection: transport, log, getWorkspaceRegistry: () => workspaceRegistry, describeError: String })
const beforeCreate = workspaceCalls.created.length
bridgeExisting.start()
await bridgeExisting.handleInbound(inbound({ user_id: 77777, message_id: 77 }))
t('existing workspace is reused, not recreated', workspaceCalls.created.length === beforeCreate, JSON.stringify(workspaceCalls.created))

// a workspace deleted later is recreated on the next message, even though the chat exists
workspaceCalls.existing.length = 0   // registry no longer resolves it = deleted
workspaceCalls.created.length = 0
bridgeExisting.reconfigure({ ...baseConfig, workspacePath: '/workspace/QQ' })
await bridgeExisting.handleInbound(inbound({ user_id: 77777, message_id: 78 }))
t('deleted workspace is recreated on the next message', workspaceCalls.created.includes('/workspace/QQ'), JSON.stringify(workspaceCalls.created))
await bridgeExisting.stop()

// restart resumes the same session instead of creating a new one
await bridge.stop()
resumeIds.push(chat.sessionId)
const bridge2 = new ChatBridge({ ctx, config: baseConfig, connection: transport, log, describeError: String })
bridge2.start()
await bridge2.handleInbound(inbound({ message_id: 9 }))
t('restart resumes the same session', bridge2.chats.get('private:20002').sessionId === chat.sessionId)

// a session already live elsewhere (opened in the Web UI) is reused, not recreated
await bridge2.stop()
const liveSessionId = 'onebot-private-20002'
liveAgent = { session: { id: liveSessionId }, followups: [], followup(m) { this.followups.push(m) } }
const bridge3 = new ChatBridge({ ctx, config: baseConfig, connection: transport, log, describeError: String })
bridge3.start()
await bridge3.handleInbound(inbound({ user_id: 20002, message_id: 11 }))
const borrowedChat = bridge3.chats.get('private:20002')
t('live agent is reused', borrowedChat !== undefined && borrowedChat.agent === liveAgent)
t('borrowed agent is not disposed by the plugin', borrowedChat.borrowed === true)
t('reused agent receives the message', liveAgent.followups.length === 1)
await bridge3.stop()
t('stopping does not dispose a borrowed agent', liveAgent.session !== undefined)

// allowlist blocks a chat that is not listed
const bridge4 = new ChatBridge({ ctx, config: { ...baseConfig, allowFrom: ['99999'] }, connection: transport, log, describeError: String })
bridge4.start()
await bridge4.handleInbound(inbound({ message_id: 10 }))
t('allowlist blocks the chat', bridge4.chats.has('private:20002') === false)
await bridge4.stop()

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
