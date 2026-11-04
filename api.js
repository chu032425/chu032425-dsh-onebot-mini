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
import { TOOL_GROUPS } from './toolcatalog.js'

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
 * @param deps - `store`, `log`, `getConnection`, `applyConfig`, and the catalog
 *   providers for the pickers.
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
        toolCatalog: TOOL_GROUPS,
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
        toolCatalog: TOOL_GROUPS,
        workspaces: typeof listWorkspaces === 'function' ? listWorkspaces() : { available: false, workspaces: [] },
        agentPresets: typeof listAgentPresets === 'function' ? await listAgentPresets() : { available: false, presets: [] },
        permissionPresets: typeof listPermissionPresets === 'function' ? listPermissionPresets() : { available: false, options: [], defaultPreset: '' },
        models: typeof listModels === 'function' ? await listModels() : { available: false, models: [], defaultModel: '' },
      })
    },
  })

  /**
   * The bot's own contact lists, for the Contacts page.
   *
   * Read live from the gateway on every request rather than cached: a friend
   * added in QQ should show up on the next refresh, and the lists are small.
   * A single failing action reports that section as unavailable instead of
   * failing the whole page, so one unsupported action on an older gateway
   * still leaves the other list usable.
   */
  const disposeContacts = ctx.webServer.register({
    kind: 'exact',
    path: API_PREFIX + '/contacts',
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
      const connection = getConnection()
      if (connection === undefined || connection.state !== 'online') {
        sendJson(res, 200, {
          ok: false,
          state: connection?.state ?? 'offline',
          selfId: connection?.selfId ?? '',
          friends: { available: false, error: 'not connected', items: [] },
          groups: { available: false, error: 'not connected', items: [] },
        })
        return
      }

      /**
       * Run one list action and normalize it.
       * @param action - the OneBot action name.
       * @returns `{ available, items, error }`.
       */
      const fetchList = async (action) => {
        try {
          const data = await connection.call(action, {})
          // OneBot 11 returns a bare array; some gateways wrap it in `{ list }`.
          const items = Array.isArray(data) ? data : (Array.isArray(data?.list) ? data.list : [])
          return { available: true, error: '', items }
        } catch (error) {
          return { available: false, error: String(error?.message ?? error), items: [] }
        }
      }

      const [friends, groups] = await Promise.all([fetchList('get_friend_list'), fetchList('get_group_list')])
      sendJson(res, 200, {
        ok: friends.available || groups.available,
        state: connection.state,
        selfId: connection.selfId,
        friends: {
          available: friends.available,
          error: friends.error,
          items: friends.items.map((item) => {
            // A gateway may report an empty or whitespace-only remark (some
            // clients send a full-width space), which means "no remark" rather
            // than an empty name, so the nickname is used in that case.
            const remark = String(item?.remark ?? '').trim()
            const nickname = String(item?.nickname ?? '').trim()
            return {
              id: String(item?.user_id ?? ''),
              name: remark !== '' ? remark : nickname,
              nickname,
              remark,
            }
          }).filter((item) => item.id !== ''),
        },
        groups: {
          available: groups.available,
          error: groups.error,
          items: groups.items.map((item) => ({
            id: String(item?.group_id ?? ''),
            name: String(item?.group_name ?? ''),
            memberCount: Number(item?.member_count ?? 0),
            maxMemberCount: Number(item?.max_member_count ?? 0),
          })).filter((item) => item.id !== ''),
        },
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
    disposeContacts()
    disposeClear()
  }
}
