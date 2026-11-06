/**
 * 暴露给聊天 agent 的 OneBot 工具。
 *
 * 用一个通用入口代替「每个动作一个工具」：模型传入动作名（OneBot 动作或本插件
 * 内部实现的本地动作）与参数。OneBot 动作转给传输层，本地动作（get_action_doc、
 * send_message、list_files）在这里执行。这样模型的工具列表只有一项，却仍覆盖
 * 媒体、文件、群管理和网关提供的其他动作。
 *
 * `parameters` 是裸 JSON Schema，而不是 schema 构建器规格：`ctx.tools.register`
 * 接收可直接注册的定义，只有 `defineTool` 助手才编译构建器规格。保持裸 JSON
 * 让本模块不依赖 `@deepseek-ai/dsh-tools`，git 安装的插件解析不到它。
 */

import { DEFAULT_TOOL_CALL_PROMPT } from './prompt.js'
import { LOCAL_ACTIONS, isKnownAction, actionLabel } from './toolcatalog.js'

/** 工具定义中不依赖实时连接的部分。 */
const PARAMETERS = Object.freeze({
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'Action name: an OneBot 11 action (e.g. send_group_msg, get_group_info, set_group_ban) '
        + 'or a local action (get_action_doc to read one action\'s full parameters and usage, '
        + 'send_message for text/media/图文混排, list_files).',
    },
    params: {
      type: 'object',
      additionalProperties: true,
      description: 'Action parameters, e.g. { user_id, message }, { group_id, message }, '
        + 'or for local actions { name } (get_action_doc), { text, kind, path } (send_message) / { dir } (list_files). '
        + 'Message segments look like [{ "type": "text", "data": { "text": "hi" } }, '
        + '{ "type": "image", "data": { "file": "/path/to.png" } }].',
    },
  },
  required: ['action'],
  additionalProperties: false,
})

const OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: 'Whether the gateway accepted the action.' },
    // OneBot 并不统一：有的动作返回对象（get_msg、get_group_info），有的返回裸
    // 数组（get_group_member_list、get_friend_list、get_group_list），还有的返回
    // 标量或 null。schema 子集无法用一个 `type` 表达「对象或数组」且拒绝类型数组，
    // 所以 `data` 刻意不标注类型（= 任意无损 JSON 值）。固定成 `object` 会让所有
    // 返回数组的动作整体失败。
    data: { description: 'The action response data: an object, array, or scalar, exactly as the gateway returned it.' },
    error: { type: 'string', description: 'Failure reason when ok is false.' },
  },
  required: ['ok'],
  additionalProperties: false,
})

/** 在主机目录里列文件，好让模型挑到真实文件名。 */
async function runListFiles(params) {
  const dir = String(params?.dir ?? '').trim()
  if (dir === '') return { ok: false, error: 'dir must not be empty' }
  const needle = String(params?.filter ?? '').trim().toLowerCase()
  const limit = Math.max(1, Math.min(500, Math.trunc(Number(params?.limit ?? 100)) || 100))
  try {
    const { readdir, stat } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const names = await readdir(dir)
    const entries = []
    for (const name of names.sort()) {
      if (needle !== '' && !name.toLowerCase().includes(needle)) continue
      if (entries.length >= limit) break
      let isDirectory = false
      let size = 0
      try {
        const info = await stat(join(dir, name))
        isDirectory = info.isDirectory()
        size = info.size
      } catch {
        continue
      }
      entries.push({ name, isDirectory, size })
    }
    return { ok: true, data: { dir, count: entries.length, entries } }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}

/**
 * 注册工具到一个 agent 的上下文。
 *
 * `agentCtx.tools.register` 把注册绑到该 agent，agent 销毁时工具随之消失。
 * @param agentCtx - setup 回调给出的 agent 作用域上下文。
 * @param options - 在线 `connection` 门面、允许的动作集合、当前聊天 id 与日志。
 *   `allow` 是动作名集合；集合外的动作被拒绝而不是转发。无任何动作可用时调用方
 *   会完全不注册该工具。
 */
export function registerTools(agentCtx, { connection, allow, chatId, deleteSentMedia, prompts, recordLog, adminOnly, adminUserId, senderOf, actionPromptOf }) {
  // 任何带 `tools` 服务的上下文都可用：agent 作用域上下文只为该 agent 注册，
  // 插件自身的上下文则全局注册——后者是复用在线 agent（setup 未跑过）的兜底。
  const tools = agentCtx?.tools ?? agentCtx?.get?.('tools')
  if (tools === undefined || typeof tools.register !== 'function') {
    // 可诊断的失败：否则模型会悄悄失去工具，并编造一个听起来很像真实限制的理由。
    if (typeof recordLog === 'function') {
      recordLog('registerTools: no tools service on the agent ctx (' + String(agentCtx?.constructor?.name ?? 'unknown') + ')')
    }
    return []
  }
  const disposers = []
  const allowed = allow instanceof Set ? allow : undefined
  const adminOnlySet = adminOnly instanceof Set ? adminOnly : new Set()
  // 该 agent 服务的聊天，本地 send_message 可默认为它，模型不必每次重复目标。
  const [defaultType, defaultId] = String(chatId ?? '').split(':')
  const env = { connection, defaultType, defaultId, deleteSentMedia, recordLog }

  disposers.push(tools.register({
    name: 'onebot_call',
    // 描述是可配置提示词；调用方会把动态的「已启用动作」说明渲染进去。未传入时
    // 回落到默认文案。
    description: (typeof prompts?.call === 'string' && prompts.call !== '') ? prompts.call : DEFAULT_TOOL_CALL_PROMPT,
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    // 媒体内联可能很慢，所以给每个动作更大的预算。
    timeoutMs: 120000,
    // 媒体发送会改变外部世界，重叠执行不安全。
    isConcurrencySafe: (args) => String(args?.action ?? '') !== 'send_message',
    async execute(args) {
      const action = String(args?.action ?? '').trim()
      if (action === '') throw new Error('onebot_call: action must not be empty')
      const params = args?.params !== null && typeof args?.params === 'object' ? args.params : {}
      if (allowed !== undefined && !allowed.has(action)) {
        // 两种拒绝分开说，因为给模型的建议不同：被运营者关掉的动作可以去工具页
        // 打开，而从目录里裁掉的动作在本插件里根本不存在，绝不能对用户描述成
        // 「被禁用」。
        const reason = isKnownAction(action)
          ? 'is switched off in the OneBot-Mini tools page'
          : 'is not offered by this plugin'
        return { ok: false, error: 'action "' + action + '" ' + reason }
      }
      // 鉴权：标为「仅管理员可用」的动作，只有这条消息的发送者就是管理员时才放行。
      // 没配置管理员时没有人是管理员，这类动作对谁都拒绝；拒绝发生在到达网关之前，
      // 模型只会拿到一个明确错误，不会真的改动群或把本机文件发出去。
      if (adminOnlySet.has(action)) {
        const adminId = String(adminUserId ?? '').trim()
        const sender = typeof senderOf === 'function' ? String(senderOf() ?? '').trim() : ''
        if (adminId === '' || sender !== adminId) {
          return {
            ok: false,
            error: 'action "' + action + '" is admin-only: the current sender is not the administrator',
          }
        }
      }
      // 本地动作永不到达网关，在进程内执行。
      if (LOCAL_ACTIONS.has(action)) {
        try {
          // 渐进式披露：系统提示只列动作名 + 中文注释，模型按名字来取这个动作的
          // 完整说明（功能、每个参数、调用示例）。说明来自工具页的内置文案或运营
          // 者覆盖，所以「工具」页编辑的内容就是模型最终读到的内容。
          if (action === 'get_action_doc') {
            const name = String(params?.name ?? params?.action ?? '').trim()
            if (name === '') {
              return { ok: false, error: 'get_action_doc needs params.name: the action whose documentation you want' }
            }
            if (!isKnownAction(name)) {
              return { ok: false, error: 'action "' + name + '" is not offered by this plugin' }
            }
            if (allowed !== undefined && !allowed.has(name)) {
              return { ok: false, error: 'action "' + name + '" is switched off in the OneBot-Mini tools page' }
            }
            const doc = typeof actionPromptOf === 'function' ? String(actionPromptOf(name) ?? '').trim() : ''
            return {
              ok: true,
              data: {
                name,
                label: actionLabel(name),
                admin_only: adminOnlySet.has(name),
                doc: doc !== '' ? doc : actionLabel(name),
              },
            }
          }
          if (action === 'send_message') {
            const chatType = String(params?.chatType ?? env.defaultType ?? '').trim()
            const targetId = String(params?.chatId ?? env.defaultId ?? '').trim()
            if (chatType === '' || targetId === '') {
              return { ok: false, error: 'chatType and chatId are required (the current chat is not known)' }
            }
            // 本机路径由 media.js 内联，这正是这一层的意义：原始发送动作只能引用
            // 网关自己读得到的 URL。
            const { sendMedia } = await import('./media.js')
            return sendMedia(env.connection, {
              onCleanup: (outcome) => { if (typeof env.recordLog === 'function') env.recordLog('media source ' + outcome) },
              chatType,
              chatId: targetId,
              text: params?.text,
              kind: params?.kind,
              path: params?.path,
              url: params?.url,
              base64: params?.base64,
              name: params?.name,
              deleteSource: env.deleteSentMedia === true,
            })
          }
          return await runListFiles(params)
        } catch (error) {
          return { ok: false, error: String(error?.message ?? error) }
        }
      }
      try {
        const data = await connection.call(action, params)
        // 原样透传载荷（对象、数组或标量）；只把缺失的载荷映射为 null，因为
        // `undefined` 不是无损 JSON，会让输出校验失败。
        return { ok: true, data: data === undefined ? null : data }
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) }
      }
    },
  }))
  return disposers
}
