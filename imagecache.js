/**
 * QQ 空间图片的本地缓存。
 *
 * 空间数据只带图片 URL，每次渲染都去抓会反复打 CDN，所以图片下载一次、之后
 * 直接从磁盘提供。
 *
 * 磁盘形态：`<profile>/onebot-mini-cache/<qq>/<sha1(url)>.<ext>`。`<qq>` 是被
 * 读取空间的账号，方便按账号区分与清理。
 *
 * 大小纪律是本模块的重点：
 *  - 单文件上限（`maxKb`）：先发 HEAD，声明超出上限的文件在读取正文字节前就被拒；
 *  - 总量上限（`totalMb`）：每次写入后按最旧优先清理，直到回到预算内；
 *  - 在飞表：同一 URL 的两个渲染共享一次下载。
 *
 * 所有网络请求都限定在已知的空间图片域名，恶意或畸形 URL 无法把它变成对内网
 * 的探测。
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { accountDir, cacheBase, walkAccounts } from './cachepaths.js'
import { extensionFor } from './inbound.js'

/** 空间图片 URL 允许指向的域名。后缀匹配，点号锚定。 */
const ALLOWED_HOST_SUFFIXES = Object.freeze([
  '.qq.com',
  '.qpic.cn',
  '.qlogo.cn',
  '.gtimg.com',
  '.myqcloud.com',
])

/** 单次下载超过该时长即放弃。 */
const FETCH_TIMEOUT_MS = 15000

/**
 * 判断一个 URL 是否可被本模块抓取。
 * @param raw - 候选 URL。
 * @returns 是 http(s) 且域名为已知图片站时为 true。
 */
export function isAllowedImageUrl(raw) {
  let parsed
  try {
    parsed = new URL(String(raw))
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  return ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix))
}

/** 一个 URL 对应的文件名，跨进程稳定。 */
function fileNameFor(url, contentType) {
  const hash = createHash('sha1').update(String(url)).digest('hex')
  return hash + '.' + extensionFor('image', contentType, '')
}

/** 缓存命中与在飞下载，键为 `qq|url`。 */
const inflight = new Map()

/**
 * 一个目录的总大小与各文件 mtime。
 * @param dir - 要测量的目录。
 * @returns `{ path, name, size, mtime }` 的数组。
 */
async function inventory(dir) {
  let names
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const files = []
  for (const name of names) {
    const path = join(dir, name)
    try {
      const info = await stat(path)
      if (info.isFile()) files.push({ path, name, size: info.size, mtime: info.mtimeMs })
    } catch {
      // readdir 与 stat 之间被删掉的文件直接跳过。
    }
  }
  return files
}

/**
 * 按最旧优先淘汰，直到整个缓存回到总量上限内。
 *
 * 在写入之后跑而不是之前，这样页面加载不会在没有任何变化时白扫一遍目录。
 * @param config - 生效插件配置（决定缓存根）。
 * @param totalMb - 总量上限（兆）。
 * @param keep - 永不淘汰的文件（刚写入的那个）。
 */
async function prune(config, totalMb, keep) {
  const budget = Math.max(1, Number(totalMb) || 100) * 1024 * 1024
  const base = cacheBase(config)
  // 账号在 `<base>/QQ/<id>/` 下，额外的命名桶直接在 `<base>/<name>/` 下。
  const dirs = (await walkAccounts(base)).map((entry) => entry.path)
  const all = []
  for (const dir of dirs) {
    all.push(...await inventory(dir))
  }
  let total = all.reduce((sum, file) => sum + file.size, 0)
  if (total <= budget) return
  all.sort((a, b) => a.mtime - b.mtime)
  for (const file of all) {
    if (total <= budget) break
    if (keep !== undefined && file.path === keep) continue
    try {
      await rm(file.path, { force: true })
      total -= file.size
    } catch {
      // 漏掉一个文件不阻碍其余清理。
    }
  }
}

/**
 * 下载一张图片，执行单文件上限。
 * @param url - 图片 URL（已校验）。
 * @param maxBytes - 单文件缓存上限。
 * @param streamMaxBytes - 允许展示的绝对上限。
 * @returns `{ ok: true, buffer, contentType }` 或失败结果；正文值得一次性展示
 *   但不值得缓存时带 `overflow`。
 */
async function download(url, maxBytes, streamMaxBytes) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    // 先 HEAD：声明体量过大的 CDN 会被直接拒，一个正文字节都不读。拒绝 HEAD
    // 的主机则落到 GET，由流式读取兜底封顶。
    let head = undefined
    try {
      head = await fetch(url, { method: 'HEAD', signal: controller.signal, headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://qzone.qq.com/' } })
    } catch {
      head = undefined
    }
    if (head !== undefined && head.ok) {
      const length = Number(head.headers.get('content-length') ?? 0)
      // 只有大到连一次性展示都不行时才直接拒；仅超出缓存上限的文件继续往下走，
      // 让正文被读回来供那一次展示。
      if (length > streamMaxBytes) return { ok: false, reason: 'too large: ' + length + ' bytes' }
    }
    const response = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://qzone.qq.com/' } })
    if (!response.ok) return { ok: false, reason: 'HTTP ' + response.status }
    const contentType = response.headers.get('content-type') ?? 'image/jpeg'
    // 带硬上限读取：没有 Content-Length 的响应也不能撑爆内存。缓存上限与展示
    // 上限不同，所以缓冲区按更大的「仅展示」边界保留，超出缓存上限时原样交回。
    const chunks = []
    let total = 0
    if (response.body !== null) {
      for await (const chunk of response.body) {
        total += chunk.length
        if (total > streamMaxBytes) return { ok: false, reason: 'too large while reading' }
        chunks.push(chunk)
      }
    }
    const buffer = Buffer.concat(chunks)
    if (buffer.length > maxBytes) {
      return { ok: false, reason: 'too large: ' + buffer.length + ' bytes', overflow: true, buffer, contentType }
    }
    return { ok: true, buffer, contentType }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 把一张图片抓进缓存并返回它的路径。
 *
 * 命中直接返回；未命中只下载一次，同键的并发调用等待同一个 promise。
 * @param qq - 账号（即缓存文件夹）。
 * @param url - 图片 URL。
 * @param options - `config`（决定缓存根）、`maxKb` 单文件上限、`totalMb` 总量上限。
 * @returns `{ ok: true, path, contentType, cached }` 或 `{ ok: false, reason }`。
 */
export async function fetchIntoCache(qq, url, options = {}) {
  if (!isAllowedImageUrl(url)) return { ok: false, reason: 'the image host is not allowed' }
  const config = options.config
  const maxBytes = Math.max(1, Number(options.maxKb ?? 1024)) * 1024
  const streamMaxBytes = Math.max(1, Number(options.maxStreamMb ?? 32)) * 1024 * 1024
  const totalMb = Number(options.totalMb ?? 100)
  const dir = accountDir(config, qq)
  const key = cacheBase(config) + '|' + String(qq) + '|' + String(url)
  if (inflight.has(key)) return inflight.get(key)

  const task = (async () => {
    // 先试已知扩展名：content-type 只有下载后才知道，所以已存在的文件按哈希前缀找。
    const hash = createHash('sha1').update(String(url)).digest('hex')
    let existing = undefined
    try {
      const names = await readdir(dir)
      existing = names.find((name) => name.startsWith(hash + '.'))
    } catch {
      existing = undefined
    }
    if (existing !== undefined) {
      return { ok: true, path: join(dir, existing), contentType: '', cached: true }
    }

    const downloaded = await download(url, maxBytes, streamMaxBytes)
    if (!downloaded.ok) {
      // 超出缓存上限的文件仍值得展示一次：把 `overflow` 结果原样交回，路由层据此
      // 直接流式返回而不落盘。
      return downloaded
    }
    await mkdir(dir, { recursive: true })
    const path = join(dir, fileNameFor(url, downloaded.contentType))
    await writeFile(path, downloaded.buffer)
    // 惰性清理：真正能把缓存顶出预算的是写入。
    void prune(config, totalMb, path).catch(() => undefined)
    return { ok: true, path, contentType: downloaded.contentType, cached: false }
  })()

  inflight.set(key, task)
  try {
    return await task
  } finally {
    inflight.delete(key)
  }
}

/**
 * 读回一张已缓存的图片，供路由把它送给浏览器。
 * @param path - 缓存文件。
 * @returns 字节；文件已消失时为 undefined。
 */
export async function readCached(path) {
  try {
    if (!existsSync(path)) return undefined
    return await readFile(path)
  } catch {
    return undefined
  }
}
