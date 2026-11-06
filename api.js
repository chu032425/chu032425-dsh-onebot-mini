/**
 * 浏览器侧使用的同源 JSON 路由。
 *
 * 都由插件自己的页面发起同源 fetch，并统一走宿主的
 * `connection.requestRejection` 鉴权，与其它工作区插件一致。
 *
 *   GET  /onebot-mini/api/state?after=<seq>&limit=<n>
 *        → { status, logs, config, 字段元数据, 各类选择器 }
 *   POST /onebot-mini/api/config    body: { patch: {...} }
 *        → { ok, problems, ...同上 }
 *   POST /onebot-mini/api/logs/clear
 *        → { ok: true }
 */

import { DEFAULTS, FIELD_GROUPS, FIELD_KINDS, MODE_FIELDS } from './config.js'
import { TOOL_GROUPS } from './toolcatalog.js'
import { fetchIntoCache, isAllowedImageUrl, readCached } from './imagecache.js'
import { sendMedia, MEDIA_KINDS } from './media.js'
import { PROMPT_DEFS } from './prompt.js'
import { inventory, clearCache } from './cacheinfo.js'
import { errorText } from './logbus.js'

/** 路由前缀。 */
const API_PREFIX = '/onebot-mini/api'

/** 请求体上限：这里传的是设置，不是文档。 */
const MAX_BODY_BYTES = 64 * 1024

/**
 * 写一个 JSON 响应。
 * @param res - 响应对象。
 * @param status - HTTP 状态码。
 * @param payload - 可 JSON 序列化的响应体。
 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

/**
 * 读取有上限的 JSON 请求体。
 * @param req - 请求。
 * @returns 解析后的对象。
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

/** 解析请求的查询串。 */
function queryOf(req) {
  return new URL(String(req.url ?? '/'), 'http://localhost')
}

/**
 * 把图片字节写回浏览器（缓存命中的与原图溢出的两种情况共用）。
 * @param res - 响应。
 * @param bytes - 图片字节。
 * @param contentType - 图片 MIME，空则按 jpeg。
 * @param cached - 是否来自本地缓存。
 */
function sendImage(res, bytes, contentType, cached) {
  res.statusCode = 200
  res.setHeader('content-type', contentType !== '' ? contentType : 'image/jpeg')
  res.setHeader('cache-control', 'private, max-age=86400')
  res.setHeader('x-onebot-mini-cached', cached ? 'yes' : 'no')
  res.setHeader('content-length', String(bytes.length))
  res.end(bytes)
}

/**
 * 跑一个「可有可无」的动作：失败就当作这台网关没有它，返回 undefined。
 * @param connection - 连接。
 * @param action - 动作名。
 * @param params - 参数。
 * @returns 动作的 data，或 undefined。
 */
async function optionalCall(connection, action, params) {
  try {
    return await connection.call(action, params)
  } catch {
    return undefined
  }
}

/**
 * 注册本插件的全部路由。
 * @param ctx - 插件上下文（需要 `webServer` 与 `connection`）。
 * @param deps - `store`、`log`、`getConnection`、`applyConfig`，以及各选择器的数据源。
 * @returns 卸载函数。
 */
export function registerRoutes(ctx, { store, log, getConnection, applyConfig, listWorkspaces, listAgentPresets, listPermissionPresets, listModels, getSessionIdForChat, forgetChat, reattachWorkspace }) {
  // 兼容两种 store 形状：真正的 ConfigStore 有 `read()`，而测试用的轻量桩可能只
  // 提供 `snapshot()`。
  const readConfig = () => {
    try {
      if (typeof store?.read === 'function') return store.read()
    } catch {
      // 落到 snapshot 分支
    }
    try {
      return store?.snapshot?.()?.config ?? {}
    } catch {
      return {}
    }
  }

  /**
   * 认证并校验方法；未通过时已写好响应，调用方直接 return。
   * @param req - 请求。
   * @param res - 响应。
   * @param methods - 允许的方法，null 表示不限。
   * @returns 是否放行。
   */
  const guard = (req, res, methods) => {
    const rejection = ctx.connection.requestRejection(req)
    if (rejection !== undefined) {
      res.statusCode = rejection
      res.end()
      return false
    }
    if (methods !== null && !methods.includes(String(req.method ?? ''))) {
      sendJson(res, 405, { error: 'method not allowed' })
      return false
    }
    return true
  }

  /**
   * 读取 JSON 请求体；失败时已写好 400 响应。
   * @param req - 请求。
   * @param res - 响应。
   * @returns 解析后的体，或 undefined。
   */
  const readBody = async (req, res) => {
    try {
      return await readJsonBody(req)
    } catch (error) {
      sendJson(res, 400, { error: errorText(error) })
      return undefined
    }
  }

  /**
   * 设置页需要的整套数据：配置、字段元数据与各个选择器。
   * @param snapshot - 配置快照。
   * @returns 可直接塞进响应的对象。
   */
  const settingsPayload = async (snapshot) => ({
    config: snapshot.config,
    secretFields: snapshot.secretFields,
    groups: FIELD_GROUPS,
    kinds: FIELD_KINDS,
    defaults: DEFAULTS,
    modeFields: MODE_FIELDS,
    toolCatalog: TOOL_GROUPS,
    promptDefs: PROMPT_DEFS,
    workspaces: typeof listWorkspaces === 'function' ? listWorkspaces() : { available: false, workspaces: [] },
    agentPresets: typeof listAgentPresets === 'function' ? await listAgentPresets() : { available: false, presets: [] },
    permissionPresets: typeof listPermissionPresets === 'function' ? listPermissionPresets() : { available: false, options: [], defaultPreset: '' },
    models: typeof listModels === 'function' ? await listModels() : { available: false, models: [], defaultModel: '' },
  })

  /** 注册过的路由，卸载时统一回收。 */
  const disposers = []

  /**
   * 注册一条同源路由。
   * @param path - 相对 `/onebot-mini/api` 的路径。
   * @param handler - 处理函数。
   */
  const route = (path, handler) => {
    disposers.push(ctx.webServer.register({ kind: 'exact', path: API_PREFIX + path, handler }))
  }

  route('/state', async (req, res) => {
    if (!guard(req, res, ['GET', 'HEAD'])) return
    const url = queryOf(req)
    const after = Number(url.searchParams.get('after') ?? '0')
    const limit = Number(url.searchParams.get('limit') ?? '200')
    const connection = getConnection()
    const snapshot = store.snapshot()
    sendJson(res, 200, {
      status: connection === undefined
        ? { state: 'offline', mode: snapshot.config.mode, address: '', selfId: '', onlineSince: 0, pendingActions: 0, reconnectAttempt: 0 }
        : connection.status(),
      logs: log.snapshot(after, limit),
      ...(await settingsPayload(snapshot)),
    })
  })

  route('/config', async (req, res) => {
    if (!guard(req, res, ['POST'])) return
    const body = await readBody(req, res)
    if (body === undefined) return
    const patch = body !== null && typeof body === 'object' && body.patch !== null && typeof body.patch === 'object'
      ? body.patch
      : {}
    let result
    try {
      result = await store.write(patch)
    } catch (error) {
      sendJson(res, 500, { error: errorText(error) })
      return
    }
    if (!result.ok) {
      sendJson(res, 400, { ok: false, problems: result.problems })
      return
    }
    try {
      await applyConfig(result.value)
    } catch (error) {
      log.record('error', { note: 'applying new config failed', error: errorText(error) })
      sendJson(res, 500, { ok: false, problems: ['applied settings but reconnecting failed: ' + errorText(error)] })
      return
    }
    log.record('bridge', { note: 'config saved; transport restarted' })
    const snapshot = store.snapshot()
    sendJson(res, 200, {
      ok: true,
      problems: [],
      ...(await settingsPayload(snapshot)),
    })
  })

  /**
   * 联系人页要的好友列表与群列表。
   *
   * 每次请求都现读，不缓存：刚加的好友下一次刷新就该出现，何况列表本来就小。
   * 单个动作失败只把对应那一段标成不可用，整页仍然可用。
   */
  route('/contacts', async (req, res) => {
    if (!guard(req, res, ['GET', 'HEAD'])) return
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
       * 跑一个列表动作并归一化。
       * @param action - OneBot 动作名。
       * @returns `{ available, items, error }`。
       */
    const fetchList = async (action) => {
      try {
        const data = await connection.call(action, {})
        // OneBot 11 直接返回数组；有的实现会包一层 `{ list }`。
        const items = Array.isArray(data) ? data : (Array.isArray(data?.list) ? data.list : [])
        return { available: true, error: '', items }
      } catch (error) {
        return { available: false, error: errorText(error), items: [] }
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
          // 备注可能是空串或只有空白（有的客户端会发全角空格），那意味着
          // 「没设备注」而不是名字为空，这种情况下用昵称。
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
  })

  /**
   * 单个群的成员列表，供可展开的群行使用。
   *
   * `group_id` 从查询串取。动作被拒时返回 `available: false` 并带上原因，
   * 页面据此说明情况，而不是假装这个群没人。
   */
  route('/members', async (req, res) => {
    if (!guard(req, res, ['GET', 'HEAD'])) return
    const url = queryOf(req)
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
      sendJson(res, 200, { available: false, error: errorText(error), groupId, items: [] })
    }
  })

  /**
   * 单个好友的实时资料：在线状态加尽量查到的详情。
   *
   * OneBot 11 没有查好友消息历史与在线状态的通用动作，所以状态由几项能指望的
   * 数据拼出来：`get_status` 给机器人自身的在线状态，`get_stranger_info` 给账号
   * 资料。每个字段都可缺，缺了就留空，不让整条请求失败。
   */
  route('/friend', async (req, res) => {
    if (!guard(req, res, ['GET', 'HEAD'])) return
    const url = queryOf(req)
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
      // `nc_get_user_status` 是 NapCat 自己的扩展，也是唯一能报出联系人是否在线
      // 的动作；`get_status` 报的是机器人自己。`status` 是数字码（10 表示在线），
      // `ext_status` 再细分。
    const [info, userStatus, botStatus] = await Promise.all([
      optionalCall(connection, 'get_stranger_info', { user_id: Number(userId), no_cache: true }),
      optionalCall(connection, 'nc_get_user_status', { user_id: String(userId) }),
      optionalCall(connection, 'get_status', {}),
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
        // 没有这个动作时 `status` 保持 undefined，页面显示「未知」而不是瞎猜。
      status: Number.isFinite(statusCode) ? statusCode : undefined,
      extStatus: userStatus === undefined ? undefined : Number(userStatus?.ext_status ?? 0),
      online: Number.isFinite(statusCode) ? statusCode === 10 : undefined,
      botOnline: botStatus?.online === true,
      good: botStatus?.good === true,
    })
  })

  /**
   * 空间页要的数据：资料、自己的说说、好友动态。
   *
   * 三次互相独立的读取放在一条路由后面，页面只需一次请求。每一段各自报告成败：
   * 空间类动作最依赖网关实现，其中一项不支持不该让整页变白。
   *
   * `what` 选子集：`profile`、`list`、`feeds` 或默认的 `all`；
   * `target_uin` 与 `pos`/`num` 原样透传。
   */
  route('/qzone', async (req, res) => {
    if (!guard(req, res, ['GET', 'HEAD'])) return
    const url = queryOf(req)
    const what = String(url.searchParams.get('what') ?? 'all')
    const targetUin = String(url.searchParams.get('target_uin') ?? '').trim()
      // 空间页以文字为主，但每条说说都可能带图，而每次翻页都要一次动作。把页
      // 做小才不至于卡住面板：默认 10 条，上限 20 条。
    const num = Math.min(20, Math.max(1, Number(url.searchParams.get('num') ?? 10) || 10))
    const pos = Math.max(0, Number(url.searchParams.get('pos') ?? 0) || 0)
    const connection = getConnection()
    const offline = { available: false, error: 'not connected' }
    if (connection === undefined || connection.state !== 'online') {
      sendJson(res, 200, { state: 'offline', profile: offline, posts: offline, feeds: offline })
      return
    }      /**
       * 把空间读取失败翻译成页面能解释的码。
       *
       * 腾讯拒绝读某个空间时给的是它自己的负数码，不是 OneBot 的 retcode：
       * -4009 与 -10031 表示「你没权限看这个空间」（对方设了限制，或不是好友、
       * 需要验证）。其它情况保留原始文案，这样真出现怪问题时还能查。
       * @param error - 抛出的异常。
       * @returns `{ code, message }`。
       */
    const classify = (error) => {
      const raw = errorText(error)
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
    ])      /**
       * 归一化一条说说。
       *
       * 返回的可能是 `{ total, msglist }` 这种形状，也可能是原生 H5 形状；两种
       * 都在这里压平成同一组字段，拿不到的值留空，不编造。
       * @param item - 一条原始说说。
       */
      // 自己的说说没有作者号，所以记住正在读的是哪个账号，记作 `ownerUin`；
      // 图片代理要靠它选缓存目录。
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
  })

  /**
   * 资料页要的数据：一个账号的详情，默认是机器人自己。
   *
   * `user_id` 指定账号；不传就取机器人自己，用 `get_login_info` 加针对该号的
   * `get_stranger_info` 拼出来——等级、签名、VIP 这些 `get_login_info` 不返回的
   * 字段只能这样读。
   *
   * 每个字段都可缺。`get_stranger_info` 是老式动作，有的实现返回的字段很少，
   * 缺了留空即可，不让整页失败。
   */
  route('/profile', async (req, res) => {
    if (!guard(req, res, ['GET', 'HEAD'])) return
    const url = queryOf(req)
    const requested = String(url.searchParams.get('user_id') ?? '').trim()
    const connection = getConnection()
    if (connection === undefined || connection.state !== 'online') {
      sendJson(res, 200, { available: false, error: 'not connected', state: 'offline', userId: requested })
      return
    }

    const botId = String(connection.selfId ?? '')
    const userId = requested !== '' ? requested : botId
    if (userId === '') {
      sendJson(res, 200, { available: false, error: 'the bot account is not known yet', state: connection.state, userId: '' })
      return
    }
      // 只有查自己、或还不知道机器人号时才读登录信息：它便宜，还能补昵称。
    const needLogin = requested === '' || botId === ''
    const isSelf = userId === botId
      // `nc_get_user_status` 能查别人，但对机器人自己往往报成离线；机器人自身的
      // 在线状态改由 `get_status` 提供。两个都读、按情况取，才不会把已连上的
      // 机器人显示成离线。
    const [login, stranger, userStatus, botStatus, like] = await Promise.all([
      needLogin ? optionalCall(connection, 'get_login_info', {}) : Promise.resolve(undefined),
      optionalCall(connection, 'get_stranger_info', { user_id: Number(userId), no_cache: true }),
      isSelf ? Promise.resolve(undefined) : optionalCall(connection, 'nc_get_user_status', { user_id: String(userId) }),
      isSelf ? optionalCall(connection, 'get_status', {}) : Promise.resolve(undefined),
      optionalCall(connection, 'get_profile_like', { user_id: String(userId), start: 0, count: 10 }),
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
        // 点赞数只是锦上添花，不是这个页面的重点，没有这个动作就留 0。
      likeCount: Number(like?.total_count ?? like?.like_count ?? 0) || 0,
    })
  })

  /**
   * 把空间图片的字节代理给页面，供 `<img src>` 使用。
   *
   * 浏览器自己加载不了空间图片：地址是带签名的，还要求 referer 指向
   * qzone.qq.com，普通 `<img>` 设不了。走这里代理顺带让图片只下载一次，之后从
   * 磁盘读。
   *
   * `qq` 决定缓存目录，`url` 是图源。两者都做了校验：`qq` 由缓存模块只留数字，
   * `url` 必须落在已知图床上，这样一条构造过的说说也探不到本机网络。
   */
  route('/image', async (req, res) => {
    if (!guard(req, res, ['GET'])) return
    const url = queryOf(req)
    const qq = String(url.searchParams.get('qq') ?? '').trim()
    const source = String(url.searchParams.get('url') ?? '')
    if (source === '' || !isAllowedImageUrl(source)) {
      sendJson(res, 400, { error: 'url is missing or not an allowed image host' })
      return
    }
    const config = readConfig()
    const cached = await fetchIntoCache(qq, source, {
      config,
      maxKb: config.imageCacheMaxKb,
      totalMb: config.imageCacheTotalMb,
      maxStreamMb: config.imageShowMaxMb,
    })
    if (cached.ok !== true) {
        // 超过缓存上限的图片仍然直接流一次给浏览器，字节就在 `overflow` 里；
        // 只有真正过大或抓取失败才算错。
      if (cached.overflow === true && cached.buffer !== undefined) {
        sendImage(res, cached.buffer, cached.contentType, false)
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
    sendImage(res, bytes, cached.contentType, true)
  })

  /**
   * 往一个会话发一条媒体消息。
   *
   * 这是给运营者用的那一半：浏览器提交 URL、base64 或本机路径，插件把它转成
   * OneBot 媒体段发出去。本机路径在这里读成 base64 内联，对面因此不需要看到
   * 这台机器的文件系统。
   *
   * 请求体：`{ chatType, chatId, kind, url? | base64? | path?, name? }`。
   */
  route('/send-media', async (req, res) => {
    if (!guard(req, res, ['POST'])) return
    const body = await readBody(req, res)
    if (body === undefined) return
    const connection = getConnection()
    if (connection === undefined || connection.state !== 'online') {
      sendJson(res, 200, { ok: false, error: 'not connected' })
      return
    }
    const config = readConfig()
    const result = await sendMedia(connection, {
      chatType: body?.chatType,
      chatId: body?.chatId,
      text: body?.text,
      kind: body?.kind,
      url: body?.url,
      base64: body?.base64,
      path: body?.path,
      name: body?.name,
      deleteSource: config.deleteSentMedia === true,
    })
    sendJson(res, result.ok === true ? 200 : 400, result)
  })

  /** 本构建能发哪些媒体类型，供调用方探测，免得把清单写死。 */
  route('/media-kinds', async (req, res) => {
    if (!guard(req, res, null)) return
    sendJson(res, 200, { kinds: MEDIA_KINDS })
  })

  /** 缓存页要的清单：本插件写下的每个文件及其大小。 */
  route('/cache', async (req, res) => {
    if (!guard(req, res, ['GET'])) return
    try {
      sendJson(res, 200, await inventory(readConfig()))
    } catch (error) {
      sendJson(res, 500, { error: errorText(error) })
    }
  })

  /**
   * 按运营者的要求清掉一块存储。
   *
   * 请求体：`{ target: 'logs' | 'files' | 'account:<qq>' | 'all' }`。这里没有
   * 任何自动清理，只是清单页的手动对应物。
   */
  route('/cache/clear', async (req, res) => {
    if (!guard(req, res, ['POST'])) return
    const body = await readBody(req, res)
    if (body === undefined) return
    const result = await clearCache(body?.target, readConfig())
    if (result.ok === true) {
      log.record('bridge', { note: 'cache cleared', target: String(body?.target ?? ''), freed: result.freed })
    }
    sendJson(res, result.ok === true ? 200 : 400, result)
  })

  /**
   * 丢掉一个会话的映射，让下一条消息开一段干净的对话。
   *
   * 一个会话攒了太多失败回合后，模型会沿同一条错路反复走；丢掉映射就换新会话，
   * 这是不改历史记录就能打断循环的最省事办法。
   *
   * 请求体：`{ chatId }`。
   */
  route('/forget-chat', async (req, res) => {
    if (!guard(req, res, ['POST'])) return
    const body = await readBody(req, res)
    if (body === undefined) return
    const chatId = String(body?.chatId ?? '').trim()
    if (chatId === '') {
      sendJson(res, 400, { error: 'chatId is required' })
      return
    }
    if (typeof forgetChat !== 'function') {
      sendJson(res, 200, { ok: false, error: 'not supported' })
      return
    }
    const existed = forgetChat(chatId)
    log.record('bridge', { note: 'chat mapping forgotten on request', chatId, existed })
    sendJson(res, 200, { ok: true, existed })
  })

  route('/tool-probe', async (req, res) => {
    if (!guard(req, res, null)) return
    const url = queryOf(req)
    const chatId = String(url.searchParams.get('chatId') ?? '').trim()
    const tools = ctx.get('tools')
    if (tools === undefined) {
      sendJson(res, 200, { available: false, error: 'no tools service' })
      return
    }
    let scope
    try {
      const agents = ctx.get('agents')
      const sessionId = typeof getSessionIdForChat === 'function' ? getSessionIdForChat(chatId) : undefined
      scope = sessionId === undefined ? undefined : agents?.get?.(sessionId)
    } catch {
      scope = undefined
    }
    try {
      const schemas = tools.schemas(scope)
      const names = schemas.map((schema) => String(schema.name ?? '')).filter((name) => name !== '')
      sendJson(res, 200, {
        available: true,
        chatId,
        scopeFound: scope !== undefined,
        total: names.length,
        onebot: names.filter((name) => name.startsWith('onebot')),
        names,
      })
    } catch (error) {
      sendJson(res, 200, { available: false, error: errorText(error) })
    }
  })

  route('/logs/clear', async (req, res) => {
    if (!guard(req, res, ['POST'])) return
    log.clear()
    sendJson(res, 200, { ok: true })
  })

  // 把一个会话重新挂到配置的工作区。幂等，用来修正落到「未分组」的会话
  // （例如重启之后）。
  route('/attach', async (req, res) => {
    if (!guard(req, res, null)) return
    if (typeof reattachWorkspace !== 'function') {
      sendJson(res, 200, { ok: false, error: 'not supported' })
      return
    }
    let chatId = ''
    if (req.method === 'POST') {
      const body = await readBody(req, res)
      if (body === undefined) return
      chatId = String(body?.chatId ?? '').trim()
    } else {
      const url = queryOf(req)
      chatId = String(url.searchParams.get('chatId') ?? '').trim()
    }
    if (chatId === '') {
      sendJson(res, 400, { error: 'chatId is required' })
      return
    }
    try {
      const result = await reattachWorkspace(chatId)
      sendJson(res, 200, result)
    } catch (error) {
      sendJson(res, 500, { ok: false, error: errorText(error) })
    }
  })

  return () => {
    for (const dispose of disposers) dispose()
  }
}
