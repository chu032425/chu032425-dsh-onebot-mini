/** OneBot 11 传输层：reverse（NapCat 主动拨入）或 forward（本端拨出）。
 * 传输层观察到的一切都写进日志总线，因此日志页能显示连接状态、每个发出的动作、
 * 每个收到的响应和每个推送事件，而不需要给插件其余部分加埋点。
 * 依赖的 OneBot 11 契约：每个动作带一个客户端生成的 `echo`，响应原样回传，由
 * `status`/`retcode` 判断成败。其余帧一律当作推送事件。 */

import { createServer } from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { acceptKey, ServerWire } from './wire.js'
import { preview } from './logbus.js'

/** 重连退避阶梯（毫秒）；最后一档重复使用。 */
const BACKOFF_MS = [2000, 5000, 10000, 30000, 60000]

/** 动作被拒：网关回了 `status: failed` 或非零 retcode。 */
export class OneBotActionError extends Error {
  constructor(message, { retcode } = {}) {
    super(message)
    this.name = 'OneBotActionError'
    this.retcode = retcode
  }
}

/** 动作没能完成：链路已断或响应超时。 */
export class OneBotTransportError extends Error {
  constructor(message) {
    super(message)
    this.name = 'OneBotTransportError'
  }
}

/** 长度不敏感时也安全的常数时间比较。
 * @param a - 待验证的令牌。
 * @param b - 期望的令牌。
 * @returns 是否匹配。 */
function tokensEqual(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8')
  const right = Buffer.from(String(b ?? ''), 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/** 传输层。用解析后的配置与日志总线构造，在插件 effect 里 `start()`、在
 * disposer 里 `stop()`。 */
export class OneBotConnection {
  /** @param options - `config` 与 `log`（LogBus）。
 * @param options - `config` 与 `log`（LogBus）。 */
  constructor({ config, log }) {
    this.config = config
    this.log = log

    /** 每个推送（非响应）事件帧都会调用。 */
    this.onEvent = () => {}
    /** 状态迁移（`'online' | 'offline' | 'connecting'`）时调用。 */
    this.onState = () => {}
    /** 每学到一次机器人账号 id 调用一次。 */
    this.onLearnSelfId = () => {}

    /** 机器人自己的账号 id；未配置时由 meta 事件学到。 */
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
    /** 为真时表示新的拨入正在顶替上一个 socket。 */
    this.superseding = false
  }

  /** 按 `config.mode` 打开传输层。
 * @returns 首次连接尝试落定后 resolve。 */
  async start() {
    this.stopping = false
    if (this.config.mode === 'reverse') return this.startReverse()
    this.startForward()
    return undefined
  }

  /** 绑定 reverse 监听。缺少令牌时拒绝启动（fail-closed）：敞开的 reverse 端口
 * 等于让网络里任何人都能驱动这个机器人。
 * @returns 监听绑定后 resolve。 */
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

  /** 接受一个 reverse 客户端。更新的连接顶替上一个：NapCat 重连时并不干净地关闭
 * 旧连接，两条活着的 socket 会让每个发送重复一遍。
 * @param socket - 已 upgrade 的 socket。
 * @param req - upgrade 请求（用于远端地址）。 */
  adoptReverse(socket, req) {
    const remote = String(req.socket?.remoteAddress ?? 'unknown')
    const previous = this.wire
    if (previous !== undefined) {
      this.log.record('bridge', { note: 'replacing previous reverse connection', remote })
      // 先摘除引用：旧 socket 的 close 不能在替换者上线前一刻把链路报成 offline。
      this.wire = undefined
      this.superseding = true
      try {
        previous.close('superseded')
      } finally {
        this.superseding = false
      }
    }
    this.attach(socket, remote)
  }

  /** 向网关拨出。
 * 向网关拨出。 */
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

  /** 把一个入站 socket 接进传输层。
 * @param socket - 已 upgrade 的 socket。
 * @param remote - 远端地址，供日志用。 */
  attach(socket, remote) {
    const wire = new ServerWire(socket, {
      onText: (text) => this.onFrameText(text),
      onClose: (reason) => this.onWireClosed(reason, remote),
    })
    this.wire = wire
    this.markOnline('reverse', remote)
  }

  /** 把一个出站 socket 接进传输层。
 * @param ws - 已打开的客户端 socket。
 * @param url - 网关 URL，供日志用。 */
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
          // 已经在关闭中。
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

  /** 宣告链路可用并重置重连阶梯。
 * @param mode - 连接模式。
 * @param address - 远端地址或 URL。 */
  markOnline(mode, address) {
    this.attempt = 0
    this.onlineSince = Date.now()
    this.setState('online')
    this.log.record('connect', { mode, address })
  }

  /** 处理一个关闭的入站 wire。
 * @param reason - 关闭原因。
 * @param remote - 远端地址。 */
  onWireClosed(reason, remote) {
    if (this.superseding) return
    this.wire = undefined
    this.failPending('link closed')
    this.setState('offline')
    this.log.record('disconnect', { mode: 'reverse', reason, remote })
    // reverse 监听继续在听；下一次拨入是一次新的 connect。
  }

  /** 发布一次状态迁移。
 * @param next - 新状态。 */
  setState(next) {
    if (this.state === next) return
    this.state = next
    if (next !== 'online') this.onlineSince = 0
    try {
      this.onState(next)
    } catch {
      // 观察者异常不得打断传输层。
    }
  }

  /** 结清一个在途动作：从 pending 里摘除、停掉超时定时器、按原因 reject。
 * @param echo - 该动作的 echo。
 * @param reason - 失败原因。
 * @returns 是否真的结清了一个条目。 */
  settlePending(echo, reason) {
    const item = this.pending.get(echo)
    if (item === undefined) return false
    this.pending.delete(echo)
    clearTimeout(item.timer)
    item.reject(new OneBotTransportError(reason))
    return true
  }

  /** 链路断开后拒绝所有在途动作。
 * @param reason - 诊断原因。 */
  failPending(reason) {
    if (this.pending.size === 0) return
    for (const echo of [...this.pending.keys()]) this.settlePending(echo, reason)
  }

  /** 安排下一次 forward 拨号。
 * 安排下一次 forward 拨号。 */
  scheduleReconnect() {
    if (this.stopping) return
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

  /** 解码并分发一个文本帧。
 * @param text - 原始 JSON 文本。 */
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
        { retcode: frame.retcode },
      ))
      return
    }

    if (typeof frame.post_type === 'string') {
      if (typeof frame.self_id === 'number' || typeof frame.self_id === 'string') {
        const learned = String(frame.self_id)
        if (this.selfId !== learned) {
          const previous = this.selfId
          this.selfId = learned
          this.log.record('bridge', { note: 'learned bot account', selfId: learned, previous })
          try {
            this.onLearnSelfId(learned)
          } catch {
            // 监听器异常不得打断帧处理。
          }
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

    this.log.record('event', { post_type: 'unknown', detail: preview(frameText(frame)) })
  }

  /** 调用一个 OneBot 动作并等待其响应。
 * @param action - 动作名，例如 `send_msg`。
 * @param params - 动作参数。
 * @returns 动作的 `data` 对象。 */
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
        this.log.record('error', { note: 'action timed out', action, timeoutMs })
        this.settlePending(echo, action + ' timed out after ' + timeoutMs + 'ms')
      }, timeoutMs)
      if (typeof timer.unref === 'function') timer.unref()
      this.pending.set(echo, { action, resolve, reject, timer, startedAt })
    })
    if (!this.wire.send(body)) {
      this.settlePending(echo, 'write failed')
    }
    return promise
  }

  /** 向一个聊天发送纯文本消息。
 * @param chat - 聊天引用：`kind` 为 private/group，`id` 为字符串。
 * @param text - 消息正文。
 * @returns 网关的响应数据。 */
  sendText(chat, text) {
    return this.sendMessage(chat, [{ type: 'text', data: { text } }])
  }

  /** 发送一条完整消息：一段有序的 OneBot 段列表。
 * 同时含文本与媒体的回复会拼成一条多段消息，让说明和图片一起到达，而不是分成
 * 两次发送。
 * @param chat - 聊天引用：`kind` 为 private/group，`id` 为字符串。
 * @param message - 段数组。
 * @returns 网关的响应数据。 */
  sendMessage(chat, message) {
    const segments = Array.isArray(message) ? message : []
    if (chat.kind === 'group') {
      return this.call('send_group_msg', { group_id: Number(chat.id), message: segments })
    }
    return this.call('send_private_msg', { user_id: Number(chat.id), message: segments })
  }

  /** 供日志页头部显示的当前传输状态。
 * @returns 一份脱离内部引用的状态对象。 */
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

  /** 关闭监听、socket 以及所有在途动作。
 * 关闭监听、socket 以及所有在途动作。 */
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
        // 已经关闭。
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

/** 提取一个帧里的正文文本（数组段先拼成文本）。
 * @param frame - 任意带 `message` 或 `raw_message` 的帧。
 * @returns 拼接后的文本；没有正文时返回空串。 */
function frameText(frame) {
  const raw = frame.raw_message ?? frame.message
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) {
    return raw
      .filter((seg) => seg !== null && typeof seg === 'object' && seg.type === 'text')
      .map((seg) => String(seg?.data?.text ?? ''))
      .join('')
  }
  return ''
}

/** 为日志页压缩一个推送事件。
 * @param frame - OneBot 事件帧。
 * @param withPreview - 正文是否贡献一段文本预览。
 * @returns 一段简短、可脱敏的摘要。 */
function eventDetail(frame, withPreview) {
  const detail = { message_type: frame.message_type ?? frame.notice_type ?? frame.request_type ?? '' }
  if (typeof frame.user_id !== 'undefined') detail.user_id = frame.user_id
  if (typeof frame.group_id !== 'undefined') detail.group_id = frame.group_id
  if (withPreview !== false && frame.post_type === 'message') {
    detail.text = preview(frameText(frame))
  }
  return detail
}
