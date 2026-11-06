/**
 * Structured documentation for every action in `toolcatalog.js`.
 *
 * `onebot_call` is one generic escape hatch, so the model only learns what an
 * action does and which parameters it takes from the prompt. Keeping that
 * knowledge here, as data, has three benefits:
 *
 *  1. the Tools page renders one collapsible prompt per action from the same
 *     source the channel prompt uses, so the UI and the model never drift;
 *  2. an operator can override a single action's prompt without editing code;
 *  3. tests can assert that every catalogued action has a doc, so adding an
 *     action without describing it fails loudly.
 *
 * Each entry is `{ params: Param[], summary?, note? }`. A `Param` is
 * `{ name, type, required, desc }`. `type` is one of the labels in
 * `TYPE_LABELS`; `required` is a boolean. Nothing here talks to the gateway — it
 * is pure reference data.
 *
 * Coverage comes from the OneBot 11 specification and NapCat's published API
 * reference. Parameter descriptions are best-effort and editable from the Tools
 * page, so a slightly stale detail on an obscure action can be corrected without
 * a release.
 */

/** Human labels for parameter types, used in the generated prompt. */
export const TYPE_LABELS = Object.freeze({
  number: '数字',
  string: '文本',
  boolean: '布尔',
  message: '消息段/文本',
  array: '数组',
  object: '对象',
  enum: '枚举',
})

/** Build one frozen parameter doc. */
const P = (name, type, required, desc) => Object.freeze({ name, type, required, desc })

// --- shared parameters (frozen, referenced by many actions) ---
const groupId = P('group_id', 'number', true, '群号')
const userId = P('user_id', 'number', true, 'QQ 号')
const message = P('message', 'message', true, '要发送的消息：字符串，或消息段数组，如 [{"type":"text","data":{"text":"hi"}}]')
const autoEscape = P('auto_escape', 'boolean', false, '为 true 时按纯文本发送，不解析 CQ 码')
const messageId = P('message_id', 'number', true, '消息 ID（从收到的消息或日志中获取）')
const noCache = P('no_cache', 'boolean', false, '为 true 时强制刷新、不走缓存')

/**
 * The structured docs, keyed by action name.
 * @type {Readonly<Record<string, { params: ReadonlyArray<object>, summary?: string, note?: string }>>}
 */
export const ACTION_DOCS = Object.freeze({
  // --- 发送消息 ---
  send_private_msg: {
    params: [userId, message, autoEscape],
  },
  send_group_msg: {
    params: [groupId, message, autoEscape],
  },
  send_msg: {
    params: [
      P('message_type', 'enum', false, '"private" 或 "group"；不填则按当前会话自动判断'),
      P('user_id', 'number', false, '私聊时的目标 QQ 号（message_type=private 时必填）'),
      P('group_id', 'number', false, '群聊时的群号（message_type=group 时必填）'),
      message,
      autoEscape,
    ],
    note: '私聊填 user_id，群聊填 group_id，按 message_type 二选一。',
  },

  // --- 媒体与文件 ---
  upload_group_file: {
    params: [
      groupId,
      P('file', 'string', true, '本机文件绝对路径，或 http(s) 链接'),
      P('name', 'string', true, '在群里显示的文件名'),
      P('folder', 'string', false, '目标文件夹 ID；不填则上传到根目录'),
    ],
  },
  upload_private_file: {
    params: [
      userId,
      P('file', 'string', true, '本机文件绝对路径，或 http(s) 链接'),
      P('name', 'string', true, '显示的文件名'),
    ],
  },
  get_image: {
    params: [P('file', 'string', true, '图片文件名或本地路径，通常取自消息段的 file 字段')],
  },
  get_record: {
    params: [
      P('file', 'string', true, '语音文件名或本地路径，通常取自消息段的 file 字段'),
      P('out_format', 'string', false, '转码输出格式，如 mp3、amr；不填则保持原格式'),
    ],
  },
  get_file: {
    params: [P('file', 'string', true, '文件名或路径，通常取自消息段的 file / file_id 字段')],
  },
  download_file: {
    params: [
      P('url', 'string', true, '要下载的 http(s) 链接'),
      P('base64', 'string', false, '备用：直接提供文件内容的 base64'),
      P('name', 'string', false, '保存的文件名'),
      P('headers', 'object', false, '下载请求的自定义请求头'),
    ],
  },
  get_group_file_url: {
    params: [groupId, P('file_id', 'string', true, '群文件 ID')],
  },
  get_private_file_url: {
    params: [userId, P('file_id', 'string', true, '私聊文件 ID')],
  },
  get_group_root_files: {
    params: [groupId],
  },
  get_group_files_by_folder: {
    params: [groupId, P('folder_id', 'string', true, '文件夹 ID')],
  },
  get_group_file_system_info: {
    params: [groupId],
  },
  create_group_file_folder: {
    params: [
      groupId,
      P('name', 'string', true, '新文件夹名称'),
      P('parent_id', 'string', false, '父文件夹 ID；不填则在根目录创建'),
    ],
  },
  delete_group_folder: {
    params: [groupId, P('folder_id', 'string', true, '要删除的文件夹 ID')],
  },
  delete_group_file: {
    params: [groupId, P('file_id', 'string', true, '要删除的群文件 ID')],
  },
  move_group_file: {
    params: [
      groupId,
      P('file_id', 'string', true, '要移动的文件 ID'),
      P('current_parent_directory', 'string', true, '文件当前所在文件夹 ID（根目录用空字符串）'),
      P('target_parent_directory', 'string', true, '目标文件夹 ID（根目录用空字符串）'),
    ],
  },
  rename_group_file: {
    params: [
      groupId,
      P('file_id', 'string', true, '文件 ID'),
      P('current_parent_directory', 'string', true, '文件所在文件夹 ID（根目录用空字符串）'),
      P('new_name', 'string', true, '新的文件名'),
    ],
  },

  // --- 群管理 ---
  set_group_ban: {
    params: [groupId, userId, P('duration', 'number', true, '禁言秒数；0 表示解除禁言')],
  },
  set_group_kick: {
    params: [groupId, userId, P('reject_add_request', 'boolean', false, '是否同时拒绝其再次加群申请')],
  },
  set_group_kick_members: {
    params: [
      groupId,
      P('user_id', 'array', true, '要踢出的 QQ 号数组'),
      P('reject_add_request', 'boolean', false, '是否同时拒绝其再次加群申请'),
    ],
  },
  set_group_whole_ban: {
    params: [groupId, P('enable', 'boolean', true, 'true 全员禁言，false 解除')],
  },
  set_group_admin: {
    params: [groupId, userId, P('enable', 'boolean', true, 'true 设为管理员，false 取消')],
  },
  set_group_card: {
    params: [groupId, userId, P('card', 'string', true, '新的群名片；空字符串表示清空')],
  },
  set_group_name: {
    params: [groupId, P('group_name', 'string', true, '新的群名称')],
  },
  set_group_leave: {
    params: [groupId, P('is_dismiss', 'boolean', false, '仅群主有效：true 表示解散群')],
  },
  set_group_special_title: {
    params: [
      groupId,
      userId,
      P('special_title', 'string', true, '专属头衔；空字符串表示取消'),
      P('duration', 'number', false, '有效期秒数，-1 表示永久'),
    ],
  },
  set_group_remark: {
    params: [groupId, P('remark', 'string', true, '群备注')],
  },
  set_group_portrait: {
    params: [groupId, P('file', 'string', true, '新群头像的本机路径或 http(s) 链接')],
  },
  set_group_todo: {
    params: [groupId, messageId],
  },
  complete_group_todo: {
    params: [groupId, messageId],
  },
  cancel_group_todo: {
    params: [groupId, messageId],
  },
  _send_group_notice: {
    params: [
      groupId,
      P('content', 'string', true, '公告正文'),
      P('image', 'string', false, '公告附图的本地路径或链接'),
      P('pinned', 'number', false, '是否置顶（1 置顶 / 0 不置顶）'),
    ],
  },
  _del_group_notice: {
    params: [groupId, P('notice_id', 'string', true, '要删除的公告 ID')],
  },

  // --- 查询与信息 ---
  get_login_info: { params: [] },
  get_status: { params: [] },
  get_version_info: { params: [] },
  can_send_image: { params: [] },
  can_send_record: { params: [] },
  get_friend_list: { params: [] },
  get_friends_with_category: { params: [] },
  get_unidirectional_friend_list: { params: [] },
  get_group_list: { params: [] },
  get_group_info: {
    params: [groupId, noCache],
  },
  get_group_detail_info: {
    params: [groupId],
  },
  get_group_info_ex: {
    params: [groupId],
  },
  get_group_share_link: {
    params: [groupId],
  },
  get_group_member_list: {
    params: [groupId, noCache],
  },
  get_group_member_info: {
    params: [groupId, userId, noCache],
  },
  get_group_shut_list: {
    params: [groupId],
  },
  get_group_honor_info: {
    params: [groupId, P('type', 'enum', false, 'talkative/performer/legend/strong_newbie/emotion/all，默认 all')],
  },
  get_group_at_all_remain: {
    params: [groupId],
  },
  get_group_system_msg: { params: [] },
  get_essence_msg_list: {
    params: [groupId],
  },
  _get_group_notice: {
    params: [groupId],
  },
  get_stranger_info: {
    params: [userId, noCache],
  },
  nc_get_user_status: {
    params: [userId],
  },
  get_recent_contact: {
    params: [P('count', 'number', false, '返回的最近会话数量')],
  },

  // --- 互动与消息操作 ---
  send_poke: {
    params: [userId, P('group_id', 'number', false, '在群里戳时填群号')],
  },
  group_poke: {
    params: [groupId, userId],
  },
  friend_poke: {
    params: [userId],
  },
  send_like: {
    params: [
      userId,
      P('times', 'number', false, '点赞次数，默认 10'),
    ],
  },
  set_msg_emoji_like: {
    params: [
      messageId,
      P('emoji_id', 'string', true, '表情 ID'),
      P('set', 'boolean', false, 'true 贴表情，false 取消'),
    ],
  },
  get_msg: {
    params: [messageId],
  },
  delete_msg: {
    params: [messageId],
  },
  fetch_ptt_text: {
    params: [messageId],
    summary: '获取一条语音消息的转文字结果',
  },
  mark_msg_as_read: {
    params: [messageId],
  },
  mark_group_msg_as_read: {
    params: [groupId],
  },
  mark_private_msg_as_read: {
    params: [userId],
  },
  _mark_all_as_read: { params: [] },
  get_group_msg_history: {
    params: [
      groupId,
      P('message_seq', 'number', false, '起始消息序号；不填从最新开始'),
      P('count', 'number', false, '拉取条数'),
    ],
  },
  get_friend_msg_history: {
    params: [
      userId,
      P('message_seq', 'number', false, '起始消息序号；不填从最新开始'),
      P('count', 'number', false, '拉取条数'),
    ],
  },
  get_forward_msg: {
    params: [P('message_id', 'string', true, '合并转发消息的 ID')],
  },
  send_forward_msg: {
    params: [
      P('messages', 'array', true, '合并转发的消息节点数组（每项含 type:"node" 与 data）'),
      P('group_id', 'number', false, '发送到该群'),
      P('user_id', 'number', false, '发送给该好友'),
    ],
    note: 'group_id 与 user_id 二选一，指定发送目标。',
  },
  send_group_forward_msg: {
    params: [groupId, P('messages', 'array', true, '合并转发的消息节点数组')],
  },
  send_private_forward_msg: {
    params: [userId, P('messages', 'array', true, '合并转发的消息节点数组')],
  },
  forward_group_single_msg: {
    params: [groupId, P('message_id', 'number', true, '要转发的消息 ID')],
  },
  forward_friend_single_msg: {
    params: [userId, P('message_id', 'number', true, '要转发的消息 ID')],
  },

  // --- 请求处理 ---
  set_friend_add_request: {
    params: [
      P('flag', 'string', true, '请求的 flag（从收到的好友请求事件中获取）'),
      P('approve', 'boolean', true, 'true 同意，false 拒绝'),
      P('remark', 'string', false, '同意时设置的好友备注'),
    ],
  },
  set_group_add_request: {
    params: [
      P('flag', 'string', true, '请求的 flag'),
      P('sub_type', 'enum', true, '"add" 加群 或 "invite" 邀请'),
      P('approve', 'boolean', true, 'true 同意，false 拒绝'),
      P('reason', 'string', false, '拒绝理由'),
    ],
  },
  get_doubt_friends_add_request: {
    params: [P('count', 'number', false, '返回数量')],
  },
  set_doubt_friends_add_request: {
    params: [
      P('flag', 'string', true, '请求的 flag'),
      P('approve', 'boolean', true, 'true 同意，false 拒绝'),
    ],
  },
  get_group_ignore_add_request: { params: [] },
  set_group_add_option: {
    params: [groupId, P('option', 'object', true, '加群选项对象，包含 add_type 等字段')],
  },
  set_group_member_invite_policy: {
    params: [groupId, P('policy', 'number', true, '邀请策略编号')],
  },
  set_group_member_permissions: {
    params: [groupId, P('permissions', 'object', true, '成员功能权限对象')],
  },
  set_group_new_member_history_visibility: {
    params: [groupId, P('visibility', 'number', true, '可见范围编号')],
  },

  // --- 账号资料 ---
  set_friend_remark: {
    params: [userId, P('remark', 'string', true, '好友备注')],
  },
  set_self_longnick: {
    params: [P('longNick', 'string', true, '个性签名')],
  },
  set_qq_profile: {
    params: [
      P('nickname', 'string', false, '昵称'),
      P('company', 'string', false, '公司'),
      P('email', 'string', false, '邮箱'),
      P('college', 'string', false, '学校'),
      P('personal_note', 'string', false, '个人说明'),
    ],
  },
  set_qq_avatar: {
    params: [P('file', 'string', true, '新头像的本机路径或 http(s) 链接')],
  },
  set_online_status: {
    params: [
      P('status', 'number', true, '在线状态编号'),
      P('ext_status', 'number', false, '扩展状态编号'),
      P('battery_status', 'number', false, '电量状态编号'),
    ],
  },
  set_diy_online_status: {
    params: [
      P('face_id', 'number', true, '自定义状态图标 ID'),
      P('face_type', 'number', true, '图标类型'),
      P('wording', 'string', true, '状态文字'),
      P('face_url', 'string', false, '自定义图标链接'),
    ],
  },
  set_input_status: {
    params: [userId, P('event_type', 'number', true, '0 表示“输入中”，1 表示“取消输入”')],
  },

  // --- QQ 空间 ---
  send_qzone_msg: {
    params: [P('message', 'array', true, '说说内容的消息段数组（文本/图片等）')],
  },
  delete_qzone_msg: {
    params: [P('tid', 'string', true, '说说的 tid')],
  },
  get_qzone_msg_list: {
    params: [P('count', 'number', false, '返回条数')],
  },
  get_qzone_msg_detail: {
    params: [P('tid', 'string', true, '说说的 tid')],
  },
  get_qzone_feeds: {
    params: [P('count', 'number', false, '返回条数')],
  },
  comment_qzone: {
    params: [P('tid', 'string', true, '说说的 tid'), P('content', 'string', true, '评论内容')],
  },
  like_qzone: {
    params: [P('tid', 'string', true, '说说的 tid')],
  },
  unlike_qzone: {
    params: [P('tid', 'string', true, '说说的 tid')],
  },
  get_qzone_comment_list: {
    params: [P('tid', 'string', true, '说说的 tid')],
  },
  get_qzone_comment_replies: {
    params: [P('tid', 'string', true, '说说的 tid'), P('comment_id', 'string', true, '评论 ID')],
  },
  get_qzone_profile: {
    params: [P('target_qq', 'number', false, '要查看的 QQ 号；不填为本人')],
  },
  set_qzone_profile: {
    params: [P('profile', 'object', true, '要修改的 QQ 空间资料对象（昵称、签名等）')],
  },
  set_qzone_msg_right: {
    params: [P('tid', 'string', true, '说说的 tid'), P('right', 'number', true, '可见权限编号')],
  },
  set_qzone_ban: {
    params: [P('target_qq', 'number', true, '目标 QQ 号'), P('duration', 'number', true, '限制时长秒数')],
  },

  // --- 群相册 ---
  get_qun_album_list: {
    params: [groupId],
  },
  get_group_album_media_list: {
    params: [groupId, P('album_id', 'string', true, '相册 ID')],
  },
  upload_image_to_qun_album: {
    params: [
      groupId,
      P('album_id', 'string', true, '相册 ID'),
      P('file', 'string', true, '图片的本机路径或 http(s) 链接'),
      P('name', 'string', false, '图片名称'),
    ],
  },
  upload_images_to_qun_album: {
    params: [
      groupId,
      P('album_id', 'string', true, '相册 ID'),
      P('files', 'array', true, '图片路径或链接的数组'),
    ],
  },
  upload_video_to_qun_album: {
    params: [
      groupId,
      P('album_id', 'string', true, '相册 ID'),
      P('file', 'string', true, '视频的本机路径或 http(s) 链接'),
      P('name', 'string', false, '视频名称'),
    ],
  },
  do_group_album_comment: {
    params: [
      groupId,
      P('album_id', 'string', true, '相册 ID'),
      P('lloc', 'string', true, '媒体在相册中的 lloc 标识'),
      P('content', 'string', true, '评论内容'),
    ],
  },
  del_group_album_media: {
    params: [groupId, P('album_id', 'string', true, '相册 ID'), P('lloc', 'string', true, '媒体 lloc 标识')],
  },
  set_group_album_media_like: {
    params: [groupId, P('album_id', 'string', true, '相册 ID'), P('lloc', 'string', true, '媒体 lloc 标识')],
  },
  cancel_group_album_media_like: {
    params: [groupId, P('album_id', 'string', true, '相册 ID'), P('lloc', 'string', true, '媒体 lloc 标识')],
  },

  // --- 本地工具（包装标准动作，不直接转发网关） ---
  send_message: {
    params: [
      P('text', 'string', false, '要发送的文字。可与媒体同时给，合成一条消息；也可以只发文字'),
      P('kind', 'enum', false, '"image" 图片、"record" 语音、"video" 视频、"file" 文件。只发文字时省略'),
      P('path', 'string', false, '媒体在本机的绝对路径；插件会读成 base64 内联发送，接收方无需访问本机文件'),
      P('url', 'string', false, '可直接下载的媒体 http(s) 链接（与 path / base64 三选一）'),
      P('base64', 'string', false, '原始 base64 媒体内容（不带 data: 前缀，与 path / url 三选一）'),
      P('name', 'string', false, '显示的文件名，仅 kind="file" 时使用'),
      P('chatType', 'enum', false, '"private" 私聊 或 "group" 群聊；省略则用当前会话'),
      P('chatId', 'string', false, '目标 QQ 号或群号；省略则用当前会话'),
    ],
    summary: '向 QQ 会话发送一条消息，支持六种组合：纯文字、纯图片、文字+图片、纯语音、纯视频、纯文件',
    note: '六种组合：'
      + '①纯文字 params={"text":"..."}；'
      + '②纯图片 params={"kind":"image","path":"/绝对/路径.png"}；'
      + '③文字+图片 params={"text":"...","kind":"image","path":"..."}（合成同一条消息）；'
      + '④纯语音 params={"kind":"record","path":"/绝对/路径.wav"}；'
      + '⑤纯视频 params={"kind":"video","path":"/绝对/路径.mp4"}；'
      + '⑥纯文件 params={"kind":"file","path":"/绝对/路径.zip","name":"显示名.zip"}。'
      + '要发到其他会话时，任意组合再加 "chatType":"group","chatId":"群号"。'
      + 'text 与 kind 至少给一个；kind 填了就还要给 path / url / base64 之一。'
      + '发本地文件前先用 list_files 确认文件名。',
  },
  list_files: {
    params: [
      P('dir', 'string', true, '宿主机上的绝对目录路径，如 /workspace/QQ'),
      P('filter', 'string', false, '可选的、不区分大小写的文件名子串过滤'),
      P('limit', 'number', false, '最多返回多少条，默认 100，上限 500'),
    ],
    summary: '列出宿主机某个目录下的文件，发本地文件前用它确认真实文件名',
  },
})

/**
 * One parameter rendered for a prompt: `名称（类型，必填/可选）：说明`.
 * @param param - a `{ name, type, required, desc }` entry.
 * @returns the rendered fragment.
 */
function renderParam(param) {
  const type = TYPE_LABELS[param.type] ?? param.type
  const need = param.required ? '必填' : '可选'
  return param.name + '（' + type + '，' + need + '）：' + param.desc
}

/**
 * The built-in prompt for one action, as a single line.
 *
 * Shape: `功能：…。参数：a（…）：…；b（…）：…。用法：onebot_call(action="x", params={"a":…, "b":…})。`
 * Actions with no parameters say `无需参数。` and omit `params`.
 * @param name - action name.
 * @param zh - the Chinese annotation, used as the function summary fallback.
 * @returns the default prompt text.
 */
export function actionPrompt(name, zh) {
  const doc = ACTION_DOCS[name] ?? { params: [] }
  const params = Array.isArray(doc.params) ? doc.params : []
  const parts = []
  parts.push('功能：' + (typeof doc.summary === 'string' && doc.summary !== '' ? doc.summary : zh) + '。')
  if (params.length === 0) {
    parts.push('无需参数。')
  } else {
    parts.push('参数：' + params.map(renderParam).join('；') + '。')
  }
  const callParams = params.length === 0
    ? ''
    : ', params={' + params.map((param) => '"' + param.name + '":…').join(', ') + '}'
  parts.push('用法：onebot_call(action="' + name + '"' + callParams + ')。')
  if (typeof doc.note === 'string' && doc.note !== '') parts.push(doc.note)
  return parts.join('')
}
