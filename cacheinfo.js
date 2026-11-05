/**
 * An inventory of the files this plugin writes, for the cache page.
 *
 * The plugin owns three kinds of storage:
 *  - its settings file, which must never be removed through this page;
 *  - the JSONL log, which the operator may clear;
 *  - the Qzone image cache, grouped one folder per account, which the operator
 *    may clear as a whole or per account.
 *
 * The point is visibility: the operator can see what has accumulated and how
 * much room it takes, and clear it deliberately. Nothing here runs on a timer;
 * every removal is a direct request.
 */

import { existsSync } from 'node:fs'
import { readdir, rm, stat, truncate } from 'node:fs/promises'
import { join } from 'node:path'
import { configPath, logPath } from './config.js'
import { cacheRoot } from './imagecache.js'

/** The most individual cache files listed at once; the rest are summarized. */
const MAX_LISTED_FILES = 200

/**
 * Size and mtime of one file, or undefined when it is absent.
 * @param path - the file path.
 * @returns `{ size, mtime }` or undefined.
 */
async function fileInfo(path) {
  try {
    const info = await stat(path)
    if (!info.isFile()) return undefined
    return { size: info.size, mtime: info.mtimeMs }
  } catch {
    return undefined
  }
}

/**
 * Count the lines in a text file without loading it whole.
 * @param path - the file path.
 * @returns the line count, or 0.
 */
async function countLines(path) {
  try {
    const { readFile } = await import('node:fs/promises')
    const text = await readFile(path, 'utf8')
    if (text === '') return 0
    return text.split('\n').filter((line) => line !== '').length
  } catch {
    return 0
  }
}

/**
 * Build the whole inventory.
 * @returns a JSON-serializable description of every plugin-owned file.
 */
export async function inventory() {
  const config = { path: configPath(), exists: false, size: 0, mtime: 0 }
  const configInfo = await fileInfo(config.path)
  if (configInfo !== undefined) {
    config.exists = true
    config.size = configInfo.size
    config.mtime = configInfo.mtime
  }

  const logs = []
  const logFile = logPath()
  const logInfo = await fileInfo(logFile)
  if (logInfo !== undefined) {
    logs.push({ path: logFile, size: logInfo.size, mtime: logInfo.mtime, lines: await countLines(logFile) })
  }

  const root = cacheRoot()
  const accounts = []
  const files = []
  let truncated = false
  let imageTotal = 0
  if (existsSync(root)) {
    let names = []
    try {
      names = await readdir(root)
    } catch {
      names = []
    }
    for (const name of names.sort()) {
      const dir = join(root, name)
      let entries = []
      try {
        entries = await readdir(dir)
      } catch {
        continue
      }
      let accountSize = 0
      let accountCount = 0
      for (const entry of entries) {
        const info = await fileInfo(join(dir, entry))
        if (info === undefined) continue
        accountSize += info.size
        accountCount += 1
        if (files.length < MAX_LISTED_FILES) {
          files.push({ account: name, name: entry, size: info.size, mtime: info.mtime })
        } else {
          truncated = true
        }
      }
      accounts.push({ account: name, path: dir, size: accountSize, count: accountCount })
      imageTotal += accountSize
    }
  }

  const totalBytes = config.size
    + logs.reduce((sum, item) => sum + item.size, 0)
    + imageTotal

  return {
    root,
    totalBytes,
    config,
    logs,
    images: { totalBytes: imageTotal, accounts, files, truncated },
  }
}

/**
 * Remove a chosen slice of storage.
 *
 * `target` is one of: `logs`, `images`, `account:<qq>`, `all`. The settings file
 * is never a valid target — losing it would silently reset the whole channel.
 * @param target - what to clear.
 * @returns `{ ok, freed, error? }` with the number of bytes removed.
 */
export async function clearCache(target) {
  const what = String(target ?? '').trim()
  let freed = 0

  const clearLogs = async () => {
    const path = logPath()
    if (!existsSync(path)) return
    const info = await fileInfo(path)
    await truncate(path, 0)
    if (info !== undefined) freed += info.size
  }

  const clearAllImages = async () => {
    const before = await inventory()
    await rm(cacheRoot(), { recursive: true, force: true })
    freed += before.images.totalBytes
  }

  const clearAccount = async (qq) => {
    const safe = String(qq ?? '').replace(/[^0-9]/g, '')
    if (safe === '') return
    const dir = join(cacheRoot(), safe)
    if (!existsSync(dir)) return
    let size = 0
    try {
      for (const entry of await readdir(dir)) {
        const info = await fileInfo(join(dir, entry))
        if (info !== undefined) size += info.size
      }
    } catch {
      // A directory that vanished between checks simply frees nothing extra.
    }
    await rm(dir, { recursive: true, force: true })
    freed += size
  }

  try {
    if (what === 'logs') {
      await clearLogs()
    } else if (what === 'images') {
      await clearAllImages()
    } else if (what === 'all') {
      await clearLogs()
      await clearAllImages()
    } else if (what.startsWith('account:')) {
      await clearAccount(what.slice('account:'.length))
    } else if (what === 'config') {
      return { ok: false, freed: 0, error: 'the settings file cannot be cleared here' }
    } else {
      return { ok: false, freed: 0, error: 'unknown target: ' + what }
    }
  } catch (error) {
    return { ok: false, freed, error: String(error?.message ?? error) }
  }
  return { ok: true, freed }
}
