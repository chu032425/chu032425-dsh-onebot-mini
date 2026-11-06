/**
 * 自包含检查：纯函数、配置存储、日志环形缓冲、帧协议。
 * 用 `node test/unit.test.mjs` 运行。无测试框架、无依赖。
 */
import { rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { join as pathJoin } from 'node:path'
import { existsSync as readFileSyncExists } from 'node:fs'
import { acceptKey, takeFrame, encodeText, encodeControl } from '../wire.js'
import { normalizeConfig, ConfigStore, DEFAULTS, MODE_FIELDS, FIELD_GROUPS, FIELD_KINDS } from '../config.js'
import { TOOL_GROUPS, ALL_ACTIONS, STANDARD_ACTIONS, isKnownAction, computeAllowlist, actionLabel, enabledGroups } from '../toolcatalog.js'
import { LogBus, redact, preview } from '../logbus.js'
import {
  chatIdOf, splitChatId, sessionIdOf, flattenMessage,
  isAddressed, speakerPrefix, textOfMessage, buildPlatformPrompt,
  ratioReached, ChatBridge, isPoke, pokeTarget, pokeText,
  messageSegments, isContentlessMessage,
} from '../bridge.js'
import { tmpdir } from 'node:os'

let pass = 0
let fail = 0
const t = (name, cond, extra = '') => {
  if (cond) pass += 1
  else { fail += 1; console.log('FAIL ' + name + (extra ? ' :: ' + extra : '')) }
}

// --- 帧协议：RFC 6455 accept 样例、帧往返、掩码解码、半截缓冲
t('acceptKey RFC sample', acceptKey('dGhlIHNhbXBsZSBub25jZQ==') === 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=')
const text = JSON.stringify({ action: 'send_msg', params: { a: 1 } })
const rt = takeFrame(Buffer.from(encodeText(text)))
t('text frame roundtrip', rt !== undefined && rt.data.toString('utf8') === text)
const big = 'x'.repeat(70000)
const bigRt = takeFrame(Buffer.from(encodeText(big)))
t('127-length frame roundtrip', bigRt !== undefined && bigRt.data.toString('utf8') === big)
const maskFrame = (s) => {
  const payload = Buffer.from(s, 'utf8')
  const mask = Buffer.from([0x37, 0xfa, 0x21, 0x3d])
  const out = Buffer.alloc(payload.length)
  for (let i = 0; i < payload.length; i += 1) out[i] = payload[i] ^ mask[i & 3]
  return Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, out])
}
const masked = takeFrame(maskFrame('{"post_type":"message"}'))
t('masked client frame decodes', masked !== undefined && masked.data.toString('utf8') === '{"post_type":"message"}')
t('partial buffer returns undefined', takeFrame(Buffer.from([0x81])) === undefined)
t('control frame is two bytes', encodeControl(0x8).length === 2)

// --- 配置
const needsToken = normalizeConfig({ mode: 'reverse', accessToken: '', workspacePath: '/workspace/QQ', sessionPermission: 'workspace-write' })
t('reverse without token is rejected', needsToken.problems.some((p) => p.includes('accessToken')))
const clamped = normalizeConfig({ port: 99999 })
t('port out of range falls back', clamped.value.port === DEFAULTS.port)
const good = normalizeConfig({ mode: 'forward', accessToken: 'x', url: 'ws://a:1', workspacePath: '/workspace/QQ', sessionPermission: 'workspace-write', allowFrom: [' 1 ', '', '2'] })
t('forward with token is clean', good.problems.length === 0, JSON.stringify(good.problems))
t('string list is trimmed', JSON.stringify(good.value.allowFrom) === '["1","2"]')
t('unknown enum falls back', normalizeConfig({ mode: 'weird' }).value.mode === 'reverse')
t('non-boolean boolean falls back', normalizeConfig({ senderPrefix: 'yes' }).value.senderPrefix === true)

t('the default keeps steering on and the prefix on', DEFAULTS.privateAutoInterject === true && DEFAULTS.senderPrefix === true)
t('dead debounce fields are gone; only the interject switch remains', !('debounceMs' in DEFAULTS) && !('debounceMaxMs' in DEFAULTS) && !('autoInterject' in DEFAULTS) && DEFAULTS.privateAutoInterject === true)
t('no group reply config remains', !('groupDebounceMs' in DEFAULTS) && !('groupAutoInterject' in DEFAULTS))
t('the reply group holds the send mode, the interject switch, then the two poke switches', JSON.stringify(FIELD_GROUPS.find((g) => g.id === 'reply').fields) === '["replyMode","privateAutoInterject","pokeEvents","pokeBack"]')

// 回复模式：stream（边说边发，默认）或 final（缓冲后合成一条）
t('reply mode defaults to stream', DEFAULTS.replyMode === 'stream')
t('reply mode is its own field kind', FIELD_KINDS.replyMode === 'replyMode')
t('a valid reply mode is kept', normalizeConfig({ replyMode: 'final' }).value.replyMode === 'final')
t('an unknown reply mode falls back to stream', normalizeConfig({ replyMode: 'burst' }).value.replyMode === 'stream')
t('a non-string reply mode falls back to stream', normalizeConfig({ replyMode: 3 }).value.replyMode === 'stream')

// 管理员是单个 QQ 号，存放在访问控制页
t('admin user id defaults to empty', DEFAULTS.adminUserId === '')
t('admin user id is a string field', FIELD_KINDS.adminUserId === 'string')
t('admin user id is trimmed', normalizeConfig({ adminUserId: ' 12345 ' }).value.adminUserId === '12345')
t('a numeric admin id is stored as a string', normalizeConfig({ adminUserId: 12345 }).value.adminUserId === '12345')
t('a non-numeric admin id is dropped', normalizeConfig({ adminUserId: 'abc' }).value.adminUserId === '')
t('admin user id is not on the settings groups', !FIELD_GROUPS.some((group) => group.fields.includes('adminUserId')))

// 上下文压缩比例：0-1（也可用百分数），0 表示回复前不检查
t('compact ratio defaults to 0.8', DEFAULTS.compactRatio === 0.8)
t('compact ratio is on the session settings group', FIELD_GROUPS.find((group) => group.id === 'session').fields.includes('compactRatio'))
t('a fraction compact ratio is kept', normalizeConfig({ compactRatio: 0.5 }).value.compactRatio === 0.5)
t('a percentage compact ratio becomes a fraction', normalizeConfig({ compactRatio: 80 }).value.compactRatio === 0.8)
t('zero disables the pre-reply check', normalizeConfig({ compactRatio: 0 }).value.compactRatio === 0)
t('an out-of-range compact ratio falls back', normalizeConfig({ compactRatio: 200 }).value.compactRatio === 0.8)
t('ratioReached compares consumed over window', ratioReached(0.8, 800, 1000) === true && ratioReached(0.8, 799, 1000) === false)
t('ratioReached is false when disabled or unmeasured', ratioReached(0, 999, 1000) === false && ratioReached(0.8, undefined, 1000) === false && ratioReached(0.8, 800, 0) === false)

// 只有比例达标时 maybeCompact 才调用在线压缩服务
{
  const compactionCalls = []
  const meter = { contextPressure: () => ({ pressureTokens: 900, contextWindow: 1000 }) }
  const compaction = { compactNow: async (agent, signal) => { compactionCalls.push(agent); return { compacted: true } } }
  const services = { tokenMeter: meter, compaction }
  const mkCtx = () => ({ on: () => () => {}, get: (name) => services[name] })
  const agent = { session: { id: 's' }, runMaintenance: (task) => task(new AbortController().signal) }
  const log = new LogBus({ capacity: 20 })
  const hot = new ChatBridge({ ctx: mkCtx(), config: { ...DEFAULTS, compactRatio: 0.8 }, connection: {}, log })
  await hot.maybeCompact('private:1', { agent })
  t('maybeCompact compacts when pressure reaches the ratio', compactionCalls.length === 1)
  const cold = new ChatBridge({ ctx: mkCtx(), config: { ...DEFAULTS, compactRatio: 0.99 }, connection: {}, log })
  await cold.maybeCompact('private:1', { agent })
  t('maybeCompact skips below the ratio', compactionCalls.length === 1)
  const off = new ChatBridge({ ctx: mkCtx(), config: { ...DEFAULTS, compactRatio: 0 }, connection: {}, log })
  await off.maybeCompact('private:1', { agent })
  t('maybeCompact is disabled by ratio 0', compactionCalls.length === 1)
  // agent 忙（压缩抛错）也不能让调用方收到异常
  const busyCompaction = { compactNow: async () => { throw new Error('busy') } }
  const busyCtx = { on: () => () => {}, get: (name) => (name === 'tokenMeter' ? meter : name === 'compaction' ? busyCompaction : undefined) }
  const busyBridge = new ChatBridge({ ctx: busyCtx, config: { ...DEFAULTS, compactRatio: 0.8 }, connection: {}, log })
  let threw = false
  try { await busyBridge.maybeCompact('private:1', { agent }) } catch { threw = true }
  t('a compaction failure never blocks the answer', threw === false)
}

// 删除入站媒体与删除已发媒体一致，默认开启
t('the inbound-delete switch defaults on', DEFAULTS.deleteInboundMedia === true)
t('the inbound-delete switch is a boolean field', FIELD_KINDS.deleteInboundMedia === 'boolean')
t('the media group orders inbound delete before sent delete', JSON.stringify(FIELD_GROUPS.find((g) => g.id === 'media').fields) === '["inboundMedia","inboundMediaMaxMb","deleteInboundMedia","deleteSentMedia"]')
t('a non-boolean inbound-delete falls back to the default', normalizeConfig({ deleteInboundMedia: 'no' }).value.deleteInboundMedia === true)
t('an explicit false inbound-delete is kept', normalizeConfig({ deleteInboundMedia: false }).value.deleteInboundMedia === false)

// 语音：代码只下载并标注消息 ID，自身绝不发起非标准调用——
// 由提示词引导模型去调 onebot_call 的 fetch_ptt_text。
t('sttEnabled is not a config field', DEFAULTS.sttEnabled === undefined && FIELD_KINDS.sttEnabled === undefined)
t('ffmpegPath is not a config field', DEFAULTS.ffmpegPath === undefined && FIELD_KINDS.ffmpegPath === undefined)
{
  const dir = pathJoin(tmpdir(), 'onebot-voice-test-' + Date.now())
  mkdirSync(dir, { recursive: true })
  let called = false
  const outcome = await buildInboundText({
    segments: [{ type: 'record', data: { file: 'base64://' + Buffer.from([0xff, 0xf3, 0x00, 0x00]).toString('base64') } }],
    chatId: 'private:1',
    chat: { kind: 'private', id: '1' },
    connection: { call: async () => { called = true; return { text: 'x' } } },
    config: { inboundMedia: true, inboundMediaMaxMb: 20, inboundDir: dir },
    messageId: '999',
  })
  t('record placeholder carries the message id', outcome.text.startsWith('[语音: ') && outcome.text.includes('（消息ID: 999）'), outcome.text)
  t('code makes no extension call for a voice clip', called === false)
  rmSync(dir, { recursive: true, force: true })
}

// 会话前缀：小写字母开头、安全字符集，不合格时回退默认值
t('session prefix default', DEFAULTS.sessionPrefix === 'onebot')
t('session prefix accepts lowercase', normalizeConfig({ sessionPrefix: 'qq-bot' }).value.sessionPrefix === 'qq-bot')
t('session prefix rejects uppercase start', normalizeConfig({ sessionPrefix: 'QQ' }).value.sessionPrefix === 'onebot')
t('session prefix rejects digit start', normalizeConfig({ sessionPrefix: '1qq' }).value.sessionPrefix === 'onebot')
t('session prefix rejects CJK', normalizeConfig({ sessionPrefix: '我的QQ' }).value.sessionPrefix === 'onebot')
t('session prefix rejects spaces', normalizeConfig({ sessionPrefix: 'a b' }).value.sessionPrefix === 'onebot')
t('session prefix empty means default', normalizeConfig({ sessionPrefix: '' }).value.sessionPrefix === 'onebot')

// workspacePath 为必填项
t('workspace is required', normalizeConfig({ mode: 'forward', accessToken: 'x', workspacePath: '' }).problems.some((p) => p.includes('workspacePath')))
t('workspace accepted when set', normalizeConfig({ mode: 'forward', accessToken: 'x', workspacePath: '/workspace/QQ', sessionPermission: 'workspace-write' }).problems.length === 0)

// 按模式区分的字段：表单只显示当前模式的连接输入
t('host and port belong to reverse', MODE_FIELDS.host === 'reverse' && MODE_FIELDS.port === 'reverse')
t('url belongs to forward', MODE_FIELDS.url === 'forward')
t('mode and token belong to both modes', MODE_FIELDS.mode === undefined && MODE_FIELDS.accessToken === undefined)
const connectionFields = FIELD_GROUPS.find((group) => group.id === 'connection').fields
const qzoneFields = FIELD_GROUPS.find((group) => group.id === 'qzone').fields
t('the image settings live in their own qzone group', JSON.stringify(qzoneFields) === '["imageShowMaxMb","imageCacheMaxKb","imageCacheTotalMb"]')
t('the diagnostics group no longer carries image settings', !FIELD_GROUPS.find((group) => group.id === 'diagnostics').fields.some((field) => field.startsWith('image')))
t('connection group carries both mode inputs', connectionFields.includes('host') && connectionFields.includes('port') && connectionFields.includes('url'))
const reverseVisible = connectionFields.filter((field) => MODE_FIELDS[field] === undefined || MODE_FIELDS[field] === 'reverse')
const forwardVisible = connectionFields.filter((field) => MODE_FIELDS[field] === undefined || MODE_FIELDS[field] === 'forward')
t('reverse view omits url', !reverseVisible.includes('url') && reverseVisible.includes('host') && reverseVisible.includes('port'))
t('forward view omits host and port', !forwardVisible.includes('host') && !forwardVisible.includes('port') && forwardVisible.includes('url'))

const path = '/tmp/onebot-mini-unit.json'
rmSync(path, { force: true })
const store = new ConfigStore(path)
t('absent file yields defaults', store.read().port === 8643)
const wrote = await store.write({ mode: 'forward', accessToken: 'tk', port: 9999, workspacePath: '/workspace/QQ', sessionPermission: 'workspace-write' })
t('valid write succeeds', wrote.ok === true, JSON.stringify(wrote.problems))
t('write reaches disk', JSON.parse(readFileSync(path, 'utf8')).port === 9999)
const snap = store.snapshot()
t('snapshot returns the real token', snap.config.accessToken === 'tk')
t('snapshot marks the token field as secret', snap.secretFields.includes('accessToken'))
writeFileSync(path, 'not json', 'utf8')
const corrupt = new ConfigStore(path)
t('corrupt file degrades to defaults', corrupt.read().port === 8643)
t('invalid write is refused', (await corrupt.write({ port: 0 })).ok === false)
t('write without a workspace is refused', (await new ConfigStore('/tmp/onebot-mini-nw.json').write({ mode: 'forward', accessToken: 'tk', workspacePath: '', sessionPermission: 'workspace-write' })).ok === false)

// --- 日志环形缓冲
const log = new LogBus({ capacity: 50 })
for (let i = 0; i < 80; i += 1) log.record('event', { i })
const s1 = log.snapshot(0, 200)
t('ring is bounded', s1.entries.length === 50, String(s1.entries.length))
t('seq is monotonic', s1.nextSeq === 80, String(s1.nextSeq))
const s2 = log.snapshot(75, 200)
t('cursor filters older entries', s2.entries.length === 5 && s2.entries[0].seq === 76)
const deep = redact({ a: { access_token: 'secret', nested: { token: 'x', keep: 1 } }, authorization: 'Bearer y' })
t('redaction is recursive', deep.a.access_token === '[redacted]' && deep.a.nested.token === '[redacted]' && deep.a.nested.keep === 1 && deep.authorization === '[redacted]')
t('preview truncates by code point', preview('a'.repeat(100), 10) === 'aaaaaaaaaa…')
const cyclic = {}; cyclic.self = cyclic
t('cyclic value does not throw', typeof redact(cyclic) === 'object')

// --- 桥的纯函数
t('chat id private', chatIdOf('private', 123) === 'private:123')
t('chat id group', chatIdOf('group', 456) === 'group:456')
t('chat id splits back', JSON.stringify(splitChatId('group:456')) === '{"kind":"group","id":"456"}')
t('session id is filesystem safe', sessionIdOf('private:123') === 'onebot-private-123')
t('session id honors a custom prefix', sessionIdOf('private:123', 'qq') === 'qq-private-123')
t('flatten keeps media placeholders', flattenMessage([{ type: 'text', data: { text: 'hi ' } }, { type: 'image', data: {} }]) === 'hi [图片]')
t('flatten drops self mention', flattenMessage([{ type: 'at', data: { qq: '10001' } }, { type: 'text', data: { text: 'hello' } }]) === 'hello')
t('flatten keeps at-all', flattenMessage([{ type: 'at', data: { qq: 'all' } }]) === '@全体成员')
t('a json mini-program card becomes a labelled placeholder', flattenMessage([{ type: 'json', data: { data: JSON.stringify({ prompt: '[QQ小程序]', desc: '某小程序' }) } }]) === '[卡片: QQ小程序]')
t('a card-only message is not flattened to empty', flattenMessage([{ type: 'json', data: {} }]).startsWith('[卡片'))
t('an unknown segment yields nothing to the model', flattenMessage([{ type: 'markdown', data: {} }]) === '')

// --- 空消息事件（网关在对方接收/下载文件后补发，不是用户输入）
t('an empty segment array is contentless', isContentlessMessage({ message: [], raw_message: '' }) === true)
t('a missing message field is contentless', isContentlessMessage({ raw_message: '' }) === true)
t('a message with one segment is not contentless', isContentlessMessage({ message: [{ type: 'text', data: { text: 'hi' } }] }) === false)
t('a segment-less frame still exposes raw_message', messageSegments({ raw_message: 'hi' }) === 'hi')
t('message segments prefer the array', Array.isArray(messageSegments({ message: [{ type: 'text', data: { text: 'x' } }], raw_message: 'y' })) === true)
t('an empty message exposes no segments', messageSegments({ message: [] }).length === 0)

// --- 戳一戳事件（通知类，不是消息）
const pokeFrame = (extra = {}) => ({ post_type: 'notice', notice_type: 'notify', sub_type: 'poke', user_id: 2000001, target_id: 2000002, group_id: 2000003, ...extra })
t('a poke notice is recognized', isPoke(pokeFrame()) === true)
t('a poke without sub_type is still recognized', isPoke({ post_type: 'notice', notice_type: 'notify', user_id: 1, target_id: 2 }) === true)
t('a plain message is not a poke', isPoke({ post_type: 'message', message_type: 'private', user_id: 1 }) === false)
t('another notice type is not a poke', isPoke(pokeFrame({ notice_type: 'group_increase' })) === false)
t('a poke missing target_id is still a poke (some gateways omit it)', isPoke({ post_type: 'notice', notice_type: 'notify', user_id: 1 }) === true)
t('a notice with no poker at all is not a poke', isPoke({ post_type: 'notice', notice_type: 'notify', target_id: 2 }) === false)
t('a group poke resolves to the group chat', pokeTarget(pokeFrame()).chatId === 'group:2000003')
t('a private poke resolves to the poker chat', pokeTarget(pokeFrame({ group_id: undefined })).chatId === 'private:2000001')
t('a group poke names the poker', pokeText({ ...pokeFrame(), sender: { card: '小明' } }, '2000002', 'group').includes('小明(2000001)'))
t('a group poke says it happened in the group', pokeText(pokeFrame(), '2000002', 'group').includes('在群里'))
t('a private poke names the poker', pokeText({ ...pokeFrame({ group_id: undefined }), sender: {} }, '2000002', 'private').includes('2000001'))
t('a self-poke is described as the bot poking', pokeText(pokeFrame({ user_id: 2000002 }), '2000002', 'group').includes('你'))
t('unknown segment types are reported', JSON.stringify(unknownSegmentTypes([{ type: 'text', data: { text: 'x' } }, { type: 'markdown', data: {} }, { type: 'markdown', data: {} }])) === '["markdown"]')
t('a cq json string becomes a card placeholder', unescapeCq('[CQ:json,data={"prompt":"&#91;QQ小程序&#93;"}]') === '[卡片]')
t('cq fallback unescapes and strips', unescapeCq('a&#91;b&#93; &amp; [CQ:image,file=x]') === 'a[b] & [图片]')
t('mention via segment', isAddressed({ message: [{ type: 'at', data: { qq: '10001' } }] }, '10001') === true)
t('mention for another user', isAddressed({ message: [{ type: 'at', data: { qq: '999' } }] }, '10001') === false)
t('unknown bot fails closed', isAddressed({ message: [{ type: 'at', data: { qq: '10001' } }] }, '') === false)
t('mention via cq string', isAddressed({ message: '[CQ:at,qq=10001] hi' }, '10001') === true)
t('group prefix has speaker', speakerPrefix({ sender: { card: '小明' }, user_id: 20002, time: 1700000000 }, 'group', true).startsWith('['))
t('private prefix is empty', speakerPrefix({ sender: {} }, 'private', true) === '')
t('prefix can be disabled', speakerPrefix({ sender: { card: 'x' } }, 'group', false) === '')
t('only text blocks are joined', textOfMessage({ content: [{ type: 'text', text: 'a' }, { type: 'reasoning', text: 'secret' }, { type: 'text', text: 'b' }] }) === 'a\nb')
t('empty content yields empty text', textOfMessage({ content: [] }) === '')

// --- onebot_call 工具目录与白名单
const groupOf = (name) => TOOL_GROUPS.find((group) => group.actions.some((action) => action.name === name))
t('catalog groups the send actions', groupOf('send_group_msg')?.id === 'message')
t('catalog covers the NapCat core actions', ['set_group_ban', 'send_poke', 'delete_msg', 'nc_get_user_status', 'send_qzone_msg']
  .every((name) => isKnownAction(name)))
t('dangerous actions stay out of the catalog', ['get_credentials', 'get_csrf_token', 'get_cookies', 'set_restart', 'bot_exit', 'send_packet', 'clean_cache', 'ocr_image']
  .every((name) => !isKnownAction(name)))
// 按运营方要求裁剪：整组群相册、Qzone 权限对、自定义在线状态，
// 以及除两个请求处理之外的全部接口、已读标记与转发、
// 扩展的群与最近会话查询、批量踢人 / 管理 / 待办三件套，
// 还有群文件管理整组。
t('pruned actions stay out of the catalog', [
  'get_qun_album_list', 'get_group_album_media_list', 'upload_image_to_qun_album', 'upload_images_to_qun_album',
  'upload_video_to_qun_album', 'do_group_album_comment', 'del_group_album_media', 'set_group_album_media_like',
  'cancel_group_album_media_like', 'set_qzone_msg_right', 'set_qzone_ban', 'set_diy_online_status',
  'get_doubt_friends_add_request', 'set_doubt_friends_add_request', 'get_group_ignore_add_request',
  'set_group_add_option', 'set_group_member_invite_policy', 'set_group_member_permissions',
  'set_group_new_member_history_visibility', 'mark_msg_as_read', 'mark_group_msg_as_read',
  'mark_private_msg_as_read', 'send_forward_msg', 'send_group_forward_msg', 'send_private_forward_msg',
  'forward_group_single_msg', 'forward_friend_single_msg', 'get_group_info_ex', 'get_recent_contact',
  'set_group_kick_members', 'set_group_admin', 'set_group_todo', 'complete_group_todo', 'cancel_group_todo',
  'upload_group_file', 'upload_private_file', 'get_group_file_url',
  'get_group_root_files', 'get_group_files_by_folder', 'get_group_file_system_info', 'create_group_file_folder',
  'delete_group_folder', 'delete_group_file', 'move_group_file', 'rename_group_file',
].every((name) => !isKnownAction(name)))
t('the two request handlers survived the pruning', isKnownAction('set_friend_add_request') && isKnownAction('set_group_add_request'))
// QQ 的「在线文件」不产生普通消息段，只能靠这三个扩展动作取回。
t('the online-file actions are catalogued as extensions', ['get_online_file_msg', 'receive_online_file', 'get_private_file_url']
  .every((name) => isKnownAction(name) && STANDARD_ACTIONS.has(name) === false))
t('mark everything as read survived the pruning', isKnownAction('_mark_all_as_read'))
t('the catalog has no group album section', TOOL_GROUPS.every((group) => group.id !== 'album'))
t('every catalogued action carries a Chinese annotation', TOOL_GROUPS.every((group) => group.actions.every((action) => /[\u4e00-\u9fa5]/.test(action.zh))))
t('every catalogued action carries an English annotation', TOOL_GROUPS.every((group) => group.actions.every((action) => action.en !== '')))
t('no duplicate action names', ALL_ACTIONS.length === new Set(ALL_ACTIONS).size)
t('actionLabel returns the Chinese annotation', actionLabel('set_group_ban') === '禁言群成员')
t('the Qzone image display cap defaults to 32 MB', DEFAULTS.imageShowMaxMb === 32)
t('an out-of-range image display cap falls back', normalizeConfig({ imageShowMaxMb: 9999 }).value.imageShowMaxMb === 32)
t('the capture cap is clamped low', normalizeConfig({ imageShowMaxMb: 0 }).value.imageShowMaxMb === 32)
t('a valid image display cap is kept', normalizeConfig({ imageShowMaxMb: 8 }).value.imageShowMaxMb === 8)
t('enabledGroups only lists groups with enabled actions', JSON.stringify(enabledGroups(new Set(['set_group_ban'])).map((g) => g.id)) === '["group"]')
t('all actions flatten from the groups', ALL_ACTIONS.length === TOOL_GROUPS.reduce((sum, group) => sum + group.actions.length, 0))
// 标准与扩展分类（工具页给每一行打徽标）
t('every action carries a boolean standard flag', TOOL_GROUPS.every((group) => group.actions.every((action) => typeof action.standard === 'boolean')))
t('the standard set has 31 OneBot 11 actions', STANDARD_ACTIONS.size === 31)
t('the standard flag matches the STANDARD_ACTIONS set', TOOL_GROUPS.every((group) => group.actions.every((action) => action.standard === STANDARD_ACTIONS.has(action.name))))
t('fetch_ptt_text is marked as an extension', TOOL_GROUPS.find((g) => g.id === 'interaction').actions.find((a) => a.name === 'fetch_ptt_text').standard === false)
t('send_msg is marked standard', TOOL_GROUPS.find((g) => g.id === 'message').actions.find((a) => a.name === 'send_msg').standard === true)
// 每个动作都附带结构化文档与生成的默认提示词
t('every catalogued action ships a default prompt', TOOL_GROUPS.every((group) => group.actions.every((action) => typeof action.defaultPrompt === 'string' && action.defaultPrompt.length > 0)))
t('every catalogued action ships a params array', TOOL_GROUPS.every((group) => group.actions.every((action) => Array.isArray(action.params))))
t('every documented parameter has a name, type, required flag and description', TOOL_GROUPS.every((group) => group.actions.every((action) => action.params.every((p) => typeof p.name === 'string' && p.name !== '' && typeof p.type === 'string' && typeof p.required === 'boolean' && typeof p.desc === 'string' && p.desc !== ''))))
t('a documented action names its params and type labels', TOOL_GROUPS.find((g) => g.id === 'message').actions.find((a) => a.name === 'send_group_msg').defaultPrompt.includes('group_id（数字，必填）'))
t('a no-arg action says so', TOOL_GROUPS.find((g) => g.id === 'query').actions.find((a) => a.name === 'get_login_info').defaultPrompt.includes('无需参数'))
t('fetch_ptt_text documents its message_id parameter', TOOL_GROUPS.find((g) => g.id === 'interaction').actions.find((a) => a.name === 'fetch_ptt_text').defaultPrompt.includes('message_id'))
// 单动作提示词覆盖存在配置里并会被校验
const promptNorm = normalizeConfig({ actionPrompts: { send_group_msg: '自定义群发说明', bogus_action: 'x', get_login_info: '   ', send_private_msg: 42 } }).value.actionPrompts
t('a valid action prompt override is kept', promptNorm.send_group_msg === '自定义群发说明')
t('unknown, blank and non-string prompt overrides are dropped', !('bogus_action' in promptNorm) && !('get_login_info' in promptNorm) && !('send_private_msg' in promptNorm))
t('the default action override map is empty', JSON.stringify(DEFAULTS.actionPrompts) === '{}')
{
  const overridden = buildPlatformPrompt({ ...DEFAULTS, actionPrompts: { send_group_msg: '只发纯文本，禁止 CQ 码。' } })
  t('an action prompt override replaces the built-in text', overridden.includes('send_group_msg：只发纯文本，禁止 CQ 码。'))
  t('an untouched action keeps its built-in text', overridden.includes('send_private_msg：功能：发送私聊消息'))
}
t('unknown action is not in the catalog', isKnownAction('definitely_not_real') === false)
t('a missing config enables every action', computeAllowlist({})?.size === ALL_ACTIONS.length)
t('the master switch off disables the tool entirely', computeAllowlist({ onebotToolEnabled: false }) === null)
const banOff = computeAllowlist({ onebotToolDisabled: ['set_group_ban'] })
t('a disabled action is dropped from the allowlist', banOff !== null && !banOff.has('set_group_ban') && banOff.has('send_group_msg'))
t('disabling every action disables the tool', computeAllowlist({ onebotToolDisabled: [...ALL_ACTIONS] }) === null)
const filteredDisabled = normalizeConfig({ onebotToolDisabled: ['set_group_ban', 'not-an-action', 'set_group_ban'] }).value.onebotToolDisabled
t('unknown and duplicate disabled actions are dropped', JSON.stringify(filteredDisabled) === '["set_group_ban"]', JSON.stringify(filteredDisabled))
t('snapshot ships the tool catalog', Array.isArray(snap.toolCatalog) && snap.toolCatalog.length === TOOL_GROUPS.length)

// --- 图片缓存：URL 白名单与账号目录
import { isAllowedImageUrl } from '../imagecache.js'
import { accountDir, profileCacheRoot } from '../cachepaths.js'
t('a qzone image host is allowed', isAllowedImageUrl('http://photomaz.photo.store.qq.com/psc?/abc/b&bo=x'))
t('a qpic host is allowed', isAllowedImageUrl('https://gchat.qpic.cn/gchatpic_new/1/2-3-4/0'))
t('a random host is refused', !isAllowedImageUrl('https://evil.example.com/a.jpg'))
t('a host that merely ends with the suffix text is refused', !isAllowedImageUrl('https://notqq.com/a.jpg'))
t('a lookalike suffix is refused', !isAllowedImageUrl('https://qq.com.evil.io/a.jpg'))
t('a non-http scheme is refused', !isAllowedImageUrl('file:///etc/passwd'))
t('a malformed url is refused', !isAllowedImageUrl('not a url'))
t('the profile cache root sits beside the config', profileCacheRoot().endsWith('onebot-mini-cache'))
t('an account folder keeps only digits under QQ/', accountDir({}, '2000002').endsWith('/QQ/2000002'))
t('the account folder follows the configured workspace', accountDir({ workspacePath: '/workspace/QQ' }, '2000002') === '/workspace/QQ/onebot-mini-cache/QQ/2000002')
t('a hostile account id cannot escape the cache root', !accountDir({}, '../etc').includes('..'))

// --- 媒体段
import { buildSegment, MEDIA_KINDS, readFileAsBase64, MAX_MEDIA_BYTES, safeUnlink, mediaFailureNotice } from '../media.js'
t('an image segment uses base64 when given base64', JSON.stringify(buildSegment('image', { base64: 'AAA' })) === '{"type":"image","data":{"file":"base64://AAA"}}')
t('a segment uses the url when given a url', JSON.stringify(buildSegment('image', { url: 'http://x/y.png' })) === '{"type":"image","data":{"file":"http://x/y.png"}}')
t('a file segment carries its name', JSON.stringify(buildSegment('file', { url: 'http://x/y.zip' }, 'a.zip')) === '{"type":"file","data":{"file":"http://x/y.zip","name":"a.zip"}}')
t('media kinds cover image, record, video and file', JSON.stringify(MEDIA_KINDS) === '["image","record","video","file"]')
t('the media ceiling is 20 MB', MAX_MEDIA_BYTES === 20 * 1024 * 1024)

// 统一发送封装：文本、媒体，或两者合在一次 send_msg 调用
{
  const { sendMedia, buildMessageSegments, sendMsgParams } = await import('../media.js')
  const textOnly = buildMessageSegments({ text: '你好' })
  t('text alone becomes one text segment', JSON.stringify(textOnly) === '[{"type":"text","data":{"text":"你好"}}]')
  const mixed = buildMessageSegments({ text: '看这张', kind: 'image', url: 'http://x/a.png' })
  t('text and an image mix into one ordered list', mixed.length === 2 && mixed[0].type === 'text' && mixed[1].type === 'image')
  // 文档化的六种组合；只有图片能与文本共处一条消息
  for (const [label, kind, withText, expected] of [
    ['纯文字', '', true, ['text']],
    ['纯图片', 'image', false, ['image']],
    ['文字+图片', 'image', true, ['text', 'image']],
    ['纯语音', 'record', false, ['record']],
    ['纯视频', 'video', false, ['video']],
    ['纯文件', 'file', false, ['file']],
  ]) {
    const opts = kind === '' ? { text: 'x' } : { kind, url: 'http://x/a.bin', ...(withText ? { text: 'x' } : {}) }
    const built = buildMessageSegments(opts)
    t('combination builds ' + label, JSON.stringify(built.map((seg) => seg.type)) === JSON.stringify(expected), JSON.stringify(built.map((seg) => seg.type)))
  }
  // 文本配语音 / 视频 / 文件会被拒绝，而不是悄悄混发
  {
    const refuseConn = { call: async () => ({ message_id: 1 }) }
    for (const kind of ['record', 'video', 'file']) {
      const refused = await sendMedia(refuseConn, { chatType: 'group', chatId: '7', text: 'x', kind, url: 'http://x/a.bin' })
      t('text with ' + kind + ' is refused', refused.ok === false && refused.error.includes('only accompany an image'))
    }
  }
  const mediaOnly = buildMessageSegments({ kind: 'image', url: 'http://x/a.png' })
  t('media alone becomes one media segment', mediaOnly.length === 1 && mediaOnly[0].type === 'image')
  t('nothing given produces no segments', buildMessageSegments({}).length === 0)
  t('send_msg params carry message_type and group_id', JSON.stringify(sendMsgParams('group', '7', [])).includes('"message_type":"group"'))
  t('send_msg params carry message_type and user_id', JSON.stringify(sendMsgParams('private', '7', [])).includes('"user_id":7'))

  const calls = []
  const conn = { call: async (action, params) => { calls.push({ action, params }); return { message_id: 1 } } }
  await sendMedia(conn, { chatType: 'group', chatId: '7', text: '看这张', kind: 'image', url: 'http://x/a.png' })
  t('the wrapper always calls the unified send_msg action', calls.length === 1 && calls[0].action === 'send_msg')
  t('the wrapper keeps text and media in one message', calls[0].params.message.length === 2)
  const empty = await sendMedia(conn, { chatType: 'group', chatId: '7' })
  t('an empty message is refused', empty.ok === false)
}

// 回复标记：只有图片与文本同条，其余单独拆开
{
  const { groupReplySegments } = await import('../media.js')
  const seg = (type) => ({ type, data: {} })
  const one = groupReplySegments([seg('text'), seg('image'), seg('text')])
  t('text and an image stay one reply message', one.length === 1 && one[0].length === 3, JSON.stringify(one.map((m) => m.length)))
  const split = groupReplySegments([seg('text'), seg('file'), seg('text')])
  t('a file splits the reply into separate messages', split.length === 3
    && JSON.stringify(split.map((m) => m.map((s) => s.type))) === JSON.stringify([['text'], ['file'], ['text']]),
  JSON.stringify(split.map((m) => m.map((s) => s.type))))
  const voice = groupReplySegments([seg('text'), seg('record')])
  t('a voice clip travels alone', voice.length === 2 && voice[1].length === 1 && voice[1][0].type === 'record')
  t('images among themselves stay with the text run', groupReplySegments([seg('text'), seg('image'), seg('image'), seg('text')]).length === 1)
  t('grouping an empty list yields no messages', groupReplySegments([]).length === 0)
}
const readBack = await readFileAsBase64('/tmp/onebot-mini-unit.json')
t('a local file is read into base64', readBack.ok === true && typeof readBack.base64 === 'string' && readBack.base64.length > 0)
const missingFile = await readFileAsBase64('/tmp/definitely-not-here-xyz')
t('a missing file is reported', missingFile.ok === false && missingFile.reason !== '')

// 面向聊天窗口的提示必须简短，不含路径或 errno 文本
t('the media failure notice hides the path', !mediaFailureNotice('image').includes('/') && !mediaFailureNotice('image').includes('ENOENT'))
t('the media failure notice names the kind', mediaFailureNotice('image').includes('图片') && mediaFailureNotice('file').includes('文件'))

// 安全删除：只允许白名单根目录内，绝不删目录、绝不删根本身
const victim = '/tmp/onebot-unlink-' + process.pid + '.txt'
writeFileSync(victim, 'bye', 'utf8')
const unlinked = await safeUnlink(victim)
t('a sent source file inside /tmp is deleted', unlinked.ok === true && !readFileSyncExists(victim))
const outside = await safeUnlink('/etc/hostname')
t('a file outside the allowed roots is refused', outside.ok === false && String(outside.reason).includes('outside'))
const rootDir = await safeUnlink('/workspace')
t('a root directory is refused', rootDir.ok === false)
const dirPath = await safeUnlink('/tmp')
t('the tmp root itself is refused', dirPath.ok === false)

// --- 可编辑的通道提示词
import { DEFAULT_CHANNEL_PROMPT, LEGACY_CHANNEL_PROMPT, LEGACY_CHANNEL_PROMPT_V2, replyModeParagraph, adminParagraph, renderPrompt, PROMPT_PLACEHOLDERS, PROMPT_DEFS, renderToolCallPrompt } from '../prompt.js'
t('the default prompt documents its placeholders', PROMPT_PLACEHOLDERS.every((p) => DEFAULT_CHANNEL_PROMPT.includes(p)))
t('renderPrompt fills a placeholder', renderPrompt('x {actions} y', { actions: 'Z' }).includes('x Z y'))
t('renderPrompt drops an empty placeholder line', !renderPrompt('a\n{media}\nb', { media: '' }).includes('{media}'))
t('an unknown placeholder is left alone', renderPrompt('keep {unknown}', {}).includes('{unknown}'))
// 回复投递那句跟随 replyMode，而不是写死
t('the stream paragraph says replies stream segment by segment', replyModeParagraph('stream').includes('实时发出'))
t('the final paragraph says one message per turn', replyModeParagraph('final').includes('只产生一条'))
t('the default channel prompt carries the replyMode placeholder', DEFAULT_CHANNEL_PROMPT.includes('{replyMode}'))
t('renderPrompt fills the replyMode line', renderPrompt(DEFAULT_CHANNEL_PROMPT, { replyMode: 'R' }).includes('R'))
t('the default build prompts streaming', buildPlatformPrompt(DEFAULTS).includes('实时发出'))
t('an explicit final mode prompts one message', buildPlatformPrompt({ ...DEFAULTS, replyMode: 'final' }).includes('只产生一条'))
t('the old shipped prompt is migrated to the new placeholder', normalizeConfig({ channelPrompt: LEGACY_CHANNEL_PROMPT }).value.channelPrompt === DEFAULT_CHANNEL_PROMPT)
t('the replyMode-only prompt is migrated too', normalizeConfig({ channelPrompt: LEGACY_CHANNEL_PROMPT_V2 }).value.channelPrompt === DEFAULT_CHANNEL_PROMPT)
t('an edited prompt is not migrated', normalizeConfig({ channelPrompt: LEGACY_CHANNEL_PROMPT + ' (edited)' }).value.channelPrompt.endsWith('(edited)'))
// 管理员身份注入到模型提示词
t('the default channel prompt carries the admin placeholder', DEFAULT_CHANNEL_PROMPT.includes('{admin}'))
t('no admin paragraph when unset', adminParagraph('') === '')
t('the admin paragraph names the admin QQ', adminParagraph('12345').includes('12345') && adminParagraph('12345').includes('优先'))
t('the build injects the admin QQ', buildPlatformPrompt({ ...DEFAULTS, adminUserId: '12345' }).includes('管理员是 QQ 12345'))
t('no admin line without an administrator', !buildPlatformPrompt(DEFAULTS).includes('管理员是 QQ'))
t('a custom prompt is kept by normalize', normalizeConfig({ mode: 'forward', accessToken: 'x', workspacePath: '/workspace/QQ', sessionPermission: 'workspace-write', channelPrompt: 'hello prompt' }).value.channelPrompt === 'hello prompt')
t('an empty prompt falls back to the default', normalizeConfig({ channelPrompt: '   ' }).value.channelPrompt === DEFAULT_CHANNEL_PROMPT)
t('the prompt registry covers channel, reply mode, admin, prefix, media, tools, actions, inbound, the tool call and pokes',
  PROMPT_DEFS.map((d) => d.field).join(',') === 'channelPrompt,replyModeStreamPrompt,replyModeFinalPrompt,adminPrompt,senderPrefixPrompt,mediaPrompt,toolsPrompt,inboundPrompt,toolCallPrompt,pokePrompt')
t('every registered prompt has a config default', PROMPT_DEFS.every((d) => typeof DEFAULTS[d.field] === 'string' && DEFAULTS[d.field] !== ''))
t('every registered prompt has a label key', PROMPT_DEFS.every((d) => typeof d.labelKey === 'string' && d.labelKey !== ''))
const blankAll = normalizeConfig({ channelPrompt: '', toolCallPrompt: '  ', mediaPrompt: '' }).value
t('every blank prompt returns to its default', PROMPT_DEFS.every((d) => blankAll[d.field] === DEFAULTS[d.field]))
t('the tool-call prompt adds the enabled note when actions are allowed', renderToolCallPrompt('X {enabledNote}', new Set(['a'])).includes('仅接受在 OneBot-Mini 设置中已启用的动作'))
t('the tool-call prompt drops the note when the tool is off', !renderToolCallPrompt('X {enabledNote}', null).includes('仅接受'))
t('the tool-call prompt falls back when empty', renderToolCallPrompt('', null).startsWith('执行一个动作'))
t('the tool-call prompt no longer mentions a gateway', !/网关|NapCat/.test(renderToolCallPrompt('', null)))
// 通道提示词把每个已启用动作连同中文注解交给模型，
// 且不含网关专属措辞——模型靠名字 + 注解发现工具。
{
  const prompt = buildPlatformPrompt(DEFAULTS)
  t('the channel prompt lists every catalog action by name', ALL_ACTIONS.every((name) => prompt.includes(name)))
  t('the channel prompt documents each action with its function', prompt.includes('fetch_ptt_text：功能：获取一条语音消息的转文字结果') && prompt.includes('send_group_msg：功能：发送群消息'))
  t('the channel prompt carries parameter names and usage', prompt.includes('group_id（数字，必填）') && prompt.includes('用法：onebot_call(action="send_group_msg"'))
  t('the channel prompt has no gateway/NapCat wording', !/网关|NapCat/.test(prompt))
}

// --- 缓存清单与手动清理（针对一次性 profile）
import { inventory, clearCache } from '../cacheinfo.js'
const prevHome = process.env.DSH_HOME
const prevProfile = process.env.DSH_PROFILE
process.env.DSH_HOME = '/tmp/onebot-cache-test-home'
process.env.DSH_PROFILE = 'p'
const profDir = '/tmp/onebot-cache-test-home/profiles/p'
rmSync('/tmp/onebot-cache-test-home', { recursive: true, force: true })
mkdirSync(profDir, { recursive: true })
writeFileSync(pathJoin(profDir, 'onebot-mini.json'), '{"mode":"reverse"}', 'utf8')
writeFileSync(pathJoin(profDir, 'onebot-mini.log.jsonl'), '{"a":1}\n{"a":2}\n', 'utf8')
// 遵循缓存约定：<base>/QQ/<account>/（此处 base 回退到 profile）。
const cacheCfg = {}
const acctDir = pathJoin(profDir, 'onebot-mini-cache', 'QQ', '123')
mkdirSync(acctDir, { recursive: true })
writeFileSync(pathJoin(acctDir, 'x.jpg'), Buffer.alloc(10))
writeFileSync(pathJoin(acctDir, 'y.jpg'), Buffer.alloc(20))

const inv = await inventory(cacheCfg)
t('inventory reports the config file', inv.config.exists === true && inv.config.size > 0)
t('inventory counts the log lines', inv.logs.length === 1 && inv.logs[0].lines === 2)
t('inventory groups the cache by account', inv.cache.accounts.length === 1 && inv.cache.accounts[0].account === '123')
t('inventory sums the account size', inv.cache.accounts[0].size === 30 && inv.cache.accounts[0].count === 2)
t('inventory lists individual cache files', inv.cache.files.length === 2)
t('a cache file is classified by extension', inv.cache.files.every((file) => file.kind === 'image'))
writeFileSync(pathJoin(acctDir, 'clip.mp4'), Buffer.alloc(5))
writeFileSync(pathJoin(acctDir, 'note.txt'), Buffer.alloc(3))
const invKinds = await inventory(cacheCfg)
const kinds = Object.fromEntries(invKinds.cache.files.map((file) => [file.name, file.kind]))
t('video and other files get their own kinds', kinds['clip.mp4'] === 'video' && kinds['note.txt'] === 'file')
rmSync(pathJoin(acctDir, 'clip.mp4'))
rmSync(pathJoin(acctDir, 'note.txt'))
t('the total adds config, logs and cache', inv.totalBytes === inv.config.size + inv.logs[0].size + 30)

const clearLogs = await clearCache('logs', cacheCfg)
t('clearing logs empties the file', clearLogs.ok === true && readFileSync(pathJoin(profDir, 'onebot-mini.log.jsonl'), 'utf8') === '')
const clearAccount = await clearCache('account:123', cacheCfg)
t('clearing one account removes only its folder', clearAccount.ok === true && !existsSync(acctDir))
const refusedClear = await clearCache('config', cacheCfg)
t('the settings file cannot be cleared', refusedClear.ok === false)
const badTarget = await clearCache('nonsense', cacheCfg)
t('an unknown clear target is refused', badTarget.ok === false)
rmSync('/tmp/onebot-cache-test-home', { recursive: true, force: true })
if (prevHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevHome
if (prevProfile === undefined) delete process.env.DSH_PROFILE; else process.env.DSH_PROFILE = prevProfile

// --- 传输门面契约
// 桥的每次回复都调用 `sendMessage`。只暴露
// `sendText` 的门面会静默打断所有回复，所以两者都必须存在。
import { readFileSync as readSrc } from 'node:fs'
const indexSrc = readSrc(new URL('../index.js', import.meta.url), 'utf8')
const facadeBlock = indexSrc.slice(indexSrc.indexOf('const transport = {'), indexSrc.indexOf('const getWorkspaceRegistry'))
t('the transport facade exposes sendText', facadeBlock.includes('sendText:'))
t('the transport facade exposes sendMessage', facadeBlock.includes('sendMessage:'))
t('the transport facade exposes call', facadeBlock.includes('call:'))
t('the transport facade exposes status', facadeBlock.includes('status:'))
t('the connection exposes sendMessage', (await import('../connection.js')).OneBotConnection.prototype.sendMessage !== undefined)
t('the connection exposes sendText', (await import('../connection.js')).OneBotConnection.prototype.sendText !== undefined)

// 工具结果只能包含输出 schema 声明的字段：多出的字段会被
// harness 拒绝，动作明明成功模型却看到报错。所以
// sendMedia 必须只返回 { ok, data, error }。
import { readFileSync as readTools } from 'node:fs'
const toolsSrc = readTools(new URL('../tools.js', import.meta.url), 'utf8')
const schemaBlock = toolsSrc.slice(toolsSrc.indexOf('const OUTPUT_SCHEMA'), toolsSrc.indexOf('required:', toolsSrc.indexOf('const OUTPUT_SCHEMA')))
t('the output schema declares ok, data and error', schemaBlock.includes('ok:') && schemaBlock.includes('data:') && schemaBlock.includes('error:'))
t('the output schema no longer declares source', !schemaBlock.includes('source:'))
const sendSrc = (await import('../media.js')).sendMedia.toString()
t('sendMedia returns only ok/data', !sendSrc.includes('source:') && sendSrc.includes('return { ok: true, data }'))
t('sendMedia still reports cleanup through a hook', sendSrc.includes('onCleanup'))

// OneBot 的列表动作返回数组；工具输出不能强制为对象，
// 否则 harness 会拒绝整次调用（报“value.data 必须是对象”）。
const { registerTools } = await import('../tools.js')
const captureTool = (call) => {
  let def
  registerTools(
    { tools: { register: (d) => { if (d?.name === 'onebot_call') def = d; return () => {} } } },
    { connection: { call }, allow: new Set(['get_group_member_list']), chatId: 'group:1', deleteSentMedia: false, prompts: {}, recordLog: () => {} },
  )
  return def
}
const arrayTool = captureTool(async () => [{ user_id: 1 }, { user_id: 2 }])
const arrayOut = await arrayTool.execute({ action: 'get_group_member_list', params: {} })
t('an array response is returned verbatim', arrayOut.ok === true && Array.isArray(arrayOut.data) && arrayOut.data.length === 2)
t('the output schema does not pin data to object', arrayTool.output.schema.properties.data.type === undefined)
const objectTool = captureTool(async () => ({ message_id: 7 }))
const objectOut = await objectTool.execute({ action: 'get_group_member_list', params: {} })
t('an object response is unchanged', objectOut.ok === true && objectOut.data.message_id === 7)
const nullTool = captureTool(async () => undefined)
const nullOut = await nullTool.execute({ action: 'get_group_member_list', params: {} })
t('an absent payload becomes null (lossless JSON)', nullOut.ok === true && nullOut.data === null)

// --- 本地动作搭在 onebot_call 上，而不是另立工具
{
  const registered = []
  const connection = { call: async (action) => { registered.push(action); return {} } }
  const { registerTools: reg } = await import('../tools.js')
  const disposers = reg(
    { tools: { register: (d) => { registered.push(d.name); return () => {} } } },
    { connection, allow: new Set(['send_message', 'list_files', 'send_group_msg']), chatId: 'private:42', deleteSentMedia: false, prompts: {}, recordLog: () => {} },
  )
  t('exactly one tool is registered', disposers.length === 1 && registered.includes('onebot_call'))
  const dir = mkdtempSync(pathJoin(tmpdir(), 'onebot-tools-'))
  writeFileSync(pathJoin(dir, 'a.png'), 'x')
  let tool
  reg({ tools: { register: (d) => { tool = d; return () => {} } } },
    { connection, allow: new Set(['send_message', 'list_files', 'send_group_msg']), chatId: 'private:42', deleteSentMedia: false, prompts: {}, recordLog: () => {} })
  const listed = await tool.execute({ action: 'list_files', params: { dir } })
  t('list_files runs locally and never hits the transport', listed.ok === true && listed.data.count === 1 && !registered.includes('list_files'))
  const refused = await tool.execute({ action: 'set_group_ban', params: {} })
  t('a switched-off action is refused and points at the tools page', refused.ok === false && refused.error.includes('switched off'))
  // 被裁剪的动作根本不在目录里，所以拒绝时不能
  // 让模型去设置里把它打开。
  const pruned = await tool.execute({ action: 'get_qun_album_list', params: {} })
  t('a pruned action is refused as not offered', pruned.ok === false
    && pruned.error.includes('not offered by this plugin') && !pruned.error.includes('switched off'))
  const unknownLocal = await tool.execute({ action: 'send_message', params: { text: 'hi', kind: 'image', url: 'http://x/y.png' } })
  t('send_message dispatches to the local handler', typeof unknownLocal.ok === 'boolean' && !registered.includes('send_message'))
  t('send_message is not marked concurrency safe', tool.isConcurrencySafe({ action: 'send_message' }) === false)
  rmSync(dir, { recursive: true, force: true })
}

// --- 媒体提示词禁止权限幻觉
import { mediaParagraph } from '../prompt.js'
const mediaText = mediaParagraph()
t('the media paragraph requires the send_message action', mediaText.includes('必须') && mediaText.includes('send_message'))
t('the media paragraph forbids claiming no permission', mediaText.includes('不要回复说你没有权限'))
t('the media paragraph forbids the admin excuse', mediaText.includes('绝不要让用户把你设为管理员'))
t('the media paragraph requires listing first', mediaText.includes('list_files'))

// --- 入站媒体：占位符变成可读的本地路径
import {
  inboxRoot, chatFolder, safeFileName, extensionFor, sourceFromData, sourceFromResponse,
  mediaPlaceholder, buildInboundText, unescapeCq, sniffImageExtension,
  unknownSegmentTypes, segmentPlaceholder, KNOWN_SEGMENT_TYPES,
} from '../inbound.js'
t('inbox root follows the workspace cache convention', inboxRoot({ workspacePath: '/workspace/QQ' }, { kind: 'private', id: '2000001' }, 'private:2000001') === '/workspace/QQ/onebot-mini-cache/QQ/2000001')
t('an explicit inboundDir overrides the default', inboxRoot({ inboundDir: '/tmp/x' }, { kind: 'private', id: '42' }, 'private:42') === '/tmp/x/private-42')
t('chat folder is filesystem safe', chatFolder('private:2000001') === 'private-2000001')
t('a file name drops path separators', !safeFileName('../../etc/passwd').includes('/') && !safeFileName('a/b').includes('/'))
t('extension follows the content type', extensionFor('image', 'image/png', '') === 'png' && extensionFor('video', 'video/mp4', '') === 'mp4')
t('extension falls back per kind', extensionFor('image', '', '') === 'jpg' && extensionFor('record', '', '') === 'amr')
t('a direct URL is picked from the segment', sourceFromData({ url: 'https://x/y.png' })?.url === 'https://x/y.png')
t('a base64 file field is decoded to a source', sourceFromData({ file: 'base64://QUJD' })?.base64 === 'QUJD')
t('a get_file response url is picked', sourceFromResponse({ url: 'https://x/y.amr' })?.url === 'https://x/y.amr')
t('the image placeholder carries its path', mediaPlaceholder('image', '/tmp/a.png') === '[图片: /tmp/a.png]')
t('the voice placeholder appends a transcript', mediaPlaceholder('record', '/tmp/a.amr', undefined, '你好').includes('转写：你好'))
t('the file placeholder names the file', mediaPlaceholder('file', '/tmp/a.pdf', 'a.pdf') === '[文件: a.pdf, /tmp/a.pdf]')
t('a failed download keeps the bare placeholder', mediaPlaceholder('image') === '[图片]')
t('the CQ fallback strips media tags', unescapeCq('[CQ:image,file=x] hi') === '[图片] hi')
t('the CQ fallback turns a json card into a placeholder', unescapeCq('[CQ:json,data={"prompt":"&#91;QQ小程序&#93;"}]') === '[卡片]')
t('a known card type has a labelled placeholder', segmentPlaceholder('json', { data: '{"prompt":"[QQ小程序]"}' }) === '[卡片: QQ小程序]')
t('an unknown type has no placeholder', segmentPlaceholder('markdown', {}) === '')
t('the known-type set covers cards and media', ['json', 'xml', 'image', 'record', 'text'].every((tp) => KNOWN_SEGMENT_TYPES.includes(tp)))
t('image magic bytes pick the extension', sniffImageExtension(Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')) === 'png'
  && sniffImageExtension(Buffer.from('ffd8ffe0', 'hex')) === 'jpg')

// buildInboundText 下载 base64 图片并把占位符改写为可读路径
// （不走网络：来源就是内联 base64）。
const tmpInboxBase = '/tmp/onebot-inbound-test-' + process.pid
const inboundConfig = { inboundDir: tmpInboxBase, inboundMediaMaxMb: 5 }
const fakeConnection = { call: async () => ({}) }
const cardBuilt = await buildInboundText({
  segments: [{ type: 'json', data: { data: JSON.stringify({ prompt: '[QQ小程序]' }) } }],
  chatId: 'private:42', chat: { kind: 'private', id: '42' }, connection: fakeConnection, config: inboundConfig,
})
t('buildInboundText keeps a card segment', cardBuilt.text === '[卡片: QQ小程序]', cardBuilt.text)
const built = await buildInboundText({
  segments: [
    { type: 'text', data: { text: '看看 ' } },
    { type: 'image', data: { file: 'base64://' + Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64') } },
  ],
  chatId: 'private:42',
  chat: { kind: 'private', id: '42' },
  connection: fakeConnection,
  config: inboundConfig,
})
t('an inbound image is saved and referenced by path', /\[图片: \/tmp\/onebot-inbound-test-\d+\/private-42\/.+\.png\]/.test(built.text), built.text)
t('the saved image file exists', built.saved.length === 1 && existsSync(built.saved[0].path))
rmSync(tmpInboxBase, { recursive: true, force: true })

// 没有可用来源的媒体段降级为裸占位符
const missing = await buildInboundText({
  segments: [{ type: 'image', data: {} }],
  chatId: 'private:43', chat: { kind: 'private', id: '43' },
  connection: fakeConnection, config: inboundConfig,
})
t('a source-less media segment keeps the bare placeholder', missing.text === '[图片]' && missing.warnings.length === 1)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
