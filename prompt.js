/**
 * The default channel prompt.
 *
 * This text used to be assembled inside bridge.js. It lives here now so it can
 * be persisted in the config and edited from the Prompt page, while the code
 * only supplies the few dynamic pieces.
 *
 * Placeholders the template understands:
 *  - `{senderPrefix}` — a line about the group speaker prefix, or empty;
 *  - `{media}` — the media tool + marker paragraph, or empty when the tool is off;
 *  - `{actions}` — the tool-disabled note, or the enabled action list.
 *
 * Every other line is plain prose the operator may rewrite. Keep the
 * placeholders if the dynamic parts matter; the renderer leaves an unknown
 * placeholder untouched rather than deleting text.
 */

/** The out-of-the-box template. */
export const DEFAULT_CHANNEL_PROMPT = [
  '## OneBot (QQ) channel',
  'You are talking to a user through a QQ chat bridged by OneBot 11.',
  '- QQ does not render Markdown. Answer in plain text; use numbered or dashed lists.',
  '- One reply turn produces ONE outgoing message: the plugin buffers your text blocks and sends them when the turn ends. Do not try to split a reply into several messages.',
  '- Incoming images, voices, videos and files appear as [图片] / [语音] / [视频] / [文件] placeholders. The plugin does not download them, so you cannot see their content; say so if the user asks about them.',
  '{senderPrefix}',
  '{media}',
  '{actions}',
  '- There is no Web approval card on this channel: do not call exit_plan_mode. Write any plan as plain text instead.',
].join('\n')

/** The placeholders the channel template documents. */
export const PROMPT_PLACEHOLDERS = Object.freeze(['{senderPrefix}', '{media}', '{actions}'])

/**
 * The default description of the `onebot_call` tool.
 *
 * `{enabledNote}` expands to the "only enabled actions are accepted" sentence
 * when the tool is on, and to nothing when it is off.
 */
export const DEFAULT_TOOL_CALL_PROMPT = 'Call one OneBot 11 action through the bridged gateway, for example send_group_msg, '
  + 'send_private_msg, get_group_info or set_group_ban. Use this to send images, files or any message that is not plain text. '
  + 'The action response comes back as JSON. {enabledNote}'

/** The default description of the `onebot_send_media` tool. */
export const DEFAULT_TOOL_MEDIA_PROMPT = 'Send an image, voice clip, video or file to the current QQ chat. '
  + 'Pass `path` for a local file (its bytes are sent inline), or `url`, or `base64`. '
  + 'Defaults to the chat this conversation is in; override with chatType and chatId.'

/** The default instruction for the lightweight steer/follow-up judge. */
export const DEFAULT_INTERJECT_PROMPT = 'You route a new QQ message for an assistant that may still be answering. '
  + 'Answer with exactly one word: STEER or FOLLOWUP. '
  + 'STEER means the message corrects, redirects, stops or urgently adds to the answer in progress, so it must reach the model at its next step. '
  + 'FOLLOWUP means it is a separate next request that can wait until the current answer finishes. '
  + 'When unsure, answer FOLLOWUP.'

/**
 * Every model-facing prompt, in the order the Prompt page shows them.
 *
 * This is the single registry: a new prompt added here appears on the page and
 * is persisted automatically. Each entry names the config field it reads, the
 * label key the page uses, the placeholders it understands, and its default.
 *
 * @typedef {{ id: string, field: string, labelKey: string, placeholders: string[], default: string }} PromptDef
 * @type {readonly PromptDef[]}
 */
export const PROMPT_DEFS = Object.freeze([
  Object.freeze({ id: 'channel', field: 'channelPrompt', labelKey: 'promptDefChannel', placeholders: PROMPT_PLACEHOLDERS, default: DEFAULT_CHANNEL_PROMPT }),
  Object.freeze({ id: 'toolCall', field: 'toolCallPrompt', labelKey: 'promptDefToolCall', placeholders: Object.freeze(['{enabledNote}']), default: DEFAULT_TOOL_CALL_PROMPT }),
  Object.freeze({ id: 'toolMedia', field: 'toolMediaPrompt', labelKey: 'promptDefToolMedia', placeholders: Object.freeze([]), default: DEFAULT_TOOL_MEDIA_PROMPT }),
  Object.freeze({ id: 'interject', field: 'interjectPrompt', labelKey: 'promptDefInterject', placeholders: Object.freeze([]), default: DEFAULT_INTERJECT_PROMPT }),
])

/**
 * The media paragraph, when sending media is available.
 * @returns the paragraph.
 */
export function mediaParagraph() {
  return '- To send an image, voice clip, video or file as its own message, call the onebot_send_media tool. '
    + 'To attach media to a reply message (so text and attachment arrive together), write a marker in your reply: '
    + '[[image:/abs/path.png]], [[record:/abs/a.wav]], [[video:/abs/a.mp4]] or [[file:/abs/a.zip]] — the path may also be an http(s) URL. '
    + 'The plugin replaces each marker with a real attachment. Only send media when the user asks for it.'
}

/** The speaker-prefix line. */
export function senderPrefixParagraph() {
  return '- Group messages are prefixed with [HH:MM nickname(QQ)] so you can tell speakers apart.'
}

/**
 * Fill a template, dropping lines whose placeholder expanded to nothing.
 *
 * A placeholder on its own line that yields no text would otherwise leave a
 * blank line behind, so empty expansions remove their line; repeated blank
 * lines are then collapsed.
 * @param template - the prompt template.
 * @param values - `{ senderPrefix, media, actions }` replacement text.
 * @returns the rendered prompt.
 */
export function renderPrompt(template, values) {
  let text = String(template ?? '')
  for (const key of ['senderPrefix', 'media', 'actions']) {
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
 * Fill the tool-call description.
 *
 * The enabled-actions sentence is dynamic (it disappears when the tool is off),
 * so it is a placeholder rather than baked into the editable text.
 * @param template - the configured description.
 * @param allow - the allowed action set from `computeAllowlist`, or null.
 * @returns the description to register on the tool.
 */
export function renderToolCallPrompt(template, allow) {
  const note = allow === null
    ? ''
    : 'Only the actions enabled in the OneBot-Mini settings are accepted; anything else is refused.'
  const text = String(template ?? '').trim() !== '' ? String(template) : DEFAULT_TOOL_CALL_PROMPT
  return text.replace(/\{enabledNote\}/g, note).replace(/\s+$/, '')
}
