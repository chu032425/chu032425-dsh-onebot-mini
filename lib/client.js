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
      groupDiagnostics: '诊断',
      groupTool: '工具（onebot_call）',
      fieldOnebotToolEnabled: '启用 onebot_call 工具',
      hintOnebotToolEnabled: '开启后模型可主动调用 QQ 接口（发图片/文件、群管理、查询等）；关闭则该工具不注册，模型看不到它。',
      hintOnebotToolOff: '工具已关闭，不会注册；模型只能发普通文字回复。下面的动作全部不生效。',
      toolGroupMessage: '发送消息',
      toolGroupMedia: '媒体与文件',
      toolGroupGroup: '群管理',
      toolGroupAccount: '账号与查询',
      toolGroupRequest: '请求处理',
      toolCount: '已启用 {on}/{total}',
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
      modeReverse: '反向（网关拨入）',
      modeForward: '正向（主动拨出）',
      modeHintReverse: '本插件监听端口，等待网关拨入；下方只显示监听地址与端口。',
      modeHintForward: '本插件主动连接网关；下方只显示网关地址，不占用本地端口。',
      tabLogs: '日志',
      tabTools: '工具',
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
      groupDiagnostics: 'Diagnostics',
      groupTool: 'Tools (onebot_call)',
      fieldOnebotToolEnabled: 'Enable the onebot_call tool',
      hintOnebotToolEnabled: 'When on, the model can call QQ APIs (images/files, group management, queries). When off, the tool is not registered and the model never sees it.',
      hintOnebotToolOff: 'The tool is off and will not be registered; the model can only send plain text replies. None of the actions below apply.',
      toolGroupMessage: 'Send messages',
      toolGroupMedia: 'Media and files',
      toolGroupGroup: 'Group management',
      toolGroupAccount: 'Account and queries',
      toolGroupRequest: 'Request handling',
      toolCount: '{on}/{total} enabled',
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
      modeReverse: 'Reverse (gateway dials in)',
      modeForward: 'Forward (we dial out)',
      modeHintReverse: 'This plugin listens and waits for the gateway; only the listen address and port are shown below.',
      modeHintForward: 'This plugin dials the gateway; only the gateway URL is shown below, and no local port is bound.',
      tabLogs: 'Logs',
      tabTools: 'Tools',
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

    /** Label key for one OneBot action, e.g. send_group_msg → toolActionSendGroupMsg. */
    function toolActionLabelKey(action) {
      return 'toolAction' + String(action)
        .split(/[^A-Za-z0-9]+/)
        .filter((part) => part !== '')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('')
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
      return React.createElement('div', { style: styles.row },
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
      return React.createElement('div', { style: styles.row },
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
    function BoolRow({ label, hint, value, onChange }) {
      return React.createElement('div', { style: styles.row },
        React.createElement('label', { style: styles.rowLabel }, label),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement('input', {
            type: 'checkbox',
            role: 'switch',
            'aria-checked': value === true,
            style: styles.checkbox,
            checked: value === true,
            onChange: (event) => onChange(event.target.checked),
          }),
          hint !== undefined && hint !== '' ? React.createElement('span', { style: styles.hint }, hint) : null,
        ),
      )
    }

    /**
     * A number row.
     * @param props - `label`, `hint`, `value`, `onChange`, `min`, `max`.
     */
    function NumberRow({ label, hint, value, onChange, min, max }) {
      return React.createElement('div', { style: styles.row },
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
      return React.createElement('div', { style: styles.row },
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
      return React.createElement('div', { style: styles.row },
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
      return React.createElement('div', { style: styles.row },
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
      return React.createElement('div', { style: styles.row },
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
      return React.createElement('div', { style: styles.row },
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
      return React.createElement('div', { style: styles.row },
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
      const disabledSet = new Set(Array.isArray(disabled) ? disabled : [])
      const commit = (next) => onChangeDisabled([...next])
      const toggleAction = (action, on) => {
        const next = new Set(disabledSet)
        if (on) next.delete(action)
        else next.add(action)
        commit(next)
      }
      const toggleGroup = (actions, on) => {
        const next = new Set(disabledSet)
        for (const action of actions) {
          if (on) next.delete(action)
          else next.add(action)
        }
        commit(next)
      }

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
      children.push(React.createElement('div', { key: 'actionsHint', style: { ...styles.hint, padding: '4px 0 10px' } }, t('toolActionsHint')))
      for (const group of groups) {
        const actions = Array.isArray(group.actions) ? group.actions : []
        const onCount = actions.filter((action) => !disabledSet.has(action)).length
        const allOn = actions.length > 0 && onCount === actions.length
        const header = React.createElement('div', { key: group.id + '-h', style: styles.toolGroupHeader },
          React.createElement('label', { style: styles.toolGroupLabel },
            React.createElement('input', {
              type: 'checkbox',
              style: styles.checkbox,
              checked: allOn,
              onChange: (event) => toggleGroup(actions, event.target.checked),
            }),
            React.createElement('span', { style: styles.toolGroupName }, t(toolGroupLabelKey(group.id))),
          ),
          React.createElement('span', { style: styles.hint }, format(t('toolCount'), { on: onCount, total: actions.length })),
        )
        const rows = actions.map((action) => React.createElement('label', { key: group.id + '-' + action, style: styles.toolListRow },
          React.createElement('input', {
            type: 'checkbox',
            style: { ...styles.checkbox, marginTop: 2 },
            checked: !disabledSet.has(action),
            onChange: (event) => toggleAction(action, event.target.checked),
          }),
          React.createElement('div', { style: styles.toolListText },
            React.createElement('span', { style: styles.toolListName }, (zh[toolActionLabelKey(action)] ?? en[toolActionLabelKey(action)] ?? t(toolActionLabelKey(action)))),
            React.createElement('code', { style: styles.toolActionCode }, action),
          ),
        ))
        children.push(React.createElement('div', { key: group.id, style: styles.toolGroup },
          header,
          React.createElement('div', { style: styles.toolList }, rows),
        ))
      }
      children.push(React.createElement('div', { key: 'note', style: { ...styles.hint, paddingTop: 8 } }, t('toolNoteAuto')))
      return React.createElement('section', { style: styles.group }, children)
    }

    /**
     * Render one config field by its declared kind.
     * @param props - `field`, `kind`, `label`, `hint`, `value`, `onChange`, `t`.
     */
    function FieldRow({ field, kind, label, hint, value, onChange, workspaces, agentPresets, permissionPresets, models, t }) {
      if (field === 'mode') {
        return React.createElement('div', { style: styles.row },
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
      if (kind === 'boolean') return React.createElement(BoolRow, { label, hint, value: value === true, onChange })
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
            return React.createElement(FieldRow, {
              key: field,
              field,
              kind: secretFields.includes(field) ? 'secret' : (kinds[field] ?? 'string'),
              label,
              hint,
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
          React.createElement('div', { style: styles.heading },
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
          React.createElement('div', { style: styles.heading },
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
          React.createElement('div', { style: styles.heading },
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
            React.createElement('div', { style: styles.logHead },
              React.createElement('span', null, 'Time'),
              React.createElement('span', null, 'Kind'),
              React.createElement('span', null, 'Detail'),
            ),
            React.createElement('div', { style: styles.logBody, ref: bodyRef },
              entries.length === 0
                ? React.createElement('div', { style: styles.empty }, t('empty'))
                : entries.map((entry) => React.createElement('div', { key: entry.seq, style: styles.logRow },
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
      const [visited, setVisited] = React.useState({ logs: true, tools: false, settings: false })
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
        { id: 'settings', label: t('tabSettings'), dot: undefined },
      ]

      return React.createElement('div', { style: styles.shell },
        React.createElement('nav', { style: styles.rail, 'aria-label': t('panel') },
          React.createElement('h2', { style: styles.railTitle }, t('panel')),
          tabs.map((item) => React.createElement('button', {
            key: item.id,
            type: 'button',
            role: 'tab',
            'aria-selected': tab === item.id,
            style: { ...styles.tab, ...(tab === item.id ? styles.tabActive : {}) },
            onClick: () => select(item.id),
          },
            item.dot !== undefined
              ? React.createElement('span', { style: { ...styles.tabDot, background: item.dot } })
              : null,
            React.createElement('span', null, item.label),
          )),
        ),
        React.createElement('div', { style: styles.pane, role: 'tabpanel' },
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
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'onebot-mini: dictionaries')
      const t = ctx.locale.bind(NS)

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
