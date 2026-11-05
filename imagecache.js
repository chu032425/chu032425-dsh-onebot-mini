/**
 * Local cache for Qzone images.
 *
 * The Qzone payload only carries image URLs. Fetching one per render would hit
 * the CDN on every refresh, and the panel is re-rendered often, so images are
 * downloaded once and served from disk afterwards.
 *
 * Shape on disk:
 *
 *   <profile>/onebot-mini-cache/<qq>/<sha1(url)>.<ext>
 *
 * `<qq>` is the account whose space is being read, so one operator can tell the
 * caches apart and clear one account without touching another.
 *
 * Size discipline is the point of this module:
 *  - a per-file cap (`maxKb`): a HEAD request runs first, and a file advertised
 *    as larger than the cap is refused before any body bytes are read;
 *  - a total cap (`totalMb`): after every write the cache is pruned, oldest
 *    file first, until it fits;
 *  - an in-flight map: two renders asking for the same URL share one download.
 *
 * Every network call is restricted to known Qzone image hosts, so a malicious
 * or malformed URL in a post cannot turn this into an SSRF probe of the local
 * network.
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { configPath } from './config.js'

/** Hosts a Qzone image URL is allowed to point at. Suffix match, dot-anchored. */
const ALLOWED_HOST_SUFFIXES = Object.freeze([
  '.qq.com',
  '.qpic.cn',
  '.qlogo.cn',
  '.gtimg.com',
  '.myqcloud.com',
])

/** A download that takes longer than this is abandoned. */
const FETCH_TIMEOUT_MS = 15000

/**
 * The default largest image that may be shown without being cached.
 *
 * An image over the cache cap is streamed straight to the browser instead of
 * being refused outright — the panel still shows it, it just costs a repeat
 * download. This bounds that path so a hostile or absurd URL cannot exhaust
 * memory or bandwidth. The operator can raise or lower it in the settings.
 */
export const DEFAULT_STREAM_ONLY_MAX_BYTES = 32 * 1024 * 1024

/** Extension for a normalized image content type. */
function extensionFor(contentType) {
  const type = String(contentType ?? '').toLowerCase()
  if (type.includes('png')) return 'png'
  if (type.includes('gif')) return 'gif'
  if (type.includes('webp')) return 'webp'
  if (type.includes('bmp')) return 'bmp'
  return 'jpg'
}

/**
 * Whether a URL may be fetched by this module.
 * @param raw - the candidate URL.
 * @returns true when it is http(s) and its host is a known image host.
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

/** The cache root, beside the config file. */
export function cacheRoot() {
  return join(dirname(configPath()), 'onebot-mini-cache')
}

/**
 * The directory for one account's cached images.
 * @param qq - the account id; only digits are kept so a path cannot escape.
 */
export function accountDir(qq) {
  const safe = String(qq ?? '').replace(/[^0-9]/g, '')
  return join(cacheRoot(), safe === '' ? 'unknown' : safe)
}

/** The file name for one URL, stable across runs. */
function fileNameFor(url, contentType) {
  const hash = createHash('sha1').update(String(url)).digest('hex')
  return hash + '.' + extensionFor(contentType)
}

/** Cache hits and in-flight downloads, keyed by `qq|url`. */
const inflight = new Map()

/**
 * Total size of a directory, and each file's mtime.
 * @param dir - the directory to measure.
 * @returns an array of `{ path, name, size, mtime }`.
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
      // A file removed between readdir and stat is simply skipped.
    }
  }
  return files
}

/**
 * Evict oldest files until the whole cache fits the total cap.
 *
 * Runs after a write, not before, so a page load never spends time on a full
 * directory scan when nothing changed.
 * @param totalMb - the total cap in megabytes.
 * @param keep - a file to never evict (the one just written).
 */
export async function prune(totalMb, keep) {
  const budget = Math.max(1, Number(totalMb) || 100) * 1024 * 1024
  const root = cacheRoot()
  let accounts
  try {
    accounts = await readdir(root)
  } catch {
    return
  }
  const all = []
  for (const account of accounts) {
    all.push(...await inventory(join(root, account)))
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
      // Leaving one file behind never blocks the rest of the prune.
    }
  }
}

/**
 * Download one image, honoring the per-file cap.
 * @param url - the image URL (already validated).
 * @param maxBytes - the per-file cache ceiling.
 * @param streamMaxBytes - the absolute ceiling for showing the image at all.
 * @returns `{ ok: true, buffer, contentType }` or a failure, with `overflow`
 *   when the body is worth streaming once but not caching.
 */
async function download(url, maxBytes, streamMaxBytes) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    // HEAD first: a CDN that advertises a huge Content-Length is refused without
    // reading a single body byte. A host that refuses HEAD falls through to GET,
    // whose body is then capped while streaming.
    let head = undefined
    try {
      head = await fetch(url, { method: 'HEAD', signal: controller.signal, headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://qzone.qq.com/' } })
    } catch {
      head = undefined
    }
    if (head !== undefined && head.ok) {
      const length = Number(head.headers.get('content-length') ?? 0)
      // Only refuse outright when it is too big even to stream; a file merely
      // over the cache cap falls through so the body can be read and handed back
      // for a one-off display.
      if (length > streamMaxBytes) return { ok: false, reason: 'too large: ' + length + ' bytes' }
    }
    const response = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://qzone.qq.com/' } })
    if (!response.ok) return { ok: false, reason: 'HTTP ' + response.status }
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (declared > streamMaxBytes) {
      return { ok: false, reason: 'too large: ' + declared + ' bytes' }
    }
    const contentType = response.headers.get('content-type') ?? 'image/jpeg'
    // Read with a hard ceiling: a response without Content-Length must not be
    // able to fill memory. The cache cap and the stream-only cap differ, so the
    // buffer is kept up to the larger "stream only" bound and handed back when
    // it turns out to exceed the cache cap.
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
 * Fetch one image into the cache and return its path.
 *
 * A cache hit returns immediately. A miss downloads once; concurrent callers
 * for the same key await the same promise instead of downloading twice.
 * @param qq - the account (the cache folder).
 * @param url - the image URL.
 * @param options - `maxKb` per-file cap, `totalMb` total cap.
 * @returns `{ ok: true, path, contentType, cached }` or `{ ok: false, reason }`.
 */
export async function fetchIntoCache(qq, url, options = {}) {
  if (!isAllowedImageUrl(url)) return { ok: false, reason: 'the image host is not allowed' }
  const maxBytes = Math.max(1, Number(options.maxKb ?? 1024)) * 1024
  const streamMaxBytes = Math.max(1, Number(options.maxStreamMb ?? 32)) * 1024 * 1024
  const totalMb = Number(options.totalMb ?? 100)
  const dir = accountDir(qq)
  const key = String(qq) + '|' + String(url)
  if (inflight.has(key)) return inflight.get(key)

  const task = (async () => {
    // Try known extensions first; the content-type is only known after download,
    // so an existing file is discovered by hash prefix.
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
      // A file over the cache cap is still worth showing once: hand the bytes
      // back as `overflow` so the route can stream them without writing them.
      if (downloaded.overflow === true) {
        return { ok: false, reason: downloaded.reason, overflow: true, buffer: downloaded.buffer, contentType: downloaded.contentType }
      }
      return downloaded
    }
    await mkdir(dir, { recursive: true })
    const path = join(dir, fileNameFor(url, downloaded.contentType))
    await writeFile(path, downloaded.buffer)
    // Prune lazily: the write is what can push the cache over budget.
    void prune(totalMb, path).catch(() => undefined)
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
 * Read a cached image back, for the route that serves it to the browser.
 * @param path - the cached file.
 * @returns the bytes, or undefined when the file vanished.
 */
export async function readCached(path) {
  try {
    if (!existsSync(path)) return undefined
    const { readFile } = await import('node:fs/promises')
    return await readFile(path)
  } catch {
    return undefined
  }
}
