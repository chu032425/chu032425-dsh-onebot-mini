/**
 * Browser-half checks without a real browser: the module loader contract,
 * slot registrations, dictionary parity, and that both pages render.
 * Run with `node test/client.test.mjs`.
 */
import { readFileSync } from 'node:fs'
import { FIELD_GROUPS } from '../config.js'
import { TOOL_GROUPS } from '../toolcatalog.js'

const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

let captured
globalThis.window = { __ModuleLoader__: { load: (def) => { captured = def } } }

// Minimal DOM head, enough for the stylesheet effect.
const injected = []
globalThis.document = {
  getElementById: (id) => injected.find((node) => node.id === id) ?? null,
  createElement: () => ({ id: '', textContent: '' }),
  head: { appendChild: (node) => { injected.push(node); return node } },
}

// Enough of React to build a tree; hooks return their initial value.
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: (init) => ({ current: init }),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}
const requireShim = (name) => {
  if (name === 'react') return React
  throw new Error('unexpected require: ' + name)
}

new Function('window', 'require', src)(globalThis.window, requireShim)
if (captured === undefined) throw new Error('bundle did not call __ModuleLoader__.load')

const mod = captured.factory(requireShim)
const registrations = []
const dictionaries = []
const ctx = {
  effect: (fn) => { const d = fn(); return d },
  locale: {
    register: (ns, dict) => { dictionaries.push({ ns, dict }); return () => {} },
    bind: (ns) => (key, vars) => {
      const entry = dictionaries.find((item) => item.ns === ns)
      let text = entry?.dict?.zh?.[key] ?? entry?.dict?.en?.[key] ?? key
      if (vars !== undefined) {
        for (const [name, value] of Object.entries(vars)) text = text.replace('{' + name + '}', String(value))
      }
      return text
    },
  },
  slots: {
    inject: (owner, callback) => { callback() },
    register: (options, render) => { registrations.push({ options, render }); return () => {} },
  },
}
mod.apply(ctx)

let pass = 0
let fail = 0
const t = (name, cond, extra = '') => {
  if (cond) pass += 1
  else { fail += 1; console.log('FAIL ' + name + (extra ? ' :: ' + extra : '')) }
}

const slots = registrations.filter((item) => item.options)
const names = slots.map((item) => item.options.name)
t('module id', captured.id === 'dsh-onebot-mini')
t('exports apply and inject', typeof mod.apply === 'function' && Array.isArray(mod.inject))
t('sidebar panel registered', names.includes('sidebar.panellist'))
t('main page registered', names.includes('main'))
t('configuration is not on the Plugins page', !names.includes('plugins.bundle.config'))
t('sidebar id matches main key', slots.find((s) => s.options.name === 'sidebar.panellist').options.id
  === slots.find((s) => s.options.name === 'main').options.key)

const zh = dictionaries[0].dict.zh
const en = dictionaries[0].dict.en
const zhKeys = Object.keys(zh).sort()
const enKeys = Object.keys(en).sort()
t('dictionary key sets match', JSON.stringify(zhKeys) === JSON.stringify(enKeys),
  zhKeys.filter((k) => !enKeys.includes(k)).join(','))
t('tab labels present', 'tabLogs' in zh && 'tabSettings' in zh)

const render = slots.find((s) => s.options.name === 'main').render
const element = render({})
const tree = typeof element.type === 'function' ? element.type(element.props) : element
t('panel root is a grid shell', tree.props.style.display === 'grid')
const rail = tree.children.find((child) => child && child.type === 'nav')
t('rail exists', rail !== undefined)
const tabs = rail.children.flat(4).filter((child) => child && child.props && child.props.role === 'tab')
t('seven tabs (logs, tools, contacts, access, qzone, profile, settings)', tabs.length === 7, String(tabs.length))
t('log tab is selected first', tabs[0].props['aria-selected'] === true && tabs.slice(1).every((tab) => tab.props['aria-selected'] === false))
const pane = tree.children.find((child) => child && child.props && child.props.role === 'tabpanel')
t('pane has a mounted page', pane.children.filter(Boolean).length >= 1)

const icon = slots.find((s) => s.options.name === 'sidebar.panellist').render({})
t('sidebar icon is an svg', icon.type === 'svg')

// Localized names for the well-known preset/permission values must exist in
// both dictionaries, so a Chinese UI never shows raw ids like "read-only".
for (const key of ['presetNameStandard', 'presetNamePtc', 'presetNameMinimal', 'presetNameCordis',
  'permReadOnly', 'permWorkspaceWrite', 'permDangerFullAccess', 'permAuto']) {
  t('localized name present: ' + key, typeof zh[key] === 'string' && zh[key] !== '' && typeof en[key] === 'string' && en[key] !== '')
}
t('session mode is gone', !('fieldSessionMode' in zh) && !('modePlan' in zh))

// The onebot_call action picker must have copy in both languages, so the section
// never falls back to a raw dictionary key in either UI.
for (const key of ['groupTool', 'fieldOnebotToolEnabled', 'hintOnebotToolOff',
  'toolGroupMessage', 'toolGroupMedia', 'toolGroupGroup', 'toolGroupQuery', 'toolGroupInteraction',
  'toolGroupRequest', 'toolGroupProfile', 'toolGroupQzone', 'toolGroupAlbum',
  'toolActionsHint', 'toolNoteAuto', 'toolTotal', 'toolSearchPlaceholder', 'toolNoMatch']) {
  t('tool config copy present: ' + key, typeof zh[key] === 'string' && zh[key] !== '' && typeof en[key] === 'string' && en[key] !== '')
}

// Every catalogued action carries its annotation in the catalog itself, so the
// list never shows a bare action id without an explanation next to it.
t('the catalog supplies action annotations', TOOL_GROUPS.every((group) => group.actions.every((action) => /[\u4e00-\u9fa5]/.test(action.zh)))),
t('the tools page renders every catalog group', TOOL_GROUPS.length === 9)

// The friend row shows the remark as its name, so the trailing hint must be the
// nickname; labelling it "remark" would describe the wrong field.
t('the friend row labels its hint as the nickname', zh.contactsNickname === '昵称' && en.contactsNickname === 'Nickname')
t('the swapped remark label is gone', !('contactsRemark' in zh) && !('contactsRemark' in en))
for (const key of ['fieldImageCacheMaxKb', 'fieldImageCacheTotalMb', 'fieldImageShowMaxMb']) {
  t('image cache field label present: ' + key, typeof zh[key] === 'string' && zh[key] !== '' && typeof en[key] === 'string' && en[key] !== '')
}
t('sex is localized in the friend detail', typeof zh.profileSexUnknown === 'string' && zh.profileSexUnknown === '未知')
for (const key of ['qzoneForbidden', 'qzoneForbiddenHint', 'qzoneForbiddenSwitch']) {
  t('permission copy present: ' + key, typeof zh[key] === 'string' && zh[key] !== '' && typeof en[key] === 'string' && en[key] !== '')
}
for (const key of ['qzoneImageAlt', 'qzoneImageFailed', 'qzoneImageTooLarge']) {
  t('image copy present: ' + key, typeof zh[key] === 'string' && zh[key] !== '' && typeof en[key] === 'string' && en[key] !== '')
}
t('tools menu label present', zh.tabTools === '工具' && en.tabTools === 'Tools')
t('contacts menu label present', zh.tabContacts === '好友与群组' && en.tabContacts === 'Contacts')
t('access menu label present', zh.tabAccess === '访问控制' && en.tabAccess === 'Access')
t('qzone menu label present', zh.tabQzone === '空间' && en.tabQzone === 'Qzone')
t('the qzone picker offers a dropdown and a manual box', typeof zh.qzoneTargetPlaceholder === 'string'
  && zh.qzoneTargetPlaceholder.includes('QQ') && typeof zh.qzoneTargetMine === 'string' && zh.qzoneTargetMine !== '')
t('profile menu label present', zh.tabProfile === '个人资料' && en.tabProfile === 'Profile')
for (const key of ['profileTitle', 'profileChoose', 'profileSelf', 'profileNickname', 'profileSignature',
  'profileLevel', 'profileVip', 'profileOnline', 'profileOnlineUnknown', 'profileUnavailable', 'profileEmpty']) {
  t('profile copy present: ' + key, typeof zh[key] === 'string' && zh[key] !== '' && typeof en[key] === 'string' && en[key] !== '')
}
for (const key of ['qzoneTitle', 'qzoneProfile', 'qzonePosts', 'qzoneFeeds', 'qzoneEmpty',
  'qzonePrivate', 'qzoneComments', 'qzoneLikes', 'qzoneUnavailable', 'qzoneOffline', 'qzoneRefresh',
  'qzoneTargetLabel', 'qzoneTargetMine', 'qzoneTargetPlaceholder', 'qzoneTargetGo', 'qzoneProfileEmpty']) {
  t('qzone copy present: ' + key, typeof zh[key] === 'string' && zh[key] !== '' && typeof en[key] === 'string' && en[key] !== '')
}
for (const key of ['accessTitle', 'accessPrivateAllow', 'accessPrivateDeny', 'accessGroupAllow', 'accessGroupDeny',
  'accessChooseFriend', 'accessChooseGroup', 'accessEmpty', 'accessNote']) {
  t('access copy present: ' + key, typeof zh[key] === 'string' && zh[key] !== '' && typeof en[key] === 'string' && en[key] !== '')
}
for (const key of ['membersTitle', 'membersLoading', 'membersFailed', 'membersRoleOwner', 'membersRoleAdmin',
  'friendDetailTitle', 'friendDetailOnline', 'friendDetailOnlineUnknown']) {
  t('detail copy present: ' + key, typeof zh[key] === 'string' && zh[key] !== '' && typeof en[key] === 'string' && en[key] !== '')
}
const settingsFields = FIELD_GROUPS.flatMap((group) => group.fields)
t('the access lists moved off the settings page', !settingsFields.includes('allowFrom') && !settingsFields.includes('allowGroups') && !settingsFields.includes('denyFrom'))
t('the access group keeps only the mention switch', JSON.stringify(FIELD_GROUPS.find((group) => group.id === 'access').fields) === '["requireMention"]')
const sheet = injected.find((node) => node.id === 'onebot-mini-stylesheet')
t('a responsive stylesheet is installed', sheet !== undefined && sheet.textContent.includes('@media (max-width:720px)'))
t('the narrow layout stacks the shell', sheet !== undefined && sheet.textContent.includes('.obm-shell{grid-template-columns:minmax(0,1fr)'))
t('the rail becomes horizontal when narrow', sheet !== undefined && sheet.textContent.includes('.obm-rail{flex-direction:row'))
t('the narrow rail stays on one scrollable row', sheet !== undefined && sheet.textContent.includes('flex-wrap:nowrap')
  && sheet.textContent.includes('overflow-x:auto'))
for (const key of ['contactsTitle', 'contactsFriends', 'contactsGroups', 'contactsCount', 'contactsEmpty', 'contactsOffline']) {
  t('contacts copy present: ' + key, typeof zh[key] === 'string' && zh[key] !== '' && typeof en[key] === 'string' && en[key] !== '')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
