/**
 * Browser-half checks without a real browser: the module loader contract,
 * slot registrations, dictionary parity, and that both pages render.
 * Run with `node test/client.test.mjs`.
 */
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

let captured
globalThis.window = { __ModuleLoader__: { load: (def) => { captured = def } } }

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
t('four tabs (logs, tools, contacts, settings)', tabs.length === 4, String(tabs.length))
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
  'toolGroupMessage', 'toolGroupMedia', 'toolGroupGroup', 'toolGroupAccount', 'toolGroupRequest',
  'toolActionsHint', 'toolNoteAuto']) {
  t('tool config copy present: ' + key, typeof zh[key] === 'string' && zh[key] !== '' && typeof en[key] === 'string' && en[key] !== '')
}

// Every catalogued action needs a Chinese annotation, so the list never shows a
// bare action id without an explanation next to it.
for (const key of ['toolActionSendPrivateMsg', 'toolActionSendGroupMsg', 'toolActionSetGroupBan',
  'toolActionGetLoginInfo', 'toolActionSetGroupAddRequest']) {
  t('action annotation present: ' + key, typeof zh[key] === 'string' && /[\u4e00-\u9fa5]/.test(zh[key]) && typeof en[key] === 'string' && en[key] !== '')
}
t('tools menu label present', zh.tabTools === '工具' && en.tabTools === 'Tools')
t('contacts menu label present', zh.tabContacts === '好友与群组' && en.tabContacts === 'Contacts')
for (const key of ['contactsTitle', 'contactsFriends', 'contactsGroups', 'contactsCount', 'contactsEmpty', 'contactsOffline']) {
  t('contacts copy present: ' + key, typeof zh[key] === 'string' && zh[key] !== '' && typeof en[key] === 'string' && en[key] !== '')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
