/**
 * The two browser-facing JSON routes.
 *
 * Same-origin fetch from the plugin's own page, authenticated with the host's
 * standard `connection.requestRejection` check — identical to what the other
 * workspace plugins do, and no Typert Remote boilerplate.
 *
 *   GET  /onebot-mini/api/state?after=<seq>&limit=<n>
 *        → { status, logs: { entries, nextSeq, oldestSeq }, config }
 *   POST /onebot-mini/api/config    body: { patch: {...} }
 *        → { ok, problems, config, secretFields, groups, kinds, defaults }
 *   POST /onebot-mini/api/logs/clear
 *        → { ok: true }
 */

import { DEFAULTS, FIELD_GROUPS, FIELD_KINDS, MODE_FIELDS } from './config.js'

/** Route path prefix. */
export const API_PREFIX = '/onebot-mini/api'

/** Body ceiling for a config write (this is settings, not a document). */
const MAX_BODY_BYTES = 64 * 1024

/**
 * Write a JSON response.
 * @param res - the server response.
 * @param status - HTTP status.
 * @param payload - JSON-serializable body.
 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

/**
 * Read a bounded JSON request body.
 * @param req - the incoming request.
 * @returns the parsed body.
 */
async function readJsonBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) throw new Error('body too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  return JSON.parse(text)
}

/**
 * Register the plugin's routes.
 * @param ctx - the plugin context (needs `webServer` and `connection`).
 * @param deps - `store`, `log`, `getConnection`, `applyConfig`.
 * @returns the disposer.
 */
export function registerRoutes(ctx, { store, log, getConnection, applyConfig, listWorkspaces, listAgentPresets, listPermissionPresets, listModels }) {
  const disposeState = ctx.webServer.register({
    kind: 'exact',
    path: API_PREFIX + '/state',
    handler: async (req, res) => {
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) {
        res.statusCode = rejection
        res.end()
        return
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      const url = new URL(String(req.url ?? '/'), 'http://localhost')
      const after = Number(url.searchParams.get('after') ?? '0')
      const limit = Number(url.searchParams.get('limit') ?? '200')
      const connection = getConnection()
      const snapshot = store.snapshot()
      sendJson(res, 200, {
        status: connection === undefined
          ? { state: 'offline', mode: snapshot.config.mode, address: '', selfId: '', onlineSince: 0, pendingActions: 0, reconnectAttempt: 0 }
          : connection.status(),
        logs: log.snapshot(after, limit),
        config: snapshot.config,
        secretFields: snapshot.secretFields,
        groups: FIELD_GROUPS,
        kinds: FIELD_KINDS,
        defaults: DEFAULTS,
        modeFields: MODE_FIELDS,
        workspaces: typeof listWorkspaces === 'function' ? listWorkspaces() : { available: false, workspaces: [] },
        agentPresets: typeof listAgentPresets === 'function' ? await listAgentPresets() : { available: false, presets: [] },
        permissionPresets: typeof listPermissionPresets === 'function' ? listPermissionPresets() : { available: false, options: [], defaultPreset: '' },
        models: typeof listModels === 'function' ? await listModels() : { available: false, models: [], defaultModel: '' },
      })
    },
  })

  const disposeConfig = ctx.webServer.register({
    kind: 'exact',
    path: API_PREFIX + '/config',
    handler: async (req, res) => {
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) {
        res.statusCode = rejection
        res.end()
        return
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      let body
      try {
        body = await readJsonBody(req)
      } catch (error) {
        sendJson(res, 400, { error: String(error?.message ?? error) })
        return
      }
      const patch = body !== null && typeof body === 'object' && body.patch !== null && typeof body.patch === 'object'
        ? body.patch
        : {}
      let result
      try {
        result = await store.write(patch)
      } catch (error) {
        sendJson(res, 500, { error: String(error?.message ?? error) })
        return
      }
      if (!result.ok) {
        sendJson(res, 400, { ok: false, problems: result.problems })
        return
      }
      try {
        await applyConfig(result.value)
      } catch (error) {
        log.record('error', { note: 'applying new config failed', error: String(error?.message ?? error) })
        sendJson(res, 500, { ok: false, problems: ['applied settings but reconnecting failed: ' + String(error?.message ?? error)] })
        return
      }
      log.record('bridge', { note: 'config saved; transport restarted' })
      const snapshot = store.snapshot()
      sendJson(res, 200, {
        ok: true,
        problems: [],
        config: snapshot.config,
        secretFields: snapshot.secretFields,
        groups: FIELD_GROUPS,
        kinds: FIELD_KINDS,
        defaults: DEFAULTS,
        modeFields: MODE_FIELDS,
        workspaces: typeof listWorkspaces === 'function' ? listWorkspaces() : { available: false, workspaces: [] },
        agentPresets: typeof listAgentPresets === 'function' ? await listAgentPresets() : { available: false, presets: [] },
        permissionPresets: typeof listPermissionPresets === 'function' ? listPermissionPresets() : { available: false, options: [], defaultPreset: '' },
        models: typeof listModels === 'function' ? await listModels() : { available: false, models: [], defaultModel: '' },
      })
    },
  })

  const disposeClear = ctx.webServer.register({
    kind: 'exact',
    path: API_PREFIX + '/logs/clear',
    handler: async (req, res) => {
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) {
        res.statusCode = rejection
        res.end()
        return
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      log.clear()
      sendJson(res, 200, { ok: true })
    },
  })

  return () => {
    disposeState()
    disposeConfig()
    disposeClear()
  }
}
