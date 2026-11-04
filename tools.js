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
export function registerTools(agentCtx, { connection, allow }) {
  const allowed = allow instanceof Set ? allow : undefined
  agentCtx.tools.register({
    name: 'onebot_call',
    description: 'Call one OneBot 11 action through the bridged gateway, for example send_group_msg, '
      + 'send_private_msg, get_group_info or set_group_ban. Use this to send images, files or any '
      + 'message that is not plain text. The action response comes back as JSON. '
      + (allowed === undefined
        ? ''
        : 'Only the actions enabled in the OneBot-Mini settings are accepted; anything else is refused.'),
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
  })
}
