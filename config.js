/**
 * The plugin's own configuration store.
 *
 * Deliberately not a Loader `config:` block. Two reasons:
 *
 *  1. A save must reconnect the WebSocket, not restart the plugin fiber — a
 *     fiber restart tears down in-flight turns and every chat's agent mapping.
 *  2. No dependency on a schema library, so the package installs identically
 *     from a git URL and as a `link:` to a local checkout.
 *
 * The file lives beside the profile that mounted the plugin, so several
 * profiles on one machine keep independent settings. Writes are atomic
 * (temp file + rename) and a corrupt file degrades to defaults instead of
 * failing the mount.
 */

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { TOOL_GROUPS, isKnownAction } from './toolcatalog.js'
import { DEFAULT_CHANNEL_PROMPT, LEGACY_CHANNEL_PROMPT, LEGACY_CHANNEL_PROMPT_V2, DEFAULT_REPLY_MODE_STREAM_PROMPT, DEFAULT_REPLY_MODE_FINAL_PROMPT, DEFAULT_ADMIN_PROMPT, DEFAULT_SENDER_PREFIX_PROMPT, DEFAULT_MEDIA_PROMPT, DEFAULT_TOOLS_PROMPT, DEFAULT_TOOL_CALL_PROMPT, DEFAULT_TOOL_MEDIA_PROMPT, DEFAULT_INTERJECT_PROMPT, DEFAULT_INBOUND_PROMPT, PROMPT_DEFS } from './prompt.js'

/** The DSH home, honoring `$DSH_HOME` then `~/.dsh`. */
export function dshHome() {
  const env = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  return env !== '' ? env : join(homedir(), '.dsh')
}

/**
 * The file this plugin persists its settings in.
 *
 * The profile name comes from `$DSH_PROFILE` (set by every profile-launched
 * Harness shell); without it the `web` profile is assumed, which is the one the
 * Web GUI runs.
 */
export function configPath() {
  const profile = typeof process.env.DSH_PROFILE === 'string' && process.env.DSH_PROFILE.trim() !== ''
    ? process.env.DSH_PROFILE.trim()
    : 'web'
  return join(dshHome(), 'profiles', profile, 'onebot-mini.json')
}

/** Where the JSONL log sink writes, beside the config file. */
export function logPath() {
  return configPath().replace(/onebot-mini\.json$/, 'onebot-mini.log.jsonl')
}

/** Every accepted field with its default. Single source of truth. */
export const DEFAULTS = Object.freeze({
  mode: 'reverse',
  host: '127.0.0.1',
  port: 8643,
  url: 'ws://127.0.0.1:3001',
  accessToken: '',
  botQQ: '',
  requireMention: true,
  allowFrom: [],
  denyFrom: [],
  allowGroups: [],
  denyGroups: [],
  // The one account treated as the bot's administrator: a QQ number picked from
  // the friend list on the Access page. Empty means no administrator is set.
  adminUserId: '',
  workspacePath: '',
  agentPreset: '',
  senderPrefix: true,
  sessionPrefix: 'onebot',
  sessionPermission: '',
  agentModel: '',
  // Pre-reply context compaction: when the last measured pressure (used tokens /
  // context window) reaches this ratio, compact the session before delivering the
  // new message. 0 disables the pre-reply check (the harness's own auto-compaction
  // still runs); values above 1 are read as a percentage (80 → 0.8).
  compactRatio: 0.8,
  onebotToolEnabled: true,
  onebotToolDisabled: [],
  // Per-action prompt overrides for the Tools page, keyed by action name. Only
  // actions an operator actually edited are stored; a missing or blank entry
  // means "use the built-in prompt from actiondocs.js". Kept out of the Settings
  // page on purpose: it is edited from the Tools page.
  actionPrompts: {},
  titleEqualsId: true,
  logCapacity: 500,
  logMessagePreview: true,
  logToFile: true,
  sendTimeoutMs: 30000,
  // One reply-behaviour switch: may a message interrupt a running answer?
  // Messages never wait for a quiet window any more.
  privateAutoInterject: true,
  // How the assistant's answer reaches the chat:
  //  - stream (default): send each assistant message the moment it appears;
  //  - final: buffer every text block and send one QQ message when the turn ends
  //    (a multi-step turn does not spam the chat).
  replyMode: 'stream',
  // Legacy keys kept only so an older config file still loads.
  debounceMs: 0,
  debounceMaxMs: 0,
  autoInterject: true,
  deleteSentMedia: true,
  // Incoming media: download image/voice/video/file segments to a local inbox so
  // the model can actually read them, and cap one file's size.
  inboundMedia: true,
  inboundMediaMaxMb: 20,
  // Delete the downloaded incoming file once the turn that parsed it has ended,
  // the mirror of `deleteSentMedia` for outgoing media.
  deleteInboundMedia: true,
  channelPrompt: DEFAULT_CHANNEL_PROMPT,
  replyModeStreamPrompt: DEFAULT_REPLY_MODE_STREAM_PROMPT,
  replyModeFinalPrompt: DEFAULT_REPLY_MODE_FINAL_PROMPT,
  adminPrompt: DEFAULT_ADMIN_PROMPT,
  senderPrefixPrompt: DEFAULT_SENDER_PREFIX_PROMPT,
  mediaPrompt: DEFAULT_MEDIA_PROMPT,
  toolsPrompt: DEFAULT_TOOLS_PROMPT,
  inboundPrompt: DEFAULT_INBOUND_PROMPT,
  toolCallPrompt: DEFAULT_TOOL_CALL_PROMPT,
  toolMediaPrompt: DEFAULT_TOOL_MEDIA_PROMPT,
  interjectPrompt: DEFAULT_INTERJECT_PROMPT,
  imageCacheMaxKb: 1024,
  imageCacheTotalMb: 100,
  imageShowMaxMb: 32,
})

/** Field kinds the config page renders. */
export const FIELD_KINDS = Object.freeze({
  mode: 'enum',
  host: 'string',
  port: 'number',
  url: 'string',
  accessToken: 'secret',
  botQQ: 'string',
  requireMention: 'boolean',
  allowFrom: 'stringList',
  denyFrom: 'stringList',
  allowGroups: 'stringList',
  denyGroups: 'stringList',
  adminUserId: 'string',
  workspacePath: 'workspace',
  agentPreset: 'agentPreset',
  senderPrefix: 'boolean',
  sessionPrefix: 'string',
  sessionPermission: 'permission',
  agentModel: 'model',
  compactRatio: 'number',
  onebotToolEnabled: 'boolean',
  onebotToolDisabled: 'stringList',
  actionPrompts: 'actionMap',
  titleEqualsId: 'boolean',
  logCapacity: 'number',
  logMessagePreview: 'boolean',
  logToFile: 'boolean',
  sendTimeoutMs: 'number',
  deleteSentMedia: 'boolean',
  inboundMedia: 'boolean',
  inboundMediaMaxMb: 'number',
  deleteInboundMedia: 'boolean',
  channelPrompt: 'text',
  replyModeStreamPrompt: 'text',
  replyModeFinalPrompt: 'text',
  adminPrompt: 'text',
  senderPrefixPrompt: 'text',
  mediaPrompt: 'text',
  toolsPrompt: 'text',
  inboundPrompt: 'text',
  toolCallPrompt: 'text',
  toolMediaPrompt: 'text',
  interjectPrompt: 'text',
  privateAutoInterject: 'boolean',
  replyMode: 'replyMode',
  debounceMs: 'number',
  debounceMaxMs: 'number',
  autoInterject: 'boolean',
  imageCacheMaxKb: 'number',
  imageCacheTotalMb: 'number',
  imageShowMaxMb: 'number',
})

/** Field order and grouping for the config page. */
export const FIELD_GROUPS = Object.freeze([
  { id: 'connection', fields: ['mode', 'host', 'port', 'url', 'accessToken', 'botQQ'] },
  { id: 'access', fields: ['requireMention'] },
  { id: 'session', fields: ['sessionPrefix', 'titleEqualsId', 'workspacePath', 'agentPreset', 'agentModel', 'sessionPermission', 'compactRatio', 'senderPrefix'] },
  { id: 'media', fields: ['inboundMedia', 'inboundMediaMaxMb', 'deleteInboundMedia', 'deleteSentMedia'] },
  { id: 'reply', fields: ['replyMode', 'privateAutoInterject'] },
  { id: 'qzone', fields: ['imageShowMaxMb', 'imageCacheMaxKb', 'imageCacheTotalMb'] },
  { id: 'diagnostics', fields: ['logCapacity', 'logMessagePreview', 'logToFile', 'sendTimeoutMs'] },
])

/**
 * Fields that only apply to one connection mode.
 *
 * The config page hides a field whose mode is not the current one, so a reverse
 * setup never shows a "gateway URL" box it ignores and a forward setup never
 * shows a "listen address/port" it never binds.
 */
export const MODE_FIELDS = Object.freeze({
  host: 'reverse',
  port: 'reverse',
  url: 'forward',
})

/** Fields that must never leave the Host in the clear. */
const SECRET_FIELDS = new Set(['accessToken'])

/**
 * Coerce one raw value to its declared kind, falling back to the default.
 * @param field - field name.
 * @param raw - candidate value.
 * @returns the coerced value.
 */
function coerce(field, raw) {
  const kind = FIELD_KINDS[field]
  const fallback = DEFAULTS[field]
  if (raw === undefined || raw === null) return fallback
  if (kind === 'boolean') return typeof raw === 'boolean' ? raw : fallback
  if (kind === 'number') {
    const num = Number(raw)
    return Number.isFinite(num) ? num : fallback
  }
  if (kind === 'stringList') {
    if (!Array.isArray(raw)) return fallback
    return raw.map((item) => String(item).trim()).filter((item) => item !== '')
  }
  if (kind === 'enum') return raw === 'reverse' || raw === 'forward' ? raw : fallback
  if (kind === 'replyMode') return raw === 'stream' || raw === 'final' ? raw : fallback
  if (kind === 'permission') return String(raw)
  if (kind === 'model') return String(raw)
  if (kind === 'actionMap') {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return fallback
    const out = {}
    for (const [name, text] of Object.entries(raw)) {
      if (!isKnownAction(name)) continue
      if (typeof text !== 'string') continue
      if (text.trim() === '') continue
      out[name] = text
    }
    return out
  }
  return String(raw)
}

/**
 * Validate one complete candidate config.
 * @param raw - an object, possibly partial or hostile.
 * @returns `{ value, problems }`; `value` is always complete.
 */
export function normalizeConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const value = {}
  const problems = []
  for (const field of Object.keys(DEFAULTS)) {
    value[field] = coerce(field, source[field])
  }

  value.port = Math.trunc(value.port)
  if (value.port < 1 || value.port > 65535) {
    problems.push('port must be 1-65535')
    value.port = DEFAULTS.port
  }
  value.sendTimeoutMs = Math.trunc(value.sendTimeoutMs)
  if (value.sendTimeoutMs < 1000 || value.sendTimeoutMs > 600000) {
    problems.push('sendTimeoutMs must be 1000-600000')
    value.sendTimeoutMs = DEFAULTS.sendTimeoutMs
  }
  // Context-compaction ratio: accept 0-1, or a percentage 1-100 (80 → 0.8).
  // 0 disables the pre-reply check.
  let compactRatio = Number(value.compactRatio)
  if (compactRatio > 1 && compactRatio <= 100) compactRatio = compactRatio / 100
  if (!Number.isFinite(compactRatio) || compactRatio < 0 || compactRatio > 1) {
    problems.push('compactRatio must be 0-1 (0 disables, or a percentage up to 100)')
    compactRatio = DEFAULTS.compactRatio
  }
  value.compactRatio = Math.round(compactRatio * 1000) / 1000
  value.imageCacheMaxKb = Math.trunc(value.imageCacheMaxKb)
  if (value.imageCacheMaxKb < 64 || value.imageCacheMaxKb > 20480) {
    problems.push('imageCacheMaxKb must be 64-20480')
    value.imageCacheMaxKb = DEFAULTS.imageCacheMaxKb
  }
  value.imageCacheTotalMb = Math.trunc(value.imageCacheTotalMb)
  if (value.imageCacheTotalMb < 8 || value.imageCacheTotalMb > 4096) {
    problems.push('imageCacheTotalMb must be 8-4096')
    value.imageCacheTotalMb = DEFAULTS.imageCacheTotalMb
  }
  value.imageShowMaxMb = Math.trunc(value.imageShowMaxMb)
  if (value.imageShowMaxMb < 1 || value.imageShowMaxMb > 512) {
    problems.push('imageShowMaxMb must be 1-512')
    value.imageShowMaxMb = DEFAULTS.imageShowMaxMb
  }
  value.inboundMediaMaxMb = Math.trunc(value.inboundMediaMaxMb)
  if (value.inboundMediaMaxMb < 1 || value.inboundMediaMaxMb > 512) {
    problems.push('inboundMediaMaxMb must be 1-512')
    value.inboundMediaMaxMb = DEFAULTS.inboundMediaMaxMb
  }
  value.logCapacity = Math.trunc(value.logCapacity)
  if (value.logCapacity < 50 || value.logCapacity > 5000) {
    problems.push('logCapacity must be 50-5000')
    value.logCapacity = DEFAULTS.logCapacity
  }
  // The tool allowlist is stored as the set of *disabled* actions, so an action
  // added to the catalog by a later release is on by default for existing
  // installs. Unknown names and duplicates are dropped so a hand-edited file
  // cannot smuggle junk into the config.
  const rawDisabled = Array.isArray(value.onebotToolDisabled) ? value.onebotToolDisabled : []
  value.onebotToolDisabled = [...new Set(rawDisabled.filter((action) => isKnownAction(action)))]

  // The administrator is one QQ number: trim it and drop anything non-numeric so
  // a stray space or a pasted nickname cannot become a bogus id.
  const rawAdmin = String(value.adminUserId ?? '').trim()
  value.adminUserId = /^\d*$/.test(rawAdmin) ? rawAdmin : ''

  // The session prefix becomes part of a filesystem-backed session id, so it is
  // flattened to the same safe alphabet the chat body already uses. A value that
  // flattens to nothing usable (CJK only, punctuation only) falls back to the
  // default instead of producing a dangling '-' prefix, and says so.

  // An emptied prompt would leave the model with no guidance, so a blank value
  // silently returns to the shipped default. Driven by the same registry the
  // Prompt page renders, so a newly registered prompt gets the same treatment.
  for (const def of PROMPT_DEFS) {
    if (String(value[def.field] ?? '').trim() === '') value[def.field] = DEFAULTS[def.field]
  }

  // A channel prompt still equal to an old shipped default is upgraded to the
  // current one: v1 hardcoded the reply sentence, v2 had `{replyMode}` but no
  // `{admin}`. An operator's edited prompt is never touched.
  if (value.channelPrompt === LEGACY_CHANNEL_PROMPT || value.channelPrompt === LEGACY_CHANNEL_PROMPT_V2) {
    value.channelPrompt = DEFAULT_CHANNEL_PROMPT
  }

  const rawPrefix = String(value.sessionPrefix ?? '').trim()
  if (/^[a-z][a-z0-9-]*$/.test(rawPrefix)) {
    value.sessionPrefix = rawPrefix
  } else {
    // Reject rather than salvage: silently turning "我的QQ" into "QQ" would hide
    // that the prefix never took effect. Lowercase-only keeps session ids
    // predictable to type in URLs and searches.
    if (rawPrefix !== '') {
      problems.push('sessionPrefix must start with a lowercase letter and contain only lowercase letters, digits and hyphens; using "' + DEFAULTS.sessionPrefix + '"')
    }
    value.sessionPrefix = DEFAULTS.sessionPrefix
  }

  if (String(value.sessionPermission ?? '').trim() === '') {
    problems.push('sessionPermission is required: pick a permission preset for the chat Sessions')
  }

  if (String(value.workspacePath ?? '').trim() === '') {
    problems.push('workspacePath is required: pick a workspace for the chat Sessions')
  }

  if (value.mode === 'reverse' && value.accessToken.trim() === '') {
    problems.push('reverse mode requires accessToken (leave it empty only for forward mode)')
  }
  if (value.mode === 'forward' && !/^ws{1,2}:\/\//.test(value.url)) {
    problems.push('url must start with ws:// or wss://')
  }

  return { value, problems }
}

/**
 * The durable config store for one profile.
 *
 * `read()` is synchronous on purpose: the plugin mount needs the settings
 * before it can build the connection, and a 4 KiB JSON file is cheap.
 */
export class ConfigStore {
  /**
   * @param path - absolute path of the JSON file.
   */
  constructor(path) {
    this.path = path
    this.cache = undefined
  }

  /**
   * Read the effective config, caching after the first successful read.
   * @returns the complete config object.
   */
  read() {
    if (this.cache !== undefined) return this.cache
    let raw
    try {
      raw = existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : {}
    } catch {
      raw = {}
    }
    const { value } = normalizeConfig(raw)
    this.cache = value
    return value
  }

  /**
   * Merge a patch into the stored config and persist it.
   * @param patch - partial candidate fields.
   * @returns `{ ok, problems, value }`; `value` is the new effective config.
   */
  async write(patch) {
    const current = this.read()
    const candidate = { ...current, ...(patch !== null && typeof patch === 'object' ? patch : {}) }
    const { value, problems } = normalizeConfig(candidate)
    if (problems.length > 0) return { ok: false, problems, value: current }
    await mkdir(dirname(this.path), { recursive: true })
    const temp = this.path + '.tmp'
    await writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8')
    await rename(temp, this.path)
    this.cache = value
    return { ok: true, problems: [], value }
  }

  /**
   * The config as the browser sees it.
   *
   * The access token is returned in full: this page is the only place the token
   * is edited, an operator debugging a gateway mismatch needs to compare the
   * exact string, and the request is already authenticated by the Host's own
   * browser session. `secretFields` still tells the page which inputs to render
   * as password-style controls.
   * @returns `{ config, secretFields, groups, kinds, defaults }`.
   */
  snapshot() {
    const value = this.read()
    return {
      config: { ...value },
      secretFields: [...SECRET_FIELDS],
      groups: FIELD_GROUPS,
      kinds: FIELD_KINDS,
      defaults: DEFAULTS,
      modeFields: MODE_FIELDS,
      toolCatalog: TOOL_GROUPS,
    }
  }
}
