/**
 * Voice → text through the OneBot gateway itself.
 *
 * NapCat exposes the `fetch_ptt_text` action (POST /fetch_ptt_text, body
 * `{ message_id }`) which returns QQ's own transcript for a voice message as
 * `{ text }`. This is the one clean, portable way to read voice: it is an action
 * on the gateway the plugin already talks to — no other plugin, no npm package,
 * no local model, no system `ffmpeg`. When the gateway lacks the action or
 * returns nothing, the caller simply keeps the plain `[语音: path]` placeholder;
 * nothing else in the message pipeline is affected.
 */

/**
 * Ask the gateway for the voice-to-text result of one message.
 * @param {{ call?: (action: string, params?: object) => Promise<any> }} connection - the live transport.
 * @param {string} messageId - the gateway message id of the voice message.
 * @param {{ log?: (note: string) => void }} [hooks] - optional diagnostics sink.
 * @returns {Promise<string>} the transcript, or '' when unavailable.
 */
export async function transcribeViaGateway(connection, messageId, hooks = {}) {
  const log = typeof hooks.log === 'function' ? hooks.log : () => {}
  const id = String(messageId ?? '').trim()
  if (id === '') return ''
  if (connection === null || connection === undefined || typeof connection.call !== 'function') return ''
  try {
    // The schema accepts a number or a string; send a number when it is numeric.
    const payload = { message_id: /^\d+$/.test(id) ? Number(id) : id }
    const data = await connection.call('fetch_ptt_text', payload)
    const text = data !== null && typeof data === 'object' && typeof data.text === 'string' ? data.text : ''
    const trimmed = text.trim()
    if (trimmed === '') log('gateway voice-to-text returned no text')
    return trimmed
  } catch (error) {
    log('gateway voice-to-text failed: ' + String(error?.message ?? error))
    return ''
  }
}
