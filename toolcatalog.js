/**
 * The OneBot actions the `onebot_call` tool is allowed to relay, grouped for
 * the settings page.
 *
 * `onebot_call` itself stays one generic escape hatch; this catalog only says
 * which actions an operator can switch on or off. The list is a whitelist: an
 * action that is not here, or that the operator turned off, is refused by the
 * tool instead of reaching the gateway. That is deliberate — an operator who
 * unchecks "ban members" should be sure the model cannot ban anyone just
 * because the OneBot API happens to support it.
 *
 * Kept dependency-free so the module loads identically from a git install and
 * from a `link:` checkout.
 */

/**
 * One group of related actions.
 * @typedef {{ id: string, actions: string[] }} ToolGroup
 */

/** The operator-facing grouping. Order is the order shown in the settings page. */
export const TOOL_GROUPS = Object.freeze([
  Object.freeze({ id: 'message', actions: Object.freeze(['send_private_msg', 'send_group_msg', 'send_msg']) }),
  Object.freeze({ id: 'media', actions: Object.freeze(['upload_group_file', 'upload_private_file', 'get_image', 'get_record', 'get_file']) }),
  Object.freeze({ id: 'group', actions: Object.freeze([
    'set_group_ban', 'set_group_kick', 'set_group_whole_ban', 'set_group_admin',
    'set_group_card', 'set_group_name', 'set_group_leave', 'set_group_special_title',
  ]) }),
  Object.freeze({ id: 'account', actions: Object.freeze([
    'get_login_info', 'get_status', 'get_version_info', 'get_friend_list',
    'get_group_list', 'get_group_info', 'get_group_member_list', 'get_group_member_info',
    'get_stranger_info',
  ]) }),
  Object.freeze({ id: 'request', actions: Object.freeze(['set_friend_add_request', 'set_group_add_request']) }),
])

/** Every known action, flattened. */
export const ALL_ACTIONS = Object.freeze(TOOL_GROUPS.flatMap((group) => group.actions))

/** Membership set for O(1) "is this a known action" checks. */
const KNOWN = new Set(ALL_ACTIONS)

/**
 * Whether a raw string is a known action.
 * @param action - candidate action name.
 * @returns true when the action is in the catalog.
 */
export function isKnownAction(action) {
  return KNOWN.has(String(action))
}

/**
 * Compute the actions a chat's agent may use, from one effective config.
 *
 * Three outcomes:
 *  - the master switch is off  → `null`: the tool is not registered at all, so
 *    the model never sees it;
 *  - every action is off        → `null`: registering a tool that can do nothing
 *    only wastes the model's attention;
 *  - otherwise                  → a Set of allowed action names.
 * @param config - the effective config (any missing field means "enabled").
 * @returns a Set of allowed actions, or null to skip registration entirely.
 */
export function computeAllowlist(config) {
  const source = config !== null && typeof config === 'object' ? config : {}
  if (source.onebotToolEnabled === false) return null
  const disabled = new Set(
    Array.isArray(source.onebotToolDisabled) ? source.onebotToolDisabled.map((item) => String(item)) : [],
  )
  const allowed = ALL_ACTIONS.filter((action) => !disabled.has(action))
  if (allowed.length === 0) return null
  return new Set(allowed)
}
