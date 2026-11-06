/**
 * 在线 WebSocket 日志环。
 *
 * 每次插件挂载一个进程内实例。传输、协议与桥接的每个决策都记一条，日志页按
 * 游标拉取更新的条目。总线永不抛错：环满丢最旧一条，字段不可读则字符串化。
 *
 * 可选的落盘会把同样脱敏后的条目追加为 JSONL，这是诊断「页面打开之前就到达的
 * 流量」（例如启动时网关正在重连）的唯一手段。
 */

import { appendFile } from 'node:fs/promises'

/**
 * 字段绝不能以明文进入页面或磁盘。
 * 对任意深度的键做大小写不敏感匹配。
 */
const SECRET_KEYS = new Set(['access_token', 'accesstoken', 'token', 'authorization', 'secret', 'password'])

/** 容量下限与上限，构造与重配置共用一处。 */
const CAPACITY_MIN = 50
const CAPACITY_MAX = 5000

/**
 * 把一个容量值夹到合法区间。
 * @param value - 候选容量。
 * @returns 合法容量；非法输入回落到默认 500。
 */
function clampCapacity(value) {
  return Math.max(CAPACITY_MIN, Math.min(CAPACITY_MAX, Math.trunc(value) || 500))
}

/**
 * 把任意异常压成一句可读文本。
 * @param error - 抛出的东西，可能不是 Error。
 * @returns 可读文本。
 */
export function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 把所有像密钥的值替换成标记。
 * @param value - 任意 JSON 值。
 * @param depth - 递归护栏。
 * @returns 一份脱钩的脱敏副本。
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
 * 截断一条消息预览，避免长文本刷爆日志环。
 * @param text - 原始文本。
 * @param limit - 保留的最大码点数。
 * @returns 预览字符串。
 */
export function preview(text, limit = 60) {
  const chars = Array.from(String(text ?? ''))
  const head = chars.slice(0, limit).join('').replace(/\s+/g, ' ')
  return chars.length > limit ? head + '…' : head
}

/** 有界、可按游标寻址的日志环。 */
export class LogBus {
  /**
   * @param options - `capacity`（保留条目数）与 `messagePreview`（消息体是否
   *   贡献一段预览文本）。
   */
  constructor({ capacity = 500, messagePreview = true, file = '' } = {}) {
    this.capacity = clampCapacity(capacity)
    this.messagePreview = messagePreview !== false
    this.entries = []
    this.nextSeq = 1
    /** 绝对 JSONL 路径；关闭落盘时为空串。 */
    this.file = typeof file === 'string' ? file : ''
    /** 追加链：保证顺序，同时不阻塞调用方。 */
    this.writes = Promise.resolve()
  }

  /**
   * 在线应用页面设置，不丢弃已有条目。
   * @param options - `capacity`、`messagePreview`。
   */
  configure({ capacity, messagePreview } = {}) {
    if (typeof capacity === 'number') this.capacity = clampCapacity(capacity)
    if (typeof messagePreview === 'boolean') this.messagePreview = messagePreview
    this.trim()
  }

  /**
   * 追加一条记录。
   * @param kind - 条目类别。
   * @param fields - 附加 JSON 字段；其中的密钥会被脱敏。
   * @returns 已存入的条目。
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
   * 把一条记录追加进文件，若已配置。
   *
   * 失败被刻意吞掉：磁盘只读或写满都不该改变通道的行为。
   * @param entry - 已存入日志环的条目。
   */
  appendToFile(entry) {
    if (this.file === '') return
    const line = JSON.stringify(entry) + '\n'
    this.writes = this.writes
      .then(() => appendFile(this.file, line, 'utf8'))
      .catch(() => undefined)
  }

  /** 丢弃超出容量的最旧条目。 */
  trim() {
    const excess = this.entries.length - this.capacity
    if (excess > 0) this.entries.splice(0, excess)
  }

  /**
   * 读取比某游标更新的条目。
   * @param after - 调用方已看到的最后 seq（0 = 从保留的最旧一条开始）。
   * @param limit - 最多返回条数。
   * @returns `{ entries, nextSeq, oldestSeq }`。
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

  /** 清空全部保留条目，游标保持单调。 */
  clear() {
    this.entries = []
  }
}
