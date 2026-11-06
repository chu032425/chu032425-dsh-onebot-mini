/**
 * `onebot_call` 工具可以转发的 OneBot 动作，按「工具」页的分组整理。
 *
 * `onebot_call` 始终只是一个通用入口；这份目录只说明运营者能开关哪些动作。
 * 它是白名单：不在这里的动作、或被运营者关掉的动作，会被工具直接拒绝，不会发到
 * 网关。
 *
 * 覆盖范围来自 NapCat 公开的接口文档。有三类刻意不收，因为交给模型会泄露密钥
 * 或弄坏运行中的机器人：
 *
 *  - 凭据与密钥：get_credentials、get_csrf_token、get_cookies、get_rkey、
 *    nc_get_rkey、get_rkey_server、get_clientkey；
 *  - 自毁操作：set_restart、bot_exit、clean_cache、clean_stream_temp_file；
 *  - 原始协议：send_packet、nc_get_packet_status，以及流式上传/下载端点。
 *
 * 另外还有一批偏门或平台相关的也没收：闪传与在线文件、自定义表情、群打卡、
 * 频道、Ark 分享卡片、内联键盘按钮、仅 Windows 可用的 ocr_image，以及那一对
 * AI 语音动作。
 *
 * 按运营者要求又精简过一轮，好让工具面保持小：整个群相册家族、QQ 空间的两个
 * 权限动作、自定义在线状态、请求处理里除两个加好友/加群之外的全部、各会话的
 * 已读标记、合并与单条转发、扩展群查询与最近会话、批量踢人 / 群管理员 / 群待办，
 * 以及群文件的上传、列表与文件夹管理一整组。它们是从目录、文档和提示词里一起
 * 删掉的，不是仅仅关掉。
 *
 * 每个条目自带中文注释，所以「工具」页直接显示「禁言群成员 / set_group_ban」，
 * 不用再维护第二份词典。
 */

import { ACTION_DOCS, actionPrompt } from './actiondocs.js'

/**
 * 一条被收录的动作。
 * @typedef {{ name: string, zh: string, en: string, standard: boolean, params: ReadonlyArray<object>, defaultPrompt: string }} ToolAction
 */

/**
 * 一组面向运营者的动作。
 * @typedef {{ id: string, actions: ToolAction[] }} ToolGroup
 */

/**
 * 造一条冻结的动作条目。
 *
 * `params` 与 `defaultPrompt` 都来自 `actiondocs.js`，这样「工具」页和频道提示词
 * 对同一个动作的描述永远一致。`defaultPrompt` 是内置文案，运营者可以在配置里
 * 逐个动作覆盖它。
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

/** 每个动作分组的中文标题，频道提示词里用。 */
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
 * 属于 OneBot 11 标准协议的动作名。目录里其余的都属于实现扩展
 * （go-cqhttp / NapCat），「工具」页据此给每一行打「标准」或「扩展」徽章。
 * 这里是唯一权威来源。
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
 * 在本插件内部实现、不转发给网关的动作。它们共用同一个 `onebot_call` 工具：
 * 工具先把这些名字派给本地处理器，剩下的才落到 OneBot 传输层。
 */
export const LOCAL_ACTIONS = Object.freeze(new Set(['send_message', 'list_files']))

/** 面向运营者的分组。这里的顺序就是「工具」页显示的顺序。 */
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

/** 全部已知动作名，压平成一维。 */
export const ALL_ACTIONS = Object.freeze(TOOL_GROUPS.flatMap((group) => group.actions.map((action) => action.name)))

/** 用于 O(1) 判断「是不是已知动作」的集合。 */
const KNOWN = new Set(ALL_ACTIONS)

/**
 * 判断一个原始字符串是不是已知动作。
 * @param action - 候选动作名。
 * @returns 在目录里则为 true。
 */
export function isKnownAction(action) {
  return KNOWN.has(String(action))
}

/**
 * 一个动作的中文注释。
 * @param action - 动作名。
 * @returns 注释；没有收录时退回动作名本身。
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
 * 从一份生效配置算出某个会话的 agent 能用哪些动作。
 *
 * 三种结果：
 *  - 总开关关闭 → `null`：工具根本不注册，模型看不到它；
 *  - 一个动作都不剩 → `null`：注册一个什么都做不了的工具只是浪费模型的注意力；
 *  - 其它情况 → 允许的动作名集合。
 * @param config - 生效配置（字段缺失按「启用」处理）。
 * @returns 允许的动作集合；返回 null 表示完全跳过注册。
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
 * 按面向运营者的分类把已启用动作分组，供频道提示词使用。只出现至少有一个启用
 * 动作的分组，提示词因此绝不会宣传一个工具会拒绝的动作。
 * @param allow - `computeAllowlist` 给出的允许集合。
 * @returns `{ id, actions }` 数组，按目录顺序。
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
