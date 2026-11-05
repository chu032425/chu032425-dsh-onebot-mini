/**
 * The OneBot tool exposed to a chat's agent.
 *
 * One generic escape hatch instead of one tool per action: the model passes the
 * OneBot action name and its params, and the transport relays it. That keeps
 * the plugin small while still covering images, files, group administration and
 * every other action a gateway offers.
 *
 * `parameters` is raw JSON Schema, not a schema-builder spec: `ctx.tools.register`
 * takes a registry-ready definition, and only the `defineTool` helper compiles a
 * builder spec. Staying raw keeps this module free of `@deepseek-ai/dsh-tools`,
 * which a git-installed plugin cannot resolve.
 */

import { DEFAULT_TOOL_CALL_PROMPT, DEFAULT_TOOL_MEDIA_PROMPT } from './prompt.js'

/** The tool definition, minus the parts that need a live connection. */
const PARAMETERS = Object.freeze({
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'OneBot 11 action name, e.g. send_private_msg, send_group_msg, get_group_info, set_group_ban.',
    },
    params: {
      type: 'object',
      additionalProperties: true,
      description: 'Action parameters, e.g. { user_id, message } or { group_id, message }. '
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
    data: { type: 'object', additionalProperties: true, description: 'The action response data.' },
    error: { type: 'string', description: 'Failure reason when ok is false.' },
  },
  required: ['ok'],
  additionalProperties: false,
})

/**
 * Register the tool on one agent's context.
 *
 * `agentCtx.tools.register` ties the registration to that agent, so the tool
 * disappears when the agent is disposed.
 * @param agentCtx - the agent-scoped context from the setup callback.
 * @param options - the live `connection` facade and the allowed action set.
 *   `allow` is a Set of action names; an action outside it is refused instead
 *   of being relayed. The caller omits the tool entirely when nothing is allowed.
 */
export function registerTools(agentCtx, { connection, allow, chatId, deleteSentMedia, prompts, recordLog }) {
  // Any context with a `tools` service works: an agent-scoped ctx registers for
  // that agent only, the plugin's own ctx registers globally. The latter is the
  // fallback for a reused live agent whose setup never ran.
  const tools = agentCtx?.tools ?? agentCtx?.get?.('tools')
  if (tools === undefined || typeof tools.register !== 'function') return []
  const disposers = []
  const allowed = allow instanceof Set ? allow : undefined
  // The chat this agent serves, so a media send can default to it instead of
  // making the model repeat the target on every call.
  const [defaultType, defaultId] = String(chatId ?? '').split(':')
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
    timeoutMs: 60000,
    isConcurrencySafe: () => true,
    async execute(args) {
      const action = String(args?.action ?? '').trim()
      if (action === '') throw new Error('onebot_call: action must not be empty')
      if (allowed !== undefined && !allowed.has(action)) {
        return { ok: false, error: 'action "' + action + '" is disabled in the OneBot-Mini settings' }
      }
      const params = args?.params !== null && typeof args?.params === 'object' ? args.params : {}
      try {
        const data = await connection.call(action, params)
        return { ok: true, data: data !== null && typeof data === 'object' ? data : { value: data } }
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) }
      }
    },
  }))

  // A file-listing tool: the model has no way to see the disk, so without this it
  // invents plausible filenames and the send fails. Listing is cheap and keeps
  // guesses honest.
  disposers.push(tools.register({
    name: 'onebot_list_files',
    description: 'List files in a directory on the DSH host, so you can pick a real file '
      + 'before calling onebot_send_media. Returns names, sizes and whether each is a directory.',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Absolute directory path, e.g. /workspace/QQ.' },
        filter: { type: 'string', description: 'Optional case-insensitive substring to match in file names.' },
        limit: { type: 'number', description: 'Maximum entries to return (default 100).' },
      },
      required: ['dir'],
      additionalProperties: false,
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    timeoutMs: 30000,
    isConcurrencySafe: () => true,
    async execute(args) {
      const dir = String(args?.dir ?? '').trim()
      if (dir === '') return { ok: false, error: 'dir must not be empty' }
      const needle = String(args?.filter ?? '').trim().toLowerCase()
      const limit = Math.max(1, Math.min(500, Math.trunc(Number(args?.limit ?? 100)) || 100))
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
    },
  }))

  // A dedicated media tool: `onebot_call` can send an image too, but only from a
  // URL the gateway can read. This one also accepts a path on this host and
  // inlines the bytes, which is what makes "reply with a local picture" work.
  disposers.push(tools.register({
    name: 'onebot_send_media',
    description: (typeof prompts?.media === 'string' && prompts.media !== '') ? prompts.media : DEFAULT_TOOL_MEDIA_PROMPT,
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['image', 'record', 'video', 'file'], description: 'Kind of media.' },
        path: { type: 'string', description: 'Local file path on the DSH host.' },
        url: { type: 'string', description: 'A URL the gateway can reach.' },
        base64: { type: 'string', description: 'Raw base64 payload (no data: prefix).' },
        name: { type: 'string', description: 'Display name, for a file.' },
        chatType: { type: 'string', enum: ['private', 'group'], description: 'Defaults to the current chat.' },
        chatId: { type: 'string', description: 'Target id; defaults to the current chat.' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    timeoutMs: 120000,
    isConcurrencySafe: () => false,
    async execute(args) {
      const chatType = String(args?.chatType ?? defaultType ?? '').trim()
      const targetId = String(args?.chatId ?? defaultId ?? '').trim()
      if (chatType === '' || targetId === '') {
        return { ok: false, error: 'chatType and chatId are required (the current chat is not known)' }
      }
      const { sendMedia } = await import('./media.js')
      const result = await sendMedia(connection, {
        onCleanup: (outcome) => { if (typeof recordLog === 'function') recordLog('media source ' + outcome) },
        chatType,
        chatId: targetId,
        kind: args?.kind,
        path: args?.path,
        url: args?.url,
        base64: args?.base64,
        name: args?.name,
        deleteSource: deleteSentMedia === true,
      })
      return result
    },
  }))
  return disposers
}
