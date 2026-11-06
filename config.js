/**
 * 插件自己的配置存储。
 *
 * 刻意不用 Loader 的 `config:` 块，原因有两条：
 *
 *  1. 保存设置只需重连 WebSocket，不能重启插件 fiber——fiber 一重启，正在跑的
 *     回合和每个会话的 agent 映射都会被打断。
 *  2. 不依赖任何 schema 库，所以从 git 安装与以 `link:` 指向本地检出，装出来的
 *     行为完全一致。
 *
 * 文件放在挂载本插件的那个 profile 旁边，因此一台机器上的多个 profile 各自独立。
 * 写入是原子的（临时文件 + rename）；文件损坏时退回默认值，而不是让挂载失败。
 */

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { TOOL_GROUPS, isKnownAction } from './toolcatalog.js'
import { DEFAULT_CHANNEL_PROMPT, LEGACY_CHANNEL_PROMPT, LEGACY_CHANNEL_PROMPT_V2, LEGACY_CHANNEL_PROMPT_V3, DEFAULT_SECURITY_PROMPT, DEFAULT_REPLY_MODE_STREAM_PROMPT, DEFAULT_REPLY_MODE_FINAL_PROMPT, DEFAULT_ADMIN_PROMPT, LEGACY_ADMIN_PROMPT, DEFAULT_SENDER_PREFIX_PROMPT, LEGACY_SENDER_PREFIX_PROMPT, DEFAULT_MEDIA_PROMPT, LEGACY_MEDIA_PROMPT, DEFAULT_TOOLS_PROMPT, LEGACY_TOOLS_PROMPT, DEFAULT_INBOUND_PROMPT, PROMPT_DEFS } from './prompt.js'

/** DSH 主目录：先看 `$DSH_HOME`，再看 `~/.dsh`。 */
export function dshHome() {
  const env = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  return env !== '' ? env : join(homedir(), '.dsh')
}

/**
 * 本插件持久化设置的文件。
 *
 * profile 名取自 `$DSH_PROFILE`（由每个 profile 启动的 Harness 外壳设置）；
 * 没有这个变量时按 `web` 处理，也就是 Web 界面用的那个。
 */
export function configPath() {
  const profile = typeof process.env.DSH_PROFILE === 'string' && process.env.DSH_PROFILE.trim() !== ''
    ? process.env.DSH_PROFILE.trim()
    : 'web'
  return join(dshHome(), 'profiles', profile, 'onebot-mini.json')
}

/** JSONL 日志落盘的位置，紧挨着配置文件。 */
export function logPath() {
  return configPath().replace(/onebot-mini\.json$/, 'onebot-mini.log.jsonl')
}

/**
 * 当前部署固化的「仅管理员可用」动作清单（由设置菜单导出，作为插件携带默认值）。
 *
 * 出厂的内置敏感动作集合见 `toolcatalog.js` 的 `DEFAULT_ADMIN_ONLY`（仍作为
 * `computeAdminOnly` 在字段缺失时的兜底）；这里记录运营者实际启用的一整套范围。
 * 注意：这是一份运营者定制清单，不是通用安全默认。
 */
const CARRIED_TOOL_ADMIN_ONLY = Object.freeze([
  'set_group_ban', 'set_group_kick', 'set_group_whole_ban', 'set_group_card',
  'set_group_name', 'set_group_leave', 'set_group_special_title', 'set_group_remark',
  'set_group_portrait', '_send_group_notice', '_del_group_notice', 'delete_msg',
  'send_msg', 'send_group_msg', 'send_private_msg', 'get_login_info', 'get_status',
  'get_version_info', 'can_send_image', 'can_send_record', 'get_friend_list',
  'get_friends_with_category', 'get_unidirectional_friend_list', 'get_group_list',
  'get_group_info', 'get_group_detail_info', 'get_group_share_link',
  'get_group_member_list', 'get_group_member_info', 'get_group_shut_list',
  'get_group_honor_info', 'get_group_at_all_remain', 'get_group_system_msg',
  'get_essence_msg_list', '_get_group_notice', 'get_stranger_info',
  'nc_get_user_status', 'send_like', '_mark_all_as_read', 'get_group_msg_history',
  'get_friend_msg_history', 'set_friend_add_request', 'set_group_add_request',
  'set_friend_remark', 'set_self_longnick', 'set_qq_profile', 'set_qq_avatar',
  'set_online_status', 'set_input_status', 'send_qzone_msg', 'delete_qzone_msg',
  'get_qzone_msg_list', 'get_qzone_msg_detail', 'get_qzone_feeds', 'comment_qzone',
  'like_qzone', 'unlike_qzone', 'get_qzone_comment_list', 'get_qzone_comment_replies',
  'get_qzone_profile', 'set_qzone_profile',
])

/**
 * 每个可接受的字段及其默认值，唯一权威来源。
 *
 * 下面这些默认值已按当前部署「设置菜单」里的配置固化，但**不含任何密钥或真实
 * QQ/群号**：`accessToken`、`botQQ` 保持为空；`adminUserId`、`denyFrom`、
 * `allowFrom`、`allowGroups`、`denyGroups` 一律留空，敏感身份由部署者自行填写。
 * 这样源码/仓库里不会带出任何真实账号信息。
 */
export const DEFAULTS = Object.freeze({
  mode: 'reverse',
  host: '0.0.0.0',
  port: 8645,
  url: 'ws://127.0.0.1:3001',
  accessToken: '',
  botQQ: '',
  requireMention: false,
  allowFrom: [],
  // 不携带任何真实 QQ / 群号：这些属于敏感信息，交付时留空，由部署者自行在
  // 「访问控制」页填写。
  denyFrom: [],
  allowGroups: [],
  denyGroups: [],
  // 唯一的机器人管理员账号：在「访问控制」页从好友列表里挑一个 QQ 号。
  // 留空表示没设管理员。
  adminUserId: '',
  workspacePath: '/workspace/QQ',
  agentPreset: '',
  senderPrefix: true,
  sessionPrefix: 'onebot',
  sessionPermission: 'workspace-write',
  agentModel: '',
  // 回答前的上下文压缩：当最近一次测得的占用（已用 token / 上下文窗口）达到这个
  // 比例时，先压缩会话再投递新消息。0 关闭这条预检查（Harness 自带的自动压缩
  // 仍然有效）；大于 1 的值按百分比理解（80 → 0.8）。
  compactRatio: 0.2,
  onebotToolEnabled: true,
  onebotToolDisabled: ['send_private_msg', 'send_group_msg', 'send_msg'],
  // 「仅管理员可用」的动作集合：当前部署固化的整套清单（见 CARRIED_TOOL_ADMIN_ONLY）。
  // 工具页每一行都有「非管理员可用」开关，取消勾选即加入这里。
  toolAdminOnly: [...CARRIED_TOOL_ADMIN_ONLY],
  // 「工具」页的逐动作提示词覆盖，按动作名索引。只保存运营者真正改过的动作；
  // 缺失或留空表示「用 actiondocs.js 里的内置说明」。刻意不出现在设置页：
  // 它在「工具」页里改。
  actionPrompts: {},
  titleEqualsId: true,
  logCapacity: 500,
  logMessagePreview: true,
  logToFile: true,
  sendTimeoutMs: 30000,
  // 回复行为只剩这一个开关：新消息能否打断正在进行的回答。消息不再等什么安静
  // 窗口。
  privateAutoInterject: true,
  // 收到戳一戳是否交给模型回答。默认开启；关掉后戳一戳事件直接忽略。
  pokeEvents: true,
  // 被戳一戳后是否反戳回去。当前部署默认开启（两个机器人都打开会互相戳个没完，
  // 单机器人自用可接受）。
  pokeBack: true,
  // 助手的回答怎么到达聊天：
  //  - stream（默认）：每产生一条助手消息就立刻发出去；
  //  - final：把每个文本块攒起来，回合结束时发一条 QQ 消息（多步回合不会刷屏）。
  replyMode: 'stream',
  deleteSentMedia: true,
  // 收到的媒体：把图片/语音/视频/文件段下载到本地收件目录，让模型真能读到；
  // 同时限制单个文件的大小。
  inboundMedia: true,
  inboundMediaMaxMb: 20,
  // 解析过这份文件的那一轮结束后就删掉它，是「发送后删除源文件」在入站侧的对应
  // 开关。
  deleteInboundMedia: true,
  channelPrompt: DEFAULT_CHANNEL_PROMPT,
  securityPrompt: DEFAULT_SECURITY_PROMPT,
  replyModeStreamPrompt: DEFAULT_REPLY_MODE_STREAM_PROMPT,
  replyModeFinalPrompt: DEFAULT_REPLY_MODE_FINAL_PROMPT,
  adminPrompt: DEFAULT_ADMIN_PROMPT,
  senderPrefixPrompt: DEFAULT_SENDER_PREFIX_PROMPT,
  mediaPrompt: DEFAULT_MEDIA_PROMPT,
  toolsPrompt: DEFAULT_TOOLS_PROMPT,
  inboundPrompt: DEFAULT_INBOUND_PROMPT,
  imageCacheMaxKb: 1024,
  imageCacheTotalMb: 100,
  imageShowMaxMb: 32,
})

/** 设置页要渲染的字段类型。 */
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
  toolAdminOnly: 'stringList',
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
  securityPrompt: 'text',
  replyModeStreamPrompt: 'text',
  replyModeFinalPrompt: 'text',
  adminPrompt: 'text',
  senderPrefixPrompt: 'text',
  mediaPrompt: 'text',
  toolsPrompt: 'text',
  inboundPrompt: 'text',
  privateAutoInterject: 'boolean',
  pokeEvents: 'boolean',
  pokeBack: 'boolean',
  replyMode: 'replyMode',
  imageCacheMaxKb: 'number',
  imageCacheTotalMb: 'number',
  imageShowMaxMb: 'number',
})

/** 设置页的字段顺序与分组。 */
export const FIELD_GROUPS = Object.freeze([
  { id: 'connection', fields: ['mode', 'host', 'port', 'url', 'accessToken', 'botQQ'] },
  { id: 'access', fields: ['requireMention'] },
  { id: 'session', fields: ['sessionPrefix', 'titleEqualsId', 'workspacePath', 'agentPreset', 'agentModel', 'sessionPermission', 'compactRatio', 'senderPrefix'] },
  { id: 'media', fields: ['inboundMedia', 'inboundMediaMaxMb', 'deleteInboundMedia', 'deleteSentMedia'] },
  { id: 'reply', fields: ['replyMode', 'privateAutoInterject', 'pokeEvents', 'pokeBack'] },
  { id: 'qzone', fields: ['imageShowMaxMb', 'imageCacheMaxKb', 'imageCacheTotalMb'] },
  { id: 'diagnostics', fields: ['logCapacity', 'logMessagePreview', 'logToFile', 'sendTimeoutMs'] },
])

/**
 * 只对某一种连接模式有效的字段。
 *
 * 设置页会藏起与当前模式无关的字段：反向配置不该看到它不用的「网关地址」输入框，
 * 正向配置也不该看到它根本不监听的地址与端口。
 */
export const MODE_FIELDS = Object.freeze({
  host: 'reverse',
  port: 'reverse',
  url: 'forward',
})

/** 绝不能以明文离开宿主的字段。 */
const SECRET_FIELDS = new Set(['accessToken'])

/**
 * 把一个原始值按它声明的类型规整，不合规就回落默认值。
 * @param field - 字段名。
 * @param raw - 候选值。
 * @returns 规整后的值。
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
 * 把一个整数字段夹进区间，越界就记一条问题并回落默认值。
 * @param value - 正在校验的配置对象，原地修改。
 * @param problems - 问题清单，原地追加。
 * @param field - 字段名。
 * @param min - 下界（含）。
 * @param max - 上界（含）。
 */
function range(value, problems, field, min, max) {
  value[field] = Math.trunc(value[field])
  if (value[field] < min || value[field] > max) {
    problems.push(field + ' must be ' + min + '-' + max)
    value[field] = DEFAULTS[field]
  }
}

/**
 * 校验一份完整的候选配置。
 * @param raw - 一个对象，可能只给了一部分，也可能是恶意输入。
 * @returns `{ value, problems }`；`value` 永远是完整的。
 */
export function normalizeConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const value = {}
  const problems = []
  for (const field of Object.keys(DEFAULTS)) {
    value[field] = coerce(field, source[field])
  }

  range(value, problems, 'port', 1, 65535)
  range(value, problems, 'sendTimeoutMs', 1000, 600000)
  // 上下文压缩比例：接受 0-1，也接受 1-100 的百分比（80 → 0.8）。
  // 0 关闭这条预检查。
  let compactRatio = Number(value.compactRatio)
  if (compactRatio > 1 && compactRatio <= 100) compactRatio = compactRatio / 100
  if (!Number.isFinite(compactRatio) || compactRatio < 0 || compactRatio > 1) {
    problems.push('compactRatio must be 0-1 (0 disables, or a percentage up to 100)')
    compactRatio = DEFAULTS.compactRatio
  }
  value.compactRatio = Math.round(compactRatio * 1000) / 1000
  range(value, problems, 'imageCacheMaxKb', 64, 20480)
  range(value, problems, 'imageCacheTotalMb', 8, 4096)
  range(value, problems, 'imageShowMaxMb', 1, 512)
  range(value, problems, 'inboundMediaMaxMb', 1, 512)
  range(value, problems, 'logCapacity', 50, 5000)
  // 工具白名单存的是「被禁用」的动作集合，这样以后版本新增的动作对老配置默认就是
  // 启用的。未知名字与重复项会被丢掉，手改过的文件因此塞不进垃圾数据。
  const rawDisabled = Array.isArray(value.onebotToolDisabled) ? value.onebotToolDisabled : []
  value.onebotToolDisabled = [...new Set(rawDisabled.filter((action) => isKnownAction(action)))]

  // 「仅管理员可用」同样是已知动作的集合；未知名字与重复项丢掉。注意这里**不是**
  // 「缺失就清空」：缺省时 coerce 已经填好出厂默认（敏感动作），运营者显式保存
  // 空数组才会真的变成「谁都允许」。
  const rawAdminOnly = Array.isArray(value.toolAdminOnly) ? value.toolAdminOnly : []
  value.toolAdminOnly = [...new Set(rawAdminOnly.filter((action) => isKnownAction(action)))]

  // 管理员是一个 QQ 号：去掉首尾空白，并丢弃非数字内容，免得一个多余空格或粘进来
  // 的昵称变成一条假 id。
  const rawAdmin = String(value.adminUserId ?? '').trim()
  value.adminUserId = /^\d*$/.test(rawAdmin) ? rawAdmin : ''

  // 会话前缀会成为文件系统里会话 id 的一部分，所以压平到与聊天 id 同一套安全字符
  // 集。压平后什么都不剩的值（纯中文、纯标点）退回默认，而不是留下一个孤零零的
  // `-` 前缀，并且会明确报出来。

  // 提示词被清空会让模型失去指引，所以空值静默回到出厂默认。这里遍历的正是「提示词」
  // 页所用的那张注册表，新登记的提示词自动获得同样的处理。
  for (const def of PROMPT_DEFS) {
    if (String(value[def.field] ?? '').trim() === '') value[def.field] = DEFAULTS[def.field]
  }

  // 仍等于旧版出厂默认的频道提示词会升级到当前版本：v1 把回复那句写死了，v2 有了
  // `{replyMode}` 但还没有 `{admin}`。运营者改过的提示词绝不动。
  if (value.channelPrompt === LEGACY_CHANNEL_PROMPT || value.channelPrompt === LEGACY_CHANNEL_PROMPT_V2 || value.channelPrompt === LEGACY_CHANNEL_PROMPT_V3) {
    value.channelPrompt = DEFAULT_CHANNEL_PROMPT
  }

  // 旧版工具清单把所有动作说明都塞进系统提示，且没提 get_action_doc。仍等于旧默认
  // 的升级到新默认（改为「只列名称+注释、按需取详细说明」的渐进式披露）；运营者
  // 改过的工具清单保持原样。
  if (value.toolsPrompt === LEGACY_TOOLS_PROMPT) {
    value.toolsPrompt = DEFAULT_TOOLS_PROMPT
  }

  // 旧版管理员段落把管理员指令当成最高优先；升级为「管理员也受平台安全规则约束」。
  if (value.adminPrompt === LEGACY_ADMIN_PROMPT) {
    value.adminPrompt = DEFAULT_ADMIN_PROMPT
  }

  // 旧版媒体段落暗示可以发到别的会话；升级为「只在当前会话发送」。
  if (value.mediaPrompt === LEGACY_MEDIA_PROMPT) {
    value.mediaPrompt = DEFAULT_MEDIA_PROMPT
  }

  // 旧版发言人前缀说明只提「[HH:MM 昵称(QQ)]」，而抬头现在同时解析出会话和
  // 发送者。仍等于旧默认的升级到新文案，运营者改过的保持原样。
  if (value.senderPrefixPrompt === LEGACY_SENDER_PREFIX_PROMPT) {
    value.senderPrefixPrompt = DEFAULT_SENDER_PREFIX_PROMPT
  }

  const rawPrefix = String(value.sessionPrefix ?? '').trim()
  if (/^[a-z][a-z0-9-]*$/.test(rawPrefix)) {
    value.sessionPrefix = rawPrefix
  } else {
    // 宁可拒绝也不打补丁：把「我的QQ」悄悄变成「QQ」会掩盖前缀根本没生效这件事。
    // 只允许小写，是为了会话 id 在地址栏和搜索框里都保持可预期的样子。
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
 * 一个 profile 的持久化配置存储。
 *
 * `read()` 故意做成同步的：插件挂载时必须在建连接之前就拿到设置，而读一个
 * 几 KB 的 JSON 文件本来就很便宜。
 */
export class ConfigStore {
  /**
   * @param path - JSON 文件的绝对路径。
   */
  constructor(path) {
    this.path = path
    this.cache = undefined
  }

  /**
   * 读出生效中的配置，第一次读成功后缓存起来。
   * @returns 完整的配置对象。
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
   * 把一份补丁合进已存的配置并落盘。
   * @param patch - 只给出部分字段的候选值。
   * @returns `{ ok, problems, value }`；`value` 是新的生效配置。
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
   * 浏览器看到的那份配置。
   *
   * 访问令牌整串返回：这个页面是唯一编辑它的地方，排查令牌对不上时需要逐字比对，
   * 而请求本身已经由宿主的浏览器会话鉴权过。`secretFields` 仍然告诉页面哪些输入
   * 框要渲染成密码样式。
   * @returns `{ config, secretFields, groups, kinds, defaults }`。
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
