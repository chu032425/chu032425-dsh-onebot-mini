/**
 * dsh-onebot-mini 的浏览器侧实现。
 *
 * 在左侧边栏提供一个面板：左边为标签页栏，右边为所选页面，
 * 数据来自宿主的 JSON 路由：
 *
 *  - **设置**：连接、访问控制、会话及诊断字段；
 *  - **日志**：实时 WebSocket 连接、断开、发送、接收及桥接
 *    决策。
 *
 * 配置刻意放在此面板而非“插件”页面，
 * 让频道自身的面板成为统一操作入口。
 *
 * 不以模块形式导入 Harness 客户端包：`dsh.client.inject` 仅控制
 * 激活顺序；纯 JavaScript 插件无法对可能随时变动的包
 * 进行类型检查。这里的控件基于 React 和宿主暴露的
 * 主题令牌构建。
 */

window.__ModuleLoader__.load({
  id: 'dsh-onebot-mini',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')

    /** 侧边栏入口标识；`main` 插槽使用同一字符串作为键。 */
    const PANEL_ID = 'onebot-mini-logs'
    /** 本插件的多语言命名空间。 */
    const NS = 'onebotMini'
    /** 宿主的 JSON 路由（相对于浏览器当前地址）。 */
    const STATE_ROUTE = '/onebot-mini/api/state'
    const CONFIG_ROUTE = '/onebot-mini/api/config'
    const CLEAR_ROUTE = '/onebot-mini/api/logs/clear'
    const CONTACTS_ROUTE = '/onebot-mini/api/contacts'
    const MEMBERS_ROUTE = '/onebot-mini/api/members'
    const FRIEND_ROUTE = '/onebot-mini/api/friend'
    const QZONE_ROUTE = '/onebot-mini/api/qzone'
    const PROFILE_ROUTE = '/onebot-mini/api/profile'
    const CACHE_ROUTE = '/onebot-mini/api/cache'
    const CACHE_CLEAR_ROUTE = '/onebot-mini/api/cache/clear'
    const IMAGE_ROUTE = '/onebot-mini/api/image'
    /** 页面可见时的日志轮询间隔。 */
    const POLL_MS = 1500
    /** 多语言字典键，以中文集合为准。 */
    const zh = {
      panel: 'OneBot-Mini',
      title: 'OneBot-Mini 设置',
      subtitle: '修改后立即重连网关，不会重启插件，进行中的会话不受影响。',
      loading: '加载中…',
      reload: '重新加载',
      save: '保存并重连',
      saving: '保存中…',
      saved: '已保存，网关已重连。',
      unsaved: '有未保存的修改。',
      saveHint: '保存只重建 WebSocket 连接；会话与聊天映射保留。',
      tokenHint: '与 NapCat 里填的 token 保持一致',
      botQQHint: '当前连接识别到：{id}',
      botQQHintEmpty: '连接网关后自动识别',
      botQQEmpty: '连接网关后自动识别',
      tokenShow: '显示令牌',
      tokenHide: '隐藏令牌',
      workspaceChoose: '请选择工作区…',
      workspaces: '工作区',
      workspaceMissing: '工作区已删除，连接时会自动重建',
      workspaceHint: '聊天会话将创建在此工作区下',
      workspaceUnavailable: '当前部署没有工作区服务，无法选择',
      presetNameStandard: '标准模式',
      presetNamePtc: 'PTC 模式',
      presetNameMinimal: '极简模式',
      presetNameCordis: '创造模式',
      permReadOnly: '仅可查看',
      permWorkspaceWrite: '工作区内修改',
      permDangerFullAccess: '完全权限',
      permAuto: '自动审查',
      presetDefault: '默认（使用部署默认预设）',
      presetIsDefault: '部署默认',
      presetMissing: '预设已删除，将使用默认',
      presetHint: 'QQ 会话使用的 agent 预设；留空用部署默认',
      presetUnavailable: '当前部署没有预设服务，只能使用默认',
      modelDefault: '默认（部署默认模型）',
      modelIsDefault: '部署默认',
      modelMissing: '模型已不可用，将使用默认',
      modelHint: 'QQ 会话使用的模型',
      modelUnavailable: '当前部署没有可用的模型目录',
      permissionChoose: '请选择权限…',
      permissionMissing: '预设已不存在，将使用部署默认',
      permissionHint: 'QQ 会话的权限预设（沙箱 + 审批策略），新建会话时生效',
      permissionUnavailable: '当前部署没有权限预设服务',
      tokenPlaceholder: '输入新的访问令牌',
      listPlaceholder: '每行一个，留空表示不限制',
      reset: '恢复默认值',
      error: '出错了：{message}',
      groupConnection: '连接',
      groupAccess: '访问控制',
      groupSession: '会话',
      groupMedia: '媒体',
      groupQzone: '空间',
      groupDiagnostics: '诊断',
      groupTool: '工具（onebot_call）',
      fieldOnebotToolEnabled: '启用 onebot_call 工具',
      hintOnebotToolEnabled: '开启后模型可主动调用 QQ 接口（发图片/文件、群管理、查询等）；关闭则该工具不注册，模型看不到它。',
      hintOnebotToolOff: '工具已关闭，不会注册；模型只能发普通文字回复。下面的动作全部不生效。',
      toolGroupLocal: '本地工具（插件自带）',
      toolGroupsHint: '分组默认折叠，点击标题展开。',
      toolGroupMessage: '发送消息',
      toolGroupMedia: '媒体与文件',
      toolGroupGroup: '群管理',
      toolGroupQuery: '查询与信息',
      toolGroupInteraction: '互动与消息操作',
      toolGroupRequest: '请求处理',
      toolGroupProfile: '账号资料',
      toolGroupQzone: 'QQ 空间',
      toolCount: '已启用 {on}/{total}',
      toolTotal: '全部动作：已启用 {on}/{total}',
      toolSearchPlaceholder: '搜索动作名或中文说明…',
      toolNoMatch: '没有匹配的动作。',
      toolActionsHint: '每个分组默认折叠，点击分组标题展开。勾选允许模型调用的动作；未勾选的动作即使被调用也会被拒绝。标「标准」的是 OneBot 11 标准动作，「NapCat 扩展」是实现扩展（能否用取决于网关是否支持），「本地」由插件自己实现。每行动作下方的「提示词」默认折叠，可展开查看或修改该动作的功能、参数和用法说明（模型调用该动作前会先用 get_action_doc 取这段说明）。',
      toolBadgeStandard: '标准',
      toolBadgeExtension: 'NapCat 扩展',
      toolBadgeLocal: '本地',
      toolNoteAuto: '注意：本节只控制 onebot_call 工具；普通文字回复的自动转发始终生效，不受此处影响。',
      toolNonAdminAllowed: '非管理员可用',
      toolNonAdminHint: '取消勾选后，该动作仅管理员可调用；未设置管理员时将对所有人拒绝。',
      toolNoAdminWarning: '未设置管理员：标为「仅管理员可用」的动作将对所有人拒绝，请先在「访问控制」里设置管理员。',
      toolPromptSummary: '提示词（功能 / 参数 / 用法）',
      toolPromptHint: '这段说明会随该动作一起发给模型。留空或点「恢复默认」即使用内置说明。',
      toolPromptReset: '恢复默认',
      toolPromptCustom: '已自定义',
      toolActionSendPrivateMsg: '发送私聊消息',
      toolActionSendGroupMsg: '发送群消息',
      toolActionSendMsg: '发送消息（按上下文自动区分私聊/群）',
      toolActionUploadGroupFile: '上传文件到群',
      toolActionUploadPrivateFile: '上传私聊文件',
      toolActionGetImage: '获取图片文件',
      toolActionGetRecord: '获取语音文件',
      toolActionGetFile: '获取文件',
      toolActionSetGroupBan: '禁言群成员',
      toolActionSetGroupKick: '踢出群成员',
      toolActionSetGroupWholeBan: '全员禁言开关',
      toolActionSetGroupAdmin: '设置/取消群管理员',
      toolActionSetGroupCard: '设置群名片',
      toolActionSetGroupName: '修改群名称',
      toolActionSetGroupLeave: '退出群聊',
      toolActionSetGroupSpecialTitle: '设置专属头衔',
      toolActionGetLoginInfo: '获取登录账号信息',
      toolActionGetStatus: '获取运行状态',
      toolActionGetVersionInfo: '获取版本信息',
      toolActionGetFriendList: '获取好友列表',
      toolActionGetGroupList: '获取群列表',
      toolActionGetGroupInfo: '获取群信息',
      toolActionGetGroupMemberList: '获取群成员列表',
      toolActionGetGroupMemberInfo: '获取群成员信息',
      toolActionGetStrangerInfo: '获取陌生人信息',
      toolActionSetFriendAddRequest: '处理加好友请求',
      toolActionSetGroupAddRequest: '处理加群请求',
      promptsTitle: 'OneBot-Mini 提示词',
      promptsSubtitle: '这里列出插件所有模型可见的提示词（频道说明与工具描述）。可修改、可恢复默认；以后新增的提示词会自动出现在这里。',
      tabPrompts: '提示词',
      promptsPlaceholderHint: '可用占位符：{replyMode} 回复发送方式说明 · {admin} 管理员身份说明 · {senderPrefix} 发言人前缀说明 · {media} 媒体发送说明 · {tools} 本插件工具清单 · {actions} 当前已启用的动作列表（只列动作名与中文注释） · {inbound} 收到的媒体说明。占位符会按当前配置自动展开。',
      promptsReset: '恢复默认',
      promptsSave: '保存提示词',
      promptsSaved: '已保存。',
      promptsUnsaved: '有未保存的修改。',
      promptsEmptyNote: '留空保存会恢复该项默认提示词。',
      promptsCollapseHint: '默认为折叠，点击标题展开编辑。',
      promptsDirtyMark: '有未保存的修改',
      promptDefChannel: '频道提示词',
      promptDefSecurity: '安全与权限提示词',
      promptDefChannelHint: '注入到每个 QQ 会话 system prompt 的频道说明。',
      promptDefSecurityHint: '注入到每个 QQ 会话的身份验证、权限与隐私规则；已按 OneBot-Mini 的字段与工具（onebot_call、adminUserId、白/黑名单等）改写，可整段编辑。',
      promptDefReplyModeStream: '流式回复提示词（仅流式模式生效）',
      promptDefReplyModeStreamHint: '仅当「回复发送方式」为「流式」时，注入到 {replyMode}；另一个模式不生效。',
      promptDefReplyModeFinal: '完成时回复提示词（仅完成时发送生效）',
      promptDefReplyModeFinalHint: '仅当「回复发送方式」为「任务完成一次发送」时，注入到 {replyMode}；另一个模式不生效。',
      promptDefAdmin: '管理员提示词',
      promptDefAdminHint: '设置管理员后注入到 {admin} 的说明；{adminId} 会替换成管理员 QQ 号，未设管理员时这段不注入。',
      promptDefSenderPrefix: '发言人前缀提示词',
      promptDefSenderPrefixHint: '开启「群消息加发言人前缀」时注入到 {senderPrefix} 的说明。',
      promptDefMedia: '媒体发送提示词',
      promptDefMediaHint: '工具启用时注入到 {media}，告诉模型如何发图片/语音/视频/文件，以及不要声称没有权限。',
      promptDefTools: '工具清单提示词',
      promptDefToolsHint: '工具启用时注入到 {tools}，列出本插件工具与「QQ 相关操作只能用这些工具」的硬规则；系统提示只列动作名与中文注释，详细参数由模型用 get_action_doc 按需获取。',
      promptDefInbound: '收到的媒体提示词',
      promptDefInboundHint: '告诉模型收到的图片/语音/视频/文件已保存到本机、以及如何用 read_image / read 读取。接收媒体关闭时这段不注入。',
      promptDefToolCall: 'onebot_call 工具描述',
      promptDefToolCallHint: '模型决定是否调用 onebot_call 时看到的说明。',
      groupReply: '回复行为',
      fieldReplyMode: '回复发送方式',
      hintReplyMode: '「任务完成一次发送」把整轮回答攒成一条消息，多步任务不会刷屏；「流式」在任务执行过程中产生一段就发一段，像边想边说。',
      replyModeFinal: '任务完成一次发送',
      replyModeStream: '流式（边说边发）',
      fieldPrivateAutoInterject: '私聊：回答中允许自动插话',
      hintPrivateAutoInterject: '仅对私聊生效。开启后模型正在回答时，新消息会直接插入当前回答；关闭则排队成下一回合。群聊始终不插话。',
      fieldPokeEvents: '收到戳一戳时交给模型回答',
      hintPokeEvents: '开启后（默认），别人戳机器人会作为一条 [戳一戳] 文本交给模型，模型据此用文字回应。关闭后戳一戳被直接忽略，模型也看不到这类事件。',
      fieldPokeBack: '收到戳一戳后反戳回去',
      hintPokeBack: '关闭时不反戳（默认）。开启后，别人戳机器人，机器人会立刻戳回去一次，然后照常让模型回复。两个机器人都打开会互相戳个没完，所以默认关闭。',
      promptsPlaceholders: '占位符（括号内为展开说明）：{list}',
      phReplyMode: '回复发送方式说明',
      phAdmin: '管理员身份说明',
      phAdminId: '管理员 QQ 号',
      phSenderPrefix: '发言人前缀说明',
      phMedia: '媒体发送说明',
      phTools: '本插件工具清单与硬规则',
      phActions: '当前已启用的动作列表（只列动作名与中文注释）',
      phInbound: '收到的媒体说明',
      phPoke: '戳一戳说明',
      phEnabledNote: '工具启用时追加的「仅接受已启用动作」说明',
      promptsNoPlaceholders: '这一段没有占位符，可自由编辑。',
      cacheTitle: 'OneBot-Mini 缓存与文件',
      cacheSubtitle: '插件写到磁盘上的所有文件：设置、日志与缓存文件。数据都从磁盘实时统计。',
      tabCache: '缓存',
      cacheTotal: '合计占用 {size}',
      cacheConfig: '设置文件',
      cacheLogs: '日志文件',
      cacheFiles: '缓存文件',
      cacheKindImage: '图片',
      cacheKindAudio: '音频',
      cacheKindVideo: '视频',
      cacheKindFile: '文件',
      cacheAccount: '账号 {qq}',
      cacheFileCount: '{count} 个文件',
      cacheLines: '{count} 行',
      cacheNoFiles: '没有文件。',
      cacheClearLogs: '清空日志',
      cacheClearImages: '清空全部缓存',
      cacheClearAccount: '清空此账号',
      cacheCleared: '已清理，释放 {size}',
      cacheConfirm: '确定清空？不可恢复。',
      cacheConfirmYes: '确认',
      cacheConfirmNo: '取消',
      cacheRefresh: '刷新',
      cacheTruncated: '文件太多，仅列出前 {max} 个',
      cacheRoot: '存放目录',
      cacheConfigNote: '设置文件不允许在此处删除。',
      profileTitle: 'OneBot-Mini 个人资料',
      profileSubtitle: '默认显示当前机器人账号，可切换查看任意好友的资料。',
      tabProfile: '个人资料',
      profileChoose: '选择好友…',
      profileSelf: '机器人自己',
      profileRefresh: '刷新',
      profileOffline: '网关未连接，连接后这里会显示资料。',
      profileUnavailable: '网关没有返回资料：{message}',
      profileEmpty: '这个账号没有可显示的资料。',
      profileId: 'QQ 号',
      profileUid: 'UID',
      profileQid: 'QID',
      profileNickname: '昵称',
      profileRemark: '备注',
      profileSignature: '个性签名',
      profileSex: '性别',
      profileSexMale: '男',
      profileSexFemale: '女',
      profileSexUnknown: '未知',
      profileAge: '年龄',
      profileLevel: 'QQ 等级',
      profileLoginDays: '登录天数',
      profileRegTime: '注册时间',
      profileVip: 'VIP',
      profileVipYes: '是',
      profileVipYears: '年费 VIP',
      profileVipLevel: 'VIP 等级',
      profileOnline: '在线状态',
      profileOnlineYes: '在线',
      profileOnlineNo: '离线',
      profileOnlineUnknown: '未知（网关不提供）',
      profileLike: '获赞',
      profileSelfBadge: '当前机器人',
      qzoneTitle: 'OneBot-Mini QQ 空间',
      qzoneSubtitle: '查询当前机器人账号的空间资料、说说与好友动态。',
      tabQzone: '空间',
      qzoneProfile: '空间资料',
      qzoneName: '空间名称',
      qzoneDescription: '空间说明',
      qzonePosts: '我的说说',
      qzoneFeeds: '好友动态',
      qzoneCount: '{count} 条',
      qzoneEmpty: '没有内容。',
      qzonePrivate: '仅自己可见',
      qzoneComments: '评论 {count}',
      qzoneLikes: '赞 {count}',
      qzoneImages: '{count} 张图',
      qzoneUnavailable: '网关不支持这个查询：{message}',
      qzoneForbidden: '看不了这个空间：对方设置了访问权限（或不是好友 / 需要验证）。',
      qzoneForbiddenHint: 'QQ 错误码 {code}，属于对方的空间权限，不是插件问题。',
      qzoneForbiddenSwitch: '可以换一个好友试试。',
      qzoneOffline: '网关未连接，连接后这里会显示空间内容。',
      qzoneRefresh: '刷新',
      qzoneOpen: '在 QQ 空间查看',
      qzoneNoContent: '（无正文）',
      qzoneImageAlt: '说说图片',
      qzoneImageFailed: '图片加载失败',
      qzoneImageTooLarge: '图片过大，未缓存',
      qzoneTargetLabel: '查看空间',
      qzoneTargetMine: '我的空间（机器人自己）',
      qzoneTargetPlaceholder: '输入 QQ 号查看对方空间',
      qzoneTargetGo: '查看',
      qzoneProfileEmpty: '这个空间没有填写名称或说明。',
      accessTitle: 'OneBot-Mini 访问控制',
      accessSubtitle: '用下拉菜单从当前机器人的好友和群组里挑选；白名单为空表示不限制。',
      tabAccess: '访问控制',
      accessPrivateAllow: '私聊白名单',
      accessPrivateDeny: '私聊黑名单',
      accessGroupAllow: '群聊白名单',
      accessGroupDeny: '群聊黑名单',
      accessAllowHint: '只接收名单内的会话；留空表示全部放行。',
      accessDenyHint: '名单内的会话一律拒绝，优先级高于白名单。',
      accessChooseFriend: '选择好友…',
      accessChooseGroup: '选择群组…',
      accessAdd: '添加',
      accessEmpty: '还没有添加任何条目。',
      accessRemove: '移除',
      accessNoContacts: '网关未连接，无法列出好友和群组；也可以手动输入号码。',
      accessManualPlaceholder: '输入 QQ 号或群号后回车',
      accessAdmin: '管理员',
      accessAdminHint: '从好友中选择一位管理员，其 QQ 号会记录到配置；留空表示不设管理员。',
      accessAdminChoose: '选择好友…',
      accessAdminNone: '未设置管理员',
      accessAdminClear: '清除管理员',
      accessAdminManual: '输入好友 QQ 号后回车',
      accessSave: '保存访问控制',
      accessSaved: '已保存。',
      accessUnsaved: '有未保存的修改。',
      accessNote: '黑名单优先于白名单；两个名单都为空时不限制。',
      membersTitle: '成员 {count}',
      membersLoading: '正在读取成员…',
      membersEmpty: '这个群没有成员数据。',
      membersFailed: '读取成员失败：{message}',
      membersRoleOwner: '群主',
      membersRoleAdmin: '管理员',
      membersRoleMember: '成员',
      friendDetailTitle: '好友详情',
      friendDetailLoading: '正在读取…',
      friendDetailFailed: '读取失败：{message}',
      friendDetailNickname: '昵称',
      friendDetailRemark: '备注',
      friendDetailId: 'QQ 号',
      friendDetailSex: '性别',
      friendDetailAge: '年龄',
      friendDetailLevel: '等级',
      friendDetailQid: 'QID',
      friendDetailOnline: '在线状态',
      friendDetailOnlineYes: '在线',
      friendDetailOnlineOffline: '离线',
      friendDetailOnlineUnknown: '未知（网关不提供）',
      friendDetailClose: '收起',
      friendDetailOpen: '查看状态',
      contactsTitle: 'OneBot-Mini 好友与群组',
      contactsSubtitle: '当前机器人在 QQ 上的好友和群组，实时从网关读取。',
      tabContacts: '好友与群组',
      contactsFriends: '好友',
      contactsGroups: '群组',
      contactsCount: '{count} 个',
      contactsEmpty: '暂无数据。',
      contactsMembers: '成员 {count}',
      contactsOffline: '网关未连接，连接后这里会列出好友和群组。',
      contactsUnavailable: '网关不支持这个查询：{message}',
      contactsRefresh: '刷新',
      contactsNickname: '昵称',
      toolsTitle: 'OneBot-Mini 工具',
      toolsSubtitle: '勾选允许模型调用的 OneBot 动作；每个动作下方是中文说明。',
      toolSave: '保存工具设置',
      toolSaved: '已保存。',
      toolUnsaved: '有未保存的修改。',
      fieldMode: '连接模式',
      fieldHost: '监听地址',
      fieldPort: '监听端口',
      fieldUrl: '网关地址（正向）',
      fieldAccessToken: '访问令牌',
      fieldBotQQ: '机器人账号',
      fieldRequireMention: '群聊需 @ 才回复',
      fieldAllowFrom: '私聊白名单',
      fieldAllowGroups: '群聊白名单',
      fieldWorkspacePath: '会话工作目录',
      fieldAgentPreset: 'Agent 预设',
      fieldSenderPrefix: '群消息加发言人前缀',
      hintSenderPrefixLocked: '已开启「回答中允许自动插话」：群聊必须带发言人前缀，否则多人消息无法区分。',
      hintSenderPrefixFree: '群消息会带 [HH:MM 昵称(QQ)]，便于模型区分发言人。',
      fieldAgentPreset: 'Agent 预设',
      fieldAgentModel: '模型',
      fieldSessionPermission: '会话权限',
      fieldCompactRatio: '上下文压缩比例',
      hintCompactRatio: '上下文占用（已用 token / 上下文窗口）达到该比例时，先压缩上下文再回答。填 0–1（如 0.8），也可填百分比（如 80）；0 表示不启用这条预压缩（Harness 自带的自动压缩仍有效）。',
      fieldSessionPrefix: '会话 ID 前缀',
      hintSessionPrefix: '必须以小写字母开头，只允许小写字母、数字、连字符。改动后新会话用新前缀，已有会话仍保留旧 ID。',
      fieldTitleEqualsId: '会话标题等于会话 ID',
      fieldLogCapacity: '日志保留条数',
      fieldLogMessagePreview: '日志记录消息正文',
      fieldLogToFile: '日志写入文件（onebot-mini.log.jsonl）',
      fieldSendTimeoutMs: '动作超时（毫秒）',
      fieldImageCacheMaxKb: '单张图片缓存上限（KB）',
      fieldImageCacheTotalMb: '图片缓存总量上限（MB）',
      fieldDeleteSentMedia: '发送后删除源文件',
      fieldInboundMedia: '接收并读取用户发来的媒体',
      hintInboundMedia: '开启后，用户发来的图片/语音/视频/文件会下载到工作区下的 onebot-mini-cache/QQ/{QQ号或群号}/（与空间图片缓存同一处，统一在「缓存」页清理），并把本机路径交给模型读取（图片用 read_image，文件用 read/bash）。关闭则只保留 [图片] 这类占位符。',
      fieldInboundMediaMaxMb: '单个接收媒体大小上限（MB）',
      hintInboundMediaMaxMb: '超过此大小的图片/语音/视频/文件不下载，只保留占位符。',
      fieldDeleteInboundMedia: '解析后删除源文件',
      hintDeleteInboundMedia: '开启后，用户发来的图片/语音/视频/文件在模型处理完这条消息的那一轮对话结束后，从本机删除（与「发送后删除源文件」相对应）。关闭则文件留在缓存目录，稍后可在「缓存」页清理。',
      fieldImageShowMaxMb: '空间单张图片显示上限（MB）',
      modeReverse: '反向（网关拨入）',
      modeForward: '正向（主动拨出）',
      modeHintReverse: '本插件监听端口，等待网关拨入；下方只显示监听地址与端口。',
      modeHintForward: '本插件主动连接网关；下方只显示网关地址，不占用本地端口。',
      tabLogs: '日志',
      tabTools: '工具',
      tabContacts: '好友与群组',
      tabAccess: '访问控制',
      tabQzone: '空间',
      tabProfile: '个人资料',
      tabPrompts: '提示词',
      tabCache: '缓存',
      tabSettings: '设置',
      logsTitle: 'OneBot-Mini 日志',
      logsSubtitle: '实时显示 WebSocket 连接、断开、发送、接收与桥接决策。',
      stateOnline: '已连接',
      stateOffline: '未连接',
      stateConnecting: '连接中',
      pause: '暂停',
      resume: '继续',
      clear: '清空',
      autoScroll: '自动滚动',
      empty: '还没有日志。网关连上后这里会出现记录。',
      paused: '已暂停，仍在后台接收。',
      kindConnect: '连接',
      kindDisconnect: '断开',
      kindReconnect: '重连',
      kindSend: '发送',
      kindRecv: '接收',
      kindEvent: '事件',
      kindError: '错误',
      kindBridge: '桥接',
      labelMode: '模式',
      labelAddress: '地址',
      labelSelfId: '机器人',
      labelPending: '在途',
      labelUptime: '已连接',
      labelRetained: '保留',
      entries: '{count} 条',
    }
    const en = {
      panel: 'OneBot-Mini',
      title: 'OneBot-Mini settings',
      subtitle: 'Saving reconnects the gateway immediately without restarting the plugin; running Sessions are unaffected.',
      loading: 'Loading…',
      reload: 'Reload',
      save: 'Save and reconnect',
      saving: 'Saving…',
      saved: 'Saved; the gateway reconnected.',
      unsaved: 'Unsaved changes.',
      saveHint: 'Saving only rebuilds the WebSocket link; Sessions and chat mappings are kept.',
      tokenHint: 'Must match the token configured in NapCat',
      botQQHint: 'Current connection reports: {id}',
      botQQHintEmpty: 'Detected automatically after the gateway connects',
      botQQEmpty: 'Detected after the gateway connects',
      tokenShow: 'Show token',
      tokenHide: 'Hide token',
      workspaceChoose: 'Select a workspace…',
      workspaces: 'Workspaces',
      workspaceMissing: 'workspace deleted; recreated on connect',
      workspaceHint: 'Chat Sessions are created under this workspace',
      workspaceUnavailable: 'This deployment has no workspace service',
      presetNameStandard: 'Standard mode',
      presetNamePtc: 'PTC mode',
      presetNameMinimal: 'Minimal mode',
      presetNameCordis: 'Cordis mode',
      permReadOnly: 'Read-only',
      permWorkspaceWrite: 'Workspace write',
      permDangerFullAccess: 'Full access',
      permAuto: 'Auto review',
      presetDefault: 'Default (deployment preset)',
      presetIsDefault: 'deployment default',
      presetMissing: 'preset deleted; the default is used',
      presetHint: 'Agent preset for QQ Sessions; empty uses the deployment default',
      presetUnavailable: 'This deployment has no preset service',
      modelDefault: 'Default (deployment model)',
      modelIsDefault: 'deployment default',
      modelMissing: 'model unavailable; the default is used',
      modelHint: 'Model for QQ Sessions',
      modelUnavailable: 'No model catalog in this deployment',
      permissionChoose: 'Select a permission…',
      permissionMissing: 'preset no longer exists; the deployment default is used',
      permissionHint: 'Permission preset (sandbox + approval) for new QQ Sessions',
      permissionUnavailable: 'This deployment has no permission preset service',
      tokenPlaceholder: 'Enter a new access token',
      listPlaceholder: 'One per line; empty means unrestricted',
      reset: 'Restore defaults',
      error: 'Failed: {message}',
      groupConnection: 'Connection',
      groupAccess: 'Access control',
      groupSession: 'Session',
      groupMedia: 'Media',
      groupQzone: 'Qzone',
      groupDiagnostics: 'Diagnostics',
      groupTool: 'Tools (onebot_call)',
      fieldOnebotToolEnabled: 'Enable the onebot_call tool',
      hintOnebotToolEnabled: 'When on, the model can call QQ APIs (images/files, group management, queries). When off, the tool is not registered and the model never sees it.',
      hintOnebotToolOff: 'The tool is off and will not be registered; the model can only send plain text replies. None of the actions below apply.',
      toolGroupLocal: 'Local tools (built in)',
      toolGroupsHint: 'Groups are collapsed by default; click a title to expand.',
      toolGroupMessage: 'Send messages',
      toolGroupMedia: 'Media and files',
      toolGroupGroup: 'Group management',
      toolGroupQuery: 'Queries and info',
      toolGroupInteraction: 'Interaction and messages',
      toolGroupRequest: 'Request handling',
      toolGroupProfile: 'Account profile',
      toolGroupQzone: 'Qzone',
      toolCount: '{on}/{total} enabled',
      toolTotal: 'All actions: {on}/{total} enabled',
      toolSearchPlaceholder: 'Search by action name or description…',
      toolNoMatch: 'No matching action.',
      toolActionsHint: 'Each group is collapsed by default; click its title to expand. Check the actions the model may call; an unchecked action is refused even if the model tries it. 标准 rows are OneBot 11 standard actions, 扩展 are implementation extensions (availability depends on the gateway), 本地 are implemented inside the plugin. Each row has a collapsed 提示词 (prompt) you can expand to view or edit its function, parameters and usage (the model fetches this text on demand via get_action_doc before calling the action).',
      toolBadgeStandard: 'Standard',
      toolBadgeExtension: 'NapCat ext.',
      toolBadgeLocal: 'Local',
      toolNoteAuto: 'Note: this section only controls the onebot_call tool. Automatic forwarding of plain text replies stays on and is not affected.',
      toolNonAdminAllowed: 'Non-admin allowed',
      toolNonAdminHint: 'When unchecked, only the administrator may call this action; with no administrator set it is refused for everyone.',
      toolNoAdminWarning: 'No administrator set: actions marked admin-only are refused for everyone. Set an administrator in Access control first.',
      toolPromptSummary: 'Prompt (function / parameters / usage)',
      toolPromptHint: 'This text is sent to the model together with the action. Leave it empty or press Reset to use the built-in description.',
      toolPromptReset: 'Reset',
      toolPromptCustom: 'Customized',
      toolActionSendPrivateMsg: 'Send a private message',
      toolActionSendGroupMsg: 'Send a group message',
      toolActionSendMsg: 'Send a message (private or group, inferred from context)',
      toolActionUploadGroupFile: 'Upload a file to a group',
      toolActionUploadPrivateFile: 'Upload a file in a private chat',
      toolActionGetImage: 'Fetch an image file',
      toolActionGetRecord: 'Fetch a voice recording',
      toolActionGetFile: 'Fetch a file',
      toolActionSetGroupBan: 'Mute a group member',
      toolActionSetGroupKick: 'Kick a group member',
      toolActionSetGroupWholeBan: 'Toggle whole-group mute',
      toolActionSetGroupAdmin: 'Set or unset a group admin',
      toolActionSetGroupCard: "Set a member's group card",
      toolActionSetGroupName: 'Rename the group',
      toolActionSetGroupLeave: 'Leave a group',
      toolActionSetGroupSpecialTitle: "Set a member's special title",
      toolActionGetLoginInfo: 'Get the logged-in account',
      toolActionGetStatus: 'Get runtime status',
      toolActionGetVersionInfo: 'Get version info',
      toolActionGetFriendList: 'List friends',
      toolActionGetGroupList: 'List groups',
      toolActionGetGroupInfo: 'Get group info',
      toolActionGetGroupMemberList: 'List group members',
      toolActionGetGroupMemberInfo: "Get a group member's info",
      toolActionGetStrangerInfo: "Get a stranger's info",
      toolActionSetFriendAddRequest: 'Handle a friend request',
      toolActionSetGroupAddRequest: 'Handle a group join request',
      promptsTitle: 'OneBot-Mini prompt',
      promptsSubtitle: 'Every model-facing prompt the plugin uses: the channel section and the tool descriptions. Edit freely or restore defaults; new prompts appear here automatically.',
      tabPrompts: 'Prompt',
      promptsPlaceholderHint: 'Placeholders: {replyMode} the reply-delivery line · {admin} the administrator identity line · {senderPrefix} the speaker-prefix line · {media} the media paragraph · {tools} the plugin tool inventory · {actions} the enabled action list (names and Chinese annotations only) · {inbound} the received-media guidance. Each expands from the current settings.',
      promptsReset: 'Restore default',
      promptsSave: 'Save prompt',
      promptsSaved: 'Saved.',
      promptsUnsaved: 'You have unsaved changes.',
      promptsEmptyNote: 'Saving an empty prompt restores that default.',
      promptsCollapseHint: 'Collapsed by default; click a title to expand and edit.',
      promptsDirtyMark: 'Unsaved changes',
      promptDefChannel: 'Channel prompt',
      promptDefSecurity: 'Security and permissions prompt',
      promptDefChannelHint: 'The channel section injected into every QQ chat agent.',
      promptDefSecurityHint: 'The identity, permission and privacy rules injected into every QQ chat; rewritten for OneBot-Mini fields and tools (onebot_call, adminUserId, allow/deny lists, etc.); fully editable.',
      promptDefReplyModeStream: 'Streaming reply prompt (stream mode only)',
      promptDefReplyModeStreamHint: 'Injected into {replyMode} only while replies are streamed; the other mode does not use it.',
      promptDefReplyModeFinal: 'Final reply prompt (final mode only)',
      promptDefReplyModeFinalHint: 'Injected into {replyMode} only while the whole turn is sent as one message; the other mode does not use it.',
      promptDefAdmin: 'Administrator prompt',
      promptDefAdminHint: 'Injected into {admin} when an administrator is set; {adminId} becomes the admin QQ id. Not injected when no admin is set.',
      promptDefSenderPrefix: 'Speaker-prefix prompt',
      promptDefSenderPrefixHint: 'Injected into {senderPrefix} when group messages carry a speaker prefix.',
      promptDefMedia: 'Media-sending prompt',
      promptDefMediaHint: 'Injected into {media} while tools are on; teaches the model how to send images/voice/video/files and not to claim it lacks permission.',
      promptDefTools: 'Tool-inventory prompt',
      promptDefToolsHint: 'Injected into {tools} while tools are on; lists the plugin tools and the "all QQ actions must use these tools" rule. The system prompt lists action names and annotations only; the model fetches detailed parameters on demand via get_action_doc.',
      promptDefInbound: 'Received-media prompt',
      promptDefInboundHint: 'Tells the model that incoming images/voice/video/files are saved locally and how to read them with read_image / read. Not injected when inbound media is off.',
      promptDefToolCall: 'onebot_call tool description',
      promptDefToolCallHint: 'What the model reads when deciding whether to call onebot_call.',
      groupReply: 'Reply behaviour',
      fieldReplyMode: 'How replies are sent',
      hintReplyMode: '"Once when done" collects the whole turn into one message so a multi-step turn does not flood the chat; "Stream" sends each produced message right away, as if thinking out loud.',
      replyModeFinal: 'Once, when the turn is done',
      replyModeStream: 'Stream (send as it goes)',
      fieldPrivateAutoInterject: 'Private chat: steer a running answer',
      hintPrivateAutoInterject: 'Private chats only. When on, a new message is inserted into the answer in progress; when off it queues as the next turn. Groups never steer.',
      fieldPokeEvents: 'Let the model answer pokes',
      hintPokeEvents: 'On by default: a poke aimed at the bot arrives as a [poke] line and the model replies in text. Off: pokes are ignored entirely and the model never sees them.',
      fieldPokeBack: 'Poke back when poked',
      hintPokeBack: 'Off by default. When on, a poke aimed at the bot is answered with one poke back before the model replies. Two bots with this on would poke each other forever, hence the default.',
      promptsPlaceholders: 'Placeholders (expansion in parentheses): {list}',
      phReplyMode: 'the reply-delivery line',
      phAdmin: 'the administrator identity line',
      phAdminId: 'the administrator QQ id',
      phSenderPrefix: 'the speaker-prefix line',
      phMedia: 'the media paragraph',
      phTools: 'the plugin tool inventory and hard rules',
      phActions: 'the enabled action list (names and Chinese annotations only)',
      phInbound: 'the received-media guidance',
      phPoke: 'the poke guidance',
      phEnabledNote: 'the "enabled actions only" note added when the tool is on',
      promptsNoPlaceholders: 'No placeholders here; edit freely.',
      cacheTitle: 'OneBot-Mini cache and files',
      cacheSubtitle: 'Every file the plugin writes: settings, log and cache files. Sizes are read from disk.',
      tabCache: 'Cache',
      cacheTotal: 'Total {size}',
      cacheConfig: 'Settings file',
      cacheLogs: 'Log file',
      cacheFiles: 'Cache files',
      cacheKindImage: 'image',
      cacheKindAudio: 'audio',
      cacheKindVideo: 'video',
      cacheKindFile: 'file',
      cacheAccount: 'Account {qq}',
      cacheFileCount: '{count} files',
      cacheLines: '{count} lines',
      cacheNoFiles: 'No files.',
      cacheClearLogs: 'Clear log',
      cacheClearImages: 'Clear all cache',
      cacheClearAccount: 'Clear this account',
      cacheCleared: 'Cleared, freed {size}',
      cacheConfirm: 'Clear it? This cannot be undone.',
      cacheConfirmYes: 'Confirm',
      cacheConfirmNo: 'Cancel',
      cacheRefresh: 'Refresh',
      cacheTruncated: 'Too many files; showing the first {max}',
      cacheRoot: 'Location',
      cacheConfigNote: 'The settings file cannot be deleted here.',
      profileTitle: 'OneBot-Mini profile',
      profileSubtitle: "Shows the bot account by default; pick any friend to read their profile.",
      tabProfile: 'Profile',
      profileChoose: 'Pick a friend…',
      profileSelf: 'The bot itself',
      profileRefresh: 'Refresh',
      profileOffline: 'The gateway is not connected; the profile appears once it is.',
      profileUnavailable: 'The gateway returned no profile: {message}',
      profileEmpty: 'This account has no profile to show.',
      profileId: 'QQ',
      profileUid: 'UID',
      profileQid: 'QID',
      profileNickname: 'Nickname',
      profileRemark: 'Remark',
      profileSignature: 'Signature',
      profileSex: 'Sex',
      profileSexMale: 'Male',
      profileSexFemale: 'Female',
      profileSexUnknown: 'Unknown',
      profileAge: 'Age',
      profileLevel: 'QQ level',
      profileLoginDays: 'Login days',
      profileRegTime: 'Registered',
      profileVip: 'VIP',
      profileVipYes: 'Yes',
      profileVipYears: 'Annual VIP',
      profileVipLevel: 'VIP level',
      profileOnline: 'Status',
      profileOnlineYes: 'Online',
      profileOnlineNo: 'Offline',
      profileOnlineUnknown: 'Unknown (the gateway does not report it)',
      profileLike: 'Likes received',
      profileSelfBadge: 'This bot',
      qzoneTitle: 'OneBot-Mini Qzone',
      qzoneSubtitle: 'Read the bot account\'s Qzone profile, own posts and the friend feed.',
      tabQzone: 'Qzone',
      qzoneProfile: 'Profile',
      qzoneName: 'Space name',
      qzoneDescription: 'Description',
      qzonePosts: 'My posts',
      qzoneFeeds: 'Friend feed',
      qzoneCount: '{count}',
      qzoneEmpty: 'Nothing to show.',
      qzonePrivate: 'Private',
      qzoneComments: '{count} comments',
      qzoneLikes: '{count} likes',
      qzoneImages: '{count} images',
      qzoneUnavailable: 'The gateway does not support this query: {message}',
      qzoneForbidden: 'This space cannot be read: the owner restricted access (or you are not a friend / verification is required).',
      qzoneForbiddenHint: 'QQ error {code} comes from the space owner\'s privacy setting, not from this plugin.',
      qzoneForbiddenSwitch: 'Try another friend.',
      qzoneOffline: 'The gateway is not connected; Qzone content appears once it is.',
      qzoneRefresh: 'Refresh',
      qzoneOpen: 'Open in Qzone',
      qzoneNoContent: '(no text)',
      qzoneImageAlt: 'Post image',
      qzoneImageFailed: 'Image failed to load',
      qzoneImageTooLarge: 'Image too large to cache',
      qzoneTargetLabel: 'View space',
      qzoneTargetMine: 'My space (the bot itself)',
      qzoneTargetPlaceholder: "Enter a QQ number to view someone's space",
      qzoneTargetGo: 'View',
      qzoneProfileEmpty: 'This space has no name or description set.',
      accessTitle: 'OneBot-Mini access control',
      accessSubtitle: 'Pick friends and groups from the current bot account; an empty whitelist means no restriction.',
      tabAccess: 'Access',
      accessPrivateAllow: 'Private whitelist',
      accessPrivateDeny: 'Private blacklist',
      accessGroupAllow: 'Group whitelist',
      accessGroupDeny: 'Group blacklist',
      accessAllowHint: 'Only chats on the list are accepted; empty means everyone.',
      accessDenyHint: 'Chats on the list are always refused; this wins over the whitelist.',
      accessChooseFriend: 'Pick a friend…',
      accessChooseGroup: 'Pick a group…',
      accessAdd: 'Add',
      accessEmpty: 'No entries yet.',
      accessRemove: 'Remove',
      accessNoContacts: 'The gateway is not connected, so friends and groups cannot be listed; type an id instead.',
      accessManualPlaceholder: 'Type a QQ or group id and press Enter',
      accessAdmin: 'Administrator',
      accessAdminHint: 'Pick one friend as the administrator; their QQ number is stored in the config. Empty means no administrator.',
      accessAdminChoose: 'Pick a friend…',
      accessAdminNone: 'No administrator set',
      accessAdminClear: 'Clear administrator',
      accessAdminManual: 'Type a friend QQ id and press Enter',
      accessSave: 'Save access control',
      accessSaved: 'Saved.',
      accessUnsaved: 'You have unsaved changes.',
      accessNote: 'The blacklist wins over the whitelist; with both empty nothing is restricted.',
      membersTitle: '{count} members',
      membersLoading: 'Loading members…',
      membersEmpty: 'This group has no member data.',
      membersFailed: 'Could not load members: {message}',
      membersRoleOwner: 'Owner',
      membersRoleAdmin: 'Admin',
      membersRoleMember: 'Member',
      friendDetailTitle: 'Friend details',
      friendDetailLoading: 'Loading…',
      friendDetailFailed: 'Could not load: {message}',
      friendDetailNickname: 'Nickname',
      friendDetailRemark: 'Remark',
      friendDetailId: 'QQ',
      friendDetailSex: 'Sex',
      friendDetailAge: 'Age',
      friendDetailLevel: 'Level',
      friendDetailQid: 'QID',
      friendDetailOnline: 'Status',
      friendDetailOnlineYes: 'Online',
      friendDetailOnlineOffline: 'Offline',
      friendDetailOnlineUnknown: 'Unknown (the gateway does not report it)',
      friendDetailClose: 'Collapse',
      friendDetailOpen: 'View status',
      contactsTitle: 'OneBot-Mini friends and groups',
      contactsSubtitle: 'The friends and groups of the bot account, read live from the gateway.',
      tabContacts: 'Friends and groups',
      contactsFriends: 'Friends',
      contactsGroups: 'Groups',
      contactsCount: '{count}',
      contactsEmpty: 'Nothing to show.',
      contactsMembers: 'members {count}',
      contactsOffline: 'The gateway is not connected; friends and groups appear once it is.',
      contactsUnavailable: 'The gateway does not support this query: {message}',
      contactsRefresh: 'Refresh',
      contactsNickname: 'Nickname',
      toolsTitle: 'OneBot-Mini tools',
      toolsSubtitle: 'Check the OneBot actions the model may call; each action has a short description.',
      toolSave: 'Save tool settings',
      toolSaved: 'Saved.',
      toolUnsaved: 'You have unsaved changes.',
      fieldMode: 'Connection mode',
      fieldHost: 'Listen address',
      fieldPort: 'Listen port',
      fieldUrl: 'Gateway URL (forward)',
      fieldAccessToken: 'Access token',
      fieldBotQQ: 'Bot account',
      fieldRequireMention: 'Groups must mention the bot',
      fieldAllowFrom: 'Private allowlist',
      fieldAllowGroups: 'Group allowlist',
      fieldWorkspacePath: 'Session working directory',
      fieldAgentPreset: 'Agent preset',
      fieldSenderPrefix: 'Prefix group messages with the speaker',
      hintSenderPrefixLocked: 'Required while "allow steering a running answer" is on: without it, group messages from different people cannot be told apart.',
      hintSenderPrefixFree: 'Group messages carry [HH:MM nickname(QQ)] so the model can tell speakers apart.',
      fieldAgentPreset: 'Agent preset',
      fieldAgentModel: 'Model',
      fieldSessionPermission: 'Session permission',
      fieldCompactRatio: 'Context compaction ratio',
      hintCompactRatio: 'When context pressure (used tokens / context window) reaches this ratio, the session is compacted before answering. Use 0–1 (e.g. 0.8) or a percentage (e.g. 80); 0 disables this pre-reply check (the harness auto-compaction still applies).',
      fieldSessionPrefix: 'Session id prefix',
      hintSessionPrefix: 'Must start with a lowercase letter; lowercase letters, digits and hyphens only. New Sessions use the new prefix; existing ones keep their old id.',
      fieldTitleEqualsId: 'Session title equals session id',
      fieldLogCapacity: 'Log entries kept',
      fieldLogMessagePreview: 'Record message bodies in the log',
      fieldLogToFile: 'Write the log to a file (onebot-mini.log.jsonl)',
      fieldSendTimeoutMs: 'Action timeout (ms)',
      fieldImageCacheMaxKb: 'Image cache per file (KB)',
      fieldImageCacheTotalMb: 'Image cache total (MB)',
      fieldDeleteSentMedia: 'Delete the source file after sending',
      fieldInboundMedia: 'Download and read incoming media',
      hintInboundMedia: 'When on, images/voice/video/files a user sends are downloaded to onebot-mini-cache/QQ/{QQ or group id}/ under the workspace (same place as the Qzone image cache, cleared together on the Cache page) and their local paths are handed to the model (read_image for pictures, read/bash for files). When off, only bare [图片]-style placeholders remain.',
      fieldInboundMediaMaxMb: 'Max size per incoming media (MB)',
      hintInboundMediaMaxMb: 'Anything larger than this is not downloaded; only the placeholder remains.',
      fieldDeleteInboundMedia: 'Delete the source file after parsing',
      hintDeleteInboundMedia: 'When on, an incoming image/voice/video/file is removed from this host once the turn that handled that message ends (the mirror of "delete the source file after sending"). When off, the file stays in the cache directory for you to clear on the Cache page.',
      fieldImageShowMaxMb: 'Qzone max image size (MB)',
      modeReverse: 'Reverse (gateway dials in)',
      modeForward: 'Forward (we dial out)',
      modeHintReverse: 'This plugin listens and waits for the gateway; only the listen address and port are shown below.',
      modeHintForward: 'This plugin dials the gateway; only the gateway URL is shown below, and no local port is bound.',
      tabLogs: 'Logs',
      tabTools: 'Tools',
      tabContacts: 'Contacts',
      tabAccess: 'Access',
      tabQzone: 'Qzone',
      tabProfile: 'Profile',
      tabPrompts: 'Prompt',
      tabCache: 'Cache',
      tabSettings: 'Settings',
      logsTitle: 'OneBot-Mini log',
      logsSubtitle: 'Live WebSocket connect, disconnect, send, receive and bridge decisions.',
      stateOnline: 'Connected',
      stateOffline: 'Disconnected',
      stateConnecting: 'Connecting',
      pause: 'Pause',
      resume: 'Resume',
      clear: 'Clear',
      autoScroll: 'Auto-scroll',
      empty: 'No log entries yet. They appear once the gateway connects.',
      paused: 'Paused; entries are still collected in the background.',
      kindConnect: 'Connect',
      kindDisconnect: 'Disconnect',
      kindReconnect: 'Reconnect',
      kindSend: 'Send',
      kindRecv: 'Receive',
      kindEvent: 'Event',
      kindError: 'Error',
      kindBridge: 'Bridge',
      labelMode: 'Mode',
      labelAddress: 'Address',
      labelSelfId: 'Bot',
      labelPending: 'Pending',
      labelUptime: 'Uptime',
      labelRetained: 'Retained',
      entries: '{count} entries',
    }

    /** 单个配置字段的标签键。 */
    function fieldLabelKey(field) {
      return 'field' + field.charAt(0).toUpperCase() + field.slice(1)
    }

    /** 单个配置分组的标签键。 */
    function groupLabelKey(group) {
      return 'group' + group.charAt(0).toUpperCase() + group.slice(1)
    }

    /** 单个 OneBot 工具动作分组的标签键。 */
    function toolGroupLabelKey(group) {
      return 'toolGroup' + group.charAt(0).toUpperCase() + group.slice(1)
    }

    /** 从状态快照获取工具分组，兼容数组或 `{ groups }` 形式。 */
    function toolGroupsOf(snapshot) {
      const raw = snapshot === null || snapshot === undefined ? undefined : snapshot.toolCatalog
      if (Array.isArray(raw)) return raw
      if (raw !== null && typeof raw === 'object' && Array.isArray(raw.groups)) return raw.groups
      return []
    }

    /**
     * 把响应体读成 JSON；HTTP 状态不是 2xx 时抛错，交给调用方的 catch。
     * @param response - fetch 的响应。
     * @returns 解析后的对象。
     */
    function readJson(response) {
      if (!response.ok) throw new Error('HTTP ' + response.status)
      return response.json()
    }

    /**
     * 把响应读成 `{ ok, body }`，用于需要同时看状态码和响应体的写请求。
     * @param response - fetch 的响应。
     * @returns `{ ok, body }`。
     */
    function readResult(response) {
      return response.json().then((body) => ({ ok: response.ok, body }))
    }

    /**
     * 出错时的整页占位：一句可读错误 + 一个「重试」按钮。
     * @param t - 多语言绑定。
     * @param error - 错误文本。
     * @param onReload - 重试回调；不传则只显示错误、不给按钮。
     * @param leading - 可选的若干前置节点（标题块、选择器等），按顺序放在最外层。
     * @returns 渲染好的节点。
     */
    function errorPanel(t, error, onReload, ...leading) {
      const body = React.createElement('div', { style: { ...styles.group, ...styles.danger } },
        format(t('error'), { message: error }),
        onReload === undefined
          ? null
          : React.createElement('div', { style: styles.actions },
            React.createElement('button', { type: 'button', style: styles.ghostBtn, onClick: onReload }, t('reload')),
          ),
      )
      return React.createElement('div', { style: styles.content }, ...leading, body)
    }

    /** 判断值是否为普通对象（非 null 且非数组）。 */
    function isPlainObject(value) {
      return value !== null && typeof value === 'object' && !Array.isArray(value)
    }

    /** 单个日志类型的标签键。 */
    function kindLabelKey(kind) {
      return 'kind' + kind.charAt(0).toUpperCase() + kind.slice(1)
    }

    /** 替换 `{name}` 占位符。 */
    function format(template, vars) {
      return String(template).replace(/\{(\w+)\}/g, (whole, name) => (
        vars !== null && vars !== undefined && Object.prototype.hasOwnProperty.call(vars, name)
          ? String(vars[name])
          : whole
      ))
    }

    /** 将时间戳格式化为本地时间。 */
    function clockTime(ts) {
      try {
        return new Date(ts).toLocaleTimeString(undefined, { hour12: false })
      } catch {
        return String(ts)
      }
    }

    /** 以紧凑格式显示毫秒时长。 */
    function duration(ms) {
      const value = Math.max(0, Number(ms) || 0)
      if (value < 1000) return value + 'ms'
      if (value < 60000) return (value / 1000).toFixed(1) + 's'
      const minutes = Math.floor(value / 60000)
      const seconds = Math.floor((value % 60000) / 1000)
      return minutes + 'm' + String(seconds).padStart(2, '0') + 's'
    }

    /**
     * 以单行展示日志条目的字段，用于日志表格。
     * @param entry - 来自宿主的一条日志记录。
     * @returns 紧凑的摘要字符串。
     */
    function summarizeEntry(entry) {
      const parts = []
      const push = (key, value) => {
        if (value === undefined || value === null || value === '') return
        parts.push(key === '' ? String(value) : key + '=' + String(value))
      }
      if (entry.action !== undefined) push('', entry.action)
      if (entry.mode !== undefined) push('', entry.mode)
      if (entry.address !== undefined) push('', entry.address)
      if (entry.remote !== undefined) push('', entry.remote)
      if (entry.note !== undefined) push('', entry.note)
      if (entry.post_type !== undefined) push('', entry.post_type)
      if (entry.detail !== undefined && typeof entry.detail === 'object') {
        if (entry.detail.text !== undefined) push('', '"' + String(entry.detail.text) + '"')
        if (entry.detail.user_id !== undefined) push('user', entry.detail.user_id)
        if (entry.detail.group_id !== undefined) push('group', entry.detail.group_id)
        if (entry.detail.message_type !== undefined && entry.detail.message_type !== '') push('', entry.detail.message_type)
      }
      if (entry.retcode !== undefined) push('retcode', entry.retcode)
      if (entry.status !== undefined) push('', entry.status)
      if (entry.ms !== undefined) push('', duration(entry.ms))
      if (entry.chatId !== undefined) push('', entry.chatId)
      if (entry.sessionId !== undefined) push('', entry.sessionId)
      if (entry.messageId !== undefined && entry.messageId !== '') push('msg', entry.messageId)
      if (entry.length !== undefined) push('len', entry.length)
      if (entry.error !== undefined) push('', entry.error)
      if (entry.state !== undefined) push('', entry.state)
      if (entry.attempt !== undefined) push('#' + entry.attempt, duration(entry.delayMs))
      if (entry.port !== undefined) push('port', entry.port)
      if (entry.timeoutMs !== undefined) push('timeout', entry.timeoutMs)
      return parts.join('  ')
    }

    /** 共用行内样式，颜色仅取自宿主主题令牌。 */
    const styles = {
      page: {
        width: '100%',
        minWidth: 0,
        minHeight: '100%',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 14,
        lineHeight: 1.6,
      },
      content: {
        maxWidth: 820,
        margin: '0 auto',
        padding: '24px clamp(16px, 4vw, 40px) 40px',
      },
      heading: {
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
      },
      headingTitle: { margin: 0, fontSize: 19, fontWeight: 500, lineHeight: '26px' },
      headingSubtitle: { margin: '4px 0 0', color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, lineHeight: '20px' },
      group: {
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 10,
        background: 'var(--dsw-alias-bg-layer-1)',
        padding: '14px 16px',
        marginBottom: 14,
      },
      groupTitle: { margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' },
      row: { display: 'grid', gridTemplateColumns: 'minmax(140px, 220px) 1fr', gap: 12, alignItems: 'center', padding: '6px 0' },
      rowLabel: { color: 'var(--dsw-alias-label-secondary)', fontSize: 13 },
      input: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '6px 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13,
        fontFamily: 'inherit',
      },
      textarea: {
        width: '100%',
        boxSizing: 'border-box',
        minHeight: 62,
        padding: '6px 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13,
        fontFamily: 'inherit',
        resize: 'vertical',
      },
      select: {
        padding: '6px 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13,
        fontFamily: 'inherit',
      },
      checkbox: { width: 16, height: 16, margin: 0 },
      hint: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 },
      toolGroup: {
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 8,
        padding: '8px 10px',
        marginBottom: 8,
        background: 'var(--dsw-alias-bg-base)',
      },
      toolGroupHeader: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap', cursor: 'pointer' },
      toolGroupLabel: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--dsw-alias-label-secondary)',
      },
      toolGroupName: { fontWeight: 600 },
      toolActionGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: '4px 12px',
      },
      toolAction: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        cursor: 'pointer',
        fontSize: 12,
        color: 'var(--dsw-alias-label-primary)',
      },
      toolActionCode: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' },
      toolKindBadge: {
        alignSelf: 'flex-start',
        marginTop: 2,
        padding: '0 6px',
        borderRadius: 999,
        border: '1px solid transparent',
        fontSize: 10,
        lineHeight: '16px',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      },
      toolSummary: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '4px 0 8px',
        fontSize: 12,
        color: 'var(--dsw-alias-label-tertiary)',
      },
      toolSearch: {
        flex: '1 1 180px',
        minWidth: 0,
        padding: '5px 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12,
        fontFamily: 'inherit',
      },
      toolList: { display: 'flex', flexDirection: 'column' },
      toolRowBlock: {
        display: 'flex',
        flexDirection: 'column',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
      toolListRow: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '6px 2px',
        cursor: 'pointer',
      },
      toolAdminRow: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 2px 6px 26px',
        cursor: 'pointer',
        fontSize: 12,
        color: 'var(--dsw-alias-label-secondary)',
      },
      toolPrompt: { padding: '0 2px 8px 26px' },
      toolPromptSummary: {
        cursor: 'pointer',
        fontSize: 12,
        color: 'var(--dsw-alias-label-secondary)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      },
      toolPromptCustom: {
        padding: '0 6px',
        borderRadius: 999,
        background: 'var(--dsw-alias-bg-l1, #f1f5f9)',
        color: 'var(--dsw-alias-label-tertiary)',
        fontSize: 10,
        lineHeight: '16px',
      },
      toolPromptArea: {
        width: '100%',
        boxSizing: 'border-box',
        marginTop: 6,
        padding: '6px 8px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12,
        lineHeight: 1.5,
        fontFamily: 'inherit',
        resize: 'vertical',
        minHeight: 54,
      },
      toolListText: { display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 },
      toolListName: { fontSize: 13, color: 'var(--dsw-alias-label-primary)' },
      contactList: { display: 'flex', flexDirection: 'column' },
      contactRow: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '6px 2px',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
      contactMain: { display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, flexWrap: 'wrap' },
      contactName: { fontSize: 13, color: 'var(--dsw-alias-label-primary)' },
      qzoneList: { display: 'flex', flexDirection: 'column' },
      qzonePost: { padding: '8px 2px', borderTop: '1px solid var(--dsw-alias-border-l1)' },
      qzonePostHead: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 8,
        marginBottom: 2,
      },
      qzoneTag: {
        fontSize: 11,
        padding: '0 6px',
        borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-secondary)',
      },
      qzoneText: { fontSize: 13, color: 'var(--dsw-alias-label-primary)', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' },
      qzoneProfile: { display: 'flex', flexDirection: 'column', gap: 4 },
      qzoneImages: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 },
      qzoneImageLink: { display: 'inline-block', lineHeight: 0 },
      qzoneImageFailed: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 96,
        height: 96,
        borderRadius: 6,
        border: '1px dashed var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-tertiary)',
        fontSize: 11,
        textAlign: 'center',
        padding: 4,
        boxSizing: 'border-box',
      },
      qzoneImage: {
        width: 96,
        height: 96,
        objectFit: 'cover',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-2)',
      },
      promptTextarea: {
        width: '100%',
        boxSizing: 'border-box',
        minHeight: 320,
        padding: '10px 12px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13,
        lineHeight: 1.6,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        resize: 'vertical',
      },
      promptSummary: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        cursor: 'pointer',
        fontSize: 15,
        fontWeight: 600,
        color: 'var(--dsw-alias-label-primary)',
        padding: '2px 0',
      },
      promptDirtyMark: { fontSize: 12, fontWeight: 400, color: 'var(--dsw-alias-label-secondary)' },
      promptBody: { marginTop: 10 },
      cacheSummary: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        gap: 12,
        padding: '10px 14px',
        marginBottom: 14,
        borderRadius: 10,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      cacheTotal: { fontSize: 15, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      cacheHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
      cacheRow: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        flexWrap: 'wrap',
        padding: '6px 0',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
      cacheActions: { display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
      cacheMono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, overflowWrap: 'anywhere', minWidth: 0 },
      cacheAccountBlock: { paddingTop: 2 },
      dangerBtn: {
        padding: '6px 14px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-state-error-primary)',
        background: 'transparent',
        color: 'var(--dsw-alias-state-error-primary)',
        fontSize: 13,
        cursor: 'pointer',
      },
      profileGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
        gap: '6px 18px',
      },
      headingText: { minWidth: 0 },
      disclosureBtn: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: 0,
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        minWidth: 0,
        flexWrap: 'wrap',
      },
      disclosureGlyph: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, width: 12, flexShrink: 0 },
      memberList: {
        margin: '2px 0 8px 18px',
        paddingLeft: 10,
        borderLeft: '1px solid var(--dsw-alias-border-l1)',
        display: 'flex',
        flexDirection: 'column',
      },
      memberRow: { display: 'flex', alignItems: 'baseline', gap: 8, padding: '3px 0', flexWrap: 'wrap' },
      memberRole: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' },
      detailGrid: {
        margin: '2px 0 8px 18px',
        paddingLeft: 10,
        borderLeft: '1px solid var(--dsw-alias-border-l1)',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: '2px 16px',
      },
      detailField: { display: 'flex', gap: 6, fontSize: 12, minWidth: 0 },
      detailLabel: { color: 'var(--dsw-alias-label-tertiary)', flexShrink: 0 },
      detailValue: { color: 'var(--dsw-alias-label-primary)', overflowWrap: 'anywhere' },
      accessList: { display: 'flex', flexWrap: 'wrap', gap: 6, margin: '6px 0 8px' },
      accessChip: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 6px 3px 9px',
        borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)',
        fontSize: 12,
        maxWidth: '100%',
      },
      accessChipText: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 },
      chipRemove: {
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-label-tertiary)',
        cursor: 'pointer',
        fontSize: 13,
        lineHeight: 1,
        padding: '0 2px',
      },
      accessRow: {
        display: 'grid',
        gridTemplateColumns: 'minmax(120px, 200px) minmax(0, 1fr)',
        gap: 12,
        alignItems: 'start',
        padding: '8px 0',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
      accessControls: { display: 'flex', flexWrap: 'wrap', gap: 6, minWidth: 0 },
      actions: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 6 },
      primaryBtn: {
        padding: '7px 16px',
        borderRadius: 8,
        border: '1px solid transparent',
        background: 'var(--dsw-alias-brand-primary)',
        color: 'var(--dsw-alias-bg-base)',
        fontSize: 13,
        fontWeight: 500,
        cursor: 'pointer',
      },
      ghostBtn: {
        padding: '7px 14px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13,
        cursor: 'pointer',
      },
      danger: { color: 'var(--dsw-alias-state-error-primary)' },
      ok: { color: 'var(--dsw-alias-state-success-primary)' },
      warn: { color: 'var(--dsw-alias-state-warn-primary)' },
      statusBar: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 14,
        padding: '8px 12px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        marginBottom: 12,
        fontSize: 12,
        color: 'var(--dsw-alias-label-secondary)',
      },
      dot: { width: 8, height: 8, borderRadius: '50%', display: 'inline-block' },
      logTable: {
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 10,
        overflow: 'hidden',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      logHead: {
        display: 'grid',
        gridTemplateColumns: '86px 92px 1fr',
        gap: 10,
        padding: '7px 12px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--dsw-alias-label-tertiary)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      },
      logBody: { maxHeight: 'calc(100vh - 320px)', minHeight: 200, overflow: 'auto' },
      logRow: {
        display: 'grid',
        gridTemplateColumns: '86px 92px 1fr',
        gap: 10,
        padding: '5px 12px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        fontSize: 12,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        lineHeight: '18px',
      },
      logTime: { color: 'var(--dsw-alias-label-tertiary)' },
      logKind: { fontWeight: 600 },
      logText: { color: 'var(--dsw-alias-label-secondary)', overflowWrap: 'anywhere' },
      empty: { padding: '28px 12px', textAlign: 'center', color: 'var(--dsw-alias-label-tertiary)', fontSize: 13 },
      // 双列布局：左侧为标签页栏，右侧为页面。
      shell: {
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr)',
        height: '100%',
        minHeight: 0,
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 14,
        lineHeight: 1.6,
      },
      rail: {
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '14px 10px',
        borderRight: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-specific-sidebar-fill)',
        minWidth: 132,
      },
      railTitle: {
        margin: '0 0 8px 8px',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: 'var(--dsw-alias-label-tertiary)',
      },
      // 只负责排版：配色、悬停与选中态交给样式表，
      // 行内样式优先级更高，会挡住样式表里的悬停和选中高亮。
      // 不画边框、不画轮廓：点击后只靠底色标亮当前项。
      tab: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '7px 10px',
        borderRadius: 8,
        border: 'none',
        outline: 'none',
        fontSize: 13,
        fontFamily: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
      },
      tabDot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
      pane: { minWidth: 0, minHeight: 0, overflow: 'auto' },
      hidden: { display: 'none' },
      secretWrap: { position: 'relative', display: 'flex', alignItems: 'center' },
      secretInput: { paddingRight: 38 },
      eyeBtn: {
        position: 'absolute',
        right: 4,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        padding: 0,
        borderRadius: 6,
        border: '1px solid transparent',
        background: 'transparent',
        color: 'var(--dsw-alias-label-tertiary)',
        cursor: 'pointer',
      },
      readOnly: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '6px 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 13,
        fontFamily: 'inherit',
        cursor: 'default',
      },
      inlineCode: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        color: 'var(--dsw-alias-label-primary)',
      },
    }

    /** 日志页面的侧边栏图标。 */
    function LogsIcon({ size }) {
      const edge = typeof size === 'number' ? size : 20
      return React.createElement('svg', {
        width: edge,
        height: edge,
        viewBox: '0 0 20 20',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        React.createElement('path', { d: 'M3 4.5h14v11H3z', rx: 2 }),
        React.createElement('path', { d: 'M6 8h8M6 11h5M6 14h3' }),
      )
    }

    /**
     * 绑定单个草稿字段的文本输入框。
     * @param props - `label`, `hint`, `value`, `onChange`, `type`, `placeholder`.
     */
    function TextRow({ label, hint, value, onChange, type, placeholder, disabled }) {
      return React.createElement('div', { className: 'obm-row', style: styles.row },
        React.createElement('label', { style: styles.rowLabel }, label),
        React.createElement('div', null,
          React.createElement('input', {
            type: type ?? 'text',
            style: styles.input,
            value: value ?? '',
            placeholder: placeholder ?? '',
            disabled: disabled === true,
            onChange: (event) => onChange(event.target.value),
          }),
          hint !== undefined && hint !== '' ? React.createElement('div', { style: styles.hint }, hint) : null,
        ),
      )
    }

    /**
     * 多行列表输入框（每行一项）。
     * @param props - `label`, `hint`, `value`（数组）, `onChange`。
     */
    function ListRow({ label, hint, value, onChange, placeholder }) {
      const text = Array.isArray(value) ? value.join('\n') : ''
      return React.createElement('div', { className: 'obm-row', style: styles.row },
        React.createElement('label', { style: styles.rowLabel }, label),
        React.createElement('div', null,
          React.createElement('textarea', {
            style: styles.textarea,
            value: text,
            placeholder: placeholder ?? '',
            onChange: (event) => onChange(event.target.value.split('\n').map((line) => line.trim()).filter((line) => line !== '')),
          }),
          hint !== undefined && hint !== '' ? React.createElement('div', { style: styles.hint }, hint) : null,
        ),
      )
    }

    /**
     * 使用原生复选框的布尔值输入行。
     * @param props - `label`, `hint`, `value`, `onChange`.
     */
    function BoolRow({ label, hint, value, onChange, disabled, lockedHint }) {
      return React.createElement('div', { className: 'obm-row', style: styles.row },
        React.createElement('label', { style: styles.rowLabel }, label),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement('input', {
            type: 'checkbox',
            role: 'switch',
            'aria-checked': value === true,
            'aria-disabled': disabled === true ? 'true' : undefined,
            // `disabled` 会让浏览器将已勾选的复选框置灰，
            // 使强制开启的设置看起来像未勾选。这里锁定交互，
            // 保留正常外观，仅拒绝操作。
            style: disabled === true ? { ...styles.checkbox, cursor: 'not-allowed' } : styles.checkbox,
            checked: value === true,
            readOnly: disabled === true,
            tabIndex: disabled === true ? -1 : undefined,
            onClick: disabled === true ? (event) => { event.preventDefault() } : undefined,
            onChange: (event) => { if (disabled !== true) onChange(event.target.checked) },
          }),
          lockedHint !== undefined && lockedHint !== ''
            ? React.createElement('span', { style: styles.hint }, lockedHint)
            : (hint !== undefined && hint !== '' ? React.createElement('span', { style: styles.hint }, hint) : null),
        ),
      )
    }

    /**
     * 数值输入行。
     * @param props - `label`, `hint`, `value`, `onChange`, `min`, `max`.
     */
    function NumberRow({ label, hint, value, onChange, min, max }) {
      return React.createElement('div', { className: 'obm-row', style: styles.row },
        React.createElement('label', { style: styles.rowLabel }, label),
        React.createElement('div', null,
          React.createElement('input', {
            type: 'number',
            style: styles.input,
            value: Number.isFinite(value) ? String(value) : '',
            min: min,
            max: max,
            onChange: (event) => onChange(event.target.value === '' ? '' : Number(event.target.value)),
          }),
          hint !== undefined && hint !== '' ? React.createElement('div', { style: styles.hint }, hint) : null,
        ),
      )
    }

    /** 用于切换密文显示状态的睁眼／闭眼图标。 */
    function EyeIcon({ open }) {
      if (open) {
        return React.createElement('svg', {
          width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
          stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
        },
          React.createElement('path', { d: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z' }),
          React.createElement('circle', { cx: 8, cy: 8, r: 2.1 }),
        )
      }
      return React.createElement('svg', {
        width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
      },
        React.createElement('path', { d: 'M2 2l12 12' }),
        React.createElement('path', { d: 'M6.3 6.4a2.1 2.1 0 0 0 2.9 3' }),
        React.createElement('path', { d: 'M4.2 4.4C2.6 5.6 1.5 8 1.5 8S4 12.5 8 12.5c1.2 0 2.2-.35 3.1-.9' }),
        React.createElement('path', { d: 'M11.6 10.2c1.5-1.2 2.9-2.2 2.9-2.2S12 3.5 8 3.5c-.5 0-1 .06-1.5.17' }),
      )
    }

    /**
     * 带眼睛开关的密文输入框：默认隐藏，可按需显示。
     * @param props - `label`, `hint`, `value`, `onChange`, `t`.
     */
    function SecretRow({ label, hint, value, onChange, t }) {
      const [shown, setShown] = React.useState(false)
      return React.createElement('div', { className: 'obm-row', style: styles.row },
        React.createElement('label', { style: styles.rowLabel }, label),
        React.createElement('div', null,
          React.createElement('div', { style: styles.secretWrap },
            React.createElement('input', {
              type: shown ? 'text' : 'password',
              style: { ...styles.input, ...styles.secretInput },
              value: value ?? '',
              autoComplete: 'off',
              spellCheck: false,
              onChange: (event) => onChange(event.target.value),
            }),
            React.createElement('button', {
              type: 'button',
              style: styles.eyeBtn,
              'aria-label': shown ? t('tokenHide') : t('tokenShow'),
              'aria-pressed': shown,
              title: shown ? t('tokenHide') : t('tokenShow'),
              onClick: () => setShown((current) => !current),
            }, React.createElement(EyeIcon, { open: shown })),
          ),
          hint !== undefined && hint !== '' ? React.createElement('div', { style: styles.hint }, hint) : null,
        ),
      )
    }

    /**
     * 由插件自行维护的值：可查看、可选中，但不可编辑。
     * @param props - `label`, `hint`, `value`, `emptyText`.
     */
    function ReadOnlyRow({ label, hint, value, emptyText }) {
      const text = String(value ?? '').trim()
      return React.createElement('div', { className: 'obm-row', style: styles.row },
        React.createElement('label', { style: styles.rowLabel }, label),
        React.createElement('div', null,
          React.createElement('div', { style: styles.readOnly, tabIndex: 0, 'aria-readonly': true },
            text !== ''
              ? React.createElement('span', { style: styles.inlineCode }, text)
              : React.createElement('span', { style: styles.hint }, emptyText ?? '')),
          hint !== undefined && hint !== '' ? React.createElement('div', { style: styles.hint }, hint) : null,
        ),
      )
    }

    /**
     * 工作区选择器：仅列出已有工作区，并标为必填。
     *
     * 配置中已有但目录中缺失的路径仍保留在列表中，
     * 以便显式显示已删除的工作区，而非悄然替换。
     * @param props - `label`, `hint`, `value`, `onChange`, `workspaces`, `t`.
     */
    function WorkspaceRow({ label, hint, value, onChange, workspaces, t }) {
      const catalog = workspaces !== null && workspaces !== undefined && Array.isArray(workspaces.workspaces)
        ? workspaces.workspaces
        : []
      const current = String(value ?? '')
      const known = catalog.some((item) => item.path === current)
      const options = catalog.map((item) => React.createElement('option', { key: item.id, value: item.path },
        item.title !== '' ? item.title + ' — ' + item.path : item.path))
      if (current !== '' && !known) {
        options.unshift(React.createElement('option', { key: '__missing', value: current }, current + '  (' + t('workspaceMissing') + ')'))
      }
      if (current === '') {
        options.unshift(React.createElement('option', { key: '__none', value: '' }, t('workspaceChoose')))
      }
      const unavailable = workspaces === null || workspaces === undefined || workspaces.available === false
      return React.createElement('div', { className: 'obm-row', style: styles.row },
        React.createElement('label', { style: styles.rowLabel }, label),
        React.createElement('div', null,
          React.createElement('select', {
            style: styles.select,
            value: current,
            disabled: unavailable || catalog.length === 0,
            onChange: (event) => onChange(event.target.value),
          }, options),
          React.createElement('div', { style: styles.hint },
            unavailable ? t('workspaceUnavailable') : (hint !== undefined && hint !== '' ? hint : t('workspaceHint'))),
        ),
      )
    }

    /** 已知预设标识到字典键的映射。 */
    const PRESET_NAME_KEYS = {
      standard: 'presetNameStandard',
      ptc: 'presetNamePtc',
      minimal: 'presetNameMinimal',
      cordis: 'presetNameCordis',
    }

    /** 已知权限预设值到字典键的映射。 */
    const PERMISSION_NAME_KEYS = {
      'read-only': 'permReadOnly',
      'workspace-write': 'permWorkspaceWrite',
      'danger-full-access': 'permDangerFullAccess',
      auto: 'permAuto',
    }

    /**
     * 返回已知值的多语言名称，找不到时先用宿主提供的名称，
     * 再用原始值。
     * @param map - 值 → 字典键。
     * @param value - 原始值。
     * @param fallback - 宿主提供的名称。
     * @param t - 多语言绑定函数。
     * @returns 显示名称。
     */
    function localizedName(map, value, fallback, t) {
      const key = map[value]
      if (key !== undefined) {
        const text = t(key)
        if (text !== key) return text
      }
      return fallback !== undefined && fallback !== '' ? fallback : value
    }

    /**
     * 智能体预设选择器。
     *
     * 空值表示“部署默认值”。配置过但已不存在的预设
     * 仍保留在列表中，以便显示删除情况；宿主在创建会话时
     * 回退到默认预设。
     * @param props - `label`, `hint`, `value`, `onChange`, `catalog`, `t`.
     */
    function AgentPresetRow({ label, hint, value, onChange, catalog, t }) {
      const list = catalog !== null && catalog !== undefined && Array.isArray(catalog.presets) ? catalog.presets : []
      const available = catalog !== null && catalog !== undefined && catalog.available === true
      const current = String(value ?? '')
      const known = list.some((item) => item.id === current)
      const options = [React.createElement('option', { key: '__default', value: '' }, t('presetDefault'))]
      for (const item of list) {
        if (item.broken !== '' && item.broken !== undefined) continue
        const label = localizedName(PRESET_NAME_KEYS, item.id, item.name, t)
        options.push(React.createElement('option', { key: item.id, value: item.id },
          label + (item.isDefault ? '  (' + t('presetIsDefault') + ')' : '')))
      }
      if (current !== '' && !known) {
        options.push(React.createElement('option', { key: '__missing', value: current }, current + '  (' + t('presetMissing') + ')'))
      }
      return React.createElement('div', { className: 'obm-row', style: styles.row },
        React.createElement('label', { style: styles.rowLabel }, label),
        React.createElement('div', null,
          React.createElement('select', {
            style: styles.select,
            value: current,
            disabled: !available,
            onChange: (event) => onChange(event.target.value),
          }, options),
          React.createElement('div', { style: styles.hint },
            !available ? t('presetUnavailable') : (hint !== undefined && hint !== '' ? hint : t('presetHint'))),
        ),
      )
    }

    /**
     * 模型选择器：将所有提供方／模型组合列在同一个平铺列表中。
     *
     * 值为 `provider::model`，空值使用部署默认模型。
     * 配置过但已不再提供的组合仍保留在列表中，
     * 以便显式显示其不可用状态。
     * @param props - `label`, `hint`, `value`, `onChange`, `catalog`, `t`.
     */
    function ModelRow({ label, hint, value, onChange, catalog, t }) {
      const list = catalog !== null && catalog !== undefined && Array.isArray(catalog.models) ? catalog.models : []
      const available = catalog !== null && catalog !== undefined && catalog.available === true
      const current = String(value ?? '')
      const known = list.some((item) => item.value === current)
      const options = [React.createElement('option', { key: '__default', value: '' }, t('modelDefault'))]
      for (const item of list) {
        const isDefault = catalog.defaultModel === item.value
        options.push(React.createElement('option', { key: item.value, value: item.value },
          item.providerName + ' / ' + item.modelName + (isDefault ? '  (' + t('modelIsDefault') + ')' : '')))
      }
      if (current !== '' && !known) {
        options.push(React.createElement('option', { key: '__missing', value: current }, current + '  (' + t('modelMissing') + ')'))
      }
      return React.createElement('div', { className: 'obm-row', style: styles.row },
        React.createElement('label', { style: styles.rowLabel }, label),
        React.createElement('div', null,
          React.createElement('select', {
            style: styles.select,
            value: current,
            disabled: !available,
            onChange: (event) => onChange(event.target.value),
          }, options),
          React.createElement('div', { style: styles.hint },
            !available ? t('modelUnavailable') : (hint !== undefined && hint !== '' ? hint : t('modelHint'))),
        ),
      )
    }

    /**
     * 权限预设选择器（沙箱与审批策略组合），必填。
     * @param props - `label`, `hint`, `value`, `onChange`, `catalog`, `t`.
     */
    function PermissionRow({ label, hint, value, onChange, catalog, t }) {
      const list = catalog !== null && catalog !== undefined && Array.isArray(catalog.options) ? catalog.options : []
      const available = catalog !== null && catalog !== undefined && catalog.available === true
      const current = String(value ?? '')
      const known = list.some((item) => item.value === current)
      const options = []
      if (current === '' || !known) {
        const fallbackLabel = current === '' ? t('permissionChoose') : current + '  (' + t('permissionMissing') + ')'
        options.push(React.createElement('option', { key: '__none', value: current === '' ? '' : current },
          current === '' ? fallbackLabel : fallbackLabel))
      }
      for (const item of list) {
        const label = localizedName(PERMISSION_NAME_KEYS, item.value, item.name, t)
        options.push(React.createElement('option', { key: item.value, value: item.value }, label))
      }
      return React.createElement('div', { className: 'obm-row', style: styles.row },
        React.createElement('label', { style: styles.rowLabel },
          label,
          React.createElement('span', { style: { ...styles.danger, marginLeft: 4 } }, ' *')),
        React.createElement('div', null,
          React.createElement('select', {
            style: styles.select,
            value: current,
            disabled: !available,
            onChange: (event) => onChange(event.target.value),
          }, options),
          React.createElement('div', { style: styles.hint },
            !available ? t('permissionUnavailable') : (hint !== undefined && hint !== '' ? hint : t('permissionHint'))),
        ),
      )
    }

    /**
     * onebot_call 动作列表：一个总开关，每个动作各占一行，
     * 附带中文说明。状态以*已禁用*动作集合保存，
     * 因此已有安装中新加入目录的动作默认开启。
     * @param props - `enabled`, `disabled`, `groups`, `actionPrompts`,
     *   `onToggleEnabled`, `onChangeDisabled`, `onChangeActionPrompts`, `t`.
     */
    function ToolCatalogSection({ enabled, disabled, groups, actionPrompts, adminOnly, adminUserId, onToggleEnabled, onChangeDisabled, onChangeActionPrompts, onChangeAdminOnly, t }) {
      const [filter, setFilter] = React.useState('')
      const disabledSet = new Set(Array.isArray(disabled) ? disabled : [])
      const adminOnlySet = new Set(Array.isArray(adminOnly) ? adminOnly : [])
      const overrides = actionPrompts !== null && typeof actionPrompts === 'object' && !Array.isArray(actionPrompts)
        ? actionPrompts
        : {}
      const commit = (next) => onChangeDisabled([...next])
      const commitAdminOnly = (next) => { if (typeof onChangeAdminOnly === 'function') onChangeAdminOnly([...next]) }
      const toggleAdmin = (name, nonAdminAllowed) => {
        const next = new Set(adminOnlySet)
        if (nonAdminAllowed) next.delete(name)
        else next.add(name)
        commitAdminOnly(next)
      }
      const isCustom = (action) => typeof overrides[action.name] === 'string' && overrides[action.name].trim() !== ''
      const promptOf = (action) => (isCustom(action) ? overrides[action.name] : (action.defaultPrompt ?? ''))
      const setPrompt = (name, text) => {
        const next = { ...overrides }
        if (String(text ?? '').trim() === '') delete next[name]
        else next[name] = text
        if (typeof onChangeActionPrompts === 'function') onChangeActionPrompts(next)
      }
      const toggleAction = (name, on) => {
        const next = new Set(disabledSet)
        if (on) next.delete(name)
        else next.add(name)
        commit(next)
      }
      const toggleGroup = (names, on) => {
        const next = new Set(disabledSet)
        for (const name of names) {
          if (on) next.delete(name)
          else next.add(name)
        }
        commit(next)
      }

      const total = groups.reduce((sum, group) => sum + group.actions.length, 0)
      const enabledCount = groups.reduce(
        (sum, group) => sum + group.actions.filter((action) => !disabledSet.has(action.name)).length, 0,
      )

      const children = [
        React.createElement(BoolRow, {
          key: 'master',
          label: t('fieldOnebotToolEnabled'),
          hint: t('hintOnebotToolEnabled'),
          value: enabled === true,
          onChange: onToggleEnabled,
        }),
      ]
      if (!enabled) {
        children.push(React.createElement('div', { key: 'off', style: { ...styles.hint, paddingTop: 6 } }, t('hintOnebotToolOff')))
        return React.createElement('section', { style: styles.group }, children)
      }
      children.push(React.createElement('div', { key: 'summary', style: styles.toolSummary },
        React.createElement('span', null, format(t('toolTotal'), { on: enabledCount, total })),
        React.createElement('input', {
          type: 'search',
          style: styles.toolSearch,
          value: filter,
          placeholder: t('toolSearchPlaceholder'),
          onChange: (event) => setFilter(event.target.value),
        }),
      ))
      children.push(React.createElement('div', { key: 'actionsHint', style: { ...styles.hint, padding: '0 0 10px' } },
        t('toolGroupsHint') + ' ' + t('toolActionsHint')))
      if (String(adminUserId ?? '').trim() === '' && adminOnlySet.size > 0) {
        children.push(React.createElement('div', { key: 'noAdminWarning', style: { ...styles.hint, ...styles.danger, padding: '0 0 10px' } },
          t('toolNoAdminWarning')))
      }

      const needle = filter.trim().toLowerCase()
      for (const group of groups) {
        const matched = needle === ''
          ? group.actions
          : group.actions.filter((action) => action.name.toLowerCase().includes(needle)
            || action.zh.includes(needle)
            || action.en.toLowerCase().includes(needle))
        if (matched.length === 0) continue
        const names = group.actions.map((action) => action.name)
        const onCount = group.actions.filter((action) => !disabledSet.has(action.name)).length
        const allOn = group.actions.length > 0 && onCount === group.actions.length
        // 每个分组使用默认折叠的 <details>，避免 118 行动作把页面撑得过长。
        // 标题作为可点击的摘要；分组复选框置于标题内，
        // 并阻止点击事件触发面板的展开或折叠。
        const header = React.createElement('summary', { key: group.id + '-h', style: styles.toolGroupHeader },
          React.createElement('label', {
            style: styles.toolGroupLabel,
            onClick: (event) => event.stopPropagation(),
          },
            React.createElement('input', {
              type: 'checkbox',
              style: styles.checkbox,
              checked: allOn,
              onChange: (event) => toggleGroup(names, event.target.checked),
            }),
            React.createElement('span', { style: styles.toolGroupName }, t(toolGroupLabelKey(group.id))),
          ),
          React.createElement('span', { style: styles.hint },
            format(t('toolCount'), { on: onCount, total: group.actions.length })),
        )
        const rows = matched.map((action) => React.createElement('div', {
          key: group.id + '-' + action.name,
          style: styles.toolRowBlock,
        },
          React.createElement('label', { style: styles.toolListRow },
            React.createElement('input', {
              type: 'checkbox',
              style: { ...styles.checkbox, marginTop: 2 },
              checked: !disabledSet.has(action.name),
              onChange: (event) => toggleAction(action.name, event.target.checked),
            }),
            React.createElement('div', { style: styles.toolListText },
              React.createElement('span', { style: styles.toolListName }, action.zh),
              React.createElement('code', { style: styles.toolActionCode }, action.name),
              React.createElement('span', {
                style: {
                  ...styles.toolKindBadge,
                  color: action.local ? '#1e40af' : (action.standard ? '#166534' : '#92400e'),
                  background: action.local ? '#dbeafe' : (action.standard ? '#dcfce7' : '#fef3c7'),
                  borderColor: action.local ? '#93c5fd' : (action.standard ? '#86efac' : '#fcd34d'),
                },
              }, t(action.local ? 'toolBadgeLocal' : (action.standard ? 'toolBadgeStandard' : 'toolBadgeExtension'))),
            ),
          ),
          React.createElement('label', { style: styles.toolAdminRow, title: t('toolNonAdminHint') },
            React.createElement('input', {
              type: 'checkbox',
              style: styles.checkbox,
              checked: !adminOnlySet.has(action.name),
              onChange: (event) => toggleAdmin(action.name, event.target.checked),
            }),
            React.createElement('span', null, t('toolNonAdminAllowed')),
          ),
          React.createElement('details', { style: styles.toolPrompt },
            React.createElement('summary', { style: styles.toolPromptSummary },
              t('toolPromptSummary'),
              isCustom(action) ? React.createElement('span', { style: styles.toolPromptCustom }, t('toolPromptCustom')) : null,
            ),
            React.createElement('textarea', {
              style: styles.toolPromptArea,
              rows: 3,
              spellCheck: false,
              value: promptOf(action),
              onChange: (event) => setPrompt(action.name, event.target.value),
            }),
            React.createElement('div', { style: { ...styles.hint, marginTop: 4 } }, t('toolPromptHint')),
            isCustom(action) ? React.createElement('button', {
              type: 'button',
              style: { ...styles.ghostBtn, marginTop: 6, fontSize: 11, padding: '2px 8px' },
              onClick: () => setPrompt(action.name, ''),
            }, t('toolPromptReset')) : null,
          ),
        ))
        children.push(React.createElement('details', { key: group.id, style: styles.toolGroup, open: needle !== '' ? true : undefined },
          header,
          React.createElement('div', { style: styles.toolList }, rows),
        ))
      }
      if (needle !== '' && children.filter((child) => child.key !== 'master' && child.key !== 'summary'
        && child.key !== 'actionsHint' && child.key !== 'note').length === 0) {
        children.push(React.createElement('div', { key: 'noMatch', style: styles.hint }, t('toolNoMatch')))
      }
      children.push(React.createElement('div', { key: 'note', style: { ...styles.hint, paddingTop: 8 } }, t('toolNoteAuto')))
      return React.createElement('section', { style: styles.group }, children)
    }

    /**
     * 按声明类型渲染一个配置字段。
     * @param props - `field`, `kind`, `label`, `hint`, `value`, `onChange`, `t`.
     */
    function FieldRow({ field, kind, label, hint, value, onChange, workspaces, agentPresets, permissionPresets, models, locked, lockedHint, t }) {
      if (field === 'mode') {
        return React.createElement('div', { className: 'obm-row', style: styles.row },
          React.createElement('label', { style: styles.rowLabel }, label),
          React.createElement('select', {
            style: styles.select,
            value: value === 'forward' ? 'forward' : 'reverse',
            onChange: (event) => onChange(event.target.value),
          },
            React.createElement('option', { value: 'reverse' }, t('modeReverse')),
            React.createElement('option', { value: 'forward' }, t('modeForward')),
          ),
          React.createElement('div', { style: styles.hint },
            value === 'forward' ? t('modeHintForward') : t('modeHintReverse')),
        )
      }
      if (field === 'replyMode') {
        return React.createElement('div', { className: 'obm-row', style: styles.row },
          React.createElement('label', { style: styles.rowLabel }, label),
          React.createElement('select', {
            style: styles.select,
            value: value === 'final' ? 'final' : 'stream',
            onChange: (event) => onChange(event.target.value),
          },
            React.createElement('option', { value: 'stream' }, t('replyModeStream')),
            React.createElement('option', { value: 'final' }, t('replyModeFinal')),
          ),
          React.createElement('div', { style: styles.hint }, hint),
        )
      }
      if (field === 'botQQ') return React.createElement(ReadOnlyRow, { label, hint, value, emptyText: t('botQQEmpty') })
      if (kind === 'workspace') return React.createElement(WorkspaceRow, { label, hint, value, onChange, workspaces, t })
      if (kind === 'agentPreset') return React.createElement(AgentPresetRow, { label, hint, value, onChange, catalog: agentPresets, t })
      if (kind === 'model') return React.createElement(ModelRow, { label, hint, value, onChange, catalog: models, t })
      if (kind === 'permission') return React.createElement(PermissionRow, { label, hint, value, onChange, catalog: permissionPresets, t })
      if (kind === 'boolean') return React.createElement(BoolRow, {
        label, hint, value: value === true, onChange, disabled: locked === true, lockedHint,
      })
      if (kind === 'number') return React.createElement(NumberRow, { label, hint, value, onChange })
      if (kind === 'stringList') return React.createElement(ListRow, { label, hint, value, onChange, placeholder: t('listPlaceholder') })
      if (kind === 'secret') return React.createElement(SecretRow, { label, hint, value, onChange, t })
      return React.createElement(TextRow, { label, hint, value, onChange, type: 'text' })
    }

    /**
     * 配置页：加载快照、维护草稿并提交补丁。
     * @param props - `t`，作为摘要渲染时还包含插槽的 `view`。
     */
    function ConfigPage(props) {
      const { t, liveSelfId: liveSelfIdProp } = props
      const [snapshot, setSnapshot] = React.useState(undefined)
      const [draft, setDraft] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(undefined)
      const [problems, setProblems] = React.useState([])
      const [savedAt, setSavedAt] = React.useState(0)
      const [liveSelfId, setLiveSelfId] = React.useState(liveSelfIdProp ?? '')
      React.useEffect(() => {
        if (typeof liveSelfIdProp === 'string' && liveSelfIdProp !== '') setLiveSelfId(liveSelfIdProp)
      }, [liveSelfIdProp])

      const load = React.useCallback(() => {
        let alive = true
        void fetch(STATE_ROUTE, { headers: { accept: 'application/json' } })
          .then(readJson)
          .then((body) => {
            if (!alive) return
            // 显示实时连接已上报的账号，即使宿主尚未
            // 持久化该值；操作人员希望在此看到真实的 QQ 号，
            // 而不是需要手动填写的空框。
            const live = String(body.status?.selfId ?? '')
            if (live !== '') setLiveSelfId(live)
            if (live !== '' && String(body.config?.botQQ ?? '') === '') {
              body = { ...body, config: { ...body.config, botQQ: live } }
            }
            setSnapshot(body)
            setDraft({ ...body.config })
            setError(undefined)
          })
          .catch((failure) => {
            if (alive) setError(String(failure?.message ?? failure))
          })
        return () => { alive = false }
      }, [])

      React.useEffect(load, [load])

      const dirty = React.useMemo(() => {
        if (snapshot === undefined || draft === undefined) return false
        return Object.keys(draft).some((key) => {
          const before = snapshot.config[key]
          const after = draft[key]
          if (Array.isArray(before) || Array.isArray(after)) return JSON.stringify(before) !== JSON.stringify(after)
          return before !== after
        })
      }, [snapshot, draft])

      const save = React.useCallback(() => {
        if (draft === undefined || busy) return
        const patch = {}
        for (const key of Object.keys(draft)) {
          if (snapshot !== undefined && JSON.stringify(snapshot.config[key]) === JSON.stringify(draft[key])) continue
          patch[key] = draft[key]
        }
        if (Object.keys(patch).length === 0) return
        setBusy(true)
        setProblems([])
        setError(undefined)
        void fetch(CONFIG_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ patch }),
        })
          .then(readResult)
          .then(({ ok, body }) => {
            if (!ok || body.ok !== true) {
              setProblems(Array.isArray(body.problems) ? body.problems : [body.error ?? 'save failed'])
              return
            }
            setSnapshot(body)
            setDraft({ ...body.config })
            setSavedAt(Date.now())
          })
          .catch((failure) => setError(String(failure?.message ?? failure)))
          .finally(() => setBusy(false))
      }, [draft, snapshot, busy])

      React.useEffect(() => {
        if (savedAt === 0) return undefined
        const timer = window.setTimeout(() => setSavedAt(0), 2400)
        return () => window.clearTimeout(timer)
      }, [savedAt])

      if (error !== undefined) return errorPanel(t, error, load)

      if (snapshot === undefined || draft === undefined) {
        return React.createElement('div', { style: styles.content },
          React.createElement('div', { style: styles.hint }, t('loading')),
        )
      }

      const set = (field, value) => setDraft((current) => ({ ...(current ?? {}), [field]: value }))
      const secretFields = snapshot.secretFields ?? []
      const kinds = snapshot.kinds ?? {}
      const groups = snapshot.groups ?? []
      // 限定模式的字段（监听地址／端口或网关 URL）只在
      // 所属模式下显示，避免表单提供
      // 当前运行模式会忽略的输入框。
      const modeFields = snapshot.modeFields ?? {}
      const workspaceCatalog = snapshot.workspaces ?? { available: false, workspaces: [] }
      const presetCatalog = snapshot.agentPresets ?? { available: false, presets: [] }
      const permissionCatalog = snapshot.permissionPresets ?? { available: false, options: [], defaultPreset: '' }
      const modelCatalog = snapshot.models ?? { available: false, models: [], defaultModel: '' }
      const currentMode = draft.mode === 'forward' ? 'forward' : 'reverse'
      const visible = (field) => modeFields[field] === undefined || modeFields[field] === currentMode

      const groupsUi = groups.map((group) => {
        return React.createElement('section', { key: group.id, style: styles.group },
          React.createElement('h3', { style: styles.groupTitle }, t(groupLabelKey(group.id))),
          group.fields.filter(visible).map((field) => {
            const label = t(fieldLabelKey(field))
            let hint = ''
            if (field === 'accessToken') hint = t('tokenHint')
            if (field === 'sessionPrefix') hint = t('hintSessionPrefix')
            if (field === 'inboundMedia') hint = t('hintInboundMedia')
            if (field === 'inboundMediaMaxMb') hint = t('hintInboundMediaMaxMb')
            if (field === 'deleteInboundMedia') hint = t('hintDeleteInboundMedia')
            if (field === 'replyMode') hint = t('hintReplyMode')
            if (field === 'compactRatio') hint = t('hintCompactRatio')
            if (field === 'botQQ') hint = liveSelfId !== '' ? format(t('botQQHint'), { id: liveSelfId }) : t('botQQHintEmpty')
            return React.createElement(FieldRow, {
              key: field,
              field,
              kind: secretFields.includes(field) ? 'secret' : (kinds[field] ?? 'string'),
              label,
              hint: field === 'senderPrefix'
                ? t('hintSenderPrefixFree')
                : (field === 'privateAutoInterject' ? t('hintPrivateAutoInterject') : hint),
              value: draft[field],
              onChange: (value) => set(field, value),
              workspaces: workspaceCatalog,
              agentPresets: presetCatalog,
              permissionPresets: permissionCatalog,
              models: modelCatalog,
              t,
            })
          }),
        )
      })

      return React.createElement('div', { style: styles.page },
        React.createElement('div', { style: styles.content },
          React.createElement('div', { className: 'obm-heading', style: styles.heading },
            React.createElement('div', null,
              React.createElement('h2', { style: styles.headingTitle }, t('title')),
              React.createElement('p', { style: styles.headingSubtitle }, t('subtitle')),
            ),
            React.createElement('button', { type: 'button', style: styles.ghostBtn, onClick: load, disabled: busy }, t('reload')),
          ),
          groupsUi,
          problems.length > 0
            ? React.createElement('div', { style: { ...styles.group, ...styles.danger } },
              problems.map((problem, index) => React.createElement('div', { key: index }, '• ' + problem)),
            )
            : null,
          React.createElement('div', { style: styles.actions },
            React.createElement('button', {
              type: 'button',
              style: { ...styles.primaryBtn, opacity: busy || !dirty ? 0.5 : 1 },
              onClick: save,
              disabled: busy || !dirty,
            }, busy ? t('saving') : t('save')),
            React.createElement('span', { style: savedAt !== 0 ? styles.ok : styles.hint },
              savedAt !== 0 ? t('saved') : (dirty ? t('unsaved') : t('saveHint')),
            ),
          ),
        ),
      )
    }

    /**
     * 工具页：单独保存的 onebot_call 动作列表。
     *
     * 加载与设置页相同的状态快照，为两个工具字段维护
     * 草稿，保存时仅提交这两个字段，确保编辑工具时
     * 不会改动连接设置。
     * @param props - `t`.
     */
    function ToolsPage(props) {
      const { t } = props
      const [snapshot, setSnapshot] = React.useState(undefined)
      const [enabled, setEnabled] = React.useState(true)
      const [disabled, setDisabled] = React.useState(undefined)
      const [actionPrompts, setActionPrompts] = React.useState(undefined)
      const [adminOnly, setAdminOnly] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(undefined)
      const [problems, setProblems] = React.useState([])
      const [savedAt, setSavedAt] = React.useState(0)

      const load = React.useCallback(() => {
        let alive = true
        void fetch(STATE_ROUTE, { headers: { accept: 'application/json' } })
          .then(readJson)
          .then((body) => {
            if (!alive) return
            setSnapshot(body)
            setEnabled(body.config?.onebotToolEnabled !== false)
            setDisabled(Array.isArray(body.config?.onebotToolDisabled) ? body.config.onebotToolDisabled : [])
            setActionPrompts(isPlainObject(body.config?.actionPrompts) ? body.config.actionPrompts : {})
            setAdminOnly(Array.isArray(body.config?.toolAdminOnly) ? body.config.toolAdminOnly : [])
            setError(undefined)
          })
          .catch((failure) => { if (alive) setError(String(failure?.message ?? failure)) })
        return () => { alive = false }
      }, [])

      React.useEffect(load, [load])

      const dirty = React.useMemo(() => {
        if (snapshot === undefined || disabled === undefined || actionPrompts === undefined || adminOnly === undefined) return false
        const beforeEnabled = snapshot.config?.onebotToolEnabled !== false
        const beforeDisabled = Array.isArray(snapshot.config?.onebotToolDisabled) ? snapshot.config.onebotToolDisabled : []
        const beforePrompts = isPlainObject(snapshot.config?.actionPrompts) ? snapshot.config.actionPrompts : {}
        const beforeAdminOnly = Array.isArray(snapshot.config?.toolAdminOnly) ? snapshot.config.toolAdminOnly : []
        return enabled !== beforeEnabled
          || JSON.stringify(disabled) !== JSON.stringify(beforeDisabled)
          || JSON.stringify(actionPrompts) !== JSON.stringify(beforePrompts)
          || JSON.stringify(adminOnly) !== JSON.stringify(beforeAdminOnly)
      }, [snapshot, enabled, disabled, actionPrompts, adminOnly])

      const save = React.useCallback(() => {
        if (disabled === undefined || actionPrompts === undefined || adminOnly === undefined || busy) return
        setBusy(true)
        setProblems([])
        setError(undefined)
        void fetch(CONFIG_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ patch: { onebotToolEnabled: enabled, onebotToolDisabled: disabled, actionPrompts, toolAdminOnly: adminOnly } }),
        })
          .then(readResult)
          .then(({ ok, body }) => {
            if (!ok || body.ok !== true) {
              setProblems(Array.isArray(body.problems) ? body.problems : [body.error ?? 'save failed'])
              return
            }
            setSnapshot(body)
            setEnabled(body.config?.onebotToolEnabled !== false)
            setDisabled(Array.isArray(body.config?.onebotToolDisabled) ? body.config.onebotToolDisabled : [])
            setActionPrompts(isPlainObject(body.config?.actionPrompts) ? body.config.actionPrompts : {})
            setAdminOnly(Array.isArray(body.config?.toolAdminOnly) ? body.config.toolAdminOnly : [])
            setSavedAt(Date.now())
          })
          .catch((failure) => setError(String(failure?.message ?? failure)))
          .finally(() => setBusy(false))
      }, [enabled, disabled, actionPrompts, adminOnly, busy])

      React.useEffect(() => {
        if (savedAt === 0) return undefined
        const timer = window.setTimeout(() => setSavedAt(0), 2400)
        return () => window.clearTimeout(timer)
      }, [savedAt])

      if (error !== undefined) return errorPanel(t, error, load)

      if (snapshot === undefined || disabled === undefined || actionPrompts === undefined || adminOnly === undefined) {
        return React.createElement('div', { style: styles.content },
          React.createElement('div', { style: styles.hint }, t('loading')),
        )
      }

      return React.createElement('div', { style: styles.page },
        React.createElement('div', { style: styles.content },
          React.createElement('div', { className: 'obm-heading', style: styles.heading },
            React.createElement('div', null,
              React.createElement('h2', { style: styles.headingTitle }, t('toolsTitle')),
              React.createElement('p', { style: styles.headingSubtitle }, t('toolsSubtitle')),
            ),
            React.createElement('button', { type: 'button', style: styles.ghostBtn, onClick: load, disabled: busy }, t('reload')),
          ),
          React.createElement(ToolCatalogSection, {
            enabled,
            disabled,
            actionPrompts,
            adminOnly,
            adminUserId: snapshot.config?.adminUserId,
            groups: toolGroupsOf(snapshot),
            onToggleEnabled: setEnabled,
            onChangeDisabled: setDisabled,
            onChangeActionPrompts: setActionPrompts,
            onChangeAdminOnly: setAdminOnly,
            t,
          }),
          problems.length > 0
            ? React.createElement('div', { style: { ...styles.group, ...styles.danger } },
              problems.map((problem, index) => React.createElement('div', { key: index }, '• ' + problem)))
            : null,
          React.createElement('div', { style: styles.actions },
            React.createElement('button', {
              type: 'button',
              style: { ...styles.primaryBtn, opacity: busy || !dirty ? 0.5 : 1 },
              onClick: save,
              disabled: busy || !dirty,
            }, busy ? t('saving') : t('toolSave')),
            React.createElement('span', { style: savedAt !== 0 ? styles.ok : styles.hint },
              savedAt !== 0 ? t('toolSaved') : (dirty ? t('toolUnsaved') : ''),
            ),
          ),
        ),
      )
    }

    /**
     * 一条群组记录，可按需展开成员列表。
     *
     * 成员按群组获取，并在页面生命周期内缓存，
     * 因此反复展开同一群组只需一次往返请求。若网关拒绝
     * `get_group_member_list`，则在展开区域显示原因，
     * 而不隐藏整个群组。
     * @param props - `group`, `t`.
     */
    function GroupRow({ group, t }) {
      const [open, setOpen] = React.useState(false)
      const [members, setMembers] = React.useState(undefined)
      const [error, setError] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)

      const loadMembers = React.useCallback(() => {
        if (members !== undefined || busy) return
        setBusy(true)
        void fetch(MEMBERS_ROUTE + '?group_id=' + encodeURIComponent(group.id), { headers: { accept: 'application/json' } })
          .then(readJson)
          .then((body) => {
            if (body.available === false) {
              setError(String(body.error ?? 'unavailable'))
              setMembers([])
              return
            }
            setMembers(Array.isArray(body.items) ? body.items : [])
            setError(undefined)
          })
          .catch((failure) => { setError(String(failure?.message ?? failure)); setMembers([]) })
          .finally(() => setBusy(false))
      }, [group.id, members, busy])

      const toggle = () => {
        const next = !open
        setOpen(next)
        if (next) loadMembers()
      }

      const roleLabel = (role) => (role === 'owner'
        ? t('membersRoleOwner')
        : (role === 'admin' ? t('membersRoleAdmin') : t('membersRoleMember')))

      let body = null
      if (open) {
        if (busy && members === undefined) {
          body = React.createElement('div', { style: styles.hint }, t('membersLoading'))
        } else if (error !== undefined) {
          body = React.createElement('div', { style: { ...styles.hint, ...styles.danger } }, format(t('membersFailed'), { message: error }))
        } else if (members !== undefined && members.length === 0) {
          body = React.createElement('div', { style: styles.hint }, t('membersEmpty'))
        } else if (members !== undefined) {
          body = React.createElement('div', { className: 'obm-member-list', style: styles.memberList },
            members.map((member) => React.createElement('div', { key: member.id, style: styles.memberRow },
              React.createElement('span', { style: styles.contactName }, member.name !== '' ? member.name : member.id),
              React.createElement('code', { style: styles.toolActionCode }, member.id),
              React.createElement('span', { style: styles.memberRole }, roleLabel(member.role)),
            )),
          )
        }
      }

      return React.createElement('div', null,
        React.createElement('div', { className: 'obm-contact-row', style: styles.contactRow },
          React.createElement('button', {
            type: 'button',
            className: 'obm-disclosure',
            style: styles.disclosureBtn,
            'aria-expanded': open,
            onClick: toggle,
          },
            React.createElement('span', { style: styles.disclosureGlyph }, open ? '▾' : '▸'),
            React.createElement('span', { style: styles.contactName }, group.name !== '' ? group.name : group.id),
            React.createElement('code', { style: styles.toolActionCode }, group.id),
          ),
          React.createElement('span', { style: styles.hint },
            open && members !== undefined && members.length > 0
              ? format(t('membersTitle'), { count: members.length })
              : (group.memberCount > 0 ? format(t('contactsMembers'), { count: group.memberCount }) : '')),
        ),
        body,
      )
    }

    /**
     * 一条好友记录，可展开查看账号资料详情。
     *
     * 在线状态不属于 OneBot 11 标准，网关未上报时
     * 状态行显示“未知”，而非声称好友离线。
     * @param props - `friend`, `t`.
     */
    function FriendRow({ friend, t }) {
      const [open, setOpen] = React.useState(false)
      const [detail, setDetail] = React.useState(undefined)
      const [error, setError] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)

      const loadDetail = React.useCallback(() => {
        if (detail !== undefined || busy) return
        setBusy(true)
        void fetch(FRIEND_ROUTE + '?user_id=' + encodeURIComponent(friend.id), { headers: { accept: 'application/json' } })
          .then(readJson)
          .then((body) => {
            if (body.available === false) {
              setError(String(body.error ?? 'unavailable'))
              return
            }
            setDetail(body)
            setError(undefined)
          })
          .catch((failure) => setError(String(failure?.message ?? failure)))
          .finally(() => setBusy(false))
      }, [friend.id, detail, busy])

      const toggle = () => {
        const next = !open
        setOpen(next)
        if (next) loadDetail()
      }

      const field = (label, value) => (value === '' || value === 0 || value === undefined
        ? null
        : React.createElement('div', { key: label, style: styles.detailField },
          React.createElement('span', { style: styles.detailLabel }, label),
          React.createElement('span', { style: styles.detailValue }, String(value)),
        ))

      let body = null
      if (open) {
        if (busy && detail === undefined && error === undefined) {
          body = React.createElement('div', { style: styles.hint }, t('friendDetailLoading'))
        } else if (error !== undefined) {
          body = React.createElement('div', { style: { ...styles.hint, ...styles.danger } }, format(t('friendDetailFailed'), { message: error }))
        } else if (detail !== undefined) {
          body = React.createElement('div', { className: 'obm-detail-grid', style: styles.detailGrid },
            field(t('friendDetailId'), friend.id),
            field(t('friendDetailNickname'), detail.nickname),
            field(t('friendDetailRemark'), detail.remark),
            field(t('friendDetailSex'), detail.sex === 'male'
              ? t('profileSexMale')
              : (detail.sex === 'female' ? t('profileSexFemale') : t('profileSexUnknown'))),
            field(t('friendDetailAge'), detail.age),
            field(t('friendDetailLevel'), detail.level),
            field(t('friendDetailQid'), detail.qid),
            React.createElement('div', { key: 'online', style: styles.detailField },
              React.createElement('span', { style: styles.detailLabel }, t('friendDetailOnline')),
              React.createElement('span', { style: styles.detailValue },
                detail.online === true
                  ? t('friendDetailOnlineYes')
                  : (detail.online === false ? t('friendDetailOnlineOffline') : t('friendDetailOnlineUnknown'))),
            ),
          )
        }
      }

      const name = friend.name !== '' ? friend.name : ''
      const nameless = name === '' || name === friend.id
      return React.createElement('div', null,
        React.createElement('div', { className: 'obm-contact-row', style: styles.contactRow },
          React.createElement('button', {
            type: 'button',
            className: 'obm-disclosure',
            style: styles.disclosureBtn,
            'aria-expanded': open,
            onClick: toggle,
          },
            React.createElement('span', { style: styles.disclosureGlyph }, open ? '▾' : '▸'),
            nameless
              ? React.createElement('code', { style: styles.contactName }, friend.id)
              : React.createElement('span', { style: styles.contactName }, name),
            nameless ? null : React.createElement('code', { style: styles.toolActionCode }, friend.id),
          ),
          // 有备注时，记录的主名称显示备注，因此末尾提示
          // 应显示昵称——将其标为“备注”会颠倒含义。
          React.createElement('span', { style: styles.hint },
            friend.remark !== '' && friend.nickname !== '' && friend.remark !== friend.nickname
              ? t('contactsNickname') + ': ' + friend.nickname
              : ''),
        ),
        body,
      )
    }

    /**
     * 联系人页：以列表展示机器人账号的好友和群组。
     *
     * 好友记录展开为资料，群组记录展开为成员。仅在
     * 挂载和按需刷新时加载，因为数据变化不频繁，
     * 且每次刷新都需与网关进行两次往返请求。
     * @param props - `t`.
     */
    function ContactsPage(props) {
      const { t } = props
      const [data, setData] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(undefined)

      const load = React.useCallback(() => {
        let alive = true
        setBusy(true)
        void fetch(CONTACTS_ROUTE, { headers: { accept: 'application/json' } })
          .then(readJson)
          .then((body) => {
            if (!alive) return
            setData(body)
            setError(undefined)
          })
          .catch((failure) => { if (alive) setError(String(failure?.message ?? failure)) })
          .finally(() => { if (alive) setBusy(false) })
        return () => { alive = false }
      }, [])

      React.useEffect(load, [load])

      const heading = React.createElement('div', { className: 'obm-heading', style: styles.heading },
        React.createElement('div', { className: 'obm-heading-text', style: styles.headingText },
          React.createElement('h2', { style: styles.headingTitle }, t('contactsTitle')),
          React.createElement('p', { style: styles.headingSubtitle }, t('contactsSubtitle')),
        ),
        React.createElement('button', { type: 'button', style: styles.ghostBtn, onClick: load, disabled: busy }, t('contactsRefresh')),
      )

      if (error !== undefined) return errorPanel(t, error, load, heading)

      if (data === undefined) {
        return React.createElement('div', { style: styles.content }, heading,
          React.createElement('div', { style: styles.hint }, t('loading')),
        )
      }

      const friends = data.friends ?? { available: false, items: [], error: '' }
      const groups = data.groups ?? { available: false, items: [], error: '' }
      const connected = data.state === 'online'

      const renderSection = ({ title, section, renderRow, emptyKey }) => {
        const rows = section.items.map(renderRow)
        const body = section.available
          ? (rows.length > 0 ? React.createElement('div', { style: styles.contactList }, rows)
            : React.createElement('div', { style: styles.hint }, t(emptyKey)))
          : React.createElement('div', { style: styles.hint }, format(t('contactsUnavailable'), { message: section.error ?? '' }))
        return React.createElement('section', { key: title, style: styles.group },
          React.createElement('h3', { style: styles.groupTitle },
            title + '  ' + format(t('contactsCount'), { count: section.items.length }),
          ),
          body,
        )
      }

      return React.createElement('div', { style: styles.page },
        React.createElement('div', { style: styles.content },
          heading,
          !connected
            ? React.createElement('div', { style: { ...styles.group, ...styles.warn } }, t('contactsOffline'))
            : null,
          renderSection({
            title: t('contactsFriends'),
            section: friends,
            emptyKey: 'contactsEmpty',
            renderRow: (item) => React.createElement(FriendRow, { key: item.id, friend: item, t }),
          }),
          renderSection({
            title: t('contactsGroups'),
            section: groups,
            emptyKey: 'contactsEmpty',
            renderRow: (item) => React.createElement(GroupRow, { key: item.id, group: item, t }),
          }),
        ),
      )
    }

    /**
     * 一份访问名单：从机器人的好友或群组中选择，
     * 并将当前条目显示为可移除的标签。
     *
     * 选择器仅提供网关实际上报的账号，操作人员
     * 无需记忆 QQ 号。仍保留手动输入框，
     * 因为准备设置时网关可能离线，
     * 而手动输入的标识依然有效。
     * @param props - `label`, `hint`, `ids`, `options`, `placeholder`,
     *   `manualPlaceholder`, `onChange`, `t`.
     */
    function AccessListRow({ label, hint, ids, options, placeholder, manualPlaceholder, onChange, t }) {
      const [manual, setManual] = React.useState('')
      const list = Array.isArray(ids) ? ids : []
      const entries = new Set(list)
      const add = (id) => {
        const next = String(id ?? '').trim()
        if (next === '' || entries.has(next)) return
        onChange([...list, next])
      }
      const remove = (id) => onChange(list.filter((entry) => entry !== id))
      const nameOf = (id) => {
        const found = options.find((option) => option.id === id)
        if (found === undefined) return id
        return found.name !== '' && found.name !== found.id ? found.name + ' (' + found.id + ')' : found.id
      }
      const remaining = options.filter((option) => !entries.has(option.id))
      const chips = list.length === 0
        ? React.createElement('div', { style: styles.hint }, t('accessEmpty'))
        : React.createElement('div', { style: styles.accessList },
          list.map((id) => React.createElement('span', { key: id, style: styles.accessChip },
            React.createElement('span', { style: styles.accessChipText }, nameOf(id)),
            React.createElement('button', {
              type: 'button',
              style: styles.chipRemove,
              title: t('accessRemove'),
              'aria-label': t('accessRemove'),
              onClick: () => remove(id),
            }, '×'),
          )),
        )
      return React.createElement('div', { className: 'obm-access-row', style: styles.accessRow },
        React.createElement('label', { style: styles.rowLabel }, label),
        React.createElement('div', null,
          React.createElement('div', { style: styles.accessControls },
            remaining.length > 0
              ? React.createElement('select', {
                style: { ...styles.select, maxWidth: '100%' },
                value: '',
                onChange: (event) => { add(event.target.value); event.target.value = '' },
              },
                React.createElement('option', { value: '' }, placeholder),
                remaining.map((option) => React.createElement('option', { key: option.id, value: option.id },
                  option.name !== '' && option.name !== option.id ? option.name + ' (' + option.id + ')' : option.id)),
              )
              : null,
            React.createElement('input', {
              type: 'text',
              style: { ...styles.input, width: 'auto', minWidth: 160, flex: '1 1 160px' },
              value: manual,
              placeholder: manualPlaceholder,
              onChange: (event) => setManual(event.target.value),
              onKeyDown: (event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                add(manual)
                setManual('')
              },
            }),
            React.createElement('button', {
              type: 'button',
              style: styles.ghostBtn,
              onClick: () => { add(manual); setManual('') },
            }, t('accessAdd')),
          ),
          hint !== undefined && hint !== '' ? React.createElement('div', { style: styles.hint }, hint) : null,
          chips,
        ),
      )
    }

    /**
     * 单个管理员选择器：选择一位好友作为机器人管理员。
     *
     * 复用联系人路由的好友选项；网关离线时仍可
     * 手动输入。空值表示不设管理员。
     * @param props - `label`, `hint`, `value`, `options`, `placeholder`,
     *   `manualPlaceholder`, `noneText`, `clearText`, `onChange`, `t`.
     */
    function AdminRow({ label, hint, value, options, placeholder, manualPlaceholder, noneText, clearText, onChange, t }) {
      const current = String(value ?? '')
      const [manual, setManual] = React.useState('')
      const known = options.some((option) => option.id === current)
      const nameOf = (id) => {
        const found = options.find((option) => option.id === id)
        if (found === undefined) return id
        return found.name !== '' && found.name !== found.id ? found.name + ' (' + found.id + ')' : found.id
      }
      const commit = (id) => onChange(String(id ?? '').trim())
      const selectOptions = [React.createElement('option', { key: '__none', value: '' }, placeholder)]
      for (const option of options) {
        selectOptions.push(React.createElement('option', { key: option.id, value: option.id },
          option.name !== '' && option.name !== option.id ? option.name + ' (' + option.id + ')' : option.id))
      }
      if (current !== '' && !known) {
        selectOptions.push(React.createElement('option', { key: '__current', value: current }, current))
      }
      return React.createElement('div', { className: 'obm-access-row', style: styles.accessRow },
        React.createElement('label', { style: styles.rowLabel }, label),
        React.createElement('div', null,
          React.createElement('div', { style: styles.accessControls },
            React.createElement('select', {
              style: { ...styles.select, maxWidth: '100%' },
              value: current,
              onChange: (event) => commit(event.target.value),
            }, selectOptions),
            React.createElement('input', {
              type: 'text',
              style: { ...styles.input, width: 'auto', minWidth: 160, flex: '1 1 160px' },
              value: manual,
              placeholder: manualPlaceholder,
              onChange: (event) => setManual(event.target.value),
              onKeyDown: (event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                commit(manual)
                setManual('')
              },
            }),
            React.createElement('button', {
              type: 'button',
              style: styles.ghostBtn,
              onClick: () => { commit(manual); setManual('') },
            }, t('accessAdd')),
            current !== ''
              ? React.createElement('button', {
                type: 'button',
                style: styles.ghostBtn,
                onClick: () => commit(''),
              }, clearText)
              : null,
          ),
          hint !== undefined && hint !== '' ? React.createElement('div', { style: styles.hint }, hint) : null,
          React.createElement('div', { style: styles.hint },
            current === '' ? noneText : nameOf(current)),
        ),
      )
    }

    /**
     * 访问控制页：私聊和群聊的白名单与黑名单。
     *
     * 选择器复用联系人路由，提供账号的真实好友和群组。
     * 保存时仅更新四个访问控制字段。
     * @param props - `t`.
     */
    function AccessPage(props) {
      const { t } = props
      const [snapshot, setSnapshot] = React.useState(undefined)
      const [contacts, setContacts] = React.useState({ friends: [], groups: [], connected: false })
      const [draft, setDraft] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(undefined)
      const [problems, setProblems] = React.useState([])
      const [savedAt, setSavedAt] = React.useState(0)

      const load = React.useCallback(() => {
        let alive = true
        void fetch(STATE_ROUTE, { headers: { accept: 'application/json' } })
          .then(readJson)
          .then((body) => {
            if (!alive) return
            setSnapshot(body)
            setDraft({
              allowFrom: Array.isArray(body.config?.allowFrom) ? body.config.allowFrom : [],
              denyFrom: Array.isArray(body.config?.denyFrom) ? body.config.denyFrom : [],
              allowGroups: Array.isArray(body.config?.allowGroups) ? body.config.allowGroups : [],
              denyGroups: Array.isArray(body.config?.denyGroups) ? body.config.denyGroups : [],
              adminUserId: typeof body.config?.adminUserId === 'string' ? body.config.adminUserId : '',
            })
            setError(undefined)
            // 选择器只为操作提供便利：加载失败时仍保留手动输入框。
            void fetch(CONTACTS_ROUTE, { headers: { accept: 'application/json' } })
              .then((response) => (response.ok ? response.json() : undefined))
              .then((body2) => {
                if (!alive || body2 === undefined) return
                setContacts({
                  connected: body2.state === 'online',
                  friends: Array.isArray(body2.friends?.items) ? body2.friends.items : [],
                  groups: Array.isArray(body2.groups?.items) ? body2.groups.items : [],
                })
              })
              .catch(() => undefined)
          })
          .catch((failure) => { if (alive) setError(String(failure?.message ?? failure)) })
        return () => { alive = false }
      }, [])

      React.useEffect(load, [load])

      const dirty = React.useMemo(() => {
        if (snapshot === undefined || draft === undefined) return false
        const listsDirty = ['allowFrom', 'denyFrom', 'allowGroups', 'denyGroups'].some((key) => {
          const before = Array.isArray(snapshot.config?.[key]) ? snapshot.config[key] : []
          return JSON.stringify(before) !== JSON.stringify(draft[key] ?? [])
        })
        const adminBefore = typeof snapshot.config?.adminUserId === 'string' ? snapshot.config.adminUserId : ''
        return listsDirty || adminBefore !== (draft.adminUserId ?? '')
      }, [snapshot, draft])

      const save = React.useCallback(() => {
        if (draft === undefined || busy) return
        setBusy(true)
        setProblems([])
        setError(undefined)
        void fetch(CONFIG_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ patch: draft }),
        })
          .then(readResult)
          .then(({ ok, body }) => {
            if (!ok || body.ok !== true) {
              setProblems(Array.isArray(body.problems) ? body.problems : [body.error ?? 'save failed'])
              return
            }
            setSnapshot(body)
            setSavedAt(Date.now())
          })
          .catch((failure) => setError(String(failure?.message ?? failure)))
          .finally(() => setBusy(false))
      }, [draft, busy])

      React.useEffect(() => {
        if (savedAt === 0) return undefined
        const timer = window.setTimeout(() => setSavedAt(0), 2400)
        return () => window.clearTimeout(timer)
      }, [savedAt])

      if (error !== undefined) return errorPanel(t, error, load)

      if (snapshot === undefined || draft === undefined) {
        return React.createElement('div', { style: styles.content },
          React.createElement('div', { style: styles.hint }, t('loading')),
        )
      }

      const set = (field, value) => setDraft((current) => ({ ...(current ?? {}), [field]: value }))
      const friendOptions = contacts.friends.map((item) => ({ id: item.id, name: item.name }))
      const groupOptions = contacts.groups.map((item) => ({ id: item.id, name: item.name }))

      return React.createElement('div', { style: styles.page },
        React.createElement('div', { style: styles.content },
          React.createElement('div', { className: 'obm-heading', style: styles.heading },
            React.createElement('div', { className: 'obm-heading-text', style: styles.headingText },
              React.createElement('h2', { style: styles.headingTitle }, t('accessTitle')),
              React.createElement('p', { style: styles.headingSubtitle }, t('accessSubtitle')),
            ),
            React.createElement('button', { type: 'button', style: styles.ghostBtn, onClick: load, disabled: busy }, t('reload')),
          ),
          !contacts.connected
            ? React.createElement('div', { style: { ...styles.group, ...styles.warn } }, t('accessNoContacts'))
            : null,
          React.createElement('section', { style: styles.group },
            React.createElement('h3', { style: styles.groupTitle }, t('accessAdmin')),
            React.createElement(AdminRow, {
              label: t('accessAdmin'),
              hint: t('accessAdminHint'),
              value: draft.adminUserId,
              options: friendOptions,
              placeholder: t('accessAdminChoose'),
              manualPlaceholder: t('accessAdminManual'),
              noneText: t('accessAdminNone'),
              clearText: t('accessAdminClear'),
              onChange: (value) => set('adminUserId', value),
              t,
            }),
          ),
          React.createElement('section', { style: styles.group },
            React.createElement('h3', { style: styles.groupTitle }, t('accessPrivateAllow')),
            React.createElement(AccessListRow, {
              label: t('accessPrivateAllow'),
              hint: t('accessAllowHint'),
              ids: draft.allowFrom,
              options: friendOptions,
              placeholder: t('accessChooseFriend'),
              manualPlaceholder: t('accessManualPlaceholder'),
              onChange: (value) => set('allowFrom', value),
              t,
            }),
            React.createElement(AccessListRow, {
              label: t('accessPrivateDeny'),
              hint: t('accessDenyHint'),
              ids: draft.denyFrom,
              options: friendOptions,
              placeholder: t('accessChooseFriend'),
              manualPlaceholder: t('accessManualPlaceholder'),
              onChange: (value) => set('denyFrom', value),
              t,
            }),
          ),
          React.createElement('section', { style: styles.group },
            React.createElement('h3', { style: styles.groupTitle }, t('accessGroupAllow')),
            React.createElement(AccessListRow, {
              label: t('accessGroupAllow'),
              hint: t('accessAllowHint'),
              ids: draft.allowGroups,
              options: groupOptions,
              placeholder: t('accessChooseGroup'),
              manualPlaceholder: t('accessManualPlaceholder'),
              onChange: (value) => set('allowGroups', value),
              t,
            }),
            React.createElement(AccessListRow, {
              label: t('accessGroupDeny'),
              hint: t('accessDenyHint'),
              ids: draft.denyGroups,
              options: groupOptions,
              placeholder: t('accessChooseGroup'),
              manualPlaceholder: t('accessManualPlaceholder'),
              onChange: (value) => set('denyGroups', value),
              t,
            }),
          ),
          React.createElement('div', { style: styles.hint }, t('accessNote')),
          problems.length > 0
            ? React.createElement('div', { style: { ...styles.group, ...styles.danger } },
              problems.map((problem, index) => React.createElement('div', { key: index }, '• ' + problem)))
            : null,
          React.createElement('div', { style: styles.actions },
            React.createElement('button', {
              type: 'button',
              style: { ...styles.primaryBtn, opacity: busy || !dirty ? 0.5 : 1 },
              onClick: save,
              disabled: busy || !dirty,
            }, busy ? t('saving') : t('accessSave')),
            React.createElement('span', { style: savedAt !== 0 ? styles.ok : styles.hint },
              savedAt !== 0 ? t('accessSaved') : (dirty ? t('accessUnsaved') : ''),
            ),
          ),
        ),
      )
    }

    /**
     * 一条 QQ 空间说说记录。
     *
     * 供“我的说说”和好友动态共用：两者会规范化为
     * 相同字段，使用同一渲染器可保持两个列表一致。
     * @param props - `post`, `showAuthor`, `t`.
     */
    /**
     * 带文字后备提示的缩略图。
     *
     * 代理仍可能失败（主机被屏蔽、CDN 对象消失或图片
     * 超过流式转发上限）。破图图标无法说明原因，
     * 因此加载失败时用简短文字替代。
     * @param props - `src`, `href`, `t`.
     */
    function QzoneImage({ src, href, t }) {
      const [failed, setFailed] = React.useState(false)
      if (failed) {
        return React.createElement('span', { style: styles.qzoneImageFailed }, t('qzoneImageFailed'))
      }
      return React.createElement('a', {
        href,
        target: '_blank',
        rel: 'noreferrer',
        style: styles.qzoneImageLink,
      }, React.createElement('img', {
        src,
        alt: t('qzoneImageAlt'),
        loading: 'lazy',
        style: styles.qzoneImage,
        onError: () => setFailed(true),
      }))
    }

    function QzonePostRow({ post, showAuthor, t }) {
      const meta = []
      if (post.time > 0) {
        const when = new Date(post.time * 1000)
        meta.push(when.toLocaleString(undefined, { hour12: false }))
      }
      if (post.commentCount > 0) meta.push(format(t('qzoneComments'), { count: post.commentCount }))
      if (post.likeCount > 0) meta.push(format(t('qzoneLikes'), { count: post.likeCount }))
      if (post.images.length > 0) meta.push(format(t('qzoneImages'), { count: post.images.length }))
      const head = []
      if (showAuthor && post.userId !== '') head.push(post.userId)
      if (post.private) head.push(t('qzonePrivate'))
      // 代理路由需用账号确定缓存目录；好友动态携带作者标识，
      // 自己的说说则归属所选账号。
      const owner = post.userId !== '' ? post.userId : (post.ownerUin ?? '')
      const images = post.images.length > 0 && owner !== ''
        ? React.createElement('div', { style: styles.qzoneImages },
          post.images.map((src, index) => {
            const proxied = IMAGE_ROUTE + '?qq=' + encodeURIComponent(owner) + '&url=' + encodeURIComponent(src)
            return React.createElement(QzoneImage, { key: index, src: proxied, href: proxied, t })
          }))
        : null
      return React.createElement('div', { style: styles.qzonePost },
        React.createElement('div', { style: styles.qzonePostHead },
          head.length > 0
            ? React.createElement('span', { style: styles.qzoneTag }, head.join(' · '))
            : null,
          React.createElement('span', { style: styles.hint }, meta.join('  ·  ')),
        ),
        React.createElement('div', { style: styles.qzoneText },
          post.content !== '' ? post.content : t('qzoneNoContent')),
        images,
      )
    }

    /**
     * 说明某个区域内容无法读取的原因。
     *
     * QQ 端的权限错误码使用专门文案，以免错误提示
     * “网关不支持此查询”，误导操作人员去排查插件缺陷，
     * 而不是查看空间的隐私设置。
     * @param section - 该区域的查询结果。
     * @param t - 多语言绑定函数。
     */
    function QzoneError({ section, t }) {
      if (section.error === 'forbidden') {
        return React.createElement('div', null,
          React.createElement('div', { style: styles.hint }, t('qzoneForbidden')),
          React.createElement('div', { style: styles.hint },
            format(t('qzoneForbiddenHint'), { code: section.errorCode ?? '' }) + ' ' + t('qzoneForbiddenSwitch')),
        )
      }
      return React.createElement('div', { style: styles.hint },
        format(t('qzoneUnavailable'), { message: section.error ?? '' }))
    }

    /**
     * 一个 QQ 空间列表区域：标题、数量、记录或该区域的错误。
     * @param props - `title`, `section`, `showAuthor`, `t`.
     */
    function QzoneSection({ title, section, showAuthor, t }) {
      const items = Array.isArray(section.items) ? section.items : []
      let body
      if (!section.available) {
        body = React.createElement(QzoneError, { section, t })
      } else if (items.length === 0) {
        body = React.createElement('div', { style: styles.hint }, t('qzoneEmpty'))
      } else {
        body = React.createElement('div', { style: styles.qzoneList },
          items.map((post, index) => React.createElement(QzonePostRow, {
            key: post.tid !== '' ? post.tid : title + index,
            post,
            showAuthor,
            t,
          })))
      }
      return React.createElement('section', { style: styles.group },
        React.createElement('h3', { style: styles.groupTitle },
          title + '  ' + format(t('qzoneCount'), { count: items.length })),
        body,
      )
    }

    /**
     * QQ 空间页：资料、自己的说说和好友动态。
     *
     * 特意保持只读。模型可通过 `onebot_call` 发说说、
     * 评论和点赞；用户在此面板中浏览时，
     * 不应因误操作而向自己的 QQ 空间发布任何内容。
     * @param props - `t`.
     */
    function QzonePage(props) {
      const { t } = props
      const [data, setData] = React.useState(undefined)
      const [friends, setFriends] = React.useState([])
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(undefined)
      // 空值表示“我的空间”；其他值则读取对应账号的空间。
      const [target, setTarget] = React.useState('')
      const [manual, setManual] = React.useState('')

      const load = React.useCallback(() => {
        let alive = true
        setBusy(true)
        const query = target.trim() === '' ? '' : '?target_uin=' + encodeURIComponent(target.trim())
        void fetch(QZONE_ROUTE + query, { headers: { accept: 'application/json' } })
          .then(readJson)
          .then((body) => {
            if (!alive) return
            setData(body)
            setError(undefined)
          })
          .catch((failure) => { if (alive) setError(String(failure?.message ?? failure)) })
          .finally(() => { if (alive) setBusy(false) })
        return () => { alive = false }
      }, [target])

      React.useEffect(load, [load])

      // 好友列表为选择器提供选项；加载失败时仍可手动输入。
      React.useEffect(() => {
        let alive = true
        void fetch(CONTACTS_ROUTE, { headers: { accept: 'application/json' } })
          .then((response) => (response.ok ? response.json() : undefined))
          .then((body) => {
            if (!alive || body === undefined) return
            setFriends(Array.isArray(body.friends?.items) ? body.friends.items : [])
          })
          .catch(() => undefined)
        return () => { alive = false }
      }, [])

      const heading = React.createElement('div', { style: styles.heading },
        React.createElement('div', { style: styles.headingText },
          React.createElement('h2', { style: styles.headingTitle }, t('qzoneTitle')),
          React.createElement('p', { style: styles.headingSubtitle }, t('qzoneSubtitle')),
        ),
        React.createElement('button', { type: 'button', style: styles.ghostBtn, onClick: load, disabled: busy }, t('qzoneRefresh')),
      )

      // 选择空间有两种方式：从真实好友下拉列表中选择，或输入非好友 QQ 号。
      // 下拉列表直接写入 `target`；
      // 输入框需点击按钮后提交，避免查询尚未输完的号码。
      const targetBar = React.createElement('section', { style: styles.group },
        React.createElement('div', { style: styles.accessControls },
          React.createElement('select', {
            style: { ...styles.select, maxWidth: '100%', minWidth: 180 },
            value: target,
            onChange: (event) => setTarget(event.target.value),
          },
            React.createElement('option', { value: '' }, t('qzoneTargetMine')),
            friends.map((friend) => React.createElement('option', { key: friend.id, value: friend.id },
              friend.name !== '' && friend.name !== friend.id ? friend.name + ' (' + friend.id + ')' : friend.id)),
          ),
          React.createElement('input', {
            type: 'text',
            style: { ...styles.input, width: 'auto', minWidth: 140, flex: '1 1 140px' },
            value: manual,
            placeholder: t('qzoneTargetPlaceholder'),
            onChange: (event) => setManual(event.target.value),
            onKeyDown: (event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              setTarget(manual.trim())
            },
          }),
          React.createElement('button', {
            type: 'button',
            style: styles.ghostBtn,
            onClick: () => setTarget(manual.trim()),
          }, t('qzoneTargetGo')),
        ),
      )

      if (error !== undefined) return errorPanel(t, error, load, heading, targetBar)

      if (data === undefined) {
        return React.createElement('div', { style: styles.content }, heading, targetBar,
          React.createElement('div', { style: styles.hint }, t('loading')),
        )
      }

      const profile = data.profile ?? { available: false, error: '', name: '', description: '' }
      const posts = data.posts ?? { available: false, error: '', items: [] }
      const feeds = data.feeds ?? { available: false, error: '', items: [] }

      const profileBody = profile.available
        ? React.createElement('div', { style: styles.qzoneProfile },
          profile.name !== ''
            ? React.createElement('div', { style: styles.detailField },
              React.createElement('span', { style: styles.detailLabel }, t('qzoneName')),
              React.createElement('span', { style: styles.detailValue }, profile.name))
            : null,
          profile.description !== ''
            ? React.createElement('div', { style: styles.detailField },
              React.createElement('span', { style: styles.detailLabel }, t('qzoneDescription')),
              React.createElement('span', { style: styles.detailValue }, profile.description))
            : null,
          profile.name === '' && profile.description === ''
            ? React.createElement('div', { style: styles.hint }, t('qzoneProfileEmpty'))
            : null,
        )
        : React.createElement(QzoneError, { section: profile, t })

      return React.createElement('div', { style: styles.page },
        React.createElement('div', { style: styles.content },
          heading,
          targetBar,
          data.state !== 'online'
            ? React.createElement('div', { style: { ...styles.group, ...styles.warn } }, t('qzoneOffline'))
            : null,
          React.createElement('section', { style: styles.group },
            React.createElement('h3', { style: styles.groupTitle }, t('qzoneProfile')),
            profileBody,
          ),
          React.createElement(QzoneSection, { title: t('qzonePosts'), section: posts, showAuthor: false, t }),
          React.createElement(QzoneSection, { title: t('qzoneFeeds'), section: feeds, showAuthor: true, t }),
        ),
      )
    }

    /**
     * 个人资料页：显示单个账号的详情，默认为机器人自己。
     *
     * 好友选择器复用联系人路由，选项来自账号的真实好友，
     * 无需手动输入号码。查看他人资料为只读操作，
     * 此处不会更改账号。
     * @param props - `t`.
     */
    function ProfilePage(props) {
      const { t } = props
      const [data, setData] = React.useState(undefined)
      const [friends, setFriends] = React.useState([])
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(undefined)
      // 空值表示“机器人自己”。
      const [target, setTarget] = React.useState('')

      const load = React.useCallback(() => {
        let alive = true
        setBusy(true)
        const query = target === '' ? '' : '?user_id=' + encodeURIComponent(target)
        void fetch(PROFILE_ROUTE + query, { headers: { accept: 'application/json' } })
          .then(readJson)
          .then((body) => {
            if (!alive) return
            setData(body)
            setError(undefined)
          })
          .catch((failure) => { if (alive) setError(String(failure?.message ?? failure)) })
          .finally(() => { if (alive) setBusy(false) })
        return () => { alive = false }
      }, [target])

      React.useEffect(load, [load])

      // 好友列表只为选择器提供便利；加载失败时，
      // 页面仍可查看机器人自己的资料。
      React.useEffect(() => {
        let alive = true
        void fetch(CONTACTS_ROUTE, { headers: { accept: 'application/json' } })
          .then((response) => (response.ok ? response.json() : undefined))
          .then((body) => {
            if (!alive || body === undefined) return
            setFriends(Array.isArray(body.friends?.items) ? body.friends.items : [])
          })
          .catch(() => undefined)
        return () => { alive = false }
      }, [])

      const heading = React.createElement('div', { style: styles.heading },
        React.createElement('div', { style: styles.headingText },
          React.createElement('h2', { style: styles.headingTitle }, t('profileTitle')),
          React.createElement('p', { style: styles.headingSubtitle }, t('profileSubtitle')),
        ),
        React.createElement('button', { type: 'button', style: styles.ghostBtn, onClick: load, disabled: busy }, t('profileRefresh')),
      )

      const picker = React.createElement('section', { style: styles.group },
        React.createElement('div', { style: styles.accessControls },
          React.createElement('select', {
            style: { ...styles.select, maxWidth: '100%', minWidth: 200 },
            value: target,
            onChange: (event) => setTarget(event.target.value),
          },
            React.createElement('option', { value: '' }, t('profileSelf')),
            friends.map((friend) => React.createElement('option', { key: friend.id, value: friend.id },
              friend.name !== '' && friend.name !== friend.id ? friend.name + ' (' + friend.id + ')' : friend.id)),
          ),
        ),
      )

      if (error !== undefined) return errorPanel(t, error, load, heading, picker)

      if (data === undefined) {
        return React.createElement('div', { style: styles.content }, heading, picker,
          React.createElement('div', { style: styles.hint }, t('loading')),
        )
      }

      if (data.available === false) {
        return React.createElement('div', { style: styles.content }, heading, picker,
          React.createElement('div', { style: styles.group },
            data.state === 'offline'
              ? t('profileOffline')
              : format(t('profileUnavailable'), { message: data.error ?? '' })),
        )
      }

      const sexLabel = data.sex === 'male'
        ? t('profileSexMale')
        : (data.sex === 'female' ? t('profileSexFemale') : t('profileSexUnknown'))
      const onlineLabel = data.online === true
        ? t('profileOnlineYes')
        : (data.online === false ? t('profileOnlineNo') : t('profileOnlineUnknown'))
      const registered = data.regTime > 0
        ? new Date(data.regTime * 1000).toLocaleDateString(undefined)
        : ''

      const field = (key, label, value) => (value === '' || value === 0 || value === undefined || value === null
        ? null
        : React.createElement('div', { key, style: styles.detailField },
          React.createElement('span', { style: styles.detailLabel }, label),
          React.createElement('span', { style: styles.detailValue }, String(value)),
        ))

      const fields = [
        field('id', t('profileId'), data.userId),
        field('nick', t('profileNickname'), data.nickname),
        field('remark', t('profileRemark'), data.remark),
        field('qid', t('profileQid'), data.qid),
        field('uid', t('profileUid'), data.uid),
        field('signature', t('profileSignature'), data.signature),
        field('sex', t('profileSex'), sexLabel),
        field('age', t('profileAge'), data.age),
        field('level', t('profileLevel'), data.level),
        field('loginDays', t('profileLoginDays'), data.loginDays),
        field('regTime', t('profileRegTime'), registered),
        field('vip', t('profileVip'), data.vip ? t('profileVipYes') : ''),
        field('yearsVip', t('profileVipYears'), data.yearsVip ? t('profileVipYes') : ''),
        field('vipLevel', t('profileVipLevel'), data.vipLevel),
        field('like', t('profileLike'), data.likeCount),
        React.createElement('div', { key: 'online', style: styles.detailField },
          React.createElement('span', { style: styles.detailLabel }, t('profileOnline')),
          React.createElement('span', { style: styles.detailValue }, onlineLabel)),
      ].filter(Boolean)

      return React.createElement('div', { style: styles.page },
        React.createElement('div', { style: styles.content },
          heading,
          picker,
          React.createElement('section', { style: styles.group },
            React.createElement('h3', { style: styles.groupTitle },
              (data.nickname !== '' ? data.nickname + '  ' : '') + data.userId,
              data.isSelf === true
                ? React.createElement('span', { style: styles.qzoneTag, title: t('profileSelfBadge') }, '  ' + t('profileSelfBadge'))
                : null,
            ),
            fields.length > 0
              ? React.createElement('div', { style: styles.profileGrid }, fields)
              : React.createElement('div', { style: styles.hint }, t('profileEmpty')),
          ),
        ),
      )
    }

    /** 以便于阅读的形式显示字节大小。 */
    function formatBytes(bytes) {
      const n = Math.max(0, Number(bytes) || 0)
      if (n < 1024) return n + ' B'
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
      if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
      return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
    }

    /**
     * 执行前需再次点击确认的按钮。
     *
     * 清空存储无法撤销，因此不能让一次误触就触发清理。
     * @param props - `label`, `confirmLabel`, `cancelLabel`, `pending`, `busy`,
     *   `onConfirm`, `t`.
     */
    function ConfirmButton({ label, pending, busy, onConfirm, onCancel, t }) {
      if (pending) {
        return React.createElement('span', { style: styles.cacheActions },
          React.createElement('span', { style: styles.hint }, t('cacheConfirm')),
          React.createElement('button', { type: 'button', style: styles.dangerBtn, disabled: busy, onClick: onConfirm }, t('cacheConfirmYes')),
          React.createElement('button', { type: 'button', style: styles.ghostBtn, disabled: busy, onClick: onCancel }, t('cacheConfirmNo')),
        )
      }
      return React.createElement('button', { type: 'button', style: styles.ghostBtn, disabled: busy, onClick: onConfirm }, label)
    }

    /**
     * 提示词页：注入每个 QQ 智能体的频道说明。
     *
     * 模板可编辑、持久化，并支持一键恢复。页面说明了
     * 各动态占位符的含义，方便操作人员保留需实时更新的部分，
     * 只改写周围的说明文字。
     * @param props - `t`.
     */
    function PromptsPage(props) {
      const { t } = props
      const [snapshot, setSnapshot] = React.useState(undefined)
      const [drafts, setDrafts] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(undefined)
      const [problems, setProblems] = React.useState([])
      const [savedAt, setSavedAt] = React.useState(0)

      const defs = Array.isArray(snapshot?.promptDefs) ? snapshot.promptDefs : []

      const load = React.useCallback(() => {
        let alive = true
        void fetch(STATE_ROUTE, { headers: { accept: 'application/json' } })
          .then(readJson)
          .then((body) => {
            if (!alive) return
            setSnapshot(body)
            const next = {}
            for (const def of (Array.isArray(body.promptDefs) ? body.promptDefs : [])) {
              next[def.field] = String(body.config?.[def.field] ?? '')
            }
            setDrafts(next)
            setError(undefined)
          })
          .catch((failure) => { if (alive) setError(String(failure?.message ?? failure)) })
        return () => { alive = false }
      }, [])

      React.useEffect(load, [load])

      const dirtyFields = (snapshot === undefined || drafts === undefined || !Array.isArray(snapshot.promptDefs))
        ? []
        : snapshot.promptDefs.filter((def) => String(drafts[def.field] ?? '') !== String(snapshot.config?.[def.field] ?? '')).map((def) => def.field)

      const save = React.useCallback(() => {
        if (snapshot === undefined || drafts === undefined || busy || dirtyFields.length === 0) return
        const patch = {}
        for (const field of dirtyFields) patch[field] = drafts[field]
        setBusy(true)
        setProblems([])
        setError(undefined)
        void fetch(CONFIG_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ patch }),
        })
          .then(readResult)
          .then(({ ok, body }) => {
            if (!ok || body.ok !== true) {
              setProblems(Array.isArray(body.problems) ? body.problems : [body.error ?? 'save failed'])
              return
            }
            setSnapshot(body)
            const next = {}
            for (const def of (Array.isArray(body.promptDefs) ? body.promptDefs : [])) {
              next[def.field] = String(body.config?.[def.field] ?? '')
            }
            setDrafts(next)
            setSavedAt(Date.now())
          })
          .catch((failure) => setError(String(failure?.message ?? failure)))
          .finally(() => setBusy(false))
      }, [snapshot, drafts, busy, dirtyFields.join(',')])

      React.useEffect(() => {
        if (savedAt === 0) return undefined
        const timer = window.setTimeout(() => setSavedAt(0), 2400)
        return () => window.clearTimeout(timer)
      }, [savedAt])

      const heading = React.createElement('div', { style: styles.heading },
        React.createElement('div', { style: styles.headingText },
          React.createElement('h2', { style: styles.headingTitle }, t('promptsTitle')),
          React.createElement('p', { style: styles.headingSubtitle }, t('promptsSubtitle')),
        ),
        React.createElement('button', { type: 'button', style: styles.ghostBtn, onClick: load, disabled: busy }, t('reload')),
      )

      if (error !== undefined) return errorPanel(t, error, undefined, heading)
      if (snapshot === undefined || drafts === undefined) {
        return React.createElement('div', { style: styles.content }, heading,
          React.createElement('div', { style: styles.hint }, t('loading')),
        )
      }

      const setField = (field, value) => setDrafts((current) => ({ ...(current ?? {}), [field]: value }))
      // 为此提示词列表中的每个占位符附上简短说明，
      // 让操作人员看到 `{replyMode}`、`{admin}` 等会展开为什么，
      // 而不只是占位符本身。未知占位符则仅显示原样文本。
      const describePlaceholder = (token) => {
        const inner = String(token ?? '').replace(/[{}]/g, '')
        if (inner === '') return String(token ?? '')
        const key = 'ph' + inner.charAt(0).toUpperCase() + inner.slice(1)
        const text = t(key)
        return text === key ? String(token) : token + '（' + text + '）'
      }
      const placeholdersText = (def) => (Array.isArray(def.placeholders) ? def.placeholders : []).map(describePlaceholder).join(' · ')

      const promptHintKey = (def) => (def.labelKey ?? '') + 'Hint'
      const isDirty = (def) => dirtyFields.includes(def.field)
      // 每个提示词使用默认折叠的原生 <details>：文本框较高，
      // 只在操作人员展开所需项时显示，以保持页面紧凑。
      // 不设置 `open` 属性，浏览器即可在重新渲染时保留
      // 用户切换的状态；各区域加载时均默认折叠。
      const sections = defs.map((def) => React.createElement('details', { key: def.field, style: styles.group },
        React.createElement('summary', { style: styles.promptSummary },
          React.createElement('span', null, t(def.labelKey)),
          isDirty(def) ? React.createElement('span', { style: styles.promptDirtyMark }, t('promptsDirtyMark')) : null,
        ),
        React.createElement('div', { style: styles.promptBody },
          React.createElement('div', { style: styles.cacheHead },
            React.createElement('div', { style: styles.hint }, t(promptHintKey(def))),
            React.createElement('button', {
              type: 'button',
              style: styles.ghostBtn,
              onClick: () => setField(def.field, String(snapshot.defaults?.[def.field] ?? def.default ?? '')),
            }, t('promptsReset')),
          ),
          React.createElement('div', { style: { ...styles.hint, padding: '4px 0 6px' } },
            Array.isArray(def.placeholders) && def.placeholders.length > 0
              ? format(t('promptsPlaceholders'), { list: placeholdersText(def) })
              : t('promptsNoPlaceholders')),
          React.createElement('textarea', {
            className: 'obm-prompt-textarea',
            style: styles.promptTextarea,
            value: String(drafts[def.field] ?? ''),
            spellCheck: false,
            onChange: (event) => setField(def.field, event.target.value),
          }),
        ),
      ))

      return React.createElement('div', { style: styles.page },
        React.createElement('div', { style: styles.content },
          heading,
          React.createElement('div', { style: { ...styles.hint, marginBottom: 10 } }, t('promptsCollapseHint')),
          sections,
          React.createElement('div', { style: styles.hint }, t('promptsEmptyNote')),
          problems.length > 0
            ? React.createElement('div', { style: { ...styles.group, ...styles.danger } },
              problems.map((problem, index) => React.createElement('div', { key: index }, '• ' + problem)))
            : null,
          React.createElement('div', { style: styles.actions },
            React.createElement('button', {
              type: 'button',
              style: { ...styles.primaryBtn, opacity: busy || dirtyFields.length === 0 ? 0.5 : 1 },
              onClick: save,
              disabled: busy || dirtyFields.length === 0,
            }, busy ? t('saving') : t('promptsSave')),
            React.createElement('span', { style: savedAt !== 0 ? styles.ok : styles.hint },
              savedAt !== 0 ? t('promptsSaved') : (dirtyFields.length > 0 ? t('promptsUnsaved') : '')),
          ),
        ),
      )
    }

    /**
     * 缓存页：显示插件写入的所有文件、大小及手动清理操作。
     *
     * 不会自行删除文件，每次清理都需用户明确操作并二次确认。
     * 设置文件仅为透明展示而列出，不允许删除。
     * @param props - `t`.
     */
    function CachePage(props) {
      const { t } = props
      const [data, setData] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(undefined)
      const [pending, setPending] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [openAccount, setOpenAccount] = React.useState('')

      const load = React.useCallback(() => {
        let alive = true
        setBusy(true)
        void fetch(CACHE_ROUTE, { headers: { accept: 'application/json' } })
          .then(readJson)
          .then((body) => { if (alive) { setData(body); setError(undefined) } })
          .catch((failure) => { if (alive) setError(String(failure?.message ?? failure)) })
          .finally(() => { if (alive) setBusy(false) })
        return () => { alive = false }
      }, [])

      React.useEffect(load, [load])

      const clear = (target) => {
        setBusy(true)
        void fetch(CACHE_CLEAR_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ target }),
        })
          .then(readResult)
          .then(({ ok, body }) => {
            if (!ok || body.ok !== true) {
              setError(String(body.error ?? 'clear failed'))
              return
            }
            setNotice(format(t('cacheCleared'), { size: formatBytes(body.freed) }))
            setPending('')
            load()
          })
          .catch((failure) => setError(String(failure?.message ?? failure)))
          .finally(() => setBusy(false))
      }

      const heading = React.createElement('div', { style: styles.heading },
        React.createElement('div', { style: styles.headingText },
          React.createElement('h2', { style: styles.headingTitle }, t('cacheTitle')),
          React.createElement('p', { style: styles.headingSubtitle }, t('cacheSubtitle')),
        ),
        React.createElement('button', { type: 'button', style: styles.ghostBtn, onClick: load, disabled: busy }, t('cacheRefresh')),
      )

      if (error !== undefined) return errorPanel(t, error, load, heading)

      if (data === undefined) {
        return React.createElement('div', { style: styles.content }, heading,
          React.createElement('div', { style: styles.hint }, t('loading')),
        )
      }

      const logs = Array.isArray(data.logs) ? data.logs : []
      const cache = data.cache ?? { totalBytes: 0, accounts: [], files: [], truncated: false }
      const accounts = Array.isArray(cache.accounts) ? cache.accounts : []
      const allFiles = Array.isArray(cache.files) ? cache.files : []
      const kindLabel = (kind) => t('cacheKind' + String(kind ?? 'file').charAt(0).toUpperCase() + String(kind ?? 'file').slice(1))

      const summary = React.createElement('div', { style: styles.cacheSummary },
        React.createElement('span', { style: styles.cacheTotal }, format(t('cacheTotal'), { size: formatBytes(data.totalBytes) })),
        React.createElement('span', { style: styles.hint }, t('cacheRoot') + ': ' + String(data.root ?? '')),
        notice !== ''
          ? React.createElement('span', { style: styles.ok }, notice)
          : null,
      )

      const configSection = React.createElement('section', { style: styles.group },
        React.createElement('h3', { style: styles.groupTitle }, t('cacheConfig')),
        React.createElement('div', { style: styles.cacheRow },
          React.createElement('code', { style: styles.cacheMono }, String(data.config?.path ?? '')),
          React.createElement('span', { style: styles.hint }, formatBytes(data.config?.size)),
        ),
        React.createElement('div', { style: styles.hint }, t('cacheConfigNote')),
      )

      const logsSection = React.createElement('section', { style: styles.group },
        React.createElement('div', { style: styles.cacheHead },
          React.createElement('h3', { style: styles.groupTitle }, t('cacheLogs')),
          React.createElement(ConfirmButton, {
            label: t('cacheClearLogs'),
            pending: pending === 'logs',
            busy,
            onConfirm: () => (pending === 'logs' ? clear('logs') : setPending('logs')),
            onCancel: () => setPending(''),
            t,
          }),
        ),
        logs.length === 0
          ? React.createElement('div', { style: styles.hint }, t('cacheNoFiles'))
          : logs.map((item) => React.createElement('div', { key: item.path, style: styles.cacheRow },
            React.createElement('code', { style: styles.cacheMono }, String(item.path)),
            React.createElement('span', { style: styles.hint },
              formatBytes(item.size) + '  ·  ' + format(t('cacheLines'), { count: item.lines ?? 0 })),
          )),
      )

      const imageSection = React.createElement('section', { style: styles.group },
        React.createElement('div', { style: styles.cacheHead },
          React.createElement('h3', { style: styles.groupTitle },
            t('cacheFiles') + '  ·  ' + formatBytes(cache.totalBytes)),
          accounts.length > 0
            ? React.createElement(ConfirmButton, {
              label: t('cacheClearImages'),
              pending: pending === 'files',
              busy,
              onConfirm: () => (pending === 'files' ? clear('files') : setPending('files')),
              onCancel: () => setPending(''),
              t,
            })
            : null,
        ),
        accounts.length === 0
          ? React.createElement('div', { style: styles.hint }, t('cacheNoFiles'))
          : accounts.map((account) => {
            const open = openAccount === account.account
            const files = allFiles.filter((file) => file.account === account.account)
            return React.createElement('div', { key: account.account, style: styles.cacheAccountBlock },
              React.createElement('div', { style: styles.cacheRow },
                React.createElement('button', {
                  type: 'button',
                  className: 'obm-disclosure',
                  style: styles.disclosureBtn,
                  onClick: () => setOpenAccount(open ? '' : account.account),
                },
                  React.createElement('span', { style: styles.disclosureGlyph }, open ? '▾' : '▸'),
                  React.createElement('span', { style: styles.contactName }, format(t('cacheAccount'), { qq: account.account })),
                ),
                React.createElement('span', { style: styles.hint },
                  formatBytes(account.size) + '  ·  ' + format(t('cacheFileCount'), { count: account.count })),
                React.createElement(ConfirmButton, {
                  label: t('cacheClearAccount'),
                  pending: pending === 'account:' + account.account,
                  busy,
                  onConfirm: () => (pending === 'account:' + account.account ? clear('account:' + account.account) : setPending('account:' + account.account)),
                  onCancel: () => setPending(''),
                  t,
                }),
              ),
              open
                ? React.createElement('div', { style: styles.memberList },
                  files.map((file) => React.createElement('div', { key: file.name, style: styles.memberRow },
                    React.createElement('span', { style: styles.qzoneTag }, kindLabel(file.kind)),
                    React.createElement('code', { style: styles.cacheMono }, file.name),
                    React.createElement('span', { style: styles.hint }, formatBytes(file.size)),
                  )),
                  cache.truncated
                    ? React.createElement('div', { style: styles.hint }, format(t('cacheTruncated'), { max: 200 }))
                    : null,
                )
                : null,
            )
          }),
      )

      return React.createElement('div', { style: styles.page },
        React.createElement('div', { style: styles.content },
          heading,
          summary,
          configSection,
          logsSection,
          imageSection,
        ),
      )
    }

    /**
     * 实时日志页。
     *
     * 向宿主轮询游标之后的新记录；暂停只停止渲染，
     * 因此用户阅读时不会丢失日志。
     */
    function LogsPage(props) {
      const { t } = props
      const [entries, setEntries] = React.useState([])
      const [status, setStatus] = React.useState({ state: 'offline' })
      const [paused, setPaused] = React.useState(false)
      const [autoScroll, setAutoScroll] = React.useState(true)
      const [error, setError] = React.useState(undefined)
      const cursor = React.useRef(0)
      const bodyRef = React.useRef(null)
      const pausedRef = React.useRef(false)
      pausedRef.current = paused

      const poll = React.useCallback(() => {
        const after = cursor.current
        return fetch(STATE_ROUTE + '?after=' + after + '&limit=200', { headers: { accept: 'application/json' } })
          .then(readJson)
          .then((body) => {
            setError(undefined)
            setStatus(body.status ?? { state: 'offline' })
            const logs = body.logs ?? { entries: [], nextSeq: after }
            if (typeof logs.nextSeq === 'number' && logs.nextSeq > cursor.current) cursor.current = logs.nextSeq
            if (logs.entries.length === 0) return
            setEntries((current) => {
              const merged = current.concat(logs.entries)
              const bounded = merged.length > 400 ? merged.slice(merged.length - 400) : merged
              return bounded
            })
          })
          .catch((failure) => setError(String(failure?.message ?? failure)))
      }, [])

      React.useEffect(() => {
        let alive = true
        let timer
        const tick = () => {
          if (!alive) return
          if (!pausedRef.current) void poll()
          timer = window.setTimeout(tick, POLL_MS)
        }
        void poll()
        timer = window.setTimeout(tick, POLL_MS)
        return () => {
          alive = false
          window.clearTimeout(timer)
        }
      }, [poll])

      React.useEffect(() => {
        if (!autoScroll || paused) return
        const body = bodyRef.current
        if (body === null) return
        body.scrollTop = body.scrollHeight
      }, [entries, autoScroll, paused])

      const clear = React.useCallback(() => {
        void fetch(CLEAR_ROUTE, { method: 'POST', headers: { accept: 'application/json' } })
          .then(() => {
            cursor.current = 0
            setEntries([])
          })
          .catch(() => undefined)
      }, [])

      const online = status.state === 'online'
      const stateLabel = status.state === 'online'
        ? t('stateOnline')
        : (status.state === 'connecting' ? t('stateConnecting') : t('stateOffline'))
      const uptime = online && typeof status.onlineSince === 'number' && status.onlineSince > 0
        ? duration(Date.now() - status.onlineSince)
        : ''

      return React.createElement('div', { style: styles.page },
        React.createElement('div', { style: styles.content },
          React.createElement('div', { className: 'obm-heading', style: styles.heading },
            React.createElement('div', null,
              React.createElement('h2', { style: styles.headingTitle }, t('logsTitle')),
              React.createElement('p', { style: styles.headingSubtitle }, t('logsSubtitle')),
            ),
            React.createElement('div', { style: styles.actions },
              React.createElement('button', { type: 'button', style: styles.ghostBtn, onClick: () => setPaused((value) => !value) },
                paused ? t('resume') : t('pause')),
              React.createElement('button', { type: 'button', style: styles.ghostBtn, onClick: clear }, t('clear')),
              React.createElement('label', { style: { ...styles.hint, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' } },
                React.createElement('input', {
                  type: 'checkbox',
                  style: styles.checkbox,
                  checked: autoScroll,
                  onChange: (event) => setAutoScroll(event.target.checked),
                }),
                t('autoScroll'),
              ),
            ),
          ),
          React.createElement('div', { style: styles.statusBar },
            React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
              React.createElement('span', {
                style: {
                  ...styles.dot,
                  background: online
                    ? 'var(--dsw-alias-state-success-primary)'
                    : (status.state === 'connecting' ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-state-idle-primary)'),
                },
              }),
              React.createElement('strong', { style: online ? styles.ok : (status.state === 'connecting' ? styles.warn : styles.danger) }, stateLabel),
            ),
            React.createElement('span', null, t('labelMode') + '：' + String(status.mode ?? '')),
            status.address !== undefined && status.address !== '' ? React.createElement('span', null, t('labelAddress') + '：' + String(status.address)) : null,
            status.selfId !== undefined && status.selfId !== '' ? React.createElement('span', null, t('labelSelfId') + '：' + String(status.selfId)) : null,
            typeof status.pendingActions === 'number' && status.pendingActions > 0
              ? React.createElement('span', null, t('labelPending') + '：' + String(status.pendingActions))
              : null,
            uptime !== '' ? React.createElement('span', null, t('labelUptime') + '：' + uptime) : null,
            React.createElement('span', null, format(t('entries'), { count: entries.length })),
            paused ? React.createElement('span', { style: styles.warn }, t('paused')) : null,
          ),
          error !== undefined
            ? React.createElement('div', { style: { ...styles.group, ...styles.danger } }, format(t('error'), { message: error }))
            : null,
          React.createElement('div', { style: styles.logTable },
            React.createElement('div', { className: 'obm-log-head', style: styles.logHead },
              React.createElement('span', null, 'Time'),
              React.createElement('span', null, 'Kind'),
              React.createElement('span', null, 'Detail'),
            ),
            React.createElement('div', { className: 'obm-log-body', style: styles.logBody, ref: bodyRef },
              entries.length === 0
                ? React.createElement('div', { style: styles.empty }, t('empty'))
                : entries.map((entry) => React.createElement('div', { key: entry.seq, className: 'obm-log-row', style: styles.logRow },
                  React.createElement('span', { style: styles.logTime }, clockTime(entry.ts)),
                  React.createElement('span', {
                    style: {
                      ...styles.logKind,
                      color: entry.kind === 'error'
                        ? 'var(--dsw-alias-state-error-primary)'
                        : (entry.kind === 'disconnect'
                          ? 'var(--dsw-alias-state-warn-primary)'
                          : (entry.kind === 'connect' ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-secondary)')),
                    },
                  }, t(kindLabelKey(entry.kind))),
                  React.createElement('span', { style: styles.logText }, summarizeEntry(entry)),
                )),
            ),
          ),
        ),
      )
    }

    /**
     * 面板外壳：左侧为标签页栏，右侧为所选页面。
     *
     * 实时连接状态控制日志标签页旁的圆点，
     * 即使打开的是设置标签页，扫一眼标签页栏也能知道网关是否在线。
     * 两个页面首次访问后均保持挂载，使日志游标和设置草稿
     * 在切换标签页时得以保留。
     * @param props - 标准插槽属性，以及本插件的多语言接口。
     */
    function PanelPage(props) {
      const { t } = props
      const [tab, setTab] = React.useState('logs')
      const [visited, setVisited] = React.useState({ logs: true, tools: false, contacts: false, access: false, qzone: false, profile: false, prompts: false, cache: false, settings: false })
      const [connectionState, setConnectionState] = React.useState('offline')
      const [liveSelfId, setLiveSelfId] = React.useState('')

      // 共用一次轮询来更新标签页栏的状态圆点；日志页维护自己的游标。
      React.useEffect(() => {
        let alive = true
        let timer
        const tick = () => {
          if (!alive) return
          void fetch(STATE_ROUTE, { headers: { accept: 'application/json' } })
            .then((response) => (response.ok ? response.json() : undefined))
            .then((body) => {
              if (!alive || body === undefined) return
              const next = body.status?.state ?? 'offline'
              setConnectionState((current) => (current === next ? current : next))
              const id = String(body.status?.selfId ?? '')
              setLiveSelfId((current) => (current === id ? current : id))
            })
            .catch(() => undefined)
          timer = window.setTimeout(tick, POLL_MS)
        }
        void tick()
        return () => {
          alive = false
          window.clearTimeout(timer)
        }
      }, [])

      const select = (next) => {
        setTab(next)
        setVisited((current) => (current[next] === true ? current : { ...current, [next]: true }))
      }

      const stateColor = connectionState === 'online'
        ? 'var(--dsw-alias-state-success-primary)'
        : (connectionState === 'connecting' ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-state-idle-primary)')

      const tabs = [
        { id: 'logs', label: t('tabLogs'), dot: stateColor },
        { id: 'tools', label: t('tabTools'), dot: undefined },
        { id: 'contacts', label: t('tabContacts'), dot: undefined },
        { id: 'access', label: t('tabAccess'), dot: undefined },
        { id: 'qzone', label: t('tabQzone'), dot: undefined },
        { id: 'profile', label: t('tabProfile'), dot: undefined },
        { id: 'prompts', label: t('tabPrompts'), dot: undefined },
        { id: 'cache', label: t('tabCache'), dot: undefined },
        { id: 'settings', label: t('tabSettings'), dot: undefined },
      ]

      return React.createElement('div', { className: 'obm-shell', style: styles.shell },
        React.createElement('nav', { className: 'obm-rail', style: styles.rail, 'aria-label': t('panel') },
          React.createElement('h2', { className: 'obm-rail-title', style: styles.railTitle }, t('panel')),
          tabs.map((item) => React.createElement('button', {
            key: item.id,
            type: 'button',
            role: 'tab',
            'aria-selected': tab === item.id,
            className: 'obm-tab',
            style: styles.tab,
            onClick: () => select(item.id),
          },
            item.dot !== undefined
              ? React.createElement('span', { style: { ...styles.tabDot, background: item.dot } })
              : null,
            React.createElement('span', null, item.label),
          )),
        ),
        React.createElement('div', { className: 'obm-pane', style: styles.pane, role: 'tabpanel' },
          visited.contacts ? React.createElement('div', { style: tab === 'contacts' ? undefined : styles.hidden }, React.createElement(ContactsPage, { t })) : null,
          visited.access ? React.createElement('div', { style: tab === 'access' ? undefined : styles.hidden }, React.createElement(AccessPage, { t })) : null,
          visited.qzone ? React.createElement('div', { style: tab === 'qzone' ? undefined : styles.hidden }, React.createElement(QzonePage, { t })) : null,
          visited.profile ? React.createElement('div', { style: tab === 'profile' ? undefined : styles.hidden }, React.createElement(ProfilePage, { t })) : null,
          visited.prompts ? React.createElement('div', { style: tab === 'prompts' ? undefined : styles.hidden }, React.createElement(PromptsPage, { t })) : null,
          visited.cache ? React.createElement('div', { style: tab === 'cache' ? undefined : styles.hidden }, React.createElement(CachePage, { t })) : null,
          visited.tools ? React.createElement('div', { style: tab === 'tools' ? undefined : styles.hidden }, React.createElement(ToolsPage, { t })) : null,
          visited.settings ? React.createElement('div', { style: tab === 'settings' ? undefined : styles.hidden }, React.createElement(ConfigPage, { t, liveSelfId })) : null,
          visited.logs ? React.createElement('div', { style: tab === 'logs' ? undefined : styles.hidden }, React.createElement(LogsPage, { t })) : null,
        ),
      )
    }

    /** 必需的客户端服务：插槽注册和多语言接口。 */
    const inject = ['slots', 'locale']

    /**
     * 注册两处界面。
     * @param ctx - 浏览器插件上下文。
     * @returns 清理函数。
     */
    /**
     * 响应式样式表。
     *
     * 行内样式无法表达媒体查询，而插件布局需适应手机尺寸的视口：
     * 标签页栏变为页面上方的横条，
     * 所有双列输入行改为纵向堆叠。规则仅修改布局，
     * 颜色与字体仍以 `styles` 中的主题令牌为准。
     * @returns CSS 文本。
     */
    function stylesheet() {
      return [
        '.obm-shell{height:100%;min-height:0;}',
        '.obm-pane{overscroll-behavior:contain;}',
        '.obm-tab{min-height:36px;background:transparent;color:var(--dsw-alias-label-secondary);}',
        // 宿主主题与浏览器默认样式都可能给 button 画边框，这里一并压掉：
        // 标签页只靠底色标亮，任何状态下都不出现边框或轮廓。
        '.obm-tab,.obm-tab:hover,.obm-tab:active,.obm-tab:focus{border:none;outline:none;box-shadow:none;}',
        // 悬停与选中都只用底色标亮。
        '.obm-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
        '.obm-tab[aria-selected=true]{background:var(--dsw-specific-sidebar-nav-item-active,var(--dsw-alias-bg-layer-1));',
        'color:var(--dsw-alias-label-primary);font-weight:600;}',
        // 点击也会让按钮获得焦点；这里连焦点框一起关掉，避免出现黑框。
        '.obm-tab:focus,.obm-tab:focus-visible{outline:none;box-shadow:none;}',
        '.obm-tab:focus-visible{background:var(--dsw-alias-interactive-bg-hover);}',
        // 折叠按钮没有底色可标亮，键盘聚焦时保留一圈可见的焦点环。
        '.obm-disclosure:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px;}',
        '@media (max-width:720px){',
        // 纵向堆叠外壳：页面上方放置可横向滚动的标签页栏。
        '.obm-shell{grid-template-columns:minmax(0,1fr)!important;grid-template-rows:auto minmax(0,1fr);}',
        // 保持单行滚动：换成两行会在手机上挤压页面，
        // 而横向栏也是常见的移动端标签页形式。
        '.obm-rail{flex-direction:row!important;flex-wrap:nowrap!important;overflow-x:auto!important;',
        'min-width:0!important;border-right:none!important;scrollbar-width:none;',
        'border-bottom:1px solid var(--dsw-alias-border-l1);padding:8px!important;gap:4px!important;}',
        '.obm-rail::-webkit-scrollbar{display:none;}',
        '.obm-rail-title{display:none;}',
        '.obm-tab{width:auto!important;flex:0 0 auto;padding:9px 12px!important;min-height:40px;}',
        // 将每组标签与控件上下堆叠，让控件占满宽度。
        '.obm-row{grid-template-columns:minmax(0,1fr)!important;gap:4px!important;align-items:start!important;}',
        '.obm-access-row{grid-template-columns:minmax(0,1fr)!important;gap:6px!important;}',
        '.obm-heading{flex-direction:column;align-items:flex-start!important;}',
        '.obm-contact-row{flex-direction:column;align-items:flex-start!important;gap:2px!important;}',
        '.obm-detail-grid{grid-template-columns:minmax(0,1fr)!important;}',
        '.obm-member-list,.obm-detail-grid{margin-left:10px!important;}',
        // 日志表格省略时间列标题，避免溢出。
        '.obm-log-head{grid-template-columns:70px 64px minmax(0,1fr)!important;}',
        '.obm-log-row{grid-template-columns:70px 64px minmax(0,1fr)!important;}',
        '}',
        '@media (max-width:480px){',
        '.obm-tab{font-size:12px!important;padding:8px 10px!important;}',
        '.obm-log-head{display:none;}',
        '.obm-log-row{grid-template-columns:minmax(0,1fr)!important;gap:0!important;}',
        '.obm-log-row>span:first-child,.obm-log-row>span:nth-child(2){display:inline;margin-right:6px;}',
        '}',
      ].join('')
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'onebot-mini: dictionaries')
      const t = ctx.locale.bind(NS)
      ctx.effect(() => {
        const id = 'onebot-mini-stylesheet'
        if (typeof document === 'undefined' || document.getElementById(id) !== null) return () => {}
        const style = document.createElement('style')
        style.id = id
        style.textContent = stylesheet()
        document.head.appendChild(style)
        return () => { style.remove() }
      }, 'onebot-mini: stylesheet')

      // 一个侧边栏面板承载两处界面：左边为标签页栏，
      // 右边为所选页面。不注册 `plugins.bundle.config`——
      // 配置放在此处，而非“插件”页面中。
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 60,
        locale: NS,
        label: () => t('panel'),
      }, LogsIcon))

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
      }, (props) => React.createElement(PanelPage, { ...props, t })))
    }

    module.exports.apply = apply
    module.exports.inject = inject
    return module.exports
  },
})
