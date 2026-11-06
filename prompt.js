/**
 * 本插件注入给模型的所有提示词。
 *
 * 这些文本过去散落在 bridge.js 里，现在集中到这里，以便持久化进配置、并在
 * 「提示词」页面里直接编辑。代码只负责提供少量动态片段。
 *
 * 频道模板支持的占位符：
 *  - `{replyMode}` —— 回复发送方式说明：流式按段实时发，或整轮攒成一条；
 *  - `{admin}` —— 管理员身份说明（告诉模型管理员 QQ 号、其指令优先），未设置时为空；
 *  - `{senderPrefix}` —— 群聊发言人前缀说明，或空；
 *  - `{media}` —— 媒体发送工具 + 标记段落，工具关闭时为空；
 *  - `{tools}` —— 本插件唯一的工具 onebot_call（含本地动作 send_message /
 *    list_files）以及「QQ 相关操作只能用这个工具」的硬规则；
 *  - `{actions}` —— 工具关闭时的说明，或当前启用的动作清单（每个动作含功能、参数和用法）；
 *  - `{inbound}` —— 收到的图片/语音/视频/文件已保存到本机、如何读取的说明。
 *
 * 其余文字都是运营者可以随意改写的普通文案。需要动态部分时保留占位符即可；
 * 渲染器遇到不认识的占位符会原样保留，而不是删掉整段文字。
 */

/** 开箱即用的频道模板。 */
export const DEFAULT_CHANNEL_PROMPT = [
  '## OneBot（QQ）通道',
  '你正在通过 OneBot 11 桥接的 QQ 聊天与用户对话。',
  '- QQ 不渲染 Markdown。请用纯文本回答，可用数字或短横线列表。',
  '{replyMode}',
  '{admin}',
  '- 用户发来的图片、语音、视频、文件会在消息文本里显示为 [图片] / [语音] / [视频] / [文件] 占位。',
  '{tools}',
  '{senderPrefix}',
  '{media}',
  '{inbound}',
  '{actions}',
  '- 本通道没有 Web 端的审批卡片：不要调用 exit_plan_mode，需要计划时用纯文本写出。',
].join('\n')

/**
 * 旧版频道模板（回复行为写死为「整轮一条」）。
 *
 * 仅用于迁移：老配置里未被编辑过的该模板会被换成新的 `DEFAULT_CHANNEL_PROMPT`，
 * 让回复发送方式的说明随 `replyMode` 动态变化；被运营者改过的模板保持原样。
 */
export const LEGACY_CHANNEL_PROMPT = [
  '## OneBot（QQ）通道',
  '你正在通过 OneBot 11 桥接的 QQ 聊天与用户对话。',
  '- QQ 不渲染 Markdown。请用纯文本回答，可用数字或短横线列表。',
  '- 一轮回复只产生一条对外消息：插件会缓存你的文本块，并在本轮结束时统一发送。不要试图把一条回复拆成多条消息。',
  '- 用户发来的图片、语音、视频、文件会在消息文本里显示为 [图片] / [语音] / [视频] / [文件] 占位。',
  '{tools}',
  '{senderPrefix}',
  '{media}',
  '{inbound}',
  '{actions}',
  '- 本通道没有 Web 端的审批卡片：不要调用 exit_plan_mode，需要计划时用纯文本写出。',
].join('\n')

/**
 * 上一版频道模板（已带 `{replyMode}`，但还没有 `{admin}`）。
 *
 * 同样只用于迁移：把已保存的这一版默认模板升级到当前默认，使管理员说明也能
 * 随配置出现；编辑过的模板不动。
 */
export const LEGACY_CHANNEL_PROMPT_V2 = [
  '## OneBot（QQ）通道',
  '你正在通过 OneBot 11 桥接的 QQ 聊天与用户对话。',
  '- QQ 不渲染 Markdown。请用纯文本回答，可用数字或短横线列表。',
  '{replyMode}',
  '- 用户发来的图片、语音、视频、文件会在消息文本里显示为 [图片] / [语音] / [视频] / [文件] 占位。',
  '{tools}',
  '{senderPrefix}',
  '{media}',
  '{inbound}',
  '{actions}',
  '- 本通道没有 Web 端的审批卡片：不要调用 exit_plan_mode，需要计划时用纯文本写出。',
].join('\n')

/** 默认：流式（按段实时发）的回复发送方式段落。 */
export const DEFAULT_REPLY_MODE_STREAM_PROMPT = '- 你的回复会按段实时发出：每产生一段文字就作为一条独立的 QQ 消息发给用户，用户能边看边等。'
  + '想清楚再发，避免前后矛盾或反复改动。'

/** 默认：任务完成一次发送的回复发送方式段落。 */
export const DEFAULT_REPLY_MODE_FINAL_PROMPT = '- 一轮回复只产生一条对外消息：插件会缓存你的文本块，并在本轮结束时统一发送。不要试图把一条回复拆成多条消息。'

/**
 * 回复发送方式段落，随 `replyMode` 变化；`template` 是该模式在提示词页编辑的文本。
 * @param mode - `stream` 或 `final`。
 * @param template - 覆盖文本；为空则用该模式的默认文案。
 * @returns 该段落。
 */
export function replyModeParagraph(mode, template) {
  const custom = String(template ?? '').trim()
  if (custom !== '') return custom
  return mode === 'final' ? DEFAULT_REPLY_MODE_FINAL_PROMPT : DEFAULT_REPLY_MODE_STREAM_PROMPT
}

/** 默认：管理员段落；`{adminId}` 会替换为管理员 QQ 号。 */
export const DEFAULT_ADMIN_PROMPT = '- 管理员是 QQ {adminId}：管理员的要求优先处理；涉及敏感或管理类操作时，以管理员的指令为准。'

/**
 * 管理员段落：把配置里的管理员 QQ 号告诉模型，并要求其指令优先。
 * @param adminUserId - 管理员的 QQ 号；空表示未设置。
 * @param template - 提示词页可编辑的模板，支持 `{adminId}`。
 * @returns 该段落，未设置时为空串（占位符所在整行会被删掉）。
 */
export function adminParagraph(adminUserId, template) {
  const id = String(adminUserId ?? '').trim()
  if (id === '') return ''
  const custom = String(template ?? '').trim()
  const base = custom !== '' ? custom : DEFAULT_ADMIN_PROMPT
  return base.replace(/\{adminId\}/g, id)
}

/** 默认：群聊发言人前缀说明。 */
export const DEFAULT_SENDER_PREFIX_PROMPT = '- 群消息会带有 [HH:MM 昵称(QQ)] 前缀，以便区分不同发言人。'

/**
 * 群聊发言人前缀段落（可被提示词页覆盖）。
 * @param template - 覆盖文本；为空则用默认。
 * @returns 该段落。
 */
export function senderPrefixParagraph(template) {
  const custom = String(template ?? '').trim()
  return custom !== '' ? custom : DEFAULT_SENDER_PREFIX_PROMPT
}

/** 默认：媒体发送段落（工具启用时注入）。 */
export const DEFAULT_MEDIA_PROMPT = [
  '- 要主动发一条消息，用 onebot_call 的 send_message 动作，四种写法：①纯文字 {"text":"…"}；②纯媒体 {"kind":"image","path":"/绝对/路径.png"}；③文字+媒体 {"text":"…","kind":"image","path":"…"}（合成同一条消息）；④发到别的会话再加 "chatType":"group","chatId":"群号"。kind 可取 image / record / video / file，媒体来源 path / url / base64 三选一。',
  '- 如果媒体要和你的回复文字一起自动发出（你在回答里、不调工具时），在回复里写标记：[[image:/abs/path.png]]、[[record:/abs/a.wav]]、[[video:/abs/a.mp4]] 或 [[file:/abs/a.zip]]——路径也可以是 http(s) URL。插件会把每个标记替换成真实附件，文字与附件是同一条消息。仅在用户要求时才发送媒体。',
  '- 你看不到磁盘。在说出某个本地文件名之前，先调用 onebot_call(action="list_files", params={"dir": "/绝对目录"})，使用它返回的真实文件名。绝不臆造文件名：路径错误会导致附件发送失败，用户只会看到一条简短提示。',
  '- 当用户要图片、语音、视频或文件时，你【必须】用 onebot_call 的 send_message 动作发送（先 list_files 列目录）。不要回复说你没有权限、账号受限、只有管理员才能发媒体、或工具不可用——这些说法在本通道都是错误的。如果确实发送失败，如实报告工具返回的错误。绝不要让用户把你设为管理员来换取发媒体的能力。',
].join('\n')

/**
 * 媒体发送段落（可被提示词页覆盖）。
 * @param template - 覆盖文本；为空则用默认。
 * @returns 该段落。
 */
export function mediaParagraph(template) {
  const custom = String(template ?? '').trim()
  return custom !== '' ? custom : DEFAULT_MEDIA_PROMPT
}

/** 默认：工具清单段落（工具启用时注入；本地动作也在动作列表里）。 */
export const DEFAULT_TOOLS_PROMPT = [
  '## 本插件提供的工具（所有 QQ 相关操作都必须使用这些工具）',
  '- 本插件只注册了一个工具 onebot_call：它既执行 OneBot 11 动作，也执行本插件的本地动作（send_message 发消息、list_files 列本机目录）。',
  '- 所有 QQ 相关操作（发消息、发图片/语音/视频/文件、群管理、查询等）都必须通过 onebot_call 完成；不要使用任何其他以 qq_ 开头的工具或第三方 QQ 工具。如果工具报错，请如实转述错误，不要声称没有权限。',
  '- 调用时动作名放 action、参数放 params，且只接受已启用的动作；下面按分组列出当前可用的动作。',
].join('\n')

/**
 * 本插件工具清单段落。
 *
 * 只有工具确实可用（`allow` 是 Set）时才输出；工具关闭时返回空串，整行会被
 * 渲染器删掉，避免向模型宣传一个根本不存在的工具。工具清单本身是固定的三项，
 * 因为 registerTools 总是同时注册它们。
 * @param allow - computeAllowlist 得到的可用动作集合，或 null。
 * @param template - 提示词页可编辑的覆盖文本；为空则用默认。
 * @returns 工具清单段落，或空串。
 */
export function toolsParagraph(allow, template) {
  if (!(allow instanceof Set)) return ''
  const custom = String(template ?? '').trim()
  return custom !== '' ? custom : DEFAULT_TOOLS_PROMPT
}

/** 频道模板声明的占位符。 */
export const PROMPT_PLACEHOLDERS = Object.freeze(['{replyMode}', '{admin}', '{senderPrefix}', '{media}', '{tools}', '{actions}', '{inbound}'])

/**
 * 「收到的媒体」默认提示词：告诉模型占位符里带的是本机路径，并说明如何读取。
 *
 * 这一段可以在「提示词」页面编辑；`{inbound}` 占位符会展开成它的当前值（接收媒体
 * 关闭时为空）。默认文案如下。
 */
export const DEFAULT_INBOUND_PROMPT = [
  '## 收到的媒体',
  '- 用户发来的图片会保存到本机，并给出形如 [图片: /绝对/路径.png] 的路径；回答前先用 read_image 工具查看这张图片，再据其内容作答。',
  '- 语音会保存为音频文件并给出 [语音: /绝对/路径]（消息ID: …）。音频本身不是文本，你不能直接“听”。若要得到文字，请在下方「可用动作」中，按动作名称和中文注释自行查找合适的动作（例如注释为「获取语音转文字结果」的动作），用 onebot_call 调用并把消息ID作为参数；找不到合适动作或取不到结果时，如实说明听不了、请用户改发文字。',
  '- 视频会保存并给出 [视频: /绝对/路径]；文件会给出 [文件: 名称, /绝对/路径]。需要时用 read 或 bash 工具读取其中内容（如文本、表格、压缩包）。',
  '- 若占位符不带路径（只有 [图片] 这种），说明下载失败或未开启接收媒体：如实告诉用户你没有收到内容，不要凭空编造。',
].join('\n')

/**
 * 「收到的媒体」段落（可被提示词页覆盖）。
 * @param template - 覆盖文本；为空则用默认。
 * @returns 该段落。
 */
export function inboundParagraph(template) {
  const custom = String(template ?? '').trim()
  return custom !== '' ? custom : DEFAULT_INBOUND_PROMPT
}

/**
 * `onebot_call` 工具的默认描述。
 *
 * `{enabledNote}` 在工具有效时展开为「只接受已启用动作」的说明，关闭时展开为空。
 */
export const DEFAULT_TOOL_CALL_PROMPT = '执行一个动作：OneBot 11 动作，或本插件的本地动作（send_message、list_files）。'
  + '把动作名放进 action，参数放进 params。不确定用哪个动作时，按动作名称与中文注释自行挑选。动作结果以 JSON 返回。{enabledNote}'

/** 轻量「插话 / 排队」判定器的默认指令。 */
export const DEFAULT_INTERJECT_PROMPT = '你负责为一位可能仍在作答的助手转发一条新的 QQ 消息。'
  + '只回答一个词：STEER 或 FOLLOWUP。'
  + 'STEER 表示这条消息是在纠正、改变方向、叫停或紧急补充正在进行的回答，必须让它在模型的下一步执行时送达。'
  + 'FOLLOWUP 表示它是一个独立的后续请求，可以等当前回答结束后再处理。'
  + '拿不准时，回答 FOLLOWUP。'

/**
 * 每一个面向模型的提示词，按「提示词」页面展示顺序排列。
 *
 * 这里是唯一的注册表：新增一项就等于在页面上出现一项，并自动持久化。每项声明
 * 它读取的配置字段、页面用的标签键、它理解的占位符，以及默认值。
 *
 * @typedef {{ id: string, field: string, labelKey: string, placeholders: string[], default: string }} PromptDef
 * @type {readonly PromptDef[]}
 */
export const PROMPT_DEFS = Object.freeze([
  Object.freeze({ id: 'channel', field: 'channelPrompt', labelKey: 'promptDefChannel', placeholders: PROMPT_PLACEHOLDERS, default: DEFAULT_CHANNEL_PROMPT }),
  Object.freeze({ id: 'replyModeStream', field: 'replyModeStreamPrompt', labelKey: 'promptDefReplyModeStream', placeholders: Object.freeze([]), default: DEFAULT_REPLY_MODE_STREAM_PROMPT }),
  Object.freeze({ id: 'replyModeFinal', field: 'replyModeFinalPrompt', labelKey: 'promptDefReplyModeFinal', placeholders: Object.freeze([]), default: DEFAULT_REPLY_MODE_FINAL_PROMPT }),
  Object.freeze({ id: 'admin', field: 'adminPrompt', labelKey: 'promptDefAdmin', placeholders: Object.freeze(['{adminId}']), default: DEFAULT_ADMIN_PROMPT }),
  Object.freeze({ id: 'senderPrefix', field: 'senderPrefixPrompt', labelKey: 'promptDefSenderPrefix', placeholders: Object.freeze([]), default: DEFAULT_SENDER_PREFIX_PROMPT }),
  Object.freeze({ id: 'media', field: 'mediaPrompt', labelKey: 'promptDefMedia', placeholders: Object.freeze([]), default: DEFAULT_MEDIA_PROMPT }),
  Object.freeze({ id: 'tools', field: 'toolsPrompt', labelKey: 'promptDefTools', placeholders: Object.freeze([]), default: DEFAULT_TOOLS_PROMPT }),
  Object.freeze({ id: 'inbound', field: 'inboundPrompt', labelKey: 'promptDefInbound', placeholders: Object.freeze([]), default: DEFAULT_INBOUND_PROMPT }),
  Object.freeze({ id: 'toolCall', field: 'toolCallPrompt', labelKey: 'promptDefToolCall', placeholders: Object.freeze(['{enabledNote}']), default: DEFAULT_TOOL_CALL_PROMPT }),
  Object.freeze({ id: 'interject', field: 'interjectPrompt', labelKey: 'promptDefInterject', placeholders: Object.freeze([]), default: DEFAULT_INTERJECT_PROMPT }),
])

/**
 * 填充模板，丢掉展开为空的占位符所在行。
 *
 * 单独占一行的占位符若展开为空，会留下一行空白，所以空展开时整行删除；随后
 * 再把连续的多行空白折叠起来。
 * @param template - 提示词模板。
 * @param values - `{ replyMode, admin, senderPrefix, media, tools, actions, inbound }` 替换文本。
 * @returns 渲染后的提示词。
 */
export function renderPrompt(template, values) {
  let text = String(template ?? '')
  for (const key of ['replyMode', 'admin', 'senderPrefix', 'media', 'tools', 'actions', 'inbound']) {
    const value = String(values?.[key] ?? '')
    const pattern = new RegExp('^[ \\t]*\\{' + key + '\\}[ \\t]*$', 'm')
    if (value.trim() === '') {
      text = text.replace(pattern, '')
    } else {
      text = text.replace(new RegExp('\\{' + key + '\\}', 'g'), value)
    }
  }
  return text.replace(/\n{3,}/g, '\n\n').trim() + '\n'
}


/**
 * 填充工具调用描述。
 *
 * 「已启用动作」这句是动态的（工具关闭时消失），所以它做成占位符，而不是写死
 * 进可编辑文本里。
 * @param template - 配置里的描述文本。
 * @param allow - computeAllowlist 得到的可用动作集合，或 null。
 * @returns 注册到工具上的描述。
 */
export function renderToolCallPrompt(template, allow) {
  const note = allow === null
    ? ''
    : '仅接受在 OneBot-Mini 设置中已启用的动作，其余一律拒绝。'
  const text = String(template ?? '').trim() !== '' ? String(template) : DEFAULT_TOOL_CALL_PROMPT
  return text.replace(/\{enabledNote\}/g, note).replace(/\s+$/, '')
}
