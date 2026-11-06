/** 最小可用的 RFC 6455 WebSocket 原语。
 * 刻意手写：插件不声明任何依赖，所以从 git URL、tarball 或 `link:` 本地目录安装
 * 时行为一致。forward（出站）方向复用平台全局 `WebSocket`；只有 reverse（入站）
 * 方向需要服务端，而 `node:http` 本身提供不了。
 * 覆盖范围：文本帧、关闭帧、ping/pong、续帧分片。OneBot 11 只发 JSON 文本帧，
 * 因此二进制帧接受后直接丢弃。 */

import { createHash } from 'node:crypto'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/** 本 wire 认识的 opcode。 */
const OP_CONT = 0x0
const OP_TEXT = 0x1
const OP_BINARY = 0x2
const OP_CLOSE = 0x8
const OP_PING = 0x9
const OP_PONG = 0xa

/** 计算某个客户端 key 对应的 `Sec-WebSocket-Accept` 值。
 * @param key - `Sec-WebSocket-Key` 请求头。
 * @returns base64 的 accept 令牌。 */
export function acceptKey(key) {
  return createHash('sha1').update(key + GUID).digest('base64')
}

/** 从缓冲区头部解码一个帧。
 * @param buffer - 已累积的字节。
 * @returns 帧与其消耗的字节数；数据不完整时返回 `undefined`。 */
export function takeFrame(buffer) {
  if (buffer.length < 2) return undefined
  const fin = (buffer[0] & 0x80) !== 0
  const opcode = buffer[0] & 0x0f
  const masked = (buffer[1] & 0x80) !== 0
  let length = buffer[1] & 0x7f
  let offset = 2

  if (length === 126) {
    if (buffer.length < 4) return undefined
    length = buffer.readUInt16BE(2)
    offset = 4
  } else if (length === 127) {
    if (buffer.length < 10) return undefined
    length = Number(buffer.readBigUInt64BE(2))
    offset = 10
  }

  let mask
  if (masked) {
    if (buffer.length < offset + 4) return undefined
    mask = buffer.subarray(offset, offset + 4)
    offset += 4
  }

  if (buffer.length < offset + length) return undefined
  const payload = buffer.subarray(offset, offset + length)
  const data = masked ? unmask(payload, mask) : Buffer.from(payload)
  return { fin, opcode, data, consumed: offset + length }
}

/** 用 4 字节掩码键对载荷做 XOR 解掩。
 * @param payload - 带掩码的字节。
 * @param mask - 4 字节掩码键。
 * @returns 解掩后的字节。 */
function unmask(payload, mask) {
  const out = Buffer.allocUnsafe(payload.length)
  for (let i = 0; i < payload.length; i += 1) out[i] = payload[i] ^ mask[i & 3]
  return out
}

/** 编码一个服务端到客户端的文本帧。
 * @param text - 要发送的 UTF-8 文本。
 * @returns 帧字节。 */
export function encodeText(text) {
  const payload = Buffer.from(text, 'utf8')
  const head = frameHead(OP_TEXT, payload.length)
  return Buffer.concat([head, payload])
}

/** 编码一个无载荷的控制帧（关闭 / ping / pong）。
 * @param opcode - 控制帧 opcode。
 * @returns 帧字节。 */
export function encodeControl(opcode) {
  return frameHead(opcode, 0)
}

/** 构造 FIN 置位、不带掩码的服务端帧头。
 * @param opcode - 帧 opcode。
 * @param length - 载荷字节数。
 * @returns 帧头字节。 */
function frameHead(opcode, length) {
  const head = []
  head.push(0x80 | opcode)
  if (length < 126) {
    head.push(length)
  } else if (length < 65536) {
    head.push(126)
    const b = Buffer.alloc(2)
    b.writeUInt16BE(length)
    head.push(b)
  } else {
    head.push(127)
    const b = Buffer.alloc(8)
    b.writeBigUInt64BE(BigInt(length))
    head.push(b)
  }
  return Buffer.concat(head.map((item) => (Buffer.isBuffer(item) ? item : Buffer.from([item]))))
}

/** 一个已接受的服务端 WebSocket 连接。
 * 分片拼装、ping/pong 应答与唯一一次关闭通知都由 wire 负责，调用方只看到文本
 * 与关闭事件。 */
export class ServerWire {
  /** @param socket - 已 upgrade 的 `net.Socket`。
 * @param options - 回调：收到文本时调 `onText`，关闭时调 `onClose`。 */
  constructor(socket, { onText, onClose }) {
    this.socket = socket
    this.onText = onText
    this.onClose = onClose
    this.buffer = Buffer.alloc(0)
    this.fragments = []
    this.fragmentOpcode = 0
    this.closed = false

    socket.setNoDelay(true)
    socket.on('data', (chunk) => this.feed(chunk))
    socket.on('error', (error) => this.finish('socket error: ' + error.message))
    socket.on('close', () => this.finish('socket closed'))
  }

  /** 消费一段传入字节。
 * @param chunk - 原始 socket 数据。 */
  feed(chunk) {
    if (this.closed) return
    this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk])
    for (;;) {
      const frame = takeFrame(this.buffer)
      if (frame === undefined) return
      this.buffer = this.buffer.subarray(frame.consumed)
      this.handleFrame(frame)
      if (this.closed) return
    }
  }

  /** 分发一个已解码的帧。
 * @param frame - 解码后的帧。 */
  handleFrame(frame) {
    if (frame.opcode === OP_CLOSE) {
      // 对端先关：回一个关闭帧再收尾，与主动关闭共用同一序列。
      this.shutdown('peer closed')
      return
    }
    if (frame.opcode === OP_PING) {
      this.sendControl(OP_PONG)
      return
    }
    if (frame.opcode === OP_PONG) return
    if (frame.opcode === OP_BINARY) return

    if (frame.opcode === OP_CONT) {
      this.fragments.push(frame.data)
    } else {
      this.fragments = [frame.data]
      this.fragmentOpcode = frame.opcode
    }
    if (!frame.fin) return

    const merged = Buffer.concat(this.fragments)
    this.fragments = []
    if (this.fragmentOpcode !== OP_TEXT) return
    const text = merged.toString('utf8')
    try {
      this.onText(text)
    } catch {
      // 处理器异常不得悄悄拆掉传输层。
    }
  }

  /** 发送一个文本帧。
 * @param text - UTF-8 载荷。
 * @returns socket 是否接受了这次写入。 */
  send(text) {
    if (this.closed) return false
    try {
      this.socket.write(encodeText(text))
      return true
    } catch {
      this.finish('write failed')
      return false
    }
  }

  /** 发送一个空控制帧。
 * @param opcode - 控制帧 opcode。 */
  sendControl(opcode) {
    if (this.closed) return
    try {
      this.socket.write(encodeControl(opcode))
    } catch {
      // 正在关闭的 socket 报不出这个错误；状态由下面的 finish() 收尾。
    }
  }

  /** 回关闭帧后收尾（主动关闭与对端关闭共用的唯一序列）。
 * @param reason - 简短的诊断原因。 */
  shutdown(reason) {
    if (this.closed) return
    this.sendControl(OP_CLOSE)
    this.finish(reason)
  }

  /** 标记 wire 已关闭，只通知一次，并释放 socket。
 * @param reason - 简短的诊断原因。 */
  finish(reason) {
    if (this.closed) return
    this.closed = true
    try {
      this.socket.end()
    } catch {
      // socket 可能已被销毁，无事可做。
    }
    try {
      this.onClose(reason)
    } catch {
      // 监听器异常不得逃逸到 socket 事件循环。
    }
  }

  /** 从本端带原因关闭。
 * @param reason - 简短的诊断原因。 */
  close(reason = 'closed by host') {
    this.shutdown(reason)
  }
}
