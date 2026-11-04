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

  /**
   * One group's member list, for the expandable group rows.
   *
   * `group_id` comes from the query string. A gateway that refuses the action
   * reports `available: false` with the reason, so the row can show that instead
   * of pretending the group is empty.
   */
  const disposeMembers = ctx.webServer.register({
    kind: 'exact',
    path: API_PREFIX + '/members',
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
      const groupId = String(url.searchParams.get('group_id') ?? '').trim()
      if (groupId === '') {
        sendJson(res, 400, { error: 'group_id is required' })
        return
      }
      const connection = getConnection()
      if (connection === undefined || connection.state !== 'online') {
        sendJson(res, 200, { available: false, error: 'not connected', groupId, items: [] })
        return
      }
      try {
        const data = await connection.call('get_group_member_list', { group_id: Number(groupId) })
        const list = Array.isArray(data) ? data : (Array.isArray(data?.list) ? data.list : [])
        sendJson(res, 200, {
          available: true,
          error: '',
          groupId,
          items: list.map((item) => ({
            id: String(item?.user_id ?? ''),
            name: String(item?.card ?? '').trim() !== '' ? String(item.card).trim() : String(item?.nickname ?? '').trim(),
            nickname: String(item?.nickname ?? '').trim(),
            card: String(item?.card ?? '').trim(),
            role: String(item?.role ?? 'member'),
          })).filter((item) => item.id !== ''),
        })
      } catch (error) {
        sendJson(res, 200, { available: false, error: String(error?.message ?? error), groupId, items: [] })
      }
    },
  })

  /**
   * One friend's live profile: status plus a best-effort detail lookup.
   *
   * `get_friend_msg_history` and presence are not part of OneBot 11, so the
   * status is assembled from what a gateway reliably offers: online state
   * (via `get_status`), the account's own info (`get_stranger_info`) and
   * whether the user is reachable. Every field is optional and missing data
   * reports as an empty string rather than failing the request.
   */
  const disposeFriend = ctx.webServer.register({
    kind: 'exact',
    path: API_PREFIX + '/friend',
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
      const userId = String(url.searchParams.get('user_id') ?? '').trim()
      if (userId === '') {
        sendJson(res, 400, { error: 'user_id is required' })
        return
      }
      const connection = getConnection()
      if (connection === undefined || connection.state !== 'online') {
        sendJson(res, 200, { available: false, error: 'not connected', userId })
        return
      }
      /**
       * Run one optional lookup.
       * @param action - the OneBot action.
       * @param params - its params.
       * @returns the data, or undefined when the gateway refused it.
       */
      const optional = async (action, params) => {
        try {
          return await connection.call(action, params)
        } catch {
          return undefined
        }
      }
      const [info, status] = await Promise.all([
        optional('get_stranger_info', { user_id: Number(userId), no_cache: true }),
        optional('get_status', {}),
      ])
      sendJson(res, 200, {
        available: info !== undefined || status !== undefined,
        error: '',
        userId,
        nickname: String(info?.nickname ?? '').trim(),
        remark: String(info?.remark ?? '').trim(),
        sex: String(info?.sex ?? ''),
        age: Number(info?.age ?? 0),
        qid: String(info?.qid ?? ''),
        level: Number(info?.level ?? 0),
        online: status?.online === true,
        good: status?.good === true,
        botOnline: status?.online === true,
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
    disposeMembers()
    disposeFriend()
    disposeClear()
  }
}
