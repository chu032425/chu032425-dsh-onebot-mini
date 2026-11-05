/**
 * Browser half of dsh-onebot-mini.
 *
 * One left-sidebar panel with a tab rail on the left and the selected page on
 * the right, fed by the Host's JSON routes:
 *
 *  - **设置**: connection, access control, session and diagnostic fields;
 *  - **日志**: live WebSocket connect, disconnect, send, receive and bridge
 *    decisions.
 *
 * Configuration deliberately lives here rather than on the Plugins page, so the
 * channel's own panel is the single place to operate it.
 *
 * No Harness Client package is imported as a module: `dsh.client.inject` only
 * orders activation, and a plain-JS plugin has no type check against packages
 * that change without notice. Controls are built here from React and the theme
 * tokens the Host exposes.
 */

window.__ModuleLoader__.load({
  id: 'dsh-onebot-mini',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')

    /** Sidebar entry id; the `main` slot is keyed by the same string. */
    const PANEL_ID = 'onebot-mini-logs'
    /** This plugin's locale namespace. */
    const NS = 'onebotMini'
    /** Host JSON routes (browser-relative). */
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
    /** Log poll cadence while the page is visible. */
    const POLL_MS = 1500
    /** Locale dictionary keys; the Chinese set is the source of truth. */
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
      toolGroupMessage: '发送消息',
      toolGroupMedia: '媒体与文件',
      toolGroupGroup: '群管理',
      toolGroupQuery: '查询与信息',
      toolGroupInteraction: '互动与消息操作',
      toolGroupRequest: '请求处理',
      toolGroupProfile: '账号资料',
      toolGroupQzone: 'QQ 空间',
      toolGroupAlbum: '群相册',
      toolCount: '已启用 {on}/{total}',
      toolTotal: '全部动作：已启用 {on}/{total}',
      toolSearchPlaceholder: '搜索动作名或中文说明…',
      toolNoMatch: '没有匹配的动作。',
      toolActionsHint: '勾选允许模型调用的 OneBot 动作；未勾选的动作即使被调用也会被拒绝。',
      toolNoteAuto: '注意：本节只控制 onebot_call 工具；普通文字回复的自动转发始终生效，不受此处影响。',
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
      promptsPlaceholderHint: '可用占位符：{senderPrefix} 发言人前缀说明 · {media} 媒体发送说明 · {actions} 当前已启用的动作列表。占位符会按当前配置自动展开。',
      promptsReset: '恢复默认',
      promptsSave: '保存提示词',
      promptsSaved: '已保存。',
      promptsUnsaved: '有未保存的修改。',
      promptsEmptyNote: '留空保存会恢复该项默认提示词。',
      promptDefChannel: '频道提示词',
      promptDefChannelHint: '注入到每个 QQ 会话 system prompt 的频道说明。',
      promptDefToolCall: 'onebot_call 工具描述',
      promptDefToolCallHint: '模型决定是否调用 onebot_call 时看到的说明。',
      promptDefToolMedia: 'onebot_send_media 工具描述',
      promptDefToolMediaHint: '模型决定是否调用发媒体工具时看到的说明。',
      promptDefInterject: '插话判断提示词',
      promptDefInterjectHint: '消息到达时若正在回答，用这段提示词让小模型判断该插话(STEER)还是排队(FOLLOWUP)。',
      groupReplyPrivate: '私聊回复行为',
      groupReplyGroup: '群聊回复行为',
      groupReply: '回复行为',
      fieldPrivateDebounceMs: '私聊合并等待（毫秒）',
      fieldPrivateDebounceMaxMs: '私聊合并最长等待（毫秒）',
      fieldPrivateAutoInterject: '私聊回答中允许自动插话',
      fieldGroupDebounceMs: '群聊合并等待（毫秒）',
      fieldGroupDebounceMaxMs: '群聊合并最长等待（毫秒）',
      fieldGroupAutoInterject: '群聊回答中允许自动插话',
      queueTitle: '当前排队',
      queueEmpty: '没有排队的消息。',
      queueGroup: '群聊 {group}',
      queuePrivate: '私聊 {user}',
      queueCount: '{count} 条待发',
      queueWaited: '已等 {ms}',
      queueRefresh: '刷新',
      fieldDebounceMs: '消息合并等待（毫秒）',
      fieldAutoInterject: '回答中允许自动插话',
      fieldDebounceMaxMs: '合并最长等待（毫秒）',
      promptsPlaceholders: '占位符：{list}',
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
      toolGroupMessage: 'Send messages',
      toolGroupMedia: 'Media and files',
      toolGroupGroup: 'Group management',
      toolGroupQuery: 'Queries and info',
      toolGroupInteraction: 'Interaction and messages',
      toolGroupRequest: 'Request handling',
      toolGroupProfile: 'Account profile',
      toolGroupQzone: 'Qzone',
      toolGroupAlbum: 'Group albums',
      toolCount: '{on}/{total} enabled',
      toolTotal: 'All actions: {on}/{total} enabled',
      toolSearchPlaceholder: 'Search by action name or description…',
      toolNoMatch: 'No matching action.',
      toolActionsHint: 'Check the OneBot actions the model may call; an unchecked action is refused even if the model tries it.',
      toolNoteAuto: 'Note: this section only controls the onebot_call tool. Automatic forwarding of plain text replies stays on and is not affected.',
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
      promptsPlaceholderHint: 'Placeholders: {senderPrefix} the speaker-prefix line · {media} the media paragraph · {actions} the enabled action list. Each expands from the current settings.',
      promptsReset: 'Restore default',
      promptsSave: 'Save prompt',
      promptsSaved: 'Saved.',
      promptsUnsaved: 'You have unsaved changes.',
      promptsEmptyNote: 'Saving an empty prompt restores that default.',
      promptDefChannel: 'Channel prompt',
      promptDefChannelHint: 'The channel section injected into every QQ chat agent.',
      promptDefToolCall: 'onebot_call tool description',
      promptDefToolCallHint: 'What the model reads when deciding whether to call onebot_call.',
      promptDefToolMedia: 'onebot_send_media tool description',
      promptDefToolMediaHint: 'What the model reads when deciding whether to send media.',
      promptDefInterject: 'Interject judge prompt',
      promptDefInterjectHint: 'When a message arrives mid-answer, this prompt asks a small model whether to STEER or queue a FOLLOWUP.',
      groupReplyPrivate: 'Private reply behaviour',
      groupReplyGroup: 'Group reply behaviour',
      groupReply: 'Reply behaviour',
      fieldPrivateDebounceMs: 'Private merge window (ms)',
      fieldPrivateDebounceMaxMs: 'Private merge hard cap (ms)',
      fieldPrivateAutoInterject: 'Steer a running private reply',
      fieldGroupDebounceMs: 'Group merge window (ms)',
      fieldGroupDebounceMaxMs: 'Group merge hard cap (ms)',
      fieldGroupAutoInterject: 'Steer a running group reply',
      queueTitle: 'Pending queue',
      queueEmpty: 'No messages waiting.',
      queueGroup: 'Group {group}',
      queuePrivate: 'Private {user}',
      queueCount: '{count} pending',
      queueWaited: 'waited {ms}',
      queueRefresh: 'Refresh',
      fieldDebounceMs: 'Message merge window (ms)',
      fieldAutoInterject: 'Allow steering a running answer',
      fieldDebounceMaxMs: 'Merge window hard cap (ms)',
      promptsPlaceholders: 'Placeholders: {list}',
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

    /** Field label key for one config field. */
    function fieldLabelKey(field) {
      return 'field' + field.charAt(0).toUpperCase() + field.slice(1)
    }

    /** Group label key for one config group. */
    function groupLabelKey(group) {
      return 'group' + group.charAt(0).toUpperCase() + group.slice(1)
    }

    /** Label key for one OneBot tool action group. */
    function toolGroupLabelKey(group) {
      return 'toolGroup' + group.charAt(0).toUpperCase() + group.slice(1)
    }

    /** The tool groups from a state snapshot, tolerating array or `{ groups }`. */
    function toolGroupsOf(snapshot) {
      const raw = snapshot === null || snapshot === undefined ? undefined : snapshot.toolCatalog
      if (Array.isArray(raw)) return raw
      if (raw !== null && typeof raw === 'object' && Array.isArray(raw.groups)) return raw.groups
      return []
    }

    /** Kind label key for one log kind. */
    function kindLabelKey(kind) {
      return 'kind' + kind.charAt(0).toUpperCase() + kind.slice(1)
    }

    /** Substitute `{name}` placeholders. */
    function format(template, vars) {
      return String(template).replace(/\{(\w+)\}/g, (whole, name) => (
        vars !== null && vars !== undefined && Object.prototype.hasOwnProperty.call(vars, name)
          ? String(vars[name])
          : whole
      ))
    }

    /** Format one timestamp as a local clock time. */
    function clockTime(ts) {
      try {
        return new Date(ts).toLocaleTimeString(undefined, { hour12: false })
      } catch {
        return String(ts)
      }
    }

    /** Format a millisecond duration compactly. */
    function duration(ms) {
      const value = Math.max(0, Number(ms) || 0)
      if (value < 1000) return value + 'ms'
      if (value < 60000) return (value / 1000).toFixed(1) + 's'
      const minutes = Math.floor(value / 60000)
      const seconds = Math.floor((value % 60000) / 1000)
      return minutes + 'm' + String(seconds).padStart(2, '0') + 's'
    }

    /**
     * One-line rendering of a log entry's fields, for the log table.
     * @param entry - one log entry from the Host.
     * @returns a compact summary string.
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

    /** Shared inline styles; colors come from Host theme tokens only. */
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
      toolGroupHeader: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' },
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
      toolListRow: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '6px 2px',
        cursor: 'pointer',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
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
      // Two-column shell: a tab rail on the left, the page on the right.
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
      tab: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '7px 10px',
        borderRadius: 8,
        border: '1px solid transparent',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 13,
        fontFamily: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
      },
      tabActive: {
        background: 'var(--dsw-alias-bg-layer-1)',
        borderColor: 'var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-primary)',
        fontWeight: 600,
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

    /** Sidebar glyph for the log page. */
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
     * A text input bound to one draft field.
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
     * A multiline list input (one entry per line).
     * @param props - `label`, `hint`, `value` (array), `onChange`.
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
     * A boolean row with a real checkbox.
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
            // `disabled` would make the browser grey out a checked box, so a
            // forced-on setting would look unchecked. Locking keeps the normal
            // rendering and simply refuses the interaction instead.
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
     * A number row.
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

    /** Eye / eye-off glyph for the secret reveal toggle. */
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
     * A secret input with an eye toggle: hidden by default, revealable on demand.
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
     * A value the plugin maintains itself: shown, selectable, not editable.
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
     * A workspace picker: existing workspaces only, marked required.
     *
     * A path already in the config but missing from the catalog stays listed so a
     * deleted workspace is visible rather than silently replaced.
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

    /** Known preset ids mapped to dictionary keys. */
    const PRESET_NAME_KEYS = {
      standard: 'presetNameStandard',
      ptc: 'presetNamePtc',
      minimal: 'presetNameMinimal',
      cordis: 'presetNameCordis',
    }

    /** Known permission preset values mapped to dictionary keys. */
    const PERMISSION_NAME_KEYS = {
      'read-only': 'permReadOnly',
      'workspace-write': 'permWorkspaceWrite',
      'danger-full-access': 'permDangerFullAccess',
      auto: 'permAuto',
    }

    /**
     * A localized name for one known value, falling back to the Host-provided
     * name and then the raw value.
     * @param map - value → dictionary key.
     * @param value - the raw value.
     * @param fallback - the Host-provided name.
     * @param t - the locale binder.
     * @returns the display name.
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
     * The agent-preset picker.
     *
     * An empty value means "the deployment default". A configured preset that no
     * longer exists stays listed so the deletion is visible; the Host falls back
     * to the default at session creation.
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
     * The model picker: one flat list of every provider/model pair.
     *
     * The value is `provider::model`; an empty value uses the deployment
     * default. A configured pair that is no longer advertised stays listed so
     * the disappearance is visible instead of silent.
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
     * The permission-preset picker (sandbox + approval bundle), required.
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
     * The onebot_call action list: a master switch plus one row per action, each
     * with its Chinese description. State is stored as the set of *disabled*
     * actions so a newly catalogued action is on by default for existing installs.
     * @param props - `enabled`, `disabled`, `groups`, `onToggleEnabled`,
     *   `onChangeDisabled`, `t`.
     */
    function ToolCatalogSection({ enabled, disabled, groups, onToggleEnabled, onChangeDisabled, t }) {
      const [filter, setFilter] = React.useState('')
      const disabledSet = new Set(Array.isArray(disabled) ? disabled : [])
      const commit = (next) => onChangeDisabled([...next])
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
      children.push(React.createElement('div', { key: 'actionsHint', style: { ...styles.hint, padding: '0 0 10px' } }, t('toolActionsHint')))

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
        const header = React.createElement('div', { key: group.id + '-h', style: styles.toolGroupHeader },
          React.createElement('label', { style: styles.toolGroupLabel },
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
        const rows = matched.map((action) => React.createElement('label', { key: group.id + '-' + action.name, style: styles.toolListRow },
          React.createElement('input', {
            type: 'checkbox',
            style: { ...styles.checkbox, marginTop: 2 },
            checked: !disabledSet.has(action.name),
            onChange: (event) => toggleAction(action.name, event.target.checked),
          }),
          React.createElement('div', { style: styles.toolListText },
            React.createElement('span', { style: styles.toolListName }, action.zh),
            React.createElement('code', { style: styles.toolActionCode }, action.name),
          ),
        ))
        children.push(React.createElement('div', { key: group.id, style: styles.toolGroup },
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
     * Render one config field by its declared kind.
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
     * The config page. Loads the snapshot, keeps a draft, and posts a patch.
     * @param props - `t`, plus the slot's `view` when rendered as a summary.
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
          .then((response) => {
            if (!response.ok) throw new Error('HTTP ' + response.status)
            return response.json()
          })
          .then((body) => {
            if (!alive) return
            // Show the account the live connection already reports, even before
            // the Host has persisted it: an operator wants to see the real QQ
            // number here, not an empty box they must fill by hand.
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
          .then((response) => response.json().then((body) => ({ ok: response.ok, body })))
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

      if (error !== undefined) {
        return React.createElement('div', { style: styles.content },
          React.createElement('div', { style: { ...styles.group, ...styles.danger } }, format(t('error'), { message: error }),
            React.createElement('div', { style: styles.actions },
              React.createElement('button', { type: 'button', style: styles.ghostBtn, onClick: load }, t('reload')),
            ),
          ),
        )
      }

      if (snapshot === undefined || draft === undefined) {
        return React.createElement('div', { style: styles.content },
          React.createElement('div', { style: styles.hint }, t('loading')),
        )
      }

      const set = (field, value) => setDraft((current) => ({ ...(current ?? {}), [field]: value }))
      const secretFields = snapshot.secretFields ?? []
      const kinds = snapshot.kinds ?? {}
      const groups = snapshot.groups ?? []
      // A mode-scoped field (listen address/port, or gateway URL) is only shown
      // for the mode it belongs to, so the form never offers a box the running
      // mode would ignore.
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
            if (field === 'botQQ') hint = liveSelfId !== '' ? format(t('botQQHint'), { id: liveSelfId }) : t('botQQHintEmpty')
            const groupSteer = draft.groupAutoInterject !== false
            const senderLocked = field === 'senderPrefix' && groupSteer
            return React.createElement(FieldRow, {
              key: field,
              field,
              kind: secretFields.includes(field) ? 'secret' : (kinds[field] ?? 'string'),
              label,
              hint: senderLocked ? t('hintSenderPrefixLocked') : (field === 'senderPrefix' ? t('hintSenderPrefixFree') : hint),
              // Steering requires the speaker prefix, so the toggle is locked on
              // while group steering is enabled.
              locked: senderLocked,
              lockedHint: senderLocked ? t('hintSenderPrefixLocked') : '',
              value: senderLocked ? true : draft[field],
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

      // The pending queues are runtime state read live from the state route; the
      // reply-behaviour group edits the settings, this panel shows what is
      // actually queued right now.
      const pendingQueues = Array.isArray(snapshot.queues) ? snapshot.queues : []
      const queuesUi = pendingQueues.length === 0
        ? React.createElement('div', { style: { ...styles.group, ...styles.actions } },
          React.createElement('button', { type: 'button', style: styles.ghostBtn, onClick: load }, t('queueRefresh')))
        : React.createElement('section', { style: styles.group },
          React.createElement('div', { style: styles.cacheHead },
            React.createElement('h3', { style: styles.groupTitle }, t('queueTitle')),
            React.createElement('button', { type: 'button', style: styles.ghostBtn, onClick: load, disabled: busy }, t('queueRefresh')),
          ),
          pendingQueues.map((q) => React.createElement('div', { key: q.chatId, style: styles.cacheRow },
            React.createElement('span', { style: styles.contactName },
              q.items[0]?.speaker && q.kind === 'group'
                ? format(t('queueGroup'), { group: q.chatId.replace(/^group:/, '') })
                : format(t('queuePrivate'), { user: q.chatId.replace(/^private:/, '') })),
            React.createElement('span', { style: styles.hint },
              format(t('queueCount'), { count: q.pending }) + '  ·  ' + format(t('queueWaited'), { ms: Math.round(q.oldestMs / 1000) + 's' })),
          )),
        )

      return React.createElement('div', { style: styles.page },
        React.createElement('div', { style: styles.content },
          React.createElement('div', { className: 'obm-heading', style: styles.heading },
            React.createElement('div', null,
              React.createElement('h2', { style: styles.headingTitle }, t('title')),
              React.createElement('p', { style: styles.headingSubtitle }, t('subtitle')),
            ),
            React.createElement('button', { type: 'button', style: styles.ghostBtn, onClick: load, disabled: busy }, t('reload')),
          ),
          queuesUi,
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
     * The tools page: the onebot_call action list, saved on its own.
     *
     * Loads the same state snapshot the settings page uses, keeps a draft of the
     * two tool fields, and posts only those two on save, so editing tools never
     * touches the connection settings.
     * @param props - `t`.
     */
    function ToolsPage(props) {
      const { t } = props
      const [snapshot, setSnapshot] = React.useState(undefined)
      const [enabled, setEnabled] = React.useState(true)
      const [disabled, setDisabled] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(undefined)
      const [problems, setProblems] = React.useState([])
      const [savedAt, setSavedAt] = React.useState(0)

      const load = React.useCallback(() => {
        let alive = true
        void fetch(STATE_ROUTE, { headers: { accept: 'application/json' } })
          .then((response) => {
            if (!response.ok) throw new Error('HTTP ' + response.status)
            return response.json()
          })
          .then((body) => {
            if (!alive) return
            setSnapshot(body)
            setEnabled(body.config?.onebotToolEnabled !== false)
            setDisabled(Array.isArray(body.config?.onebotToolDisabled) ? body.config.onebotToolDisabled : [])
            setError(undefined)
          })
          .catch((failure) => { if (alive) setError(String(failure?.message ?? failure)) })
        return () => { alive = false }
      }, [])

      React.useEffect(load, [load])

      const dirty = React.useMemo(() => {
        if (snapshot === undefined || disabled === undefined) return false
        const beforeEnabled = snapshot.config?.onebotToolEnabled !== false
        const beforeDisabled = Array.isArray(snapshot.config?.onebotToolDisabled) ? snapshot.config.onebotToolDisabled : []
        return enabled !== beforeEnabled || JSON.stringify(disabled) !== JSON.stringify(beforeDisabled)
      }, [snapshot, enabled, disabled])

      const save = React.useCallback(() => {
        if (disabled === undefined || busy) return
        setBusy(true)
        setProblems([])
        setError(undefined)
        void fetch(CONFIG_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ patch: { onebotToolEnabled: enabled, onebotToolDisabled: disabled } }),
        })
          .then((response) => response.json().then((body) => ({ ok: response.ok, body })))
          .then(({ ok, body }) => {
            if (!ok || body.ok !== true) {
              setProblems(Array.isArray(body.problems) ? body.problems : [body.error ?? 'save failed'])
              return
            }
            setSnapshot(body)
            setEnabled(body.config?.onebotToolEnabled !== false)
            setDisabled(Array.isArray(body.config?.onebotToolDisabled) ? body.config.onebotToolDisabled : [])
            setSavedAt(Date.now())
          })
          .catch((failure) => setError(String(failure?.message ?? failure)))
          .finally(() => setBusy(false))
      }, [enabled, disabled, busy])

      React.useEffect(() => {
        if (savedAt === 0) return undefined
        const timer = window.setTimeout(() => setSavedAt(0), 2400)
        return () => window.clearTimeout(timer)
      }, [savedAt])

      if (error !== undefined) {
        return React.createElement('div', { style: styles.content },
          React.createElement('div', { style: { ...styles.group, ...styles.danger } }, format(t('error'), { message: error }),
            React.createElement('div', { style: styles.actions },
              React.createElement('button', { type: 'button', style: styles.ghostBtn, onClick: load }, t('reload')),
            ),
          ),
        )
      }

      if (snapshot === undefined || disabled === undefined) {
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
            groups: toolGroupsOf(snapshot),
            onToggleEnabled: setEnabled,
            onChangeDisabled: setDisabled,
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
     * One group row that expands into its member list on demand.
     *
     * Members are fetched per group and cached for the lifetime of the page, so
     * expanding a group twice costs one round-trip. A gateway that refuses
     * `get_group_member_list` shows the reason inside the expanded area instead
     * of hiding the group.
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
          .then((response) => {
            if (!response.ok) throw new Error('HTTP ' + response.status)
            return response.json()
          })
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
     * One friend row that expands into the account's profile details.
     *
     * Presence is not part of OneBot 11, so the status line says "unknown" when
     * the gateway does not report it rather than claiming the friend is offline.
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
          .then((response) => {
            if (!response.ok) throw new Error('HTTP ' + response.status)
            return response.json()
          })
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
          // The row's primary name is the remark when one exists, so the trailing
          // hint shows the nickname — labelling it "remark" would be backwards.
          React.createElement('span', { style: styles.hint },
            friend.remark !== '' && friend.nickname !== '' && friend.remark !== friend.nickname
              ? t('contactsNickname') + ': ' + friend.nickname
              : ''),
        ),
        body,
      )
    }

    /**
     * The contacts page: the bot account's friends and groups, as lists.
     *
     * A friend row expands to its profile, a group row to its members. Loads
     * once on mount and on demand, because these change rarely and each refresh
     * costs two gateway round-trips.
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
          .then((response) => {
            if (!response.ok) throw new Error('HTTP ' + response.status)
            return response.json()
          })
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

      if (error !== undefined) {
        return React.createElement('div', { style: styles.content }, heading,
          React.createElement('div', { style: { ...styles.group, ...styles.danger } }, format(t('error'), { message: error }),
            React.createElement('div', { style: styles.actions },
              React.createElement('button', { type: 'button', style: styles.ghostBtn, onClick: load }, t('reload')),
            ),
          ),
        )
      }

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
     * One access list: a picker fed by the bot's friends or groups, plus the
     * current entries as removable chips.
     *
     * The picker offers only accounts the gateway actually reports, so an
     * operator never has to remember a QQ number. A manual text box stays
     * available because the gateway may be offline while the settings are being
     * prepared, and an id typed by hand is still valid.
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
     * The access-control page: private and group whitelists and blacklists.
     *
     * The pickers reuse the contacts route, so the choices are the account's
     * real friends and groups. Saving patches only the four access fields.
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
          .then((response) => {
            if (!response.ok) throw new Error('HTTP ' + response.status)
            return response.json()
          })
          .then((body) => {
            if (!alive) return
            setSnapshot(body)
            setDraft({
              allowFrom: Array.isArray(body.config?.allowFrom) ? body.config.allowFrom : [],
              denyFrom: Array.isArray(body.config?.denyFrom) ? body.config.denyFrom : [],
              allowGroups: Array.isArray(body.config?.allowGroups) ? body.config.allowGroups : [],
              denyGroups: Array.isArray(body.config?.denyGroups) ? body.config.denyGroups : [],
            })
            setError(undefined)
            // The pickers are a convenience: a failure leaves the manual inputs.
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
        return ['allowFrom', 'denyFrom', 'allowGroups', 'denyGroups'].some((key) => {
          const before = Array.isArray(snapshot.config?.[key]) ? snapshot.config[key] : []
          return JSON.stringify(before) !== JSON.stringify(draft[key] ?? [])
        })
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
          .then((response) => response.json().then((body) => ({ ok: response.ok, body })))
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

      if (error !== undefined) {
        return React.createElement('div', { style: styles.content },
          React.createElement('div', { style: { ...styles.group, ...styles.danger } }, format(t('error'), { message: error }),
            React.createElement('div', { style: styles.actions },
              React.createElement('button', { type: 'button', style: styles.ghostBtn, onClick: load }, t('reload')),
            ),
          ),
        )
      }

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
     * One Qzone post row.
     *
     * Shared by "my posts" and the friend feed: both normalize to the same
     * fields, so one renderer keeps the two lists consistent.
     * @param props - `post`, `showAuthor`, `t`.
     */
    /**
     * One thumbnail with a text fallback.
     *
     * The proxy can still fail (a blocked host, a vanished CDN object, an image
     * beyond even the stream-through ceiling). A broken-image icon tells the
     * operator nothing, so a failed load is replaced by a short label.
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
      // The proxy route needs the account for the cache folder; a feed post
      // carries its author id, own posts are the selected account's.
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
     * The explanation for a section that could not be read.
     *
     * A QQ-side permission code gets its own wording, because "the gateway does
     * not support this query" would be wrong and would send the operator looking
     * for a bug in the plugin instead of at the space's privacy setting.
     * @param section - the section result.
     * @param t - the locale binder.
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
     * One Qzone list section: title, count, rows, or a per-section error.
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
     * The Qzone page: profile, own posts and the friend feed.
     *
     * Read-only on purpose. Posting, commenting and liking are available to the
     * model through `onebot_call`; a human clicking around in this panel should
     * not accidentally publish anything to their Qzone.
     * @param props - `t`.
     */
    function QzonePage(props) {
      const { t } = props
      const [data, setData] = React.useState(undefined)
      const [friends, setFriends] = React.useState([])
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(undefined)
      // Empty means "my own space"; any other value reads that account's space.
      const [target, setTarget] = React.useState('')
      const [manual, setManual] = React.useState('')

      const load = React.useCallback(() => {
        let alive = true
        setBusy(true)
        const query = target.trim() === '' ? '' : '?target_uin=' + encodeURIComponent(target.trim())
        void fetch(QZONE_ROUTE + query, { headers: { accept: 'application/json' } })
          .then((response) => {
            if (!response.ok) throw new Error('HTTP ' + response.status)
            return response.json()
          })
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

      // The friend list feeds the picker; a failure leaves the manual box usable.
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

      // Two ways to pick a space: a dropdown of real friends, and a box for a QQ
      // number that is not a friend. The dropdown writes straight into `target`;
      // the box needs its button so a half-typed number is not fetched.
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

      if (error !== undefined) {
        return React.createElement('div', { style: styles.content }, heading, targetBar,
          React.createElement('div', { style: { ...styles.group, ...styles.danger } }, format(t('error'), { message: error }),
            React.createElement('div', { style: styles.actions },
              React.createElement('button', { type: 'button', style: styles.ghostBtn, onClick: load }, t('reload')),
            ),
          ),
        )
      }

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
     * The profile page: one account's details, the bot's own by default.
     *
     * The friend picker reuses the contacts route, so the choices are the
     * account's real friends instead of hand-typed numbers. Reading someone
     * else's profile is read-only; nothing here mutates the account.
     * @param props - `t`.
     */
    function ProfilePage(props) {
      const { t } = props
      const [data, setData] = React.useState(undefined)
      const [friends, setFriends] = React.useState([])
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(undefined)
      // Empty means "the bot itself".
      const [target, setTarget] = React.useState('')

      const load = React.useCallback(() => {
        let alive = true
        setBusy(true)
        const query = target === '' ? '' : '?user_id=' + encodeURIComponent(target)
        void fetch(PROFILE_ROUTE + query, { headers: { accept: 'application/json' } })
          .then((response) => {
            if (!response.ok) throw new Error('HTTP ' + response.status)
            return response.json()
          })
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

      // The friend list is a convenience for the picker; a failure leaves the
      // page usable for the bot's own profile.
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

      if (error !== undefined) {
        return React.createElement('div', { style: styles.content }, heading, picker,
          React.createElement('div', { style: { ...styles.group, ...styles.danger } }, format(t('error'), { message: error }),
            React.createElement('div', { style: styles.actions },
              React.createElement('button', { type: 'button', style: styles.ghostBtn, onClick: load }, t('reload')),
            ),
          ),
        )
      }

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

    /** Human-readable byte size. */
    function formatBytes(bytes) {
      const n = Math.max(0, Number(bytes) || 0)
      if (n < 1024) return n + ' B'
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
      if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
      return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
    }

    /**
     * A button that asks for a second click before it acts.
     *
     * Clearing storage cannot be undone, so a single stray click must not do it.
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
     * The prompt page: the channel section injected into every QQ agent.
     *
     * The template is editable and persisted, with a one-click restore. The
     * dynamic placeholders are documented on the page so an operator can keep
     * the parts that must stay live and rewrite the prose around them.
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
          .then((response) => {
            if (!response.ok) throw new Error('HTTP ' + response.status)
            return response.json()
          })
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
          .then((response) => response.json().then((body) => ({ ok: response.ok, body })))
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

      if (error !== undefined) {
        return React.createElement('div', { style: styles.content }, heading,
          React.createElement('div', { style: { ...styles.group, ...styles.danger } }, format(t('error'), { message: error })),
        )
      }
      if (snapshot === undefined || drafts === undefined) {
        return React.createElement('div', { style: styles.content }, heading,
          React.createElement('div', { style: styles.hint }, t('loading')),
        )
      }

      const setField = (field, value) => setDrafts((current) => ({ ...(current ?? {}), [field]: value }))

      const sections = defs.map((def) => React.createElement('section', { key: def.field, style: styles.group },
        React.createElement('div', { style: styles.cacheHead },
          React.createElement('h3', { style: styles.groupTitle }, t(def.labelKey)),
          React.createElement('button', {
            type: 'button',
            style: styles.ghostBtn,
            onClick: () => setField(def.field, String(snapshot.defaults?.[def.field] ?? def.default ?? '')),
          }, t('promptsReset')),
        ),
        React.createElement('div', { style: styles.hint }, t((def.labelKey ?? '') + 'Hint')),
        React.createElement('div', { style: { ...styles.hint, padding: '4px 0 6px' } },
          Array.isArray(def.placeholders) && def.placeholders.length > 0
            ? format(t('promptsPlaceholders'), { list: def.placeholders.join(' · ') })
            : t('promptsNoPlaceholders')),
        React.createElement('textarea', {
          className: 'obm-prompt-textarea',
          style: styles.promptTextarea,
          value: String(drafts[def.field] ?? ''),
          spellCheck: false,
          onChange: (event) => setField(def.field, event.target.value),
        }),
      ))

      return React.createElement('div', { style: styles.page },
        React.createElement('div', { style: styles.content },
          heading,
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
     * The cache page: every file the plugin writes, with sizes and manual clear.
     *
     * Nothing is removed on its own; each clear is an explicit, twice-confirmed
     * action. The settings file is shown for transparency but cannot be deleted.
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
          .then((response) => {
            if (!response.ok) throw new Error('HTTP ' + response.status)
            return response.json()
          })
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
          .then((response) => response.json().then((body) => ({ ok: response.ok, body })))
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

      if (error !== undefined) {
        return React.createElement('div', { style: styles.content }, heading,
          React.createElement('div', { style: { ...styles.group, ...styles.danger } }, format(t('error'), { message: error }),
            React.createElement('div', { style: styles.actions },
              React.createElement('button', { type: 'button', style: styles.ghostBtn, onClick: load }, t('reload')),
            ),
          ),
        )
      }

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
     * The live log page.
     *
     * Polls the Host for entries newer than its cursor; pausing only stops the
     * render, so nothing is lost while the user reads.
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
          .then((response) => {
            if (!response.ok) throw new Error('HTTP ' + response.status)
            return response.json()
          })
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
     * The panel shell: a tab rail on the left, the selected page on the right.
     *
     * The live connection state drives the dot beside the log tab, so a glance
     * at the rail says whether the gateway is up even while the settings tab is
     * open. Both pages are kept mounted after their first visit so the log's
     * cursor and the settings draft survive a tab switch.
     * @param props - standard slot props plus this plugin's locale seat.
     */
    function PanelPage(props) {
      const { t } = props
      const [tab, setTab] = React.useState('logs')
      const [visited, setVisited] = React.useState({ logs: true, tools: false, contacts: false, access: false, qzone: false, profile: false, prompts: false, cache: false, settings: false })
      const [connectionState, setConnectionState] = React.useState('offline')
      const [liveSelfId, setLiveSelfId] = React.useState('')

      // One shared poll for the rail dot; the log page keeps its own cursor.
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
            style: { ...styles.tab, ...(tab === item.id ? styles.tabActive : {}) },
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

    /** Required client services: slot registration and the locale seat. */
    const inject = ['slots', 'locale']

    /**
     * Contribute both surfaces.
     * @param ctx - the browser plugin context.
     * @returns the disposer.
     */
    /**
     * The responsive stylesheet.
     *
     * Inline styles cannot express a media query, and this plugin's layout must
     * survive a phone-sized viewport: the rail becomes a horizontal strip above
     * the page, and every two-column row stacks. The rules only touch layout, so
     * the theme tokens in `styles` stay authoritative for color and type.
     * @returns the CSS text.
     */
    function stylesheet() {
      return [
        '.obm-shell{height:100%;min-height:0;}',
        '.obm-pane{overscroll-behavior:contain;}',
        '.obm-tab{min-height:36px;}',
        '.obm-tab:focus-visible,.obm-disclosure:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}',
        '@media (max-width:720px){',
        // Stack the shell: a horizontal, scrollable rail on top of the page.
        '.obm-shell{grid-template-columns:minmax(0,1fr)!important;grid-template-rows:auto minmax(0,1fr);}',
        // One scrollable row: wrapping to two lines would push the page down on
        // a phone, and a horizontal strip is the familiar mobile tab pattern.
        '.obm-rail{flex-direction:row!important;flex-wrap:nowrap!important;overflow-x:auto!important;',
        'min-width:0!important;border-right:none!important;scrollbar-width:none;',
        'border-bottom:1px solid var(--dsw-alias-border-l1);padding:8px!important;gap:4px!important;}',
        '.obm-rail::-webkit-scrollbar{display:none;}',
        '.obm-rail-title{display:none;}',
        '.obm-tab{width:auto!important;flex:0 0 auto;padding:9px 12px!important;min-height:40px;}',
        // Every label/control row stacks, so the control gets the full width.
        '.obm-row{grid-template-columns:minmax(0,1fr)!important;gap:4px!important;align-items:start!important;}',
        '.obm-access-row{grid-template-columns:minmax(0,1fr)!important;gap:6px!important;}',
        '.obm-heading{flex-direction:column;align-items:flex-start!important;}',
        '.obm-contact-row{flex-direction:column;align-items:flex-start!important;gap:2px!important;}',
        '.obm-detail-grid{grid-template-columns:minmax(0,1fr)!important;}',
        '.obm-member-list,.obm-detail-grid{margin-left:10px!important;}',
        // The log table drops its time column label instead of overflowing.
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

      // One sidebar panel owns both surfaces: a tab rail on the left, the
      // selected page on the right. No `plugins.bundle.config` registration —
      // configuration lives here, not inside the Plugins page.
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
