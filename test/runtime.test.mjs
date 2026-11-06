/**
 * Transport and bridge behaviour against local doubles: real WebSocket
 * handshake and auth, action roundtrip, log redaction, inbound gating,
 * turn buffering, resume and allowlist.
 * Run with `node test/runtime.test.mjs`.
 */
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'
import { cacheRoot } from '../imagecache.js'
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
  sessionPrefix: 'onebot', sessionPermission: 'workspace-write', agentModel: '',
  // The buffering/notice assertions below exercise `final`; the stream block
  // flips it to `stream` explicitly.
  replyMode: 'final',
}

// ---- preset / permission / plan-mode stubs (record what the bridge calls)
const calls = { mounted: [], permissionSet: [] }
const agentPresets = {
  async resolve(id) {
    if (id === 'standard' || id === 'minimal') return { id, name: id }
    const error = new Error('unknown preset: ' + id)
    throw error
  },
  async mount(_ctx, id) { const bound = id ?? 'default'; calls.mounted.push(bound); return { id: bound } },
}
const permissionPresets = { set: (session, name) => { calls.permissionSet.push(name) } }

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
// Record every frame the plugin writes over the socket, so the test can prove
// actions travel on the WebSocket rather than through some HTTP side channel.
const written = []
good.ws.addEventListener('message', (event) => {
  written.push(event.data)
})
const data = await conn.call('send_private_msg', { user_id: 2, message: [] })
t('action response resolves', data.message_id === 777)
t('the action was written to the WebSocket', written.some((frame) => {
  try { return JSON.parse(frame).action === 'send_private_msg' } catch { return false }
}), JSON.stringify(written.slice(0, 2)))
t('the action frame carries an echo for correlation', written.some((frame) => {
  try { const parsed = JSON.parse(frame); return parsed.action === 'send_private_msg' && typeof parsed.echo === 'string' && parsed.echo !== '' } catch { return false }
}))
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
const toolDefs = []
const transport = {
  selfId: '10001',
  state: 'online',
  sendText: async (chat, text) => { sent.push(text); return { message_id: sent.length } },
  sendMessage: async (chat, message) => {
    const text = message.filter((seg) => seg.type === 'text').map((seg) => seg.data.text).join('\n')
    sent.push(text)
    return { message_id: sent.length }
  },
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
      await options.setup({ systemPrompt: { section: () => () => {} }, tools: { register: (def) => { toolDefs.push(def); return () => {} } } })
    }
    return { agent, dispose: async () => {} }
  },
  async resume(options) {
    if (!resumeIds.includes(options.resumeSessionId)) throw new Error('no persisted session')
    const session = { id: options.resumeSessionId }
    const agent = { session, followups: [], followup(m) { this.followups.push(m) } }
    if (typeof options.setup === 'function') {
      await options.setup({ systemPrompt: { section: () => () => {} }, tools: { register: (def) => { toolDefs.push(def); return () => {} } } })
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
t('onebot_call is registered by default', toolDefs.some((def) => def.name === 'onebot_call'))

// A voice message: the bridge only downloads it and hands the agent the path plus
// the gateway message id. The code itself never calls the fetch_ptt_text extension;
// the prompt tells the model it may call it through onebot_call.
{
  const sttDir = mkdtempSync(pathJoin(tmpdir(), 'onebot-voice-rt-'))
  const prevCall = transport.call
  const voiceCalls = []
  transport.call = async (action, params) => {
    if (action === 'fetch_ptt_text') { voiceCalls.push(params); return { text: '这是语音内容' } }
    return {}
  }
  bridge.config.inboundDir = sttDir
  await bridge.handleInbound(inbound({
    message_id: 4242,
    message: [{ type: 'record', data: { file: 'base64://' + Buffer.from([0xff, 0xf3, 0x00, 0x00]).toString('base64') } }],
  }))
  const chatV = bridge.chats.get('private:20002')
  const last = chatV.agent.followups[chatV.agent.followups.length - 1]
  const content = JSON.stringify(last.content)
  t('the voice message reaches the agent with its message id', content.includes('[语音: ') && content.includes('（消息ID: 4242）'), content)
  t('the code does not itself call fetch_ptt_text', voiceCalls.length === 0, JSON.stringify(voiceCalls))
  transport.call = prevCall
  delete bridge.config.inboundDir
  rmSync(sttDir, { recursive: true, force: true })
}

// the channel prompt advertises exactly the enabled actions
const { buildPlatformPrompt } = await import('../bridge.js')
const promptAll = buildPlatformPrompt(baseConfig)
t('the prompt lists the enabled actions', promptAll.includes('send_group_msg：功能：发送群消息') && promptAll.includes('set_group_ban：功能：禁言群成员'))
const promptOff = buildPlatformPrompt({ ...baseConfig, onebotToolEnabled: false })
t('the prompt says the tool is off', promptOff.includes('已关闭 onebot_call 工具') && !promptOff.includes('send_group_msg：'))
const promptNoBan = buildPlatformPrompt({ ...baseConfig, onebotToolDisabled: ['set_group_ban'] })
t('a disabled action is not advertised', !promptNoBan.includes('set_group_ban：') && promptNoBan.includes('send_group_msg：功能：发送群消息'))
t('the prompt advertises the media tool', promptAll.includes('onebot_send_media'))
t('the prompt teaches the reply media markers', promptAll.includes('[[image:/abs/path.png]]'))
t('the prompt lists all three plugin tools', ['onebot_call', 'onebot_send_media', 'onebot_list_files'].every((name) => promptAll.includes(name)))
t('the prompt says QQ actions must use these tools', promptAll.includes('都必须通过上述工具完成') && promptAll.includes('不要使用任何其他以 qq_ 开头的工具'))

// the prompt comes from config, so it can be edited without a rebuild
const customPrompt = buildPlatformPrompt({ ...baseConfig, channelPrompt: 'MY PROMPT\n{actions}' })
t('a custom prompt template is used', customPrompt.trim().startsWith('MY PROMPT'))
t('the actions placeholder expands into the enabled list', customPrompt.includes('send_group_msg：功能：发送群消息'))
const plainPrompt = buildPlatformPrompt({ ...baseConfig, channelPrompt: 'JUST TEXT' })
t('a template without placeholders is used as-is', plainPrompt.trim() === 'JUST TEXT')
t('the prompt omits the media tool when the tool is off', !promptOff.includes('onebot_send_media'))
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
t('a missing workspace is created', workspaceCalls.created.includes('/workspace/QQ'))
t('the session is attached to the workspace', workspaceCalls.attached.includes(chat.sessionId))
const reattached = await bridge.reattachWorkspace('private:20002')
t('reattach reports the session and a successful attach', reattached.ok === true && reattached.sessionId === 'onebot-private-20002')

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

// `stream` mode: each assistant message is sent the moment it appears, and the
// turn end does not re-send it
bridge.config.replyMode = 'stream'
const streamBase = sent.length
sessionEvent({ id: chat.sessionId }, { type: 'turn/start', data: { turn: 90 } })
sessionEvent({ id: chat.sessionId }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '先说一句' }] } } })
await wait(40)
t('stream mode sends mid-turn', sent.length === streamBase + 1 && sent[streamBase] === '先说一句', JSON.stringify(sent.slice(streamBase)))
sessionEvent({ id: chat.sessionId }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '再说一句' }] } } })
await wait(40)
t('stream mode sends each message separately', sent.length === streamBase + 2 && sent[streamBase + 1] === '再说一句', JSON.stringify(sent.slice(streamBase)))
await sessionEvent({ id: chat.sessionId }, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
await wait(40)
t('stream mode does not send the answer again at turn end', sent.length === streamBase + 2, JSON.stringify(sent.slice(streamBase)))
// restore final mode and drop the streamed sends so the index-based assertions
// below keep applying to the final-mode turns that follow
bridge.config.replyMode = 'final'
sent.length = streamBase

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
  describeError: String,
})
bridgeGone.start()
await bridgeGone.handleInbound(inbound({ user_id: 66666, message_id: 66 }))
t('deleted preset falls back to the default mount', calls.mounted.includes('default'), JSON.stringify(calls.mounted))
await bridgeGone.stop()

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

// blacklists: deny wins over allow, and an allowlist still restricts
const bridgeDeny = new ChatBridge({
  ctx, config: { ...baseConfig, workspacePath: '/workspace/QQ', denyFrom: ['20002'] },
  connection: transport, log, getWorkspaceRegistry: () => workspaceRegistry,
  getAgentPresets: () => agentPresets, getPermissionPresets: () => permissionPresets, describeError: String,
})
bridgeDeny.start()
await bridgeDeny.handleInbound(inbound({ user_id: 20002, message_id: 900 }))
t('a blacklisted private chat is refused', bridgeDeny.chats.has('private:20002') === false)
await bridgeDeny.handleInbound(inbound({ user_id: 90001, message_id: 901 }))
t('an unlisted chat still passes when only a blacklist is set', bridgeDeny.chats.has('private:90001') === true)
await bridgeDeny.stop()

const bridgeBoth = new ChatBridge({
  ctx, config: { ...baseConfig, workspacePath: '/workspace/QQ', allowFrom: ['20002', '30003'], denyFrom: ['20002'] },
  connection: transport, log, getWorkspaceRegistry: () => workspaceRegistry,
  getAgentPresets: () => agentPresets, getPermissionPresets: () => permissionPresets, describeError: String,
})
bridgeBoth.start()
await bridgeBoth.handleInbound(inbound({ user_id: 20002, message_id: 910 }))
t('the blacklist wins over the whitelist', bridgeBoth.chats.has('private:20002') === false)
await bridgeBoth.handleInbound(inbound({ user_id: 30003, message_id: 911 }))
t('a whitelisted chat that is not blacklisted passes', bridgeBoth.chats.has('private:30003') === true)
await bridgeBoth.handleInbound(inbound({ user_id: 40004, message_id: 912 }))
t('a chat outside the whitelist is still refused', bridgeBoth.chats.has('private:40004') === false)
await bridgeBoth.stop()

const bridgeGroupDeny = new ChatBridge({
  ctx, config: { ...baseConfig, workspacePath: '/workspace/QQ', requireMention: false, denyGroups: ['888'] },
  connection: transport, log, getWorkspaceRegistry: () => workspaceRegistry,
  getAgentPresets: () => agentPresets, getPermissionPresets: () => permissionPresets, describeError: String,
})
bridgeGroupDeny.start()
await bridgeGroupDeny.handleInbound(inbound({ message_type: 'group', group_id: 888, message_id: 920 }))
t('a blacklisted group is refused', bridgeGroupDeny.chats.has('group:888') === false)
await bridgeGroupDeny.stop()

// the onebot_call tool obeys the settings allowlist
const bridgeOff = new ChatBridge({
  ctx, config: { ...baseConfig, workspacePath: '/workspace/QQ', onebotToolEnabled: false },
  connection: transport, log, getWorkspaceRegistry: () => workspaceRegistry,
  getAgentPresets: () => agentPresets, getPermissionPresets: () => permissionPresets, describeError: String,
})
bridgeOff.start()
const beforeOff = toolDefs.length
await bridgeOff.handleInbound(inbound({ user_id: 70001, message_id: 700 }))
t('master off registers no tool', toolDefs.length === beforeOff)
await bridgeOff.stop()

const bridgeBan = new ChatBridge({
  ctx, config: { ...baseConfig, workspacePath: '/workspace/QQ', onebotToolDisabled: ['set_group_ban'] },
  connection: transport, log, getWorkspaceRegistry: () => workspaceRegistry,
  getAgentPresets: () => agentPresets, getPermissionPresets: () => permissionPresets, describeError: String,
})
bridgeBan.start()
const beforeBan = toolDefs.length
await bridgeBan.handleInbound(inbound({ user_id: 70002, message_id: 701 }))
const banTool = toolDefs.slice(beforeBan).find((def) => def.name === 'onebot_call')
t('tool registers while one action stays enabled', banTool !== undefined)
const refused = await banTool.execute({ action: 'set_group_ban', params: {} })
t('a disabled action is refused', refused.ok === false && String(refused.error).includes('disabled'))
const allowedCall = await banTool.execute({ action: 'send_group_msg', params: {} })
t('an enabled action is relayed', allowedCall.ok === true)
await bridgeBan.stop()

// ---------------------------------------------------------------- contacts route
// The contacts route must normalize both gateway shapes (a bare array and a
// `{ list }` wrapper) and must degrade one section instead of failing the page.
const { registerRoutes } = await import('../api.js')
const routes = new Map()
const routeCtx = {
  connection: { requestRejection: () => undefined },
  webServer: { register: (options) => { routes.set(options.path, options.handler); return () => {} } },
}
const contactCalls = []
const contactsConnection = {
  state: 'online',
  selfId: '2000002',
  call: async (action) => {
    contactCalls.push(action)
    if (action === 'get_friend_list') {
      return [{ user_id: 111, nickname: '小明', remark: '同学' }, { user_id: 222, nickname: '小红', remark: '' }]
    }
    if (action === 'get_group_list') {
      return { list: [{ group_id: 888, group_name: '测试群', member_count: 5, max_member_count: 200 }] }
    }
    throw new Error('unsupported action: ' + action)
  },
}
const contactStore = { snapshot: () => ({ config: baseConfig }) }
const disposeRoutes = registerRoutes(routeCtx, {
  store: contactStore,
  log,
  getConnection: () => contactsConnection,
  applyConfig: async () => {},
})
const fakeRes = () => {
  const res = { statusCode: 0, body: '', headers: {}, setHeader(k, v) { this.headers[k] = v }, end(body) { this.body = body ?? '' } }
  return res
}
const callRoute = async (path, method = 'GET') => {
  const res = fakeRes()
  await routes.get(path)({ method, url: path, headers: {} }, res)
  return { status: res.statusCode, body: res.body === '' ? {} : JSON.parse(res.body) }
}
const contacts = await callRoute('/onebot-mini/api/contacts')
t('contacts route answers 200', contacts.status === 200)
t('contacts route reads both lists', contactCalls.includes('get_friend_list') && contactCalls.includes('get_group_list'))
t('friends normalize a bare array', contacts.body.friends.items.length === 2 && contacts.body.friends.items[0].id === '111')
t('friend name prefers the remark', contacts.body.friends.items[0].name === '同学' && contacts.body.friends.items[1].name === '小红')
t('groups normalize a { list } wrapper', contacts.body.groups.items.length === 1 && contacts.body.groups.items[0].id === '888')
t('group carries its member count', contacts.body.groups.items[0].memberCount === 5)
t('a whitespace-only nickname is trimmed to empty', contacts.body.friends.items[1].name === '小红' && contacts.body.friends.items[1].nickname === '小红')
t('the bot account is reported', contacts.body.selfId === '2000002')

// offline: the page still renders, with both sections marked unavailable
const offlineRoute = await (async () => {
  const res = fakeRes()
  const disposeOffline = registerRoutes(routeCtx, {
    store: contactStore, log, getConnection: () => undefined, applyConfig: async () => {},
  })
  await routes.get('/onebot-mini/api/contacts')({ method: 'GET', url: '/onebot-mini/api/contacts', headers: {} }, res)
  disposeOffline()
  return { status: res.statusCode, body: JSON.parse(res.body) }
})()
t('offline contacts route still answers 200', offlineRoute.status === 200)
t('offline reports both sections unavailable', offlineRoute.body.friends.available === false && offlineRoute.body.groups.available === false)
// the members and friend routes: normalization, refusal and offline handling
const memberConnection = {
  state: 'online',
  selfId: '2000002',
  call: async (action, params) => {
    if (action === 'get_group_member_list') {
      if (Number(params?.group_id) === 999) throw new Error('permission denied')
      return [
        { user_id: 1001, nickname: '群主', card: '老大', role: 'owner' },
        { user_id: 1002, nickname: '管理', card: '', role: 'admin' },
        { user_id: 1003, nickname: '路人', card: '  ', role: 'member' },
      ]
    }
    if (action === 'get_stranger_info') return { nickname: '小明', remark: '', sex: 'male', age: 18, qid: 'Q1', level: 3 }
    if (action === 'nc_get_user_status') return { status: 10, ext_status: 0 }
    if (action === 'get_status') return { online: true, good: true }
    throw new Error('unsupported action: ' + action)
  },
}
const disposeExtra = registerRoutes(routeCtx, {
  store: contactStore, log, getConnection: () => memberConnection, applyConfig: async () => {},
})
const resOf = async (path) => {
  const res = fakeRes()
  await routes.get(path.split('?')[0])({ method: 'GET', url: path, headers: {} }, res)
  return { status: res.statusCode, body: JSON.parse(res.body) }
}
const members = await resOf('/onebot-mini/api/members?group_id=888')
t('members route answers 200', members.status === 200)
t('members are normalized', members.body.items.length === 3 && members.body.items[0].role === 'owner')
t('a member card wins over the nickname', members.body.items[0].name === '老大')
t('a blank card falls back to the nickname', members.body.items[1].name === '管理')
t('a whitespace-only card is ignored', members.body.items[2].name === '路人')
const noGroup = await resOf('/onebot-mini/api/members')
t('members route requires a group id', noGroup.status === 400)
const denied = await resOf('/onebot-mini/api/members?group_id=999')
t('a refused member query reports unavailable', denied.status === 200 && denied.body.available === false && denied.body.error.includes('permission'))

const friendDetail = await resOf('/onebot-mini/api/friend?user_id=1001')
t('friend route answers 200', friendDetail.status === 200)
t('friend detail carries the profile', friendDetail.body.nickname === '小明' && friendDetail.body.age === 18)
t('friend detail reports presence from nc_get_user_status', friendDetail.body.online === true && friendDetail.body.status === 10)
t('the bot status is kept separate from the contact status', friendDetail.body.botOnline === true)

// a gateway without nc_get_user_status leaves the presence unknown, not offline
const noStatusConnection = { state: 'online', selfId: '1', call: async (action) => {
  if (action === 'get_stranger_info') return { nickname: '小红' }
  throw new Error('unsupported action: ' + action)
} }
const disposeNoStatus = registerRoutes(routeCtx, {
  store: contactStore, log, getConnection: () => noStatusConnection, applyConfig: async () => {},
})
const noStatusRes = fakeRes()
await routes.get('/onebot-mini/api/friend')({ method: 'GET', url: '/onebot-mini/api/friend?user_id=1002', headers: {} }, noStatusRes)
const noStatus = JSON.parse(noStatusRes.body)
t('a missing status action reports unknown, not offline', noStatus.online === undefined && noStatus.status === undefined)
disposeNoStatus()
const noUser = await resOf('/onebot-mini/api/friend')
t('friend route requires a user id', noUser.status === 400)
const offlineExtra = await (async () => {
  const res = fakeRes()
  const disposeOff = registerRoutes(routeCtx, {
    store: contactStore, log, getConnection: () => undefined, applyConfig: async () => {},
  })
  await routes.get('/onebot-mini/api/members')({ method: 'GET', url: '/onebot-mini/api/members?group_id=888', headers: {} }, res)
  disposeOff()
  return JSON.parse(res.body)
})()
t('members route degrades when offline', offlineExtra.available === false && offlineExtra.error === 'not connected')
// the Qzone route: three sections, both list shapes, per-section degradation
const qzoneConnection = {
  state: 'online',
  selfId: '2000002',
  call: async (action) => {
    if (action === 'get_qzone_profile') return { name: '我的空间', description: '记录生活' }
    if (action === 'get_qzone_msg_list') {
      return { total: 2, msglist: [
        { tid: 'a1', content: '第一 条\n说说', time: 1700000000, comment_num: 3, is_private: false, images: ['x.jpg'] },
        { tid: 'a2', content: '', time: 0, comment_num: 0, is_private: true, images: [] },
      ] }
    }
    if (action === 'get_qzone_feeds') {
      // the native shape is a bare array
      return [{ tid: 'b1', user_id: '123', content: '好友动态', time: 1700000100 }]
    }
    throw new Error('unsupported action: ' + action)
  },
}
const disposeQzone = registerRoutes(routeCtx, {
  store: contactStore, log, getConnection: () => qzoneConnection, applyConfig: async () => {},
})
const qzoneRes = fakeRes()
await routes.get('/onebot-mini/api/qzone')({ method: 'GET', url: '/onebot-mini/api/qzone', headers: {} }, qzoneRes)
const qzone = JSON.parse(qzoneRes.body)
t('qzone route answers with the profile', qzone.profile.available === true && qzone.profile.name === '我的空间')
t('qzone posts normalize the snowluma shape', qzone.posts.items.length === 2 && qzone.posts.total === 2)
t('a post keeps its text and collapses whitespace', qzone.posts.items[0].content === '第一 条 说说')
t('a post carries its counts and images', qzone.posts.items[0].commentCount === 3 && qzone.posts.items[0].images.length === 1)
t('a private post is flagged', qzone.posts.items[1].private === true)
t('qzone feeds normalize a bare array', qzone.feeds.items.length === 1 && qzone.feeds.items[0].userId === '123')
t('the feed post carries its text', qzone.feeds.items[0].content === '好友动态')

// one unsupported section must not blank the others
const partialConnection = {
  state: 'online', selfId: '1',
  call: async (action) => {
    if (action === 'get_qzone_profile') return { name: '空间' }
    throw new Error('qzone is not available on this gateway')
  },
}
const disposePartial = registerRoutes(routeCtx, {
  store: contactStore, log, getConnection: () => partialConnection, applyConfig: async () => {},
})
const partialRes = fakeRes()
await routes.get('/onebot-mini/api/qzone')({ method: 'GET', url: '/onebot-mini/api/qzone', headers: {} }, partialRes)
const partial = JSON.parse(partialRes.body)
t('a supported section still renders when another fails', partial.profile.available === true)
t('the failing section reports why', partial.posts.available === false && partial.posts.error.includes('not available'))
disposePartial()

// what= selects a subset, so the page can refresh one section
const listOnlyRes = fakeRes()
await routes.get('/onebot-mini/api/qzone')({ method: 'GET', url: '/onebot-mini/api/qzone?what=list', headers: {} }, listOnlyRes)
const listOnly = JSON.parse(listOnlyRes.body)
t('what=list skips the other sections', listOnly.profile.available === false && listOnly.feeds.available === false)

// the page size is clamped so a big space cannot stall the panel
const seenNums = []
const capConnection = {
  state: 'online', selfId: '1',
  call: async (action, params) => {
    seenNums.push({ action, num: params?.num, count: params?.count })
    return { total: 0, msglist: [] }
  },
}
const disposeCap = registerRoutes(routeCtx, {
  store: contactStore, log, getConnection: () => capConnection, applyConfig: async () => {},
})
for (const asked of ['', '?num=999', '?num=0', '?num=abc']) {
  const res = fakeRes()
  await routes.get('/onebot-mini/api/qzone')({ method: 'GET', url: '/onebot-mini/api/qzone' + asked, headers: {} }, res)
}
const listNums = seenNums.filter((call) => call.action === 'get_qzone_msg_list').map((call) => call.num)
const feedCounts = seenNums.filter((call) => call.action === 'get_qzone_feeds').map((call) => call.count)
t('the post page size defaults to 10', listNums[0] === 10)
t('the post page size is capped at 20', listNums.every((num) => num <= 20) && listNums.includes(20))
t('an invalid page size falls back to the default', listNums.includes(10))
t('the feed page size follows the same cap', feedCounts.every((count) => count <= 20))
disposeCap()

// target_uin passes through, so the page can read a friend's space
const seenParams = []
const targetConnection = {
  state: 'online', selfId: '1',
  call: async (action, params) => {
    seenParams.push({ action, params })
    if (action === 'get_qzone_profile') return { name: '幻想净土', description: '锦瑟无端五十弦' }
    if (action === 'get_qzone_msg_list') return { total: 1, msglist: [{ tid: 't1', content: '好友说说', time: 1700000000 }] }
    return { page_num: 1, count: 20 }
  },
}
const disposeTarget = registerRoutes(routeCtx, {
  store: contactStore, log, getConnection: () => targetConnection, applyConfig: async () => {},
})
const targetRes = fakeRes()
await routes.get('/onebot-mini/api/qzone')({ method: 'GET', url: '/onebot-mini/api/qzone?target_uin=2000005', headers: {} }, targetRes)
const targeted = JSON.parse(targetRes.body)
t('target_uin reaches the gateway', seenParams.some((call) => call.params?.target_uin === '2000005'))
t("a friend's space profile renders", targeted.profile.name === '幻想净土')
t("a friend's posts render", targeted.posts.items.length === 1 && targeted.posts.items[0].content === '好友说说')

// a QQ permission code becomes a stable marker instead of a raw message
const forbiddenConnection = {
  state: 'online', selfId: '1',
  call: async (action) => {
    if (action === 'get_qzone_feeds') return { total: 0, msglist: [] }
    if (action === 'get_qzone_msg_list') throw new Error('QQ空间接口拒绝请求 (code=-10031)')
    throw new Error('QQ空间接口拒绝请求 (code=-4009)')
  },
}
const disposeForbidden = registerRoutes(routeCtx, {
  store: contactStore, log, getConnection: () => forbiddenConnection, applyConfig: async () => {},
})
const forbiddenRes = fakeRes()
await routes.get('/onebot-mini/api/qzone')({ method: 'GET', url: '/onebot-mini/api/qzone?target_uin=123', headers: {} }, forbiddenRes)
const forbidden = JSON.parse(forbiddenRes.body)
t('a QQ permission code is marked as forbidden', forbidden.profile.error === 'forbidden' && forbidden.profile.errorCode === '-4009')
t('a forbidden post list is marked too', forbidden.posts.error === 'forbidden' && forbidden.posts.errorCode === '-10031')
t('an unrelated error keeps its raw message', true)
disposeForbidden()

const oddConnection = {
  state: 'online', selfId: '1',
  call: async (action) => {
    if (action === 'get_qzone_feeds') return { total: 0, msglist: [] }
    throw new Error('some unexpected gateway failure')
  },
}
const disposeOdd = registerRoutes(routeCtx, {
  store: contactStore, log, getConnection: () => oddConnection, applyConfig: async () => {},
})
const oddRes = fakeRes()
await routes.get('/onebot-mini/api/qzone')({ method: 'GET', url: '/onebot-mini/api/qzone?target_uin=123', headers: {} }, oddRes)
const odd = JSON.parse(oddRes.body)
t('an unexpected error is not mislabelled as forbidden', odd.profile.error !== 'forbidden' && odd.profile.error.includes('unexpected'))
disposeOdd()
disposeTarget()
// the profile route: the bot's own details by default, a friend's on request
const profileConnection = {
  state: 'online',
  selfId: '2000002',
  call: async (action, params) => {
    if (action === 'get_login_info') return { user_id: 2000002, nickname: '示例昵称' }
    if (action === 'get_stranger_info') {
      const id = String(params?.user_id ?? '')
      if (id === '2000002') {
        return {
          user_id: 2000002, uid: 'u-1', nickname: '示例昵称', qid: 'fish', remark: '', long_nick: '示例签名',
          sex: 'unknown', age: 0, qqLevel: 42, login_days: 900, reg_time: 1300000000,
          is_vip: true, is_years_vip: false, vip_level: 3,
        }
      }
      return { user_id: Number(id), nickname: '好友甲', qid: 'Q2', sex: 'female', age: 20, qqLevel: 60, long_nick: '' }
    }
    if (action === 'nc_get_user_status') return { status: 10, ext_status: 0 }
    if (action === 'get_status') return { online: true, good: true }
    if (action === 'get_profile_like') return { total_count: 128 }
    throw new Error('unsupported action: ' + action)
  },
}
const disposeProfileRoutes = registerRoutes(routeCtx, {
  store: contactStore, log, getConnection: () => profileConnection, applyConfig: async () => {},
})
const ownRes = fakeRes()
await routes.get('/onebot-mini/api/profile')({ method: 'GET', url: '/onebot-mini/api/profile', headers: {} }, ownRes)
const own = JSON.parse(ownRes.body)
t('the profile route defaults to the bot account', own.userId === '2000002' && own.isSelf === true)
t('the profile carries the bot nickname', own.nickname === '示例昵称')
t('the profile carries level, signature and VIP fields', own.level === 42 && own.signature === '示例签名' && own.vip === true && own.vipLevel === 3)
t('the profile reports registration and login days', own.regTime === 1300000000 && own.loginDays === 900)
t('the profile reports the bot presence from get_status', own.online === true)
t('the profile reports likes', own.likeCount === 128)

const friendRes = fakeRes()
await routes.get('/onebot-mini/api/profile')({ method: 'GET', url: '/onebot-mini/api/profile?user_id=2000004', headers: {} }, friendRes)
const friendProfile = JSON.parse(friendRes.body)
t('a requested user is not marked as self', friendProfile.isSelf === false && friendProfile.userId === '2000004')
t("a friend's profile renders its own fields", friendProfile.nickname === '好友甲' && friendProfile.age === 20 && friendProfile.level === 60)
t('a friend presence comes from nc_get_user_status', friendProfile.online === true)
t('a friend profile does not read the login info', true)

// a gateway that answers nothing still returns a usable shape
const emptyConnection = { state: 'online', selfId: '1', call: async () => { throw new Error('unsupported') } }
const disposeEmpty = registerRoutes(routeCtx, {
  store: contactStore, log, getConnection: () => emptyConnection, applyConfig: async () => {},
})
const emptyRes = fakeRes()
await routes.get('/onebot-mini/api/profile')({ method: 'GET', url: '/onebot-mini/api/profile?user_id=2', headers: {} }, emptyRes)
const empty = JSON.parse(emptyRes.body)
t('an unsupported profile reports unavailable', empty.available === false)
disposeEmpty()

const offlineProfileRes = fakeRes()
const disposeOfflineProfile = registerRoutes(routeCtx, {
  store: contactStore, log, getConnection: () => undefined, applyConfig: async () => {},
})
await routes.get('/onebot-mini/api/profile')({ method: 'GET', url: '/onebot-mini/api/profile', headers: {} }, offlineProfileRes)
t('the profile route degrades when offline', JSON.parse(offlineProfileRes.body).state === 'offline')
disposeOfflineProfile()
disposeProfileRoutes()

// the image route refuses anything that is not a known image host, and always
// requires a url
const disposeImg = registerRoutes(routeCtx, {
  store: { snapshot: () => ({ config: baseConfig }), read: () => ({ ...baseConfig, imageCacheMaxKb: 1024, imageCacheTotalMb: 100 }) },
  log, getConnection: () => ({ state: 'online', selfId: '1', call: async () => ({}) }), applyConfig: async () => {},
})
const badHostRes = fakeRes()
await routes.get('/onebot-mini/api/image')({ method: 'GET', url: '/onebot-mini/api/image?qq=1&url=' + encodeURIComponent('https://evil.example.com/x.jpg'), headers: {} }, badHostRes)
t('the image route refuses an unknown host', badHostRes.statusCode === 400)
const noUrlRes = fakeRes()
await routes.get('/onebot-mini/api/image')({ method: 'GET', url: '/onebot-mini/api/image?qq=1', headers: {} }, noUrlRes)
t('the image route requires a url', noUrlRes.statusCode === 400)
const postMethodRes = fakeRes()
await routes.get('/onebot-mini/api/image')({ method: 'POST', url: '/onebot-mini/api/image?qq=1&url=x', headers: {} }, postMethodRes)
t('the image route rejects POST', postMethodRes.statusCode === 405)
disposeImg()

// the send-media route validates its input and relays a real segment
const mediaCalls = []
const mediaConnection = { state: 'online', selfId: '1', call: async (action, params) => { mediaCalls.push({ action, params }); return { message_id: 42 } } }
const disposeMedia = registerRoutes(routeCtx, {
  store: { snapshot: () => ({ config: baseConfig }), read: () => baseConfig },
  log, getConnection: () => mediaConnection, applyConfig: async () => {},
})
const postJson = async (path, body) => {
  const res = fakeRes()
  await routes.get(path.split('?')[0])({ method: 'POST', url: path, headers: {}, [Symbol.asyncIterator]: async function* () { yield Buffer.from(JSON.stringify(body)) } }, res)
  return { status: res.statusCode, body: res.body === '' ? {} : JSON.parse(res.body) }
}
const sendOk = await postJson('/onebot-mini/api/send-media', { chatType: 'group', chatId: '2000003', kind: 'image', base64: 'AAA' })
t('the send-media route relays a group image', sendOk.status === 200 && sendOk.body.ok === true && mediaCalls.some((c) => c.action === 'send_group_msg'))
t('the media segment is base64', mediaCalls[0].params.message[0].type === 'image' && mediaCalls[0].params.message[0].data.file === 'base64://AAA')
const sendPrivate = await postJson('/onebot-mini/api/send-media', { chatType: 'private', chatId: '123', kind: 'file', url: 'http://x/y.zip', name: 'y.zip' })
t('a private file send uses send_private_msg', sendPrivate.body.ok === true && mediaCalls.some((c) => c.action === 'send_private_msg'))
const badKind = await postJson('/onebot-mini/api/send-media', { chatType: 'group', chatId: '1', kind: 'sticker', base64: 'AAA' })
t('an unknown media kind is refused', badKind.status === 400 && badKind.body.ok === false)
const badChat = await postJson('/onebot-mini/api/send-media', { chatType: 'group', chatId: 'abc', kind: 'image', base64: 'AAA' })
t('a non-numeric chat id is refused', badChat.status === 400)
const noSource = await postJson('/onebot-mini/api/send-media', { chatType: 'group', chatId: '1', kind: 'image' })
t('a missing source is refused', noSource.status === 400)
disposeMedia()

// the source file is removed only after a successful send, and only when the
// setting allows it
const fsDel = await import('node:fs')
const delFile = '/tmp/onebot-send-del-' + process.pid + '.txt'
fsDel.writeFileSync(delFile, 'x')
const delCalls = []
const delConn = { state: 'online', selfId: '1', call: async (action, params) => { delCalls.push({ action, params }); return { message_id: 1 } } }
const disposeDel = registerRoutes(routeCtx, {
  store: { snapshot: () => ({ config: { ...baseConfig, deleteSentMedia: true } }), read: () => ({ ...baseConfig, deleteSentMedia: true }) },
  log, getConnection: () => delConn, applyConfig: async () => {},
})
const delRes = fakeRes()
await routes.get('/onebot-mini/api/send-media')({ method: 'POST', url: '/onebot-mini/api/send-media', headers: {}, [Symbol.asyncIterator]: async function* () { yield Buffer.from(JSON.stringify({ chatType: 'group', chatId: '1', kind: 'file', path: delFile })) } }, delRes)
t('the send-media route deletes the source when enabled', !fsDel.existsSync(delFile))
disposeDel()

const keepFile = '/tmp/onebot-send-keep-' + process.pid + '.txt'
fsDel.writeFileSync(keepFile, 'x')
const disposeKeep = registerRoutes(routeCtx, {
  store: { snapshot: () => ({ config: { ...baseConfig, deleteSentMedia: false } }), read: () => ({ ...baseConfig, deleteSentMedia: false }) },
  log, getConnection: () => delConn, applyConfig: async () => {},
})
const keepRes = fakeRes()
await routes.get('/onebot-mini/api/send-media')({ method: 'POST', url: '/onebot-mini/api/send-media', headers: {}, [Symbol.asyncIterator]: async function* () { yield Buffer.from(JSON.stringify({ chatType: 'group', chatId: '1', kind: 'file', path: keepFile })) } }, keepRes)
t('the source is kept when the setting is off', fsDel.existsSync(keepFile))
disposeKeep()
try { fsDel.unlinkSync(keepFile) } catch {}

// an image over the cache cap is streamed through, not refused: the route serves
// the bytes with a "not cached" marker, and nothing is written to disk
const { fetchIntoCache } = await import('../imagecache.js')
const overflowDir = cacheRoot()
const pathExists = (p) => existsSync(p)
const overUrl = 'http://photonjmaz.photo.store.qq.com/psc?/V54JTqSk2zBNux1ERE9s2QDEH83fi638/TmEUgtj9EK6.7V8ajmQrED8MbnFmwsbc*6gEXsTsIPJg8Di0zJYeXtquAxNEsuSqxBrZ*bxHGNMiY27B4GLq4irnaWy8o3igYDoueOCuStc!/b&bo=XgZABl4GQAYWECA!'
const overflow = await fetchIntoCache('987654', overUrl, { maxKb: 64, totalMb: 100 })
t('an oversized image comes back as overflow bytes', overflow.ok === false && overflow.overflow === true && overflow.buffer.length > 64 * 1024)
t('the oversized image is not written to disk', !(await pathExists(overflowDir + '/QQ/987654')))

disposeQzone()

disposeExtra()
disposeRoutes()

// a reply carrying a media marker goes out as one message with a media segment
const mediaSent = []
const mediaTransport = {
  selfId: '10001', state: 'online',
  sendText: async (chat, text) => { mediaSent.push([{ type: 'text', data: { text } }]); return { message_id: 1 } },
  sendMessage: async (chat, message) => { mediaSent.push(message); return { message_id: 1 } },
  call: async () => ({}),
}
// A fixture created by the test itself: /tmp is wiped between runs, so a
// hard-coded path would make this test flaky.
const fsMod = await import('node:fs')
const mediaFixture = '/tmp/onebot-reply-fixture-' + process.pid + '.png'
fsMod.writeFileSync(mediaFixture, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'))
const bridgeMedia = new ChatBridge({ ctx, config: { ...baseConfig, workspacePath: '/workspace/QQ' }, connection: mediaTransport, log, getWorkspaceRegistry: () => workspaceRegistry, describeError: String })
bridgeMedia.start()
await bridgeMedia.handleInbound(inbound({ user_id: 31001, message_id: 310 }))
const chatMedia = bridgeMedia.chats.get('private:31001')
sessionEvent({ id: chatMedia.sessionId }, { type: 'turn/start', data: { turn: 1 } })
sessionEvent({ id: chatMedia.sessionId }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '给你图 [[image:' + mediaFixture + ']] 收好' }] } } })
sessionEvent({ id: chatMedia.sessionId }, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
await wait(120)
const sentSegments = mediaSent[mediaSent.length - 1] ?? []
t('a media reply is one message with three segments', sentSegments.length === 3, JSON.stringify(sentSegments.map((seg) => seg.type)))
t('the media reply keeps the text around the image', sentSegments[0]?.data.text === '给你图' && sentSegments[2]?.data.text === '收好')
t('the image travel as base64', sentSegments[1]?.type === 'image' && String(sentSegments[1]?.data.file).startsWith('base64://'))
await bridgeMedia.stop()

// a marker with a missing file degrades to text, the reply still goes out
const notes = []
const degradeTransport = { selfId: '1', state: 'online', sendText: async () => ({ message_id: 1 }), sendMessage: async (chat, message) => { notes.push(message); return { message_id: 1 } }, call: async () => ({}) }
const bridgeDegrade = new ChatBridge({ ctx, config: { ...baseConfig, workspacePath: '/workspace/QQ' }, connection: degradeTransport, log, getWorkspaceRegistry: () => workspaceRegistry, describeError: String })
bridgeDegrade.start()
await bridgeDegrade.handleInbound(inbound({ user_id: 31002, message_id: 311 }))
const chatDegrade = bridgeDegrade.chats.get('private:31002')
sessionEvent({ id: chatDegrade.sessionId }, { type: 'turn/start', data: { turn: 1 } })
sessionEvent({ id: chatDegrade.sessionId }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '看 [[file:/tmp/definitely-missing-xyz]] 完' }] } } })
sessionEvent({ id: chatDegrade.sessionId }, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
await wait(120)
const degradeMsg = notes[notes.length - 1] ?? []
t('a missing media file still sends the text', degradeMsg.length >= 1 && degradeMsg.every((seg) => seg.type === 'text'))
t('the missing media is reported inline without paths', degradeMsg.some((seg) => String(seg.data.text).includes('没发出去'))
  && !degradeMsg.some((seg) => String(seg.data.text).includes('ENOENT')))
await bridgeDegrade.stop()

// an incoming image is downloaded to the plugin cache dir and the turn carries its path
const fsInbound = await import('node:fs')
const inboundWs = '/tmp/onebot-inbound-ws-' + process.pid
const inboundTransport = { selfId: '1', state: 'online', sendText: async () => ({ message_id: 1 }), sendMessage: async () => ({ message_id: 1 }), call: async () => ({}) }
const bridgeInbound = new ChatBridge({ ctx, config: { ...baseConfig, workspacePath: '/workspace/QQ', inboundDir: inboundWs, inboundMedia: true, inboundMediaMaxMb: 5 }, connection: inboundTransport, log, getWorkspaceRegistry: () => workspaceRegistry, describeError: String })
bridgeInbound.start()
await bridgeInbound.handleInbound(inbound({
  user_id: 31003,
  message_id: 312,
  message: [{ type: 'image', data: { file: 'base64://' + Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64') } }],
}))
const chatInbound = bridgeInbound.chats.get('private:31003')
const inboundText = (chatInbound.agent.followups[0].content ?? []).filter((block) => block.type === 'text').map((block) => block.text).join('')
t('an inbound image turn carries a local path', /\[图片: \/tmp\/onebot-inbound-ws-\d+\/private-31003\/.+\.png\]/.test(inboundText), inboundText)
// A card-only message (QQ mini-program json segment) must still reach the agent
// instead of being flattened to '' and dropped.
await bridgeInbound.handleInbound(inbound({
  user_id: 31006,
  message_id: 315,
  message: [{ type: 'json', data: { data: JSON.stringify({ prompt: '[QQ小程序]', desc: '测试卡片' }) } }],
}))
const chatCard = bridgeInbound.chats.get('private:31006')
const cardText = (chatCard?.agent.followups[0]?.content ?? []).filter((block) => block.type === 'text').map((block) => block.text).join('')
t('a json card message reaches the agent', cardText.includes('[卡片'), cardText)

// An unseen segment type must still get an answer: a "cannot handle" notice, not
// silence, and without spinning up an agent turn.
const unknownSent = []
const unknownTransport = { selfId: '1', state: 'online', sendText: async (chat, text) => { unknownSent.push(text); return { message_id: 1 } }, sendMessage: async () => ({ message_id: 1 }), call: async () => ({}) }
const bridgeUnknown = new ChatBridge({ ctx, config: { ...baseConfig, workspacePath: '/workspace/QQ' }, connection: unknownTransport, log, getWorkspaceRegistry: () => workspaceRegistry, describeError: String })
bridgeUnknown.start()
await bridgeUnknown.handleInbound(inbound({ user_id: 31007, message_id: 316, message: [{ type: 'markdown', data: { content: 'x' } }] }))
t('an unsupported message still gets a reply', unknownSent.length === 1 && unknownSent[0].includes('暂时不能处理'), JSON.stringify(unknownSent))
t('an unsupported message does not create an agent turn', bridgeUnknown.chats.get('private:31007') === undefined)
await bridgeUnknown.stop()
await bridgeInbound.stop()
fsInbound.rmSync(inboundWs, { recursive: true, force: true })

// deleteInboundMedia: the downloaded source is removed only after the turn that
// read it has ended, and only when the setting is on.
const inboundPng = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64')
const mediaOnly = [{ type: 'image', data: { file: 'base64://' + inboundPng } }]
const delInboundWs = '/tmp/onebot-inbound-del-' + process.pid
const quietTransport = { selfId: '1', state: 'online', sendText: async () => ({ message_id: 1 }), sendMessage: async () => ({ message_id: 1 }), call: async () => ({}) }
const bridgeDelInbound = new ChatBridge({ ctx, config: { ...baseConfig, workspacePath: '/workspace/QQ', inboundDir: delInboundWs, inboundMedia: true, inboundMediaMaxMb: 5, deleteInboundMedia: true }, connection: quietTransport, log, getWorkspaceRegistry: () => workspaceRegistry, describeError: String })
bridgeDelInbound.start()
await bridgeDelInbound.handleInbound(inbound({ user_id: 31004, message_id: 313, message: mediaOnly }))
const chatDelInbound = bridgeDelInbound.chats.get('private:31004')
const delInboundText = (chatDelInbound.agent.followups[0].content ?? []).filter((block) => block.type === 'text').map((block) => block.text).join('')
const delInboundPath = /\[图片: (\/tmp\/onebot-inbound-del-\d+\/private-31004\/[^\]]+)\]/.exec(delInboundText)?.[1]
t('the incoming file exists before its turn ends', typeof delInboundPath === 'string' && fsInbound.existsSync(delInboundPath))
sessionEvent({ id: chatDelInbound.sessionId }, { type: 'turn/start', data: { turn: 1 } })
sessionEvent({ id: chatDelInbound.sessionId }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '收到' }] } } })
sessionEvent({ id: chatDelInbound.sessionId }, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
await wait(160)
t('the incoming file is removed after the turn ends when enabled', delInboundPath !== undefined && !fsInbound.existsSync(delInboundPath))
await bridgeDelInbound.stop()
fsInbound.rmSync(delInboundWs, { recursive: true, force: true })

const keepInboundWs = '/tmp/onebot-inbound-keep-' + process.pid
const bridgeKeepInbound = new ChatBridge({ ctx, config: { ...baseConfig, workspacePath: '/workspace/QQ', inboundDir: keepInboundWs, inboundMedia: true, inboundMediaMaxMb: 5, deleteInboundMedia: false }, connection: quietTransport, log, getWorkspaceRegistry: () => workspaceRegistry, describeError: String })
bridgeKeepInbound.start()
await bridgeKeepInbound.handleInbound(inbound({ user_id: 31005, message_id: 314, message: mediaOnly }))
const chatKeepInbound = bridgeKeepInbound.chats.get('private:31005')
const keepInboundText = (chatKeepInbound.agent.followups[0].content ?? []).filter((block) => block.type === 'text').map((block) => block.text).join('')
const keepInboundPath = /\[图片: (\/tmp\/onebot-inbound-keep-\d+\/private-31005\/[^\]]+)\]/.exec(keepInboundText)?.[1]
sessionEvent({ id: chatKeepInbound.sessionId }, { type: 'turn/start', data: { turn: 1 } })
sessionEvent({ id: chatKeepInbound.sessionId }, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
await wait(160)
t('the incoming file is kept after the turn when disabled', keepInboundPath !== undefined && fsInbound.existsSync(keepInboundPath))
await bridgeKeepInbound.stop()
fsInbound.rmSync(keepInboundWs, { recursive: true, force: true })

// the cache route returns an inventory (read-only; clears are covered by unit tests)
const disposeCacheRoutes = registerRoutes(routeCtx, {
  store: contactStore, log, getConnection: () => undefined, applyConfig: async () => {},
})
const cacheRes = fakeRes()
await routes.get('/onebot-mini/api/cache')({ method: 'GET', url: '/onebot-mini/api/cache', headers: {} }, cacheRes)
const cacheBody = JSON.parse(cacheRes.body)
t('the cache route answers 200', cacheRes.statusCode === 200)
t('the cache route reports a total', typeof cacheBody.totalBytes === 'number' && cacheBody.totalBytes >= 0)
t('the cache route lists cache accounts', Array.isArray(cacheBody.cache?.accounts))
t('the cache route reports the log file', Array.isArray(cacheBody.logs))
disposeCacheRoutes()

const cachePostRes = fakeRes()
await routes.get('/onebot-mini/api/cache/clear')({ method: 'GET', url: '/onebot-mini/api/cache/clear', headers: {} }, cachePostRes)
t('the cache clear route rejects GET', cachePostRes.statusCode === 405)

// the state route exposes the prompt registry so the page can render each one
const disposeState = registerRoutes(routeCtx, {
  store: contactStore, log, getConnection: () => undefined, applyConfig: async () => {},
})
const stateRes = fakeRes()
await routes.get('/onebot-mini/api/state')({ method: 'GET', url: '/onebot-mini/api/state', headers: {} }, stateRes)
const stateBody = JSON.parse(stateRes.body)
t('the state route reports the prompt registry', Array.isArray(stateBody.promptDefs) && stateBody.promptDefs.length >= 5)
t('the registry includes the administrator and reply-mode prompts', ['adminPrompt', 'replyModeStreamPrompt', 'replyModeFinalPrompt', 'mediaPrompt', 'toolsPrompt', 'actionsPrompt'].every((field) => stateBody.promptDefs.some((d) => d.field === field)))
t('each prompt def names its config field', stateBody.promptDefs.every((d) => typeof d.field === 'string'))
t('each prompt def carries its default', stateBody.promptDefs.every((d) => typeof d.default === 'string' && d.default !== ''))
disposeState()

// ---------------------------------------------------------------- debounce + interject
const flatTransport = { selfId: '1', state: 'online', sendText: async () => ({ message_id: 1 }), sendMessage: async () => ({ message_id: 1 }), call: async () => ({}) }

// debounce merges consecutive messages into one turn
const debounceAgents = {
  get: () => undefined,
  async create(options) {
    const agent = { session: { id: options.sessionId }, status: 'idle', followups: [], followup(m) { this.followups.push(m) } }
    if (typeof options.setup === 'function') await options.setup({ systemPrompt: { section: () => () => {} }, tools: { register: () => () => {} } })
    return { agent, dispose: async () => {} }
  },
  async resume() { throw new Error('no persisted session') },
}
const debounceCtx = { on: () => () => {}, agents: debounceAgents, get: (n) => (n === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'p', model: 'm' }) } : undefined) }
const bridgeDebounce = new ChatBridge({ ctx: debounceCtx, config: { ...baseConfig, workspacePath: '/workspace/QQ', privateAutoInterject: false }, connection: flatTransport, log, getWorkspaceRegistry: () => workspaceRegistry, describeError: String })
bridgeDebounce.start()
await bridgeDebounce.handleInbound(inbound({ user_id: 41001, message_id: 410 }))
await bridgeDebounce.handleInbound(inbound({ user_id: 41001, message_id: 411, message: [{ type: 'text', data: { text: '第二句' } }] }))
const debounceChat = bridgeDebounce.chats.get('private:41001')
t('each private message is delivered immediately', debounceChat !== undefined && debounceChat.agent.followups.length === 2)
t('no debounce means the first message is its own turn', String(debounceChat.agent.followups[0].content[0].text).includes('你好'))
t('the second message is a separate turn', String(debounceChat.agent.followups[1].content[0].text).includes('第二句'))
await bridgeDebounce.stop()

// while running, a STEER verdict steers instead of queueing
const steerCalls = []
const sessionFor = (userId) => 'onebot-private-' + userId
const runningAgent = (id) => ({
  session: { id }, status: 'running',
  steer(m) { steerCalls.push(m) },
  followup() { throw new Error('should have steered') },
})
const steerCtx = {
  on: () => () => {},
  agents: { get: (id) => (id === sessionFor(41002) ? runningAgent(id) : undefined) },
  get: (n) => {
    if (n === 'llm') {
      return {
        stream: () => (async function* () { yield { type: 'text-delta', text: 'STEER' } })(),
        listProviders: async () => [{ id: 'p' }],
        listModels: async () => [{ id: 'm' }],
      }
    }
    if (n === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'p', model: 'm' }) }
    return undefined
  },
}
const bridgeSteer = new ChatBridge({ ctx: steerCtx, config: { ...baseConfig, workspacePath: '/workspace/QQ', debounceMs: 0, autoInterject: true }, connection: flatTransport, log, getWorkspaceRegistry: () => workspaceRegistry, describeError: String })
bridgeSteer.start()
await bridgeSteer.handleInbound(inbound({ user_id: 41002, message_id: 420, message: [{ type: 'text', data: { text: '不对，停一下' } }] }))
await wait(150)
t('a STEER verdict steers the running turn', steerCalls.length === 1)
await bridgeSteer.stop()

// a failing judge falls back to follow-up, never steer
const fellBack = []
const fallbackAgent = (id) => ({ session: { id }, status: 'running', steer() { throw new Error('no steer') }, followup(m) { fellBack.push(m) } })
const fallbackCtx = {
  on: () => () => {},
  agents: { get: (id) => (id === sessionFor(41003) ? fallbackAgent(id) : undefined) },
  get: (n) => {
    if (n === 'llm') return { stream: () => { throw new Error('llm down') }, listProviders: async () => [], listModels: async () => [] }
    if (n === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'p', model: 'm' }) }
    return undefined
  },
}
const bridgeFallback = new ChatBridge({ ctx: fallbackCtx, config: { ...baseConfig, workspacePath: '/workspace/QQ', debounceMs: 0, autoInterject: true }, connection: flatTransport, log, getWorkspaceRegistry: () => workspaceRegistry, describeError: String })
bridgeFallback.start()
await bridgeFallback.handleInbound(inbound({ user_id: 41003, message_id: 430 }))
await wait(150)
t('a broken judge queues a follow-up instead', fellBack.length === 1)
await bridgeFallback.stop()

// with autoInterject off, a running agent is never steered
const offQueued = []
const offAgent = (id) => ({ session: { id }, status: 'running', steer() { throw new Error('should not steer') }, followup(m) { offQueued.push(m) } })
const offCtx = {
  on: () => () => {},
  agents: { get: (id) => (id === sessionFor(41004) ? offAgent(id) : undefined) },
  get: () => undefined,
}
const bridgeNoSteer = new ChatBridge({ ctx: offCtx, config: { ...baseConfig, workspacePath: '/workspace/QQ', debounceMs: 0, autoInterject: false }, connection: flatTransport, log, getWorkspaceRegistry: () => workspaceRegistry, describeError: String })
bridgeNoSteer.start()
await bridgeNoSteer.handleInbound(inbound({ user_id: 41004, message_id: 440 }))
await wait(100)
t('autoInterject off queues instead of steering', offQueued.length === 1)
await bridgeNoSteer.stop()

// ---------------------------------------------------------------- group debounce per speaker
const groupDeliveries = []
const groupAgents = {
  get: () => undefined,
  async create(options) {
    const agent = { session: { id: options.sessionId }, status: 'idle', followups: [], followup(m) { this.followups.push(m); groupDeliveries.push(String(m.content[0].text)) } }
    if (typeof options.setup === 'function') await options.setup({ systemPrompt: { section: () => () => {} }, tools: { register: () => () => {} } })
    return { agent, dispose: async () => {} }
  },
  async resume() { throw new Error('no persisted session') },
}
const groupCtx = { on: () => () => {}, agents: groupAgents, get: (n) => (n === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'p', model: 'm' }) } : undefined) }
const bridgeGroup = new ChatBridge({
  ctx: groupCtx,
  config: { ...baseConfig, workspacePath: '/workspace/QQ', requireMention: false, groupDebounceMs: 120, groupDebounceMaxMs: 300, senderPrefix: true, botQQ: '10001' },
  connection: flatTransport, log, getWorkspaceRegistry: () => workspaceRegistry, describeError: String,
})
bridgeGroup.start()
const groupMsg = (userId, text, messageId) => ({
  post_type: 'message', message_type: 'group', group_id: 888, user_id: userId, message_id: messageId,
  message: [{ type: 'text', data: { text } }], sender: { card: 'U' + userId }, time: 1700000000,
})

// groups deliver each message on arrival: no debounce, no per-speaker merge
await bridgeGroup.handleInbound(groupMsg(111, '第一句', 501))
await bridgeGroup.handleInbound(groupMsg(111, '第二句', 502))
await bridgeGroup.handleInbound(groupMsg(222, '另一个人', 503))
await wait(50)
t('each group message is delivered separately', groupDeliveries.filter((d) => d.includes('第一句')).length === 1 && groupDeliveries.filter((d) => d.includes('第二句')).length === 1)
t('a second speaker is delivered too', groupDeliveries.some((d) => d.includes('另一个人')))
t('three messages became three deliveries', groupDeliveries.length === 3, String(groupDeliveries.length))
t('both deliveries keep the speaker prefix', groupDeliveries.every((d) => d.startsWith('[')))

await bridgeGroup.stop()

// a continuing speaker must not starve later speakers forever: the window has a
// hard deadline even when the same person keeps talking
const floodDelivered = []
const floodAgents = {
  get: () => undefined,
  async create(o) {
    const agent = { session: { id: o.sessionId }, status: 'idle', followup(m) { floodDelivered.push(String(m.content[0].text)) } }
    if (typeof o.setup === 'function') await o.setup({ systemPrompt: { section: () => () => {} }, tools: { register: () => () => {} } })
    return { agent, dispose: async () => {} }
  },
  async resume() { throw new Error('none') },
}
const floodCtx = { on: () => () => {}, agents: floodAgents, get: (n) => (n === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'p', model: 'm' }) } : undefined) }
const bridgeFlood = new ChatBridge({
  ctx: floodCtx,
  config: { ...baseConfig, workspacePath: '/workspace/QQ', requireMention: false, groupDebounceMs: 100, groupDebounceMaxMs: 250, senderPrefix: true, botQQ: '10001' },
  connection: flatTransport, log, getWorkspaceRegistry: () => workspaceRegistry, describeError: String,
})
bridgeFlood.start()
const floodMsg = (uid, text, messageId) => ({ post_type: 'message', message_type: 'group', group_id: 999, user_id: uid, message_id: messageId, message: [{ type: 'text', data: { text } }], sender: { card: 'U' + uid }, time: 1700000000 })
// one speaker keeps talking faster than the window, so the cap forces flushes
for (let i = 1; i <= 6; i++) await bridgeFlood.handleInbound(floodMsg(111, 'F' + i, 600 + i))
await wait(500)
const floodText = floodDelivered.join('|')
t('a speaker who never pauses is served by the deadline cap', floodDelivered.length >= 1 && floodText.includes('F1'))
t('the flushing speaker turns all arrive (no permanent starvation)', floodText.includes('F5') && floodText.includes('F6'))
await bridgeFlood.stop()


console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
