/**
 * Minimal RFC 6455 WebSocket primitives.
 *
 * Hand-written on purpose: the plugin declares no dependencies, so it installs
 * the same way from a git URL, from a tarball, or as a `link:` to a local
 * checkout. The forward (outbound) direction reuses the platform's global
 * `WebSocket`; only the reverse (inbound) direction needs a server, which
 * `node:http` cannot provide by itself.
 *
 * Scope: text frames, close, ping/pong, continuation fragments. OneBot 11 sends
 * JSON text frames only, so binary frames are accepted and dropped.
 */

import { createHash } from 'node:crypto'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/** Opcodes this wire understands. */
const OP_CONT = 0x0
const OP_TEXT = 0x1
const OP_BINARY = 0x2
const OP_CLOSE = 0x8
const OP_PING = 0x9
const OP_PONG = 0xa

/**
 * Compute the `Sec-WebSocket-Accept` value for one client key.
 * @param key - the `Sec-WebSocket-Key` request header.
 * @returns the base64 accept token.
 */
export function acceptKey(key) {
  return createHash('sha1').update(key + GUID).digest('base64')
}

/**
 * Decode one frame from the head of a buffer.
 * @param buffer - accumulated bytes.
 * @returns the frame and the bytes it consumed, or `undefined` when incomplete.
 */
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

/**
 * XOR-unmask one payload with its 4-byte mask key.
 * @param payload - masked bytes.
 * @param mask - the 4-byte mask key.
 * @returns unmasked bytes.
 */
function unmask(payload, mask) {
  const out = Buffer.allocUnsafe(payload.length)
  for (let i = 0; i < payload.length; i += 1) out[i] = payload[i] ^ mask[i & 3]
  return out
}

/**
 * Encode one server-to-client text frame.
 * @param text - the UTF-8 text to send.
 * @returns the frame bytes.
 */
export function encodeText(text) {
  const payload = Buffer.from(text, 'utf8')
  const head = frameHead(OP_TEXT, payload.length)
  return Buffer.concat([head, payload])
}

/**
 * Encode one control frame (close / ping / pong) with no payload.
 * @param opcode - the control opcode.
 * @returns the frame bytes.
 */
export function encodeControl(opcode) {
  return frameHead(opcode, 0)
}

/**
 * Build the frame header for a FIN-set, unmasked server frame.
 * @param opcode - frame opcode.
 * @param length - payload byte count.
 * @returns header bytes.
 */
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

/**
 * One accepted server-side WebSocket connection.
 *
 * The wire owns fragment assembly, ping/pong answering and a single close
 * notification; callers only see text and close.
 */
export class ServerWire {
  /**
   * @param socket - the upgraded `net.Socket`.
   * @param options - `onText(text)`, `onClose(reason)`.
   */
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

  /**
   * Consume one chunk of incoming bytes.
   * @param chunk - raw socket data.
   */
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

  /**
   * Dispatch one decoded frame.
   * @param frame - decoded frame.
   */
  handleFrame(frame) {
    if (frame.opcode === OP_CLOSE) {
      this.sendControl(OP_CLOSE)
      this.finish('peer closed')
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
      // A handler failure must not tear down the transport silently.
    }
  }

  /**
   * Send one text frame.
   * @param text - UTF-8 payload.
   * @returns whether the socket accepted it.
   */
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

  /**
   * Send one empty control frame.
   * @param opcode - control opcode.
   */
  sendControl(opcode) {
    if (this.closed) return
    try {
      this.socket.write(encodeControl(opcode))
    } catch {
      // A closing socket cannot report this; finish() below handles the state.
    }
  }

  /**
   * Mark the wire closed, notify once and release the socket.
   * @param reason - short diagnostic reason.
   */
  finish(reason) {
    if (this.closed) return
    this.closed = true
    try {
      this.socket.end()
    } catch {
      // The socket may already be destroyed; nothing else to do.
    }
    try {
      this.onClose(reason)
    } catch {
      // Listener failures must not escape into the socket event loop.
    }
  }

  /**
   * Close from our side with a reason.
   * @param reason - short diagnostic reason.
   */
  close(reason = 'closed by host') {
    if (this.closed) return
    this.sendControl(OP_CLOSE)
    this.finish(reason)
  }
}
