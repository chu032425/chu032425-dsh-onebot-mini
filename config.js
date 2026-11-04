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
  allowGroups: [],
  workspacePath: '',
  agentPreset: '',
  senderPrefix: true,
  sessionPrefix: 'onebot',
  sessionPermission: '',
  sessionMode: 'normal',
  titleEqualsId: true,
  logCapacity: 500,
  logMessagePreview: true,
  logToFile: true,
  sendTimeoutMs: 30000,
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
  allowGroups: 'stringList',
  workspacePath: 'workspace',
  agentPreset: 'agentPreset',
  senderPrefix: 'boolean',
  sessionPrefix: 'string',
  sessionPermission: 'permission',
  sessionMode: 'sessionMode',
  titleEqualsId: 'boolean',
  logCapacity: 'number',
  logMessagePreview: 'boolean',
  logToFile: 'boolean',
  sendTimeoutMs: 'number',
})

/** Field order and grouping for the config page. */
export const FIELD_GROUPS = Object.freeze([
  { id: 'connection', fields: ['mode', 'host', 'port', 'url', 'accessToken', 'botQQ'] },
  { id: 'access', fields: ['requireMention', 'allowFrom', 'allowGroups'] },
  { id: 'session', fields: ['sessionPrefix', 'titleEqualsId', 'workspacePath', 'agentPreset', 'sessionPermission', 'sessionMode', 'senderPrefix'] },
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
  if (kind === 'sessionMode') return raw === 'plan' ? 'plan' : 'normal'
  if (kind === 'permission') return String(raw)
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
  value.logCapacity = Math.trunc(value.logCapacity)
  if (value.logCapacity < 50 || value.logCapacity > 5000) {
    problems.push('logCapacity must be 50-5000')
    value.logCapacity = DEFAULTS.logCapacity
  }
  // The session prefix becomes part of a filesystem-backed session id, so it is
  // flattened to the same safe alphabet the chat body already uses. A value that
  // flattens to nothing usable (CJK only, punctuation only) falls back to the
  // default instead of producing a dangling '-' prefix, and says so.
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
    }
  }
}
