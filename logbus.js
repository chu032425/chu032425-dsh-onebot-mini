/**
 * The live WebSocket log ring.
 *
 * One process-wide instance per plugin mount. Every transport, protocol and
 * bridge decision records one entry here; the log page polls for entries newer
 * than its cursor. The bus never throws: a full ring drops its oldest entry and
 * a malformed field is stringified.
 *
 * An optional file sink appends the same redacted entries as JSONL, which is the
 * only way to diagnose a channel whose traffic arrives before anyone opens the
 * log page (a gateway reconnecting at boot, for example).
 */

import { appendFile } from 'node:fs/promises'

/** Entry kinds the log page knows how to label. */
export const LOG_KINDS = [
  'connect',
  'disconnect',
  'reconnect',
  'send',
  'recv',
  'event',
  'error',
  'bridge',
]

/** Kinds that represent a failed or notable condition (rendered in warn color). */
export const LOG_WARN_KINDS = new Set(['disconnect', 'error'])

/**
 * Fields that must never reach the page or disk in the clear.
 * Matched case-insensitively against a key at any depth.
 */
const SECRET_KEYS = new Set(['access_token', 'accesstoken', 'token', 'authorization', 'secret', 'password'])

/**
 * Replace every secret-looking value with a marker.
 * @param value - any JSON-ish value.
 * @param depth - recursion guard.
 * @returns a detached redacted copy.
 */
export function redact(value, depth = 0) {
  if (depth > 6) return '[depth]'
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1))
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    out[key] = SECRET_KEYS.has(key.toLowerCase()) ? '[redacted]' : redact(item, depth + 1)
  }
  return out
}

/**
 * Bound one message preview so a long QQ message does not flood the ring.
 * @param text - raw text.
 * @param limit - maximum code points kept.
 * @returns the preview string.
 */
export function preview(text, limit = 60) {
  const chars = Array.from(String(text ?? ''))
  const head = chars.slice(0, limit).join('').replace(/\s+/g, ' ')
  return chars.length > limit ? head + '…' : head
}

/** A bounded, cursor-addressable log of connection and protocol activity. */
export class LogBus {
  /**
   * @param options - `capacity` (entries kept) and `messagePreview` (whether
   * message bodies contribute a text preview).
   */
  constructor({ capacity = 500, messagePreview = true, file = '' } = {}) {
    this.capacity = Math.max(50, Math.min(5000, Math.trunc(capacity) || 500))
    this.messagePreview = messagePreview !== false
    this.entries = []
    this.nextSeq = 1
    /** Absolute JSONL path, or '' when file logging is off. */
    this.file = typeof file === 'string' ? file : ''
    /** Pending append chain so entries keep their order without blocking callers. */
    this.writes = Promise.resolve()
  }

  /**
   * Apply live page settings without dropping existing entries.
   * @param options - `capacity`, `messagePreview`.
   */
  configure({ capacity, messagePreview } = {}) {
    if (typeof capacity === 'number') this.capacity = Math.max(50, Math.min(5000, Math.trunc(capacity) || 500))
    if (typeof messagePreview === 'boolean') this.messagePreview = messagePreview
    this.trim()
  }

  /**
   * Append one entry.
   * @param kind - one of `LOG_KINDS`.
   * @param fields - additional JSON fields; secrets are redacted.
   * @returns the stored entry.
   */
  record(kind, fields = {}) {
    let safe
    try {
      safe = redact(fields)
    } catch {
      safe = { note: 'fields unreadable' }
    }
    const entry = { seq: this.nextSeq, ts: Date.now(), kind, ...safe }
    this.nextSeq += 1
    this.entries.push(entry)
    this.trim()
    this.appendToFile(entry)
    return entry
  }

  /**
   * Append one entry to the file sink, if configured.
   *
   * Failures are swallowed on purpose: a read-only or full disk must not change
   * how the channel behaves.
   * @param entry - the entry already stored in the ring.
   */
  appendToFile(entry) {
    if (this.file === '') return
    const line = JSON.stringify(entry) + '\n'
    this.writes = this.writes
      .then(() => appendFile(this.file, line, 'utf8'))
      .catch(() => undefined)
  }

  /** Drop the oldest entries beyond the capacity. */
  trim() {
    const excess = this.entries.length - this.capacity
    if (excess > 0) this.entries.splice(0, excess)
  }

  /**
   * Read entries newer than a cursor.
   * @param after - last seq the caller has seen (0 = from the oldest retained).
   * @param limit - maximum entries returned.
   * @returns `{ entries, nextSeq, oldestSeq }`.
   */
  snapshot(after = 0, limit = 200) {
    const cursor = Number.isFinite(after) ? after : 0
    const bounded = Math.max(1, Math.min(1000, Math.trunc(limit) || 200))
    const visible = this.entries.filter((entry) => entry.seq > cursor)
    const entries = visible.length > bounded ? visible.slice(visible.length - bounded) : visible
    return {
      entries,
      nextSeq: entries.length > 0 ? entries[entries.length - 1].seq : cursor,
      oldestSeq: this.entries.length > 0 ? this.entries[0].seq : this.nextSeq,
    }
  }

  /** Forget every retained entry, keeping the cursor monotonic. */
  clear() {
    this.entries = []
  }

  /** Current retained entry count (diagnostics). */
  get size() {
    return this.entries.length
  }
}
