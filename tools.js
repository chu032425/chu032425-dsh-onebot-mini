/**
 * The OneBot tool exposed to a chat's agent.
 *
 * One generic escape hatch instead of one tool per action: the model passes the
 * name of an OneBot action — or of a local action implemented inside this plugin
 * — and its params. OneBot actions are relayed to the transport; local actions
 * (send_message, list_files) run here. That keeps the model's tool list to a single
 * entry while still covering media, files, group administration and every other
 * action a gateway offers.
 *
 * `parameters` is raw JSON Schema, not a schema-builder spec: `ctx.tools.register`
 * takes a registry-ready definition, and only the `defineTool` helper compiles a
 * builder spec. Staying raw keeps this module free of `@deepseek-ai/dsh-tools`,
 * which a git-installed plugin cannot resolve.
 */

import { DEFAULT_TOOL_CALL_PROMPT } from './prompt.js'

/** The tool definition, minus the parts that need a live connection. */
const PARAMETERS = Object.freeze({
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'Action name: an OneBot 11 action (e.g. send_group_msg, get_group_info, set_group_ban) '
        + 'or a local action (send_message for text/media/图文混排, list_files).',
    },
    params: {
      type: 'object',
      additionalProperties: true,
      description: 'Action parameters, e.g. { user_id, message }, { group_id, message }, '
        + 'or for local actions { text, kind, path } / { dir }. '
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
    // OneBot is not consistent: some actions return an object (get_msg,
    // get_group_info), some a bare array (get_group_member_list,
    // get_friend_list, get_group_list), and some a scalar or null. The harness
    // schema subset cannot express "object or array" with a single `type` and
    // rejects type arrays, so `data` is deliberately left untyped (= any lossless
    // JSON value). Pinning it to `object` used to fail the whole call with
    // "value.data must be an object" on every array-returning action.
    data: { description: 'The action response data: an object, array, or scalar, exactly as the gateway returned it.' },
    error: { type: 'string', description: 'Failure reason when ok is false.' },
  },
  required: ['ok'],
  additionalProperties: false,
})

/** Local actions implemented in this module instead of being relayed. */
const LOCAL = new Set(['send_message', 'list_files'])

/** List files in a host directory so the model can pick a real name. */
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
 * Send one message through the gateway's unified `send_msg` action.
 *
 * A local path is inlined by `media.js`, which is the point of this wrapper:
 * the raw send actions can only reference a URL the gateway itself can read.
 */
async function runSendMessage(params, env) {
  const chatType = String(params?.chatType ?? env.defaultType ?? '').trim()
  const targetId = String(params?.chatId ?? env.defaultId ?? '').trim()
  if (chatType === '' || targetId === '') {
    return { ok: false, error: 'chatType and chatId are required (the current chat is not known)' }
  }
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

/**
 * Register the tool on one agent's context.
 *
 * `agentCtx.tools.register` ties the registration to that agent, so the tool
 * disappears when the agent is disposed.
 * @param agentCtx - the agent-scoped context from the setup callback.
 * @param options - the live `connection` facade, the allowed action set, the
 *   current chat id, and logging. `allow` is a Set of action names; an action
 *   outside it is refused instead of being relayed. The caller omits the tool
 *   entirely when nothing is allowed.
 */
export function registerTools(agentCtx, { connection, allow, chatId, deleteSentMedia, prompts, recordLog }) {
  // Any context with a `tools` service works: an agent-scoped ctx registers for
  // that agent only, the plugin's own ctx registers globally. The latter is the
  // fallback for a reused live agent whose setup never ran.
  const tools = agentCtx?.tools ?? agentCtx?.get?.('tools')
  if (tools === undefined || typeof tools.register !== 'function') {
    // Diagnosable failure: without this the model simply loses its tools and
    // invents a reason ("no permission") that reads like a real limitation.
    if (typeof recordLog === 'function') {
      recordLog('registerTools: no tools service on the agent ctx (' + String(agentCtx?.constructor?.name ?? 'unknown') + ')')
    }
    return []
  }
  const disposers = []
  const allowed = allow instanceof Set ? allow : undefined
  // The chat this agent serves, so a local send_message can default to it instead
  // of making the model repeat the target on every call.
  const [defaultType, defaultId] = String(chatId ?? '').split(':')
  const env = { connection, defaultType, defaultId, deleteSentMedia, recordLog }

  disposers.push(tools.register({
    name: 'onebot_call',
    // The description is a configurable prompt; the caller renders the dynamic
    // enabled-actions note into it. Fall back to the default when none is passed.
    description: (typeof prompts?.call === 'string' && prompts.call !== '') ? prompts.call : DEFAULT_TOOL_CALL_PROMPT,
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    // Media inlining can be slow; give every action the larger budget.
    timeoutMs: 120000,
    // A media send mutates the outside world and is not safe to overlap.
    isConcurrencySafe: (args) => String(args?.action ?? '') !== 'send_message',
    async execute(args) {
      const action = String(args?.action ?? '').trim()
      if (action === '') throw new Error('onebot_call: action must not be empty')
      const params = args?.params !== null && typeof args?.params === 'object' ? args.params : {}
      if (allowed !== undefined && !allowed.has(action)) {
        return { ok: false, error: 'action "' + action + '" is disabled in the OneBot-Mini settings' }
      }
      // Local actions never reach the gateway; they run in-process.
      if (LOCAL.has(action)) {
        try {
          return action === 'send_message' ? await runSendMessage(params, env) : await runListFiles(params)
        } catch (error) {
          return { ok: false, error: String(error?.message ?? error) }
        }
      }
      try {
        const data = await connection.call(action, params)
        // Pass the payload through verbatim (object, array or scalar); only map
        // an absent payload to null, since `undefined` is not lossless JSON and
        // would itself fail output validation.
        return { ok: true, data: data === undefined ? null : data }
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) }
      }
    },
  }))
  return disposers
}
