/**
 * Self-contained checks: pure functions, config store, log ring, wire protocol.
 * Run with `node test/unit.test.mjs`. No test framework, no dependencies.
 */
import { rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join as pathJoin } from 'node:path'
import { existsSync as readFileSyncExists } from 'node:fs'
import { acceptKey, takeFrame, encodeText, encodeControl } from '../wire.js'
import { normalizeConfig, ConfigStore, DEFAULTS, MODE_FIELDS, FIELD_GROUPS, FIELD_KINDS } from '../config.js'
import { TOOL_GROUPS, ALL_ACTIONS, STANDARD_ACTIONS, isKnownAction, computeAllowlist, actionLabel, enabledGroups } from '../toolcatalog.js'
import { LogBus, redact, preview } from '../logbus.js'
import {
  chatIdOf, splitChatId, sessionIdOf, flattenMessage, unescapeCq,
  isAddressed, speakerPrefix, speakerKey, textOfMessage, buildPlatformPrompt,
} from '../bridge.js'
import { tmpdir } from 'node:os'

let pass = 0
let fail = 0
const t = (name, cond, extra = '') => {
  if (cond) pass += 1
  else { fail += 1; console.log('FAIL ' + name + (extra ? ' :: ' + extra : '')) }
}

// --- wire: RFC 6455 accept sample, frame roundtrip, masked decode, partial buffer
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

// --- config
const needsToken = normalizeConfig({ mode: 'reverse', accessToken: '', workspacePath: '/workspace/QQ', sessionPermission: 'workspace-write' })
t('reverse without token is rejected', needsToken.problems.some((p) => p.includes('accessToken')))
const clamped = normalizeConfig({ port: 99999 })
t('port out of range falls back', clamped.value.port === DEFAULTS.port)
const good = normalizeConfig({ mode: 'forward', accessToken: 'x', url: 'ws://a:1', workspacePath: '/workspace/QQ', sessionPermission: 'workspace-write', allowFrom: [' 1 ', '', '2'] })
t('forward with token is clean', good.problems.length === 0, JSON.stringify(good.problems))
t('string list is trimmed', JSON.stringify(good.value.allowFrom) === '["1","2"]')
t('unknown enum falls back', normalizeConfig({ mode: 'weird' }).value.mode === 'reverse')
t('non-boolean boolean falls back', normalizeConfig({ senderPrefix: 'yes' }).value.senderPrefix === true)

t('the default keeps steering on and the prefix on', DEFAULTS.autoInterject === true && DEFAULTS.senderPrefix === true)
t('debounce config is gone; only the interject switch remains', !('privateDebounceMs' in DEFAULTS) && !('privateDebounceMaxMs' in DEFAULTS) && DEFAULTS.privateAutoInterject === true)
t('no group reply config remains', !('groupDebounceMs' in DEFAULTS) && !('groupAutoInterject' in DEFAULTS))
t('the reply group holds the send mode then the interject switch', JSON.stringify(FIELD_GROUPS.find((g) => g.id === 'reply').fields) === '["replyMode","privateAutoInterject"]')

// reply mode: stream (send as it goes, default) or final (buffer, one message)
t('reply mode defaults to stream', DEFAULTS.replyMode === 'stream')
t('reply mode is its own field kind', FIELD_KINDS.replyMode === 'replyMode')
t('a valid reply mode is kept', normalizeConfig({ replyMode: 'final' }).value.replyMode === 'final')
t('an unknown reply mode falls back to stream', normalizeConfig({ replyMode: 'burst' }).value.replyMode === 'stream')
t('a non-string reply mode falls back to stream', normalizeConfig({ replyMode: 3 }).value.replyMode === 'stream')

// the administrator is a single QQ number stored on the access page
t('admin user id defaults to empty', DEFAULTS.adminUserId === '')
t('admin user id is a string field', FIELD_KINDS.adminUserId === 'string')
t('admin user id is trimmed', normalizeConfig({ adminUserId: ' 12345 ' }).value.adminUserId === '12345')
t('a numeric admin id is stored as a string', normalizeConfig({ adminUserId: 12345 }).value.adminUserId === '12345')
t('a non-numeric admin id is dropped', normalizeConfig({ adminUserId: 'abc' }).value.adminUserId === '')
t('admin user id is not on the settings groups', !FIELD_GROUPS.some((group) => group.fields.includes('adminUserId')))

// delete-inbound-media mirrors delete-sent-media and defaults on
t('the inbound-delete switch defaults on', DEFAULTS.deleteInboundMedia === true)
t('the inbound-delete switch is a boolean field', FIELD_KINDS.deleteInboundMedia === 'boolean')
t('the media group orders inbound delete before sent delete', JSON.stringify(FIELD_GROUPS.find((g) => g.id === 'media').fields) === '["inboundMedia","inboundMediaMaxMb","deleteInboundMedia","deleteSentMedia"]')
t('a non-boolean inbound-delete falls back to the default', normalizeConfig({ deleteInboundMedia: 'no' }).value.deleteInboundMedia === true)
t('an explicit false inbound-delete is kept', normalizeConfig({ deleteInboundMedia: false }).value.deleteInboundMedia === false)

// voice: code only downloads and annotates the message id. It makes NO non-standard
// call itself — the prompt guides the model to call onebot_call's fetch_ptt_text.
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

// session prefix: lowercase-letter start, safe alphabet, default on rejection
t('session prefix default', DEFAULTS.sessionPrefix === 'onebot')
t('session prefix accepts lowercase', normalizeConfig({ sessionPrefix: 'qq-bot' }).value.sessionPrefix === 'qq-bot')
t('session prefix rejects uppercase start', normalizeConfig({ sessionPrefix: 'QQ' }).value.sessionPrefix === 'onebot')
t('session prefix rejects digit start', normalizeConfig({ sessionPrefix: '1qq' }).value.sessionPrefix === 'onebot')
t('session prefix rejects CJK', normalizeConfig({ sessionPrefix: '我的QQ' }).value.sessionPrefix === 'onebot')
t('session prefix rejects spaces', normalizeConfig({ sessionPrefix: 'a b' }).value.sessionPrefix === 'onebot')
t('session prefix empty means default', normalizeConfig({ sessionPrefix: '' }).value.sessionPrefix === 'onebot')

// workspacePath is required
t('workspace is required', normalizeConfig({ mode: 'forward', accessToken: 'x', workspacePath: '' }).problems.some((p) => p.includes('workspacePath')))
t('workspace accepted when set', normalizeConfig({ mode: 'forward', accessToken: 'x', workspacePath: '/workspace/QQ', sessionPermission: 'workspace-write' }).problems.length === 0)

// mode-scoped fields: the form shows only the current mode's connection inputs
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

// --- log ring
const log = new LogBus({ capacity: 50 })
for (let i = 0; i < 80; i += 1) log.record('event', { i })
t('ring is bounded', log.size === 50, String(log.size))
const s1 = log.snapshot(0, 200)
t('snapshot returns retained entries', s1.entries.length === 50)
t('seq is monotonic', s1.nextSeq === 80, String(s1.nextSeq))
const s2 = log.snapshot(75, 200)
t('cursor filters older entries', s2.entries.length === 5 && s2.entries[0].seq === 76)
const deep = redact({ a: { access_token: 'secret', nested: { token: 'x', keep: 1 } }, authorization: 'Bearer y' })
t('redaction is recursive', deep.a.access_token === '[redacted]' && deep.a.nested.token === '[redacted]' && deep.a.nested.keep === 1 && deep.authorization === '[redacted]')
t('preview truncates by code point', preview('a'.repeat(100), 10) === 'aaaaaaaaaa…')
const cyclic = {}; cyclic.self = cyclic
t('cyclic value does not throw', typeof redact(cyclic) === 'object')

// --- bridge pure functions
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
t('unknown segment types are reported', JSON.stringify(unknownSegmentTypes([{ type: 'text', data: { text: 'x' } }, { type: 'markdown', data: {} }, { type: 'markdown', data: {} }])) === '["markdown"]')
t('a cq json string becomes a card placeholder', unescapeCq('[CQ:json,data={"prompt":"&#91;QQ小程序&#93;"}]') === '[卡片]')
t('cq fallback unescapes and strips', unescapeCq('a&#91;b&#93; &amp; [CQ:image,file=x]') === 'a[b] & [图片]')
t('mention via segment', isAddressed({ message: [{ type: 'at', data: { qq: '10001' } }] }, '10001') === true)
t('mention for another user', isAddressed({ message: [{ type: 'at', data: { qq: '999' } }] }, '10001') === false)
t('unknown bot fails closed', isAddressed({ message: [{ type: 'at', data: { qq: '10001' } }] }, '') === false)
t('mention via cq string', isAddressed({ message: '[CQ:at,qq=10001] hi' }, '10001') === true)
t('group prefix has speaker', speakerPrefix({ sender: { card: '小明' }, user_id: 20002, time: 1700000000 }, 'group', true).startsWith('['))
t('private prefix is empty', speakerPrefix({ sender: {} }, 'private', true) === '')
t('a group speaker key is the sender id', speakerKey({ user_id: 111 }, 'group') === '111')
t('different group senders get different keys', speakerKey({ user_id: 111 }, 'group') !== speakerKey({ user_id: 222 }, 'group'))
t('a private chat has one speaker key', speakerKey({ user_id: 111 }, 'private') === speakerKey({ user_id: 222 }, 'private'))
t('prefix can be disabled', speakerPrefix({ sender: { card: 'x' } }, 'group', false) === '')
t('only text blocks are joined', textOfMessage({ content: [{ type: 'text', text: 'a' }, { type: 'reasoning', text: 'secret' }, { type: 'text', text: 'b' }] }) === 'a\nb')
t('empty content yields empty text', textOfMessage({ content: [] }) === '')

// --- onebot_call tool catalog and allowlist
const groupOf = (name) => TOOL_GROUPS.find((group) => group.actions.some((action) => action.name === name))
t('catalog groups the send actions', groupOf('send_group_msg')?.id === 'message')
t('catalog covers the NapCat core actions', ['set_group_ban', 'send_poke', 'delete_msg', 'nc_get_user_status', 'send_qzone_msg']
  .every((name) => isKnownAction(name)))
t('dangerous actions stay out of the catalog', ['get_credentials', 'get_csrf_token', 'get_cookies', 'set_restart', 'bot_exit', 'send_packet', 'clean_cache', 'ocr_image']
  .every((name) => !isKnownAction(name)))
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
// standard vs extension classification (the tools page badges each row)
t('every action carries a boolean standard flag', TOOL_GROUPS.every((group) => group.actions.every((action) => typeof action.standard === 'boolean')))
t('the standard set has 40 OneBot 11 actions', STANDARD_ACTIONS.size === 40)
t('the standard flag matches the STANDARD_ACTIONS set', TOOL_GROUPS.every((group) => group.actions.every((action) => action.standard === STANDARD_ACTIONS.has(action.name))))
t('fetch_ptt_text is marked as an extension', TOOL_GROUPS.find((g) => g.id === 'interaction').actions.find((a) => a.name === 'fetch_ptt_text').standard === false)
t('send_msg is marked standard', TOOL_GROUPS.find((g) => g.id === 'message').actions.find((a) => a.name === 'send_msg').standard === true)
// every action ships a structured doc + a generated default prompt
t('every catalogued action ships a default prompt', TOOL_GROUPS.every((group) => group.actions.every((action) => typeof action.defaultPrompt === 'string' && action.defaultPrompt.length > 0)))
t('every catalogued action ships a params array', TOOL_GROUPS.every((group) => group.actions.every((action) => Array.isArray(action.params))))
t('every documented parameter has a name, type, required flag and description', TOOL_GROUPS.every((group) => group.actions.every((action) => action.params.every((p) => typeof p.name === 'string' && p.name !== '' && typeof p.type === 'string' && typeof p.required === 'boolean' && typeof p.desc === 'string' && p.desc !== ''))))
t('a documented action names its params and type labels', TOOL_GROUPS.find((g) => g.id === 'message').actions.find((a) => a.name === 'send_group_msg').defaultPrompt.includes('group_id（数字，必填）'))
t('a no-arg action says so', TOOL_GROUPS.find((g) => g.id === 'query').actions.find((a) => a.name === 'get_login_info').defaultPrompt.includes('无需参数'))
t('fetch_ptt_text documents its message_id parameter', TOOL_GROUPS.find((g) => g.id === 'interaction').actions.find((a) => a.name === 'fetch_ptt_text').defaultPrompt.includes('message_id'))
// per-action prompt overrides live in config and are validated
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

// --- image cache: url allow-list and account folders
import { isAllowedImageUrl, accountDir, cacheRoot } from '../imagecache.js'
t('a qzone image host is allowed', isAllowedImageUrl('http://photomaz.photo.store.qq.com/psc?/abc/b&bo=x'))
t('a qpic host is allowed', isAllowedImageUrl('https://gchat.qpic.cn/gchatpic_new/1/2-3-4/0'))
t('a random host is refused', !isAllowedImageUrl('https://evil.example.com/a.jpg'))
t('a host that merely ends with the suffix text is refused', !isAllowedImageUrl('https://notqq.com/a.jpg'))
t('a lookalike suffix is refused', !isAllowedImageUrl('https://qq.com.evil.io/a.jpg'))
t('a non-http scheme is refused', !isAllowedImageUrl('file:///etc/passwd'))
t('a malformed url is refused', !isAllowedImageUrl('not a url'))
t('the profile cache root sits beside the config', cacheRoot().endsWith('onebot-mini-cache'))
t('an account folder keeps only digits under QQ/', accountDir({}, '2000002').endsWith('/QQ/2000002'))
t('the account folder follows the configured workspace', accountDir({ workspacePath: '/workspace/QQ' }, '2000002') === '/workspace/QQ/onebot-mini-cache/QQ/2000002')
t('a hostile account id cannot escape the cache root', !accountDir({}, '../etc').includes('..'))

// --- media segments
import { buildSegment, MEDIA_KINDS, readFileAsBase64, MAX_MEDIA_BYTES, safeUnlink, mediaFailureNotice } from '../media.js'
t('an image segment uses base64 when given base64', JSON.stringify(buildSegment('image', { base64: 'AAA' })) === '{"type":"image","data":{"file":"base64://AAA"}}')
t('a segment uses the url when given a url', JSON.stringify(buildSegment('image', { url: 'http://x/y.png' })) === '{"type":"image","data":{"file":"http://x/y.png"}}')
t('a file segment carries its name', JSON.stringify(buildSegment('file', { url: 'http://x/y.zip' }, 'a.zip')) === '{"type":"file","data":{"file":"http://x/y.zip","name":"a.zip"}}')
t('media kinds cover image, record, video and file', JSON.stringify(MEDIA_KINDS) === '["image","record","video","file"]')
t('the media ceiling is 20 MB', MAX_MEDIA_BYTES === 20 * 1024 * 1024)
const readBack = await readFileAsBase64('/tmp/onebot-mini-unit.json')
t('a local file is read into base64', readBack.ok === true && typeof readBack.base64 === 'string' && readBack.base64.length > 0)
const missingFile = await readFileAsBase64('/tmp/definitely-not-here-xyz')
t('a missing file is reported', missingFile.ok === false && missingFile.reason !== '')

// the chat-facing notice must be short and free of paths or errno text
t('the media failure notice hides the path', !mediaFailureNotice('image').includes('/') && !mediaFailureNotice('image').includes('ENOENT'))
t('the media failure notice names the kind', mediaFailureNotice('image').includes('图片') && mediaFailureNotice('file').includes('文件'))

// safe deletion: only inside the allowed roots, never a directory, never a root
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

// --- the editable channel prompt
import { DEFAULT_CHANNEL_PROMPT, LEGACY_CHANNEL_PROMPT, replyModeParagraph, renderPrompt, PROMPT_PLACEHOLDERS, PROMPT_DEFS, renderToolCallPrompt } from '../prompt.js'
t('the default prompt documents its placeholders', PROMPT_PLACEHOLDERS.every((p) => DEFAULT_CHANNEL_PROMPT.includes(p)))
t('renderPrompt fills a placeholder', renderPrompt('x {actions} y', { actions: 'Z' }).includes('x Z y'))
t('renderPrompt drops an empty placeholder line', !renderPrompt('a\n{media}\nb', { media: '' }).includes('{media}'))
t('an unknown placeholder is left alone', renderPrompt('keep {unknown}', {}).includes('{unknown}'))
// the reply-delivery sentence follows replyMode instead of being hardcoded
t('the stream paragraph says replies stream segment by segment', replyModeParagraph('stream').includes('实时发出'))
t('the final paragraph says one message per turn', replyModeParagraph('final').includes('只产生一条'))
t('the default channel prompt carries the replyMode placeholder', DEFAULT_CHANNEL_PROMPT.includes('{replyMode}'))
t('renderPrompt fills the replyMode line', renderPrompt(DEFAULT_CHANNEL_PROMPT, { replyMode: 'R' }).includes('R'))
t('the default build prompts streaming', buildPlatformPrompt(DEFAULTS).includes('实时发出'))
t('an explicit final mode prompts one message', buildPlatformPrompt({ ...DEFAULTS, replyMode: 'final' }).includes('只产生一条'))
t('the old shipped prompt is migrated to the new placeholder', normalizeConfig({ channelPrompt: LEGACY_CHANNEL_PROMPT }).value.channelPrompt === DEFAULT_CHANNEL_PROMPT)
t('an edited prompt is not migrated', normalizeConfig({ channelPrompt: LEGACY_CHANNEL_PROMPT + ' (edited)' }).value.channelPrompt.endsWith('(edited)'))
t('a custom prompt is kept by normalize', normalizeConfig({ mode: 'forward', accessToken: 'x', workspacePath: '/workspace/QQ', sessionPermission: 'workspace-write', channelPrompt: 'hello prompt' }).value.channelPrompt === 'hello prompt')
t('an empty prompt falls back to the default', normalizeConfig({ channelPrompt: '   ' }).value.channelPrompt === DEFAULT_CHANNEL_PROMPT)
t('the prompt registry covers channel, inbound, both tools and the interject judge', PROMPT_DEFS.map((d) => d.field).join(',') === 'channelPrompt,inboundPrompt,toolCallPrompt,toolMediaPrompt,interjectPrompt')
t('every registered prompt has a config default', PROMPT_DEFS.every((d) => typeof DEFAULTS[d.field] === 'string' && DEFAULTS[d.field] !== ''))
t('every registered prompt has a label key', PROMPT_DEFS.every((d) => typeof d.labelKey === 'string' && d.labelKey !== ''))
const blankAll = normalizeConfig({ channelPrompt: '', toolCallPrompt: '  ', toolMediaPrompt: '' }).value
t('every blank prompt returns to its default', PROMPT_DEFS.every((d) => blankAll[d.field] === DEFAULTS[d.field]))
t('the tool-call prompt adds the enabled note when actions are allowed', renderToolCallPrompt('X {enabledNote}', new Set(['a'])).includes('仅接受在 OneBot-Mini 设置中已启用的动作'))
t('the tool-call prompt drops the note when the tool is off', !renderToolCallPrompt('X {enabledNote}', null).includes('仅接受'))
t('the tool-call prompt falls back when empty', renderToolCallPrompt('', null).startsWith('执行一个 OneBot 11 动作'))
t('the tool-call prompt no longer mentions a gateway', !/网关|NapCat/.test(renderToolCallPrompt('', null)))
// the channel prompt hands the model every enabled action with its Chinese annotation,
// and carries no gateway-specific wording — the model discovers tools by name + annotation.
{
  const prompt = buildPlatformPrompt(DEFAULTS)
  t('the channel prompt lists every catalog action by name', ALL_ACTIONS.every((name) => prompt.includes(name)))
  t('the channel prompt documents each action with its function', prompt.includes('fetch_ptt_text：功能：获取一条语音消息的转文字结果') && prompt.includes('send_group_msg：功能：发送群消息'))
  t('the channel prompt carries parameter names and usage', prompt.includes('group_id（数字，必填）') && prompt.includes('用法：onebot_call(action="send_group_msg"'))
  t('the channel prompt has no gateway/NapCat wording', !/网关|NapCat/.test(prompt))
}

// --- cache inventory and manual clearing (against a throwaway profile)
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
// Follow the cache convention: <base>/QQ/<account>/ (here base falls back to the profile).
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

// --- transport facade contract
// The bridge calls `sendMessage` for every reply. A facade that only exposes
// `sendText` silently breaks every reply, so both must be present.
import { readFileSync as readSrc } from 'node:fs'
const indexSrc = readSrc(new URL('../index.js', import.meta.url), 'utf8')
const facadeBlock = indexSrc.slice(indexSrc.indexOf('const transport = {'), indexSrc.indexOf('const getWorkspaceRegistry'))
t('the transport facade exposes sendText', facadeBlock.includes('sendText:'))
t('the transport facade exposes sendMessage', facadeBlock.includes('sendMessage:'))
t('the transport facade exposes call', facadeBlock.includes('call:'))
t('the transport facade exposes status', facadeBlock.includes('status:'))
t('the connection exposes sendMessage', (await import('../connection.js')).OneBotConnection.prototype.sendMessage !== undefined)
t('the connection exposes sendText', (await import('../connection.js')).OneBotConnection.prototype.sendText !== undefined)

// A tool result may only contain fields its output schema declares: an extra
// field is rejected by the harness and the model sees an error even though the
// action succeeded. sendMedia must therefore return exactly { ok, data, error }.
import { readFileSync as readTools } from 'node:fs'
const toolsSrc = readTools(new URL('../tools.js', import.meta.url), 'utf8')
const schemaBlock = toolsSrc.slice(toolsSrc.indexOf('const OUTPUT_SCHEMA'), toolsSrc.indexOf('required:', toolsSrc.indexOf('const OUTPUT_SCHEMA')))
t('the output schema declares ok, data and error', schemaBlock.includes('ok:') && schemaBlock.includes('data:') && schemaBlock.includes('error:'))
t('the output schema no longer declares source', !schemaBlock.includes('source:'))
const sendSrc = (await import('../media.js')).sendMedia.toString()
t('sendMedia returns only ok/data', !sendSrc.includes('source:') && sendSrc.includes('return { ok: true, data }'))
t('sendMedia still reports cleanup through a hook', sendSrc.includes('onCleanup'))

// OneBot returns an array for list actions; the tool output must not force an
// object, or the harness rejects the whole call ("value.data must be an object").
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

// --- media prompt forbids the permission hallucination
import { mediaParagraph } from '../prompt.js'
const mediaText = mediaParagraph()
t('the media paragraph requires calling the tool', mediaText.includes('必须') && mediaText.includes('onebot_send_media'))
t('the media paragraph forbids claiming no permission', mediaText.includes('不要回复说你没有权限'))
t('the media paragraph forbids the admin excuse', mediaText.includes('绝不要让用户把你设为管理员'))
t('the media paragraph requires listing first', mediaText.includes('onebot_list_files'))

// --- incoming media: placeholders become readable local paths
import {
  inboxRoot, chatFolder, safeFileName, extensionFor, sourceFromData, sourceFromResponse,
  mediaPlaceholder, buildInboundText, unescapeCqLite, sniffImageExtension,
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
t('the CQ fallback strips media tags', unescapeCqLite('[CQ:image,file=x] hi') === '[图片] hi')
t('the CQ fallback turns a json card into a placeholder', unescapeCqLite('[CQ:json,data={"prompt":"&#91;QQ小程序&#93;"}]') === '[卡片]')
t('a known card type has a labelled placeholder', segmentPlaceholder('json', { data: '{"prompt":"[QQ小程序]"}' }) === '[卡片: QQ小程序]')
t('an unknown type has no placeholder', segmentPlaceholder('markdown', {}) === '')
t('the known-type set covers cards and media', ['json', 'xml', 'image', 'record', 'text'].every((tp) => KNOWN_SEGMENT_TYPES.includes(tp)))
t('image magic bytes pick the extension', sniffImageExtension(Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')) === 'png'
  && sniffImageExtension(Buffer.from('ffd8ffe0', 'hex')) === 'jpg')

// buildInboundText downloads a base64 image and rewrites the placeholder to a
// readable path (no network: the source is inline base64).
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

// a media segment with no usable source degrades to the bare placeholder
const missing = await buildInboundText({
  segments: [{ type: 'image', data: {} }],
  chatId: 'private:43', chat: { kind: 'private', id: '43' },
  connection: fakeConnection, config: inboundConfig,
})
t('a source-less media segment keeps the bare placeholder', missing.text === '[图片]' && missing.warnings.length === 1)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
