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
import { fetchIntoCache, isAllowedImageUrl, readCached } from './imagecache.js'
import { sendMedia, MEDIA_KINDS } from './media.js'
import { inventory, clearCache } from './cacheinfo.js'

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
      // `nc_get_user_status` is NapCat's own extension and is the only action
      // that reports a contact's presence; `get_status` reports the bot itself.
      // `status` is a numeric code (10 = online) and `ext_status` refines it.
      const [info, userStatus, botStatus] = await Promise.all([
        optional('get_stranger_info', { user_id: Number(userId), no_cache: true }),
        optional('nc_get_user_status', { user_id: String(userId) }),
        optional('get_status', {}),
      ])
      const statusCode = userStatus === undefined ? undefined : Number(userStatus?.status ?? NaN)
      sendJson(res, 200, {
        available: info !== undefined || userStatus !== undefined || botStatus !== undefined,
        error: '',
        userId,
        nickname: String(info?.nickname ?? '').trim(),
        remark: String(info?.remark ?? '').trim(),
        sex: String(info?.sex ?? ''),
        age: Number(info?.age ?? 0),
        qid: String(info?.qid ?? ''),
        level: Number(info?.level ?? 0),
        // `status` stays undefined when the gateway has no such action, which the
        // page shows as "unknown" instead of guessing.
        status: Number.isFinite(statusCode) ? statusCode : undefined,
        extStatus: userStatus === undefined ? undefined : Number(userStatus?.ext_status ?? 0),
        online: Number.isFinite(statusCode) ? statusCode === 10 : undefined,
        botOnline: botStatus?.online === true,
        good: botStatus?.good === true,
      })
    },
  })

  /**
   * The Qzone page's data: profile, own posts, friend feed.
   *
   * Three independent reads behind one route so the page needs a single request.
   * Each section reports its own failure, because Qzone actions are the most
   * gateway-dependent ones and one of them being unsupported must not blank the
   * whole page.
   *
   * `what` selects a subset: `profile`, `list`, `feeds`, or `all` (default).
   * `target_uin` and `pos`/`num` pass through to the gateway.
   */
  const disposeQzone = ctx.webServer.register({
    kind: 'exact',
    path: API_PREFIX + '/qzone',
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
      const what = String(url.searchParams.get('what') ?? 'all')
      const targetUin = String(url.searchParams.get('target_uin') ?? '').trim()
      // A Qzone page is mostly text but each post can carry images, and the
      // gateway answers one action per page load. Keeping the page small is what
      // keeps the panel responsive: 10 by default, 20 at the hard ceiling.
      const num = Math.min(20, Math.max(1, Number(url.searchParams.get('num') ?? 10) || 10))
      const pos = Math.max(0, Number(url.searchParams.get('pos') ?? 0) || 0)
      const connection = getConnection()
      const offline = { available: false, error: 'not connected' }
      if (connection === undefined || connection.state !== 'online') {
        sendJson(res, 200, { state: 'offline', profile: offline, posts: offline, feeds: offline })
        return
      }

      /**
       * Run one optional Qzone read.
       * @param action - the action name.
       * @param params - its params.
       * @returns `{ available, error, data }`.
       */
      /**
       * Turn a Qzone failure into a code the page can explain.
       *
       * Tencent answers a forbidden Qzone read with its own negative codes, not
       * an OneBot retcode: -4009 and -10031 mean "you may not read this space"
       * (the owner restricted it, or the account is not a friend / needs
       * verification). Anything else keeps its raw message so a genuinely odd
       * gateway stays diagnosable.
       * @param error - the thrown error.
       * @returns `{ code, message }`.
       */
      const classify = (error) => {
        const raw = String(error?.message ?? error)
        const match = /code=(-?\d+)/.exec(raw)
        const code = match === null ? '' : match[1]
        if (code === '-4009' || code === '-10031') {
          return { code, message: 'forbidden' }
        }
        return { code, message: raw }
      }

      const read = async (action, params) => {
        try {
          return { available: true, error: '', errorCode: '', data: await connection.call(action, params) }
        } catch (error) {
          const info = classify(error)
          return { available: false, error: info.message, errorCode: info.code, data: undefined }
        }
      }

      const want = (name) => what === 'all' || what === name
      const [profile, posts, feeds] = await Promise.all([
        want('profile') ? read('get_qzone_profile', targetUin === '' ? {} : { target_uin: targetUin }) : Promise.resolve(undefined),
        want('list')
          ? read('get_qzone_msg_list', targetUin === '' ? { pos, num } : { target_uin: targetUin, pos, num })
          : Promise.resolve(undefined),
        want('feeds') ? read('get_qzone_feeds', { page_num: 1, count: num }) : Promise.resolve(undefined),
      ])

      /**
       * Normalize one post.
       *
       * The gateway may answer in SnowLuma shape (`{ total, msglist }`) or in
       * the native H5 shape; both are flattened to the same fields here, with
       * unknown values left null rather than invented.
       * @param item - one raw post.
       */
      // Own posts carry no author id, so the account being read is remembered as
      // `ownerUin`; the image proxy needs it to pick a cache folder.
      const selfUin = targetUin !== '' ? targetUin : String(connection.selfId ?? '')
      const post = (item) => ({
        tid: item?.tid === undefined || item?.tid === null ? '' : String(item.tid),
        ownerUin: selfUin,
        content: String(item?.content ?? '').replace(/\s+/g, ' ').trim(),
        time: Number(item?.time ?? 0) || 0,
        commentCount: Number(item?.comment_num ?? item?.commentCount ?? 0) || 0,
        likeCount: Number(item?.like_count ?? item?.likeCount ?? 0) || 0,
        private: item?.is_private === true || item?.private === true,
        images: Array.isArray(item?.images) ? item.images.map((image) => String(image)).filter((image) => image !== '') : [],
        userId: item?.user_id === undefined || item?.user_id === null ? '' : String(item.user_id),
      })

      const listOf = (result) => {
        const data = result?.data
        const items = Array.isArray(data) ? data : (Array.isArray(data?.msglist) ? data.msglist : [])
        return {
          available: result?.available === true,
          error: result?.error ?? '',
          errorCode: result?.errorCode ?? '',
          total: Number(data?.total ?? 0) || 0,
          items: items.map(post),
        }
      }

      sendJson(res, 200, {
        state: connection.state,
        selfId: connection.selfId,
        profile: profile === undefined
          ? { available: false, error: 'not requested', name: '', description: '' }
          : {
            available: profile.available,
            error: profile.error,
            errorCode: profile.errorCode ?? '',
            name: String(profile.data?.name ?? ''),
            description: String(profile.data?.description ?? ''),
          },
        posts: posts === undefined ? { available: false, error: 'not requested', errorCode: '', total: 0, items: [] } : listOf(posts),
        feeds: feeds === undefined ? { available: false, error: 'not requested', errorCode: '', total: 0, items: [] } : listOf(feeds),
      })
    },
  })

  /**
   * The profile page's data: one account's details, the bot's own by default.
   *
   * `user_id` picks the account; without it the bot's own profile is built from
   * `get_login_info` plus `get_stranger_info` on that id, which is the only way
   * to read fields like level, signature and VIP that `get_login_info` omits.
   *
   * Every field is optional. `get_stranger_info` is a Go-CQHTTP-era action that
   * some gateways answer with fewer fields, so a missing value stays empty
   * rather than failing the whole page.
   */
  const disposeProfile = ctx.webServer.register({
    kind: 'exact',
    path: API_PREFIX + '/profile',
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
      const requested = String(url.searchParams.get('user_id') ?? '').trim()
      const connection = getConnection()
      if (connection === undefined || connection.state !== 'online') {
        sendJson(res, 200, { available: false, error: 'not connected', state: 'offline', userId: requested })
        return
      }

      const optional = async (action, params) => {
        try {
          return await connection.call(action, params)
        } catch {
          return undefined
        }
      }

      const botId = String(connection.selfId ?? '')
      const userId = requested !== '' ? requested : botId
      if (userId === '') {
        sendJson(res, 200, { available: false, error: 'the bot account is not known yet', state: connection.state, userId: '' })
        return
      }

      // Only read the login info when this is the bot itself, or when the bot
      // id is still unknown: it is a cheap way to fill the nickname.
      const needLogin = requested === '' || botId === ''
      const isSelf = userId === botId
      // `nc_get_user_status` answers for other accounts, but on a live gateway it
      // reports the bot itself as not online; the bot's own presence comes from
      // `get_status` instead. Reading both and picking per case avoids showing a
      // connected bot as offline.
      const [login, stranger, userStatus, botStatus, like] = await Promise.all([
        needLogin ? optional('get_login_info', {}) : Promise.resolve(undefined),
        optional('get_stranger_info', { user_id: Number(userId), no_cache: true }),
        isSelf ? Promise.resolve(undefined) : optional('nc_get_user_status', { user_id: String(userId) }),
        isSelf ? optional('get_status', {}) : Promise.resolve(undefined),
        optional('get_profile_like', { user_id: String(userId), start: 0, count: 10 }),
      ])

      const statusCode = userStatus === undefined ? undefined : Number(userStatus?.status ?? NaN)
      const selfOnline = botStatus === undefined ? undefined : botStatus?.online === true
      sendJson(res, 200, {
        available: stranger !== undefined || login !== undefined,
        error: '',
        state: connection.state,
        selfId: botId,
        isSelf,
        userId,
        nickname: String(stranger?.nickname ?? login?.nickname ?? '').trim(),
        uid: String(stranger?.uid ?? ''),
        qid: String(stranger?.qid ?? '').trim(),
        remark: String(stranger?.remark ?? '').trim(),
        signature: String(stranger?.long_nick ?? '').trim(),
        sex: String(stranger?.sex ?? '').trim(),
        age: Number(stranger?.age ?? 0) || 0,
        level: Number(stranger?.qqLevel ?? stranger?.level ?? 0) || 0,
        loginDays: Number(stranger?.login_days ?? 0) || 0,
        regTime: Number(stranger?.reg_time ?? 0) || 0,
        vip: stranger?.is_vip === true,
        yearsVip: stranger?.is_years_vip === true,
        vipLevel: Number(stranger?.vip_level ?? 0) || 0,
        online: isSelf
          ? selfOnline
          : (Number.isFinite(statusCode) ? statusCode === 10 : undefined),
        // A like summary is a nicety, not the point of the page, so a gateway
        // that lacks it just leaves the count at zero.
        likeCount: Number(like?.total_count ?? like?.like_count ?? 0) || 0,
      })
    },
  })

  /**
   * Cached Qzone image bytes, proxied to the page as `<img src>`.
   *
   * The browser cannot load a Qzone image itself: the URL is signed and refers
   * the request to qzone.qq.com, which a plain `<img>` cannot set. Proxying it
   * here also means the image is fetched once and served from disk afterwards.
   *
   * `qq` selects the cache folder, `url` is the image source. Both are checked:
   * `qq` is reduced to digits by the cache module, and `url` must be on a known
   * image host, so a crafted post cannot probe the local network through us.
   */
  const disposeImage = ctx.webServer.register({
    kind: 'exact',
    path: API_PREFIX + '/image',
    handler: async (req, res) => {
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) {
        res.statusCode = rejection
        res.end()
        return
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      const url = new URL(String(req.url ?? '/'), 'http://localhost')
      const qq = String(url.searchParams.get('qq') ?? '').trim()
      const source = String(url.searchParams.get('url') ?? '')
      if (source === '' || !isAllowedImageUrl(source)) {
        sendJson(res, 400, { error: 'url is missing or not an allowed image host' })
        return
      }
      const config = store.read()
      const cached = await fetchIntoCache(qq, source, {
        maxKb: config.imageCacheMaxKb,
        totalMb: config.imageCacheTotalMb,
        maxStreamMb: config.imageShowMaxMb,
      })
      if (cached.ok !== true) {
        // An image over the cache cap is still shown once by streaming the bytes
        // held in `overflow`; only a genuinely oversized or failed fetch is an
        // error. `no-store` keeps the browser from re-fetching it from us.
        if (cached.overflow === true && cached.buffer !== undefined) {
          res.statusCode = 200
          res.setHeader('content-type', cached.contentType !== '' ? cached.contentType : 'image/jpeg')
          res.setHeader('cache-control', 'private, max-age=86400')
          res.setHeader('x-onebot-mini-cached', 'no')
          res.setHeader('content-length', String(cached.buffer.length))
          res.end(cached.buffer)
          return
        }
        sendJson(res, 502, { error: cached.reason ?? 'could not fetch the image' })
        return
      }
      const bytes = await readCached(cached.path)
      if (bytes === undefined) {
        sendJson(res, 502, { error: 'the cached image disappeared' })
        return
      }
      res.statusCode = 200
      res.setHeader('content-type', cached.contentType !== '' ? cached.contentType : 'image/jpeg')
      res.setHeader('cache-control', 'private, max-age=86400')
      res.setHeader('x-onebot-mini-cached', 'yes')
      res.setHeader('content-length', String(bytes.length))
      res.end(bytes)
    },
  })

  /**
   * Send one media segment to a chat.
   *
   * This is the operator-facing half of media sending: the browser posts a URL,
   * a base64 payload, or a path on this host, and the plugin relays it as a
   * OneBot media segment over the same WebSocket. A local path is read here and
   * inlined as base64, so the gateway never needs to see this host's filesystem.
   *
   * Body: `{ chatType, chatId, kind, url? | base64? | path?, name? }`.
   */
  const disposeSendMedia = ctx.webServer.register({
    kind: 'exact',
    path: API_PREFIX + '/send-media',
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
      const connection = getConnection()
      if (connection === undefined || connection.state !== 'online') {
        sendJson(res, 200, { ok: false, error: 'not connected' })
        return
      }
      const config = store.read()
      const result = await sendMedia(connection, {
        chatType: body?.chatType,
        chatId: body?.chatId,
        kind: body?.kind,
        url: body?.url,
        base64: body?.base64,
        path: body?.path,
        name: body?.name,
        deleteSource: config.deleteSentMedia === true,
      })
      sendJson(res, result.ok === true ? 200 : 400, result)
    },
  })

  /**
   * What media kinds this build can send. A tiny capability probe so a caller
   * does not have to hard-code the list.
   */
  const disposeMediaKinds = ctx.webServer.register({
    kind: 'exact',
    path: API_PREFIX + '/media-kinds',
    handler: async (req, res) => {
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) {
        res.statusCode = rejection
        res.end()
        return
      }
      sendJson(res, 200, { kinds: MEDIA_KINDS })
    },
  })

  /**
   * The cache page's inventory: every file this plugin writes, with sizes.
   */
  const disposeCache = ctx.webServer.register({
    kind: 'exact',
    path: API_PREFIX + '/cache',
    handler: async (req, res) => {
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) {
        res.statusCode = rejection
        res.end()
        return
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      try {
        sendJson(res, 200, await inventory())
      } catch (error) {
        sendJson(res, 500, { error: String(error?.message ?? error) })
      }
    },
  })

  /**
   * Clear one slice of storage at the operator's request.
   *
   * Body: `{ target: 'logs' | 'files' | 'account:<qq>' | 'all' }`. Nothing here
   * runs on its own; this is the manual counterpart to the inventory.
   */
  const disposeCacheClear = ctx.webServer.register({
    kind: 'exact',
    path: API_PREFIX + '/cache/clear',
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
      const result = await clearCache(body?.target)
      if (result.ok === true) {
        log.record('bridge', { note: 'cache cleared', target: String(body?.target ?? ''), freed: result.freed })
      }
      sendJson(res, result.ok === true ? 200 : 400, result)
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
    disposeQzone()
    disposeProfile()
    disposeImage()
    disposeSendMedia()
    disposeMediaKinds()
    disposeCache()
    disposeCacheClear()
    disposeClear()
  }
}
