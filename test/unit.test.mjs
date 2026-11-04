/**
 * Self-contained checks: pure functions, config store, log ring, wire protocol.
 * Run with `node test/unit.test.mjs`. No test framework, no dependencies.
 */
import { rmSync, writeFileSync, readFileSync } from 'node:fs'
import { acceptKey, takeFrame, encodeText, encodeControl } from '../wire.js'
import { normalizeConfig, ConfigStore, DEFAULTS, MODE_FIELDS, FIELD_GROUPS } from '../config.js'
import { TOOL_GROUPS, ALL_ACTIONS, isKnownAction, computeAllowlist } from '../toolcatalog.js'
import { LogBus, redact, preview } from '../logbus.js'
import {
  chatIdOf, splitChatId, sessionIdOf, flattenMessage, unescapeCq,
  isAddressed, speakerPrefix, textOfMessage,
} from '../bridge.js'

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

// --- onebot_call tool catalog and allowlist
t('catalog groups the send actions', TOOL_GROUPS.some((group) => group.id === 'message' && group.actions.includes('send_group_msg')))
t('all actions flatten from the groups', ALL_ACTIONS.length === TOOL_GROUPS.reduce((sum, group) => sum + group.actions.length, 0))
t('unknown action is not in the catalog', isKnownAction('definitely_not_real') === false)
t('a missing config enables every action', computeAllowlist({})?.size === ALL_ACTIONS.length)
t('the master switch off disables the tool entirely', computeAllowlist({ onebotToolEnabled: false }) === null)
const banOff = computeAllowlist({ onebotToolDisabled: ['set_group_ban'] })
t('a disabled action is dropped from the allowlist', banOff !== null && !banOff.has('set_group_ban') && banOff.has('send_group_msg'))
t('disabling every action disables the tool', computeAllowlist({ onebotToolDisabled: [...ALL_ACTIONS] }) === null)
const filteredDisabled = normalizeConfig({ onebotToolDisabled: ['set_group_ban', 'not-an-action', 'set_group_ban'] }).value.onebotToolDisabled
t('unknown and duplicate disabled actions are dropped', JSON.stringify(filteredDisabled) === '["set_group_ban"]', JSON.stringify(filteredDisabled))
t('snapshot ships the tool catalog', Array.isArray(snap.toolCatalog) && snap.toolCatalog.length === TOOL_GROUPS.length)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
