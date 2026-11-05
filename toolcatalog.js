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
 * Every entry carries its Chinese annotation inline, so the tools page shows
 * "禁言群成员 / set_group_ban" without a second dictionary to keep in sync.
 */

/**
 * One catalogued action.
 * @typedef {{ name: string, zh: string, en: string }} ToolAction
 */

/**
 * One operator-facing group of actions.
 * @typedef {{ id: string, actions: ToolAction[] }} ToolGroup
 */

/** Build one frozen action entry. */
const a = (name, zh, en) => Object.freeze({ name, zh, en, standard: STANDARD_ACTIONS.has(name) })

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
  'get_image', 'get_record', 'upload_group_file', 'get_group_file_url', 'get_group_root_files',
  'get_group_files_by_folder', 'get_group_file_system_info', 'create_group_file_folder',
  'delete_group_folder', 'delete_group_file',
  // 查询
  'get_login_info', 'get_status', 'get_version_info', 'can_send_image', 'can_send_record',
  'get_friend_list', 'get_group_info', 'get_group_list', 'get_group_member_info',
  'get_group_member_list', 'get_group_honor_info', 'get_group_system_msg', 'get_stranger_info',
  // 群管理
  'set_group_ban', 'set_group_whole_ban', 'set_group_admin', 'set_group_card', 'set_group_name',
  'set_group_leave', 'set_group_kick', 'set_group_special_title',
  // 请求处理
  'set_friend_add_request', 'set_group_add_request',
]))

/** The operator-facing grouping. Order is the order shown in the tools page. */
export const TOOL_GROUPS = Object.freeze([
  Object.freeze({ id: 'message', actions: Object.freeze([
    a('send_private_msg', '发送私聊消息', 'Send a private message'),
    a('send_group_msg', '发送群消息', 'Send a group message'),
    a('send_msg', '发送消息（按上下文自动区分私聊/群）', 'Send a message, private or group'),
  ]) }),

  Object.freeze({ id: 'media', actions: Object.freeze([
    a('upload_group_file', '上传文件到群', 'Upload a file to a group'),
    a('upload_private_file', '上传文件到私聊', 'Upload a file in a private chat'),
    a('get_image', '获取图片文件', 'Fetch an image file'),
    a('get_record', '获取语音文件', 'Fetch a voice recording'),
    a('get_file', '获取文件', 'Fetch a file'),
    a('download_file', '下载网络文件到本地', 'Download a remote file to disk'),
    a('get_group_file_url', '获取群文件下载链接', 'Get a group file download link'),
    a('get_private_file_url', '获取私聊文件下载链接', 'Get a private file download link'),
    a('get_group_root_files', '列出群根目录文件', 'List a group root file directory'),
    a('get_group_files_by_folder', '列出群文件夹内容', 'List a group folder'),
    a('get_group_file_system_info', '获取群文件系统信息', 'Get group file system info'),
    a('create_group_file_folder', '创建群文件夹', 'Create a group folder'),
    a('delete_group_folder', '删除群文件夹', 'Delete a group folder'),
    a('delete_group_file', '删除群文件', 'Delete a group file'),
    a('move_group_file', '移动群文件', 'Move a group file'),
    a('rename_group_file', '重命名群文件', 'Rename a group file'),
  ]) }),

  Object.freeze({ id: 'group', actions: Object.freeze([
    a('set_group_ban', '禁言群成员', 'Mute a group member'),
    a('set_group_kick', '踢出群成员', 'Kick a group member'),
    a('set_group_kick_members', '批量踢出群成员', 'Kick several members at once'),
    a('set_group_whole_ban', '全员禁言开关', 'Toggle whole-group mute'),
    a('set_group_admin', '设置/取消群管理员', 'Set or unset a group admin'),
    a('set_group_card', '设置群名片', "Set a member's group card"),
    a('set_group_name', '修改群名称', 'Rename the group'),
    a('set_group_leave', '退出群聊', 'Leave a group'),
    a('set_group_special_title', '设置群专属头衔', "Set a member's special title"),
    a('set_group_remark', '设置群备注', 'Set a remark for the group'),
    a('set_group_portrait', '设置群头像', 'Set the group portrait'),
    a('set_group_todo', '设置群待办', 'Pin a message as a group todo'),
    a('complete_group_todo', '完成群待办', 'Complete a group todo'),
    a('cancel_group_todo', '取消群待办', 'Cancel a group todo'),
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
    a('get_group_info_ex', '获取群详细信息（扩展）', 'Get extended group info'),
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
    a('get_recent_contact', '获取最近会话', 'List recent conversations'),
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
    a('mark_msg_as_read', '标记消息已读', 'Mark a message as read'),
    a('mark_group_msg_as_read', '标记群聊已读', 'Mark a group chat as read'),
    a('mark_private_msg_as_read', '标记私聊已读', 'Mark a private chat as read'),
    a('_mark_all_as_read', '标记全部已读', 'Mark everything as read'),
    a('get_group_msg_history', '获取群历史消息', 'Read group message history'),
    a('get_friend_msg_history', '获取好友历史消息', 'Read private message history'),
    a('get_forward_msg', '获取合并转发内容', 'Expand a forwarded message'),
    a('send_forward_msg', '发送合并转发消息', 'Send a merged forward'),
    a('send_group_forward_msg', '发送群合并转发', 'Send a merged forward to a group'),
    a('send_private_forward_msg', '发送私聊合并转发', 'Send a merged forward privately'),
    a('forward_group_single_msg', '转发单条消息到群', 'Forward one message to a group'),
    a('forward_friend_single_msg', '转发单条消息给好友', 'Forward one message to a friend'),
  ]) }),

  Object.freeze({ id: 'request', actions: Object.freeze([
    a('set_friend_add_request', '处理加好友请求', 'Handle a friend request'),
    a('set_group_add_request', '处理加群请求', 'Handle a group join request'),
    a('get_doubt_friends_add_request', '获取可疑好友申请', 'List suspicious friend requests'),
    a('set_doubt_friends_add_request', '处理可疑好友申请', 'Handle a suspicious friend request'),
    a('get_group_ignore_add_request', '获取被忽略的加群请求', 'List ignored join requests'),
    a('set_group_add_option', '设置群加群方式', 'Set how the group is joinable'),
    a('set_group_member_invite_policy', '设置群邀请策略', 'Set the group invite policy'),
    a('set_group_member_permissions', '设置群成员功能权限', 'Set member feature permissions'),
    a('set_group_new_member_history_visibility', '设置新成员可见历史消息', 'Set history visibility for new members'),
  ]) }),

  Object.freeze({ id: 'profile', actions: Object.freeze([
    a('set_friend_remark', '设置好友备注', 'Set a friend remark'),
    a('set_self_longnick', '设置个性签名', 'Set the signature'),
    a('set_qq_profile', '设置 QQ 资料', 'Set the account profile'),
    a('set_qq_avatar', '设置 QQ 头像', 'Set the account avatar'),
    a('set_online_status', '设置在线状态', 'Set the online status'),
    a('set_diy_online_status', '设置自定义在线状态', 'Set a custom online status'),
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
    a('set_qzone_msg_right', '修改说说权限', 'Set Qzone post visibility'),
    a('set_qzone_ban', '设置 QQ 空间访问限制', 'Set Qzone access limits'),
  ]) }),

  Object.freeze({ id: 'album', actions: Object.freeze([
    a('get_qun_album_list', '获取群相册列表', 'List group albums'),
    a('get_group_album_media_list', '获取群相册媒体列表', 'List media in a group album'),
    a('upload_image_to_qun_album', '上传图片到群相册', 'Upload an image to a group album'),
    a('upload_images_to_qun_album', '批量上传图片到群相册', 'Upload several images to a group album'),
    a('upload_video_to_qun_album', '上传视频到群相册', 'Upload a video to a group album'),
    a('do_group_album_comment', '发表群相册评论', 'Comment on group album media'),
    a('del_group_album_media', '删除群相册媒体', 'Delete group album media'),
    a('set_group_album_media_like', '点赞群相册媒体', 'Like group album media'),
    a('cancel_group_album_media_like', '取消点赞群相册媒体', 'Unlike group album media'),
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
