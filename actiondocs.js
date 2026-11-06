/**
 * `toolcatalog.js` 里每个动作的结构化说明。
 *
 * `onebot_call` 只是一个通用入口，所以模型只能从提示词里知道某个动作干什么、
 * 要哪些参数。把这些知识当作数据放在这里，有三个好处：
 *
 *  1. 「工具」页和频道提示词用同一份来源渲染，界面和模型不会说两套话；
 *  2. 运营者可以覆盖单个动作的提示词，不必改代码；
 *  3. 测试可以断言「每个收录的动作都有说明」，漏写说明时会直接报错。
 *
 * 每条是 `{ params: Param[], summary?, note? }`；`Param` 是
 * `{ name, type, required, desc }`，`type` 取 `TYPE_LABELS` 里的标签，
 * `required` 是布尔值。这里不跟网关打交道，纯粹是参考资料。
 *
 * 覆盖范围来自 OneBot 11 规范与 NapCat 公开的接口文档。参数说明是尽力而为的，
 * 也能在「工具」页直接改，所以某个偏门动作写得过时了，不用发版就能修正。
 */

/** 参数类型的中文标签，生成提示词时用。 */
const TYPE_LABELS = Object.freeze({
  number: '数字',
  string: '文本',
  boolean: '布尔',
  message: '消息段/文本',
  array: '数组',
  object: '对象',
  enum: '枚举',
})

/** 造一条冻结的参数说明。 */
const P = (name, type, required, desc) => Object.freeze({ name, type, required, desc })

// --- 共用参数（已冻结，被许多动作引用） ---
const groupId = P('group_id', 'number', true, '群号')
const userId = P('user_id', 'number', true, 'QQ 号')
const message = P('message', 'message', true, '要发送的消息：字符串，或消息段数组，如 [{"type":"text","data":{"text":"hi"}}]')
const autoEscape = P('auto_escape', 'boolean', false, '为 true 时按纯文本发送，不解析 CQ 码')
const messageId = P('message_id', 'number', true, '消息 ID（从收到的消息或日志中获取）')
const noCache = P('no_cache', 'boolean', false, '为 true 时强制刷新、不走缓存')

/**
 * 结构化说明，按动作名索引。
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
  // 在线文件：QQ 的「在线文件」传输不走普通消息段，消息本身会是空的，
  // 需要这几个动作单独取回。仅私聊。
  get_online_file_msg: {
    params: [P('user_id', 'string', true, '对方 QQ 号（仅私聊）')],
    note: '在对方说发了文件、但消息里没有 file 段或 [文件: …] 占位符时使用；返回里的 msg_id / element_id 用于接收。列表里没有新文件，说明那条空消息只是文件传输回执，不要回复。',
  },
  receive_online_file: {
    params: [
      P('user_id', 'string', true, '对方 QQ 号（仅私聊）'),
      P('msg_id', 'string', true, '在线文件消息 ID，取自 get_online_file_msg 的结果'),
      P('element_id', 'string', true, '文件元素 ID，取自 get_online_file_msg 的结果'),
    ],
    note: '接收并下载这个在线文件；下载完成后用 get_file 或返回的路径读取内容，再据内容回答。',
  },
  get_private_file_url: {
    params: [P('file_id', 'string', true, '私聊文件 ID，取自 file 段的 file_id 字段')],
    note: '拿到私聊文件的下载直链；链接有时效，取到后尽快用 download_file 下载。',
  },
  // --- 群管理 ---
  set_group_ban: {
    params: [groupId, userId, P('duration', 'number', true, '禁言秒数；0 表示解除禁言')],
  },
  set_group_kick: {
    params: [groupId, userId, P('reject_add_request', 'boolean', false, '是否同时拒绝其再次加群申请')],
  },
  set_group_whole_ban: {
    params: [groupId, P('enable', 'boolean', true, 'true 全员禁言，false 解除')],
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
  // --- 本地工具（包装标准动作，不直接转发网关） ---
  get_action_doc: {
    params: [P('name', 'string', true, '要查看详细说明的动作名，如 set_group_ban')],
    summary: '获取指定动作的详细说明（功能、每个参数与调用示例）',
    note: '系统提示里只列动作名和中文注释，所以要调用某个动作前先用它查清参数与用法；只对已启用的动作返回说明。',
  },
  send_message: {
    params: [
      P('text', 'string', false, '要发送的文字。只有图片能和文字合成一条消息；语音/视频/文件必须单独发'),
      P('kind', 'enum', false, '"image" 图片、"record" 语音、"video" 视频、"file" 文件。只发文字时省略'),
      P('path', 'string', false, '媒体在本机的绝对路径；插件会读成 base64 内联发送，接收方无需访问本机文件'),
      P('url', 'string', false, '可直接下载的媒体 http(s) 链接（与 path / base64 三选一）'),
      P('base64', 'string', false, '原始 base64 媒体内容（不带 data: 前缀，与 path / url 三选一）'),
      P('name', 'string', false, '显示的文件名，仅 kind="file" 时使用'),
      P('chatType', 'enum', false, '保留字段：请勿填写，消息始终发到当前会话'),
      P('chatId', 'string', false, '保留字段：请勿填写，消息始终发到当前会话'),
    ],
    summary: '向 QQ 会话发送一条消息，支持六种组合：纯文字、纯图片、文字+图片、纯语音、纯视频、纯文件',
    note: '六种组合：'
      + '①纯文字 params={"text":"..."}；'
      + '②纯图片 params={"kind":"image","path":"/绝对/路径.png"}；'
      + '③文字+图片 params={"text":"...","kind":"image","path":"..."}（合成同一条消息）；'
      + '④纯语音 params={"kind":"record","path":"/绝对/路径.wav"}；'
      + '⑤纯视频 params={"kind":"video","path":"/绝对/路径.mp4"}；'
      + '⑥纯文件 params={"kind":"file","path":"/绝对/路径.zip","name":"显示名.zip"}。'
      + '只有图片可以与文字同条发送：语音、视频、文件不能带 text，需要说明时先发文字再发媒体，分成两条。'
      + '只能在当前会话发送：不要填 chatType / chatId 指向别的群或好友。'
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
 * 把一个参数渲染进提示词：`名称（类型，必填/可选）：说明`。
 * @param param - `{ name, type, required, desc }` 条目。
 * @returns 渲染出的片段。
 */
function renderParam(param) {
  const type = TYPE_LABELS[param.type] ?? param.type
  const need = param.required ? '必填' : '可选'
  return param.name + '（' + type + '，' + need + '）：' + param.desc
}

/**
 * 一个动作的内置提示词，压成一行。
 *
 * 形状：`功能：…。参数：a（…）：…；b（…）：…。用法：onebot_call(action="x", params={"a":…, "b":…})。`
 * 没有参数的动作写 `无需参数。`，并省略 `params`。
 * @param name - 动作名。
 * @param zh - 中文注释，作为功能摘要的兜底。
 * @returns 默认提示词文本。
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
