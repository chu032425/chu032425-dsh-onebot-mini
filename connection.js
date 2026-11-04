/**
 * The OneBot 11 transport: reverse (NapCat dials in) or forward (we dial out).
 *
 * Everything the transport observes lands in the log bus, so the log page can
 * show connection state, every action sent, every response received and every
 * pushed event without instrumenting the rest of the plugin.
 *
 * OneBot 11 contract this relies on: every action carries a client-generated
 * `echo`, the response repeats it, and `status`/`retcode` say whether the action
 * succeeded. Anything else is treated as a pushed event.
 */

import { createServer } from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { acceptKey, ServerWire } from './wire.js'

/** Reconnect ladder in milliseconds; the last value repeats. */
const BACKOFF_MS = [2000, 5000, 10000, 30000, 60000]

/** A rejected action: the gateway answered `status: failed` or a non-zero retcode. */
export class OneBotActionError extends Error {
  constructor(message, { action, retcode, wording } = {}) {
    super(message)
    this.name = 'OneBotActionError'
    this.action = action
    this.retcode = retcode
    this.wording = wording
  }
}

/** An action that never completed: the link is down or the response timed out. */
export class OneBotTransportError extends Error {
  constructor(message) {
    super(message)
    this.name = 'OneBotTransportError'
  }
}

/**
 * Constant-time comparison that tolerates different lengths.
 * @param a - candidate token.
 * @param b - expected token.
 * @returns whether they match.
 */
function tokensEqual(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8')
  const right = Buffer.from(String(b ?? ''), 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * The transport. Construct with the resolved config and the log bus, then
 * `start()` from the plugin effect and `stop()` from its disposer.
 */
export class OneBotConnection {
  /**
   * @param options - `config`, `log` (LogBus), `describeError`.
   */
  constructor({ config, log }) {
    this.config = config
    this.log = log

    /** Called with every pushed (non-response) event frame. */
    this.onEvent = () => {}
    /** Called with `'online' | 'offline' | 'connecting'` transitions. */
    this.onState = () => {}

    /** The bot's own account id, learned from a meta event when not configured. */
    this.selfId = String(config.botQQ ?? '')
    this.state = 'offline'
    this.address = ''
    this.onlineSince = 0

    this.server = undefined
    this.wire = undefined
    this.socket = undefined
    this.pending = new Map()
    this.attempt = 0
    this.reconnectTimer = undefined
    this.stopping = false
    /** True while a replacement dial-in is retiring the previous socket. */
    this.superseding = false
  }

  /**
   * Open the transport according to `config.mode`.
   * @returns resolution once the first connection attempt settled.
   */
  async start() {
    this.stopping = false
    if (this.config.mode === 'reverse') return this.startReverse()
    this.startForward()
    return undefined
  }

  /**
   * Bind the reverse listener. A missing token refuses to start (fail-closed):
   * an open reverse port lets anyone on the network drive the bot.
   * @returns resolution once the listener is bound.
   */
  async startReverse() {
    const token = String(this.config.accessToken ?? '')
    if (token.trim() === '') {
      this.log.record('error', { note: 'reverse mode refused: accessToken is empty' })
      throw new Error('dsh-onebot-mini: reverse mode requires accessToken')
    }
    const host = String(this.config.host || '127.0.0.1')
    const port = Number(this.config.port)
    this.setState('connecting')

    const server = createServer((req, res) => {
      res.statusCode = 404
      res.end()
    })
    this.server = server

    server.on('upgrade', (req, socket, head) => {
      const url = String(req.url ?? '')
      if (!url.startsWith('/')) {
        socket.destroy()
        return
      }
      const header = String(req.headers.authorization ?? '')
      const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
      const queryToken = new URL(url, 'http://localhost').searchParams.get('access_token') ?? ''
      const candidate = bearer !== '' ? bearer : queryToken
      if (!tokensEqual(candidate, token)) {
        this.log.record('error', { note: 'reverse upgrade rejected: bad access token' })
        socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')
        return
      }
      const key = String(req.headers['sec-websocket-key'] ?? '')
      if (key === '') {
        socket.destroy()
        return
      }
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n'
        + 'Upgrade: websocket\r\n'
        + 'Connection: Upgrade\r\n'
        + 'Sec-WebSocket-Accept: ' + acceptKey(key) + '\r\n\r\n',
      )
      if (head !== undefined && head.length > 0) socket.unshift(head)
      this.adoptReverse(socket, req)
    })

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off('listening', onListening)
        this.log.record('error', { note: 'reverse listener failed: ' + error.message, port })
        reject(error)
      }
      const onListening = () => {
        server.off('error', onError)
        this.address = host + ':' + port
        this.log.record('bridge', { note: 'reverse listener bound', host, port })
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, host)
    })
  }

  /**
   * Accept one reverse client. A newer connection supersedes the previous one:
   * NapCat reconnects without closing cleanly, and two live sockets would
   * duplicate every send.
   * @param socket - the upgraded socket.
   * @param req - the upgrade request (for the remote address).
   */
  adoptReverse(socket, req) {
    const remote = String(req.socket?.remoteAddress ?? 'unknown')
    const previous = this.wire
    if (previous !== undefined) {
      this.log.record('bridge', { note: 'replacing previous reverse connection', remote })
      // Detach first: the outgoing socket's close must not report the link as
      // offline a moment before the replacement comes online.
      this.wire = undefined
      this.superseding = true
      try {
        previous.close('superseded')
      } finally {
        this.superseding = false
      }
    }
    this.attach(socket, remote, 'reverse')
  }

  /**
   * Dial out to the gateway.
   */
  startForward() {
    if (this.stopping) return
    const url = String(this.config.url)
    this.setState('connecting')
    const Socket = globalThis.WebSocket
    if (typeof Socket !== 'function') {
      this.log.record('error', { note: 'this Node build has no global WebSocket; forward mode unavailable' })
      return
    }
    const headers = this.config.accessToken.trim() !== ''
      ? { authorization: 'Bearer ' + this.config.accessToken }
      : undefined
    let ws
    try {
      ws = headers === undefined ? new Socket(url) : new Socket(url, headers)
    } catch (error) {
      this.log.record('error', { note: 'forward dial failed: ' + String(error?.message ?? error), url })
      this.scheduleReconnect()
      return
    }
    this.socket = ws
    this.address = url
    ws.addEventListener('open', () => {
      this.attempt = 0
      this.attachForward(ws, url)
    })
    ws.addEventListener('error', () => {
      this.log.record('error', { note: 'forward socket error', url })
    })
    ws.addEventListener('close', (event) => {
      this.failPending('link closed')
      this.setState('offline')
      this.log.record('disconnect', { mode: 'forward', code: event?.code, reason: event?.reason ?? '', url })
      this.scheduleReconnect()
    })
  }

  /**
   * Wire one inbound socket into the transport.
   * @param socket - upgraded socket.
   * @param remote - remote address for the log.
   * @param mode - `reverse`.
   */
  attach(socket, remote, mode) {
    const wire = new ServerWire(socket, {
      onText: (text) => this.onFrameText(text),
      onClose: (reason) => this.onWireClosed(reason, remote),
    })
    this.wire = wire
    this.markOnline(mode, remote)
  }

  /**
   * Wire one outbound socket into the transport.
   * @param ws - the open client socket.
   * @param url - the gateway URL for the log.
   */
  attachForward(ws, url) {
    this.wire = {
      send: (text) => {
        try {
          ws.send(text)
          return true
        } catch {
          return false
        }
      },
      close: () => {
        try {
          ws.close()
        } catch {
          // Already closing.
        }
      },
    }
    ws.addEventListener('message', (event) => {
      const data = event?.data
      if (typeof data === 'string') {
        this.onFrameText(data)
        return
      }
      if (data !== undefined && data !== null && typeof data.text === 'function') {
        void data.text().then((text) => this.onFrameText(text)).catch(() => undefined)
      }
    })
    this.markOnline('forward', url)
  }

  /**
   * Announce a live link and reset the reconnect ladder.
   * @param mode - connection mode.
   * @param address - remote or URL.
   */
  markOnline(mode, address) {
    this.attempt = 0
    this.onlineSince = Date.now()
    this.setState('online')
    this.log.record('connect', { mode, address })
  }

  /**
   * Handle one closed inbound wire.
   * @param reason - close reason.
   * @param remote - remote address.
   */
  onWireClosed(reason, remote) {
    if (this.superseding) return
    this.wire = undefined
    this.failPending('link closed')
    this.setState('offline')
    this.log.record('disconnect', { mode: 'reverse', reason, remote })
    // A reverse listener keeps listening; the next dial-in is a new connect.
  }

  /**
   * Publish a state transition once.
   * @param next - the new state.
   */
  setState(next) {
    if (this.state === next) return
    this.state = next
    if (next !== 'online') this.onlineSince = 0
    try {
      this.onState(next)
    } catch {
      // Observers must not break the transport.
    }
  }

  /**
   * Reject every in-flight action after a link loss.
   * @param reason - diagnostic reason.
   */
  failPending(reason) {
    if (this.pending.size === 0) return
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const item of pending) {
      clearTimeout(item.timer)
      item.reject(new OneBotTransportError(reason))
    }
  }

  /**
   * Schedule the next forward dial.
   */
  scheduleReconnect() {
    if (this.stopping || this.config.mode !== 'forward') return
    if (this.reconnectTimer !== undefined) return
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]
    this.attempt += 1
    this.log.record('reconnect', { attempt: this.attempt, delayMs: delay })
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      if (this.stopping) return
      this.startForward()
    }, delay)
    if (typeof this.reconnectTimer.unref === 'function') this.reconnectTimer.unref()
  }

  /**
   * Decode and dispatch one text frame.
   * @param text - raw JSON text.
   */
  onFrameText(text) {
    let frame
    try {
      frame = JSON.parse(text)
    } catch {
      this.log.record('error', { note: 'unparsable frame', preview: text.slice(0, 120) })
      return
    }
    if (frame === null || typeof frame !== 'object') return

    if (typeof frame.echo === 'string' && this.pending.has(frame.echo)) {
      const item = this.pending.get(frame.echo)
      this.pending.delete(frame.echo)
      clearTimeout(item.timer)
      const ok = frame.status === 'ok' || frame.status === 'async' || frame.retcode === 0
      this.log.record('recv', {
        action: item.action,
        retcode: frame.retcode,
        status: frame.status,
        ms: Date.now() - item.startedAt,
      })
      if (ok) item.resolve(frame.data ?? {})
      else item.reject(new OneBotActionError(
        String(frame.wording ?? frame.message ?? 'action failed'),
        { action: item.action, retcode: frame.retcode, wording: frame.wording },
      ))
      return
    }

    if (typeof frame.post_type === 'string') {
      if (typeof frame.self_id === 'number' || typeof frame.self_id === 'string') {
        const learned = String(frame.self_id)
        if (this.selfId !== learned) {
          this.selfId = learned
          this.log.record('bridge', { note: 'learned bot account', selfId: learned })
        }
      }
      this.log.record('event', {
        post_type: frame.post_type,
        detail: eventDetail(frame, this.log.messagePreview),
      })
      try {
        this.onEvent(frame)
      } catch (error) {
        this.log.record('error', { note: 'event handler failed: ' + String(error?.message ?? error) })
      }
      return
    }

    this.log.record('event', { post_type: 'unknown', detail: previewOf(frame) })
  }

  /**
   * Call one OneBot action and await its response.
   * @param action - action name, e.g. `send_msg`.
   * @param params - action parameters.
   * @returns the action's `data` object.
   */
  async call(action, params = {}) {
    if (this.state !== 'online' || this.wire === undefined) {
      throw new OneBotTransportError('link is ' + this.state)
    }
    const echo = randomUUID()
    const startedAt = Date.now()
    const body = JSON.stringify({ action, params, echo })
    this.log.record('send', { action, params, echo })
    const promise = new Promise((resolve, reject) => {
      const timeoutMs = Number(this.config.sendTimeoutMs) || 30000
      const timer = setTimeout(() => {
        this.pending.delete(echo)
        this.log.record('error', { note: 'action timed out', action, timeoutMs })
        reject(new OneBotTransportError(action + ' timed out after ' + timeoutMs + 'ms'))
      }, timeoutMs)
      if (typeof timer.unref === 'function') timer.unref()
      this.pending.set(echo, { action, resolve, reject, timer, startedAt })
    })
    if (!this.wire.send(body)) {
      const item = this.pending.get(echo)
      if (item !== undefined) {
        this.pending.delete(echo)
        clearTimeout(item.timer)
        item.reject(new OneBotTransportError('write failed'))
      }
    }
    return promise
  }

  /**
   * Send one plain text message to a chat.
   * @param chat - `{ kind: 'private'|'group', id: string }`.
   * @param text - message body.
   * @returns the gateway's response data.
   */
  sendText(chat, text) {
    const message = [{ type: 'text', data: { text } }]
    if (chat.kind === 'group') {
      return this.call('send_group_msg', { group_id: Number(chat.id), message })
    }
    return this.call('send_private_msg', { user_id: Number(chat.id), message })
  }

  /**
   * Current transport status for the log page header.
   * @returns a detached status object.
   */
  status() {
    return {
      state: this.state,
      mode: this.config.mode,
      address: this.address,
      selfId: this.selfId,
      onlineSince: this.onlineSince,
      pendingActions: this.pending.size,
      reconnectAttempt: this.attempt,
    }
  }

  /**
   * Close the listener, the socket and every pending action.
   */
  async stop() {
    this.stopping = true
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
    this.failPending('plugin stopped')
    if (this.wire !== undefined) {
      this.wire.close('plugin stopped')
      this.wire = undefined
    }
    if (this.socket !== undefined) {
      try {
        this.socket.close()
      } catch {
        // Already closed.
      }
      this.socket = undefined
    }
    if (this.server !== undefined) {
      const server = this.server
      this.server = undefined
      await new Promise((resolve) => server.close(() => resolve(undefined)))
    }
    this.setState('offline')
  }
}

/**
 * Summarize one pushed event for the log page.
 * @param frame - the OneBot event frame.
 * @param withPreview - whether message bodies contribute a text preview.
 * @returns a short, redaction-safe detail object.
 */
function eventDetail(frame, withPreview) {
  const detail = { message_type: frame.message_type ?? frame.notice_type ?? frame.request_type ?? '' }
  if (typeof frame.user_id !== 'undefined') detail.user_id = frame.user_id
  if (typeof frame.group_id !== 'undefined') detail.group_id = frame.group_id
  if (withPreview !== false && frame.post_type === 'message') {
    detail.text = previewOf(frame)
  }
  return detail
}

/**
 * Extract the leading text of a message event or action frame.
 * @param frame - any frame carrying `message` or `raw_message`.
 * @returns a bounded preview string.
 */
function previewOf(frame) {
  const raw = frame.raw_message ?? frame.message
  if (typeof raw === 'string') {
    const chars = Array.from(raw)
    return chars.slice(0, 60).join('') + (chars.length > 60 ? '…' : '')
  }
  if (Array.isArray(raw)) {
    const text = raw
      .filter((seg) => seg !== null && typeof seg === 'object' && seg.type === 'text')
      .map((seg) => String(seg?.data?.text ?? ''))
      .join('')
    const chars = Array.from(text)
    return chars.slice(0, 60).join('') + (chars.length > 60 ? '…' : '')
  }
  return ''
}
