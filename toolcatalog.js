/**
 * The OneBot actions the `onebot_call` tool is allowed to relay, grouped for
 * the tools page.
 *
 * `onebot_call` stays one generic escape hatch; this catalog only says which
 * actions an operator can switch on or off. The list is a whitelist: an action
 * that is not here, or that the operator turned off, is refused by the tool
 * instead of reaching the gateway.
 *
 * Coverage comes from NapCat's published API reference. Three families are
 * deliberately left out, because handing them to a model would leak secrets or
 * break the running bot:
 *
 *  - credentials and keys: get_credentials, get_csrf_token, get_cookies,
 *    get_rkey, nc_get_rkey, get_rkey_server, get_clientkey;
 *  - self-destructive: set_restart, bot_exit, clean_cache,
 *    clean_stream_temp_file;
 *  - raw protocol: send_packet, nc_get_packet_status, and the streaming
 *    upload/download endpoints.
 *
 * Also omitted as niche or platform-specific: flash transfer and online files,
 * custom stickers, group sign-in, guild/channel, Ark share cards, inline
 * keyboard buttons, ocr_image (Windows only) and the AI-voice pair.
 *
 * Trimmed further on the operator's request, so the tool surface stays small:
 * the whole group-album family, the Qzone permission pair, the custom online
 * status, everything in request handling except the two add-request handlers,
 * the per-chat read markers, the merged/one-message forwards, the extended
 * group query and recent contacts, bulk kick / group admin / group todo, and
 * the group-file upload, listing and folder-management set. They are gone from
 * the catalog, the docs and the prompt, not merely switched off.
 *
 * Every entry carries its Chinese annotation inline, so the tools page shows
 * "禁言群成员 / set_group_ban" without a second dictionary to keep in sync.
 */

import { ACTION_DOCS, actionPrompt } from './actiondocs.js'

/**
 * One catalogued action.
 * @typedef {{ name: string, zh: string, en: string, standard: boolean, params: ReadonlyArray<object>, defaultPrompt: string }} ToolAction
 */

/**
 * One operator-facing group of actions.
 * @typedef {{ id: string, actions: ToolAction[] }} ToolGroup
 */

/**
 * Build one frozen action entry.
 *
 * `params` and `defaultPrompt` come from `actiondocs.js`, so the Tools page and
 * the channel prompt describe an action the same way. `defaultPrompt` is the
 * built-in text an operator can override per action in the config.
 */
const a = (name, zh, en) => Object.freeze({
  name,
  zh,
  en,
  standard: STANDARD_ACTIONS.has(name),
  local: LOCAL_ACTIONS.has(name),
  params: ACTION_DOCS[name]?.params ?? Object.freeze([]),
  defaultPrompt: actionPrompt(name, zh),
})

/** Chinese labels for each action group, used in the channel prompt. */
export const GROUP_LABELS = Object.freeze({
  local: '本地工具（插件自带）',
  message: '发送消息',
  media: '媒体与文件',
  group: '群管理',
  query: '查询与信息',
  interaction: '互动与消息操作',
  request: '请求处理',
  profile: '账号资料',
  qzone: 'QQ 空间',
})

/**
 * The action names that belong to the OneBot 11 standard protocol
 * (https://onebot.dev / OneBot-11). Everything else in the catalog is an
 * implementation extension (go-cqhttp / NapCat), so the tools page can badge each
 * row as 「标准」or 「扩展」. Kept here as the single source of truth.
 */
export const STANDARD_ACTIONS = Object.freeze(new Set([
  // 消息
  'send_private_msg', 'send_group_msg', 'send_msg', 'delete_msg', 'get_msg', 'get_forward_msg', 'send_like',
  // 媒体 / 群文件
  'get_image', 'get_record',
  // 查询
  'get_login_info', 'get_status', 'get_version_info', 'can_send_image', 'can_send_record',
  'get_friend_list', 'get_group_info', 'get_group_list', 'get_group_member_info',
  'get_group_member_list', 'get_group_honor_info', 'get_group_system_msg', 'get_stranger_info',
  // 群管理
  'set_group_ban', 'set_group_whole_ban', 'set_group_card', 'set_group_name',
  'set_group_leave', 'set_group_kick', 'set_group_special_title',
  // 请求处理
  'set_friend_add_request', 'set_group_add_request',
]))

/**
 * Actions implemented inside this plugin instead of being relayed to the
 * gateway. They share the one `onebot_call` tool: the tool dispatches these
 * names to local handlers before falling back to the OneBot transport.
 */
export const LOCAL_ACTIONS = Object.freeze(new Set(['send_message', 'list_files']))

/** The operator-facing grouping. Order is the order shown in the tools page. */
export const TOOL_GROUPS = Object.freeze([
  Object.freeze({ id: 'local', actions: Object.freeze([
    a('send_message', '发送消息（文字 / 图片 / 语音 / 视频 / 文件；仅文字+图片可同条）', 'Send a message (text, image, voice, video, file; only text+image share one)'),
    a('list_files', '列出本机目录文件', 'List host directory files'),
  ]) }),

  Object.freeze({ id: 'message', actions: Object.freeze([
    a('send_private_msg', '发送私聊消息', 'Send a private message'),
    a('send_group_msg', '发送群消息', 'Send a group message'),
    a('send_msg', '发送消息（按上下文自动区分私聊/群）', 'Send a message, private or group'),
  ]) }),

  Object.freeze({ id: 'media', actions: Object.freeze([
    a('get_image', '获取图片文件', 'Fetch an image file'),
    a('get_record', '获取语音文件', 'Fetch a voice recording'),
    a('get_file', '获取文件', 'Fetch a file'),
    a('download_file', '下载网络文件到本地', 'Download a remote file to disk'),
  ]) }),

  Object.freeze({ id: 'group', actions: Object.freeze([
    a('set_group_ban', '禁言群成员', 'Mute a group member'),
    a('set_group_kick', '踢出群成员', 'Kick a group member'),
    a('set_group_whole_ban', '全员禁言开关', 'Toggle whole-group mute'),
    a('set_group_card', '设置群名片', "Set a member's group card"),
    a('set_group_name', '修改群名称', 'Rename the group'),
    a('set_group_leave', '退出群聊', 'Leave a group'),
    a('set_group_special_title', '设置群专属头衔', "Set a member's special title"),
    a('set_group_remark', '设置群备注', 'Set a remark for the group'),
    a('set_group_portrait', '设置群头像', 'Set the group portrait'),
    a('_send_group_notice', '发布群公告', 'Publish a group notice'),
    a('_del_group_notice', '删除群公告', 'Delete a group notice'),
  ]) }),

  Object.freeze({ id: 'query', actions: Object.freeze([
    a('get_login_info', '获取登录账号信息', 'Get the logged-in account'),
    a('get_status', '获取运行状态', 'Get runtime status'),
    a('get_version_info', '获取版本信息', 'Get version info'),
    a('can_send_image', '是否可发送图片', 'Whether images can be sent'),
    a('can_send_record', '是否可发送语音', 'Whether voice can be sent'),
    a('get_friend_list', '获取好友列表', 'List friends'),
    a('get_friends_with_category', '获取带分组的好友列表', 'List friends by category'),
    a('get_unidirectional_friend_list', '获取单向好友列表', 'List one-way friends'),
    a('get_group_list', '获取群列表', 'List groups'),
    a('get_group_info', '获取群信息', 'Get group info'),
    a('get_group_detail_info', '获取群详细信息', 'Get detailed group info'),
    a('get_group_share_link', '获取群分享链接', 'Get a group share link'),
    a('get_group_member_list', '获取群成员列表', 'List group members'),
    a('get_group_member_info', '获取群成员信息', "Get a group member's info"),
    a('get_group_shut_list', '获取群禁言列表', 'List muted group members'),
    a('get_group_honor_info', '获取群荣誉信息', 'Get group honor info'),
    a('get_group_at_all_remain', '获取群 @全体 剩余次数', 'Remaining @all quota'),
    a('get_group_system_msg', '获取群系统消息', 'Get group system messages'),
    a('get_essence_msg_list', '获取群精华消息', 'List group essence messages'),
    a('_get_group_notice', '获取群公告', 'List group notices'),
    a('get_stranger_info', '获取陌生人信息', "Get a stranger's info"),
    a('nc_get_user_status', '获取用户在线状态', "Get a user's online status"),
  ]) }),

  Object.freeze({ id: 'interaction', actions: Object.freeze([
    a('send_poke', '发送戳一戳', 'Poke someone'),
    a('group_poke', '在群里戳一戳', 'Poke someone in a group'),
    a('friend_poke', '在私聊戳一戳', 'Poke a friend'),
    a('send_like', '给好友点赞', 'Give a friend ten likes'),
    a('set_msg_emoji_like', '给消息贴表情回应', 'React to a message with an emoji'),
    a('get_msg', '获取单条消息详情', 'Get one message by id'),
    a('delete_msg', '撤回消息', 'Recall a message'),
    a('fetch_ptt_text', '获取语音转文字结果', 'Get the transcript of a voice message'),
    a('_mark_all_as_read', '标记全部已读', 'Mark everything as read'),
    a('get_group_msg_history', '获取群历史消息', 'Read group message history'),
    a('get_friend_msg_history', '获取好友历史消息', 'Read private message history'),
    a('get_forward_msg', '获取合并转发内容', 'Expand a forwarded message'),
  ]) }),

  Object.freeze({ id: 'request', actions: Object.freeze([
    a('set_friend_add_request', '处理加好友请求', 'Handle a friend request'),
    a('set_group_add_request', '处理加群请求', 'Handle a group join request'),
  ]) }),

  Object.freeze({ id: 'profile', actions: Object.freeze([
    a('set_friend_remark', '设置好友备注', 'Set a friend remark'),
    a('set_self_longnick', '设置个性签名', 'Set the signature'),
    a('set_qq_profile', '设置 QQ 资料', 'Set the account profile'),
    a('set_qq_avatar', '设置 QQ 头像', 'Set the account avatar'),
    a('set_online_status', '设置在线状态', 'Set the online status'),
    a('set_input_status', '设置输入中状态', 'Show a typing indicator'),
  ]) }),

  Object.freeze({ id: 'qzone', actions: Object.freeze([
    a('send_qzone_msg', '发表 QQ 空间说说', 'Post to Qzone'),
    a('delete_qzone_msg', '删除 QQ 空间说说', 'Delete a Qzone post'),
    a('get_qzone_msg_list', '获取说说列表', 'List Qzone posts'),
    a('get_qzone_msg_detail', '获取说说详情', 'Get one Qzone post'),
    a('get_qzone_feeds', '获取好友动态', 'Read the Qzone friend feed'),
    a('comment_qzone', '评论说说', 'Comment on a Qzone post'),
    a('like_qzone', '点赞说说', 'Like a Qzone post'),
    a('unlike_qzone', '取消说说点赞', 'Unlike a Qzone post'),
    a('get_qzone_comment_list', '获取说说评论', 'List Qzone comments'),
    a('get_qzone_comment_replies', '获取评论楼中楼回复', 'List nested comment replies'),
    a('get_qzone_profile', '获取 QQ 空间资料', 'Get the Qzone profile'),
    a('set_qzone_profile', '修改 QQ 空间资料', 'Update the Qzone profile'),
  ]) }),
])

/** Every known action name, flattened. */
export const ALL_ACTIONS = Object.freeze(TOOL_GROUPS.flatMap((group) => group.actions.map((action) => action.name)))

/** Membership set for O(1) "is this a known action" checks. */
const KNOWN = new Set(ALL_ACTIONS)

/**
 * Whether a raw string is a known action.
 * @param action - candidate action name.
 * @returns true when the action is in the catalog.
 */
export function isKnownAction(action) {
  return KNOWN.has(String(action))
}

/**
 * The Chinese annotation for one action.
 * @param action - action name.
 * @returns the annotation, or the action name itself when it is not catalogued.
 */
export function actionLabel(action) {
  for (const group of TOOL_GROUPS) {
    for (const entry of group.actions) {
      if (entry.name === action) return entry.zh
    }
  }
  return String(action)
}

/**
 * Compute the actions a chat's agent may use, from one effective config.
 *
 * Three outcomes:
 *  - the master switch is off  → `null`: the tool is not registered at all, so
 *    the model never sees it;
 *  - every action is off        → `null`: registering a tool that can do nothing
 *    only wastes the model's attention;
 *  - otherwise                  → a Set of allowed action names.
 * @param config - the effective config (any missing field means "enabled").
 * @returns a Set of allowed actions, or null to skip registration entirely.
 */
export function computeAllowlist(config) {
  const source = config !== null && typeof config === 'object' ? config : {}
  if (source.onebotToolEnabled === false) return null
  const disabled = new Set(
    Array.isArray(source.onebotToolDisabled) ? source.onebotToolDisabled.map((item) => String(item)) : [],
  )
  const allowed = ALL_ACTIONS.filter((action) => !disabled.has(action))
  if (allowed.length === 0) return null
  return new Set(allowed)
}

/**
 * The enabled actions grouped by their operator-facing category, for the
 * channel prompt. Only groups with at least one enabled action appear, so the
 * prompt never advertises something the tool would refuse.
 * @param allow - the allowed action set from `computeAllowlist`.
 * @returns an array of `{ id, actions }`, in catalog order.
 */
export function enabledGroups(allow) {
  if (!(allow instanceof Set)) return []
  const groups = []
  for (const group of TOOL_GROUPS) {
    const actions = group.actions.filter((action) => allow.has(action.name))
    if (actions.length > 0) groups.push({ id: group.id, actions })
  }
  return groups
}
