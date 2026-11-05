/**
 * An inventory of the files this plugin writes, for the cache page.
 *
 * The plugin owns three kinds of storage:
 *  - its settings file, which must never be removed through this page;
 *  - the JSONL log, which the operator may clear;
 *  - the session cache (Qzone images + incoming media), which lives under the
 *    configured workspace per cachepaths.js: `{workspacePath}/onebot-mini-cache/QQ/{qq}/`.
 *
 * The point is visibility: the operator can see what has accumulated and how
 * much room it takes, and clear it deliberately. Nothing here runs on a timer;
 * every removal is a direct request.
 */

import { existsSync } from 'node:fs'
import { readdir, rm, stat, truncate } from 'node:fs/promises'
import { join } from 'node:path'
import { configPath, logPath } from './config.js'
import { accountDir, cacheBase } from './cachepaths.js'

/** The most individual cache files listed at once; the rest are summarized. */
const MAX_LISTED_FILES = 200

/**
 * Classify one cache file by extension.
 *
 * The cache is not only pictures: future features may cache media or other
 * payloads, so every entry gets a coarse kind the page can show.
 * @param name - the file name.
 * @returns `image` | `audio` | `video` | `file`.
 */
function kindOf(name) {
  const ext = String(name).toLowerCase().split('.').pop() ?? ''
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif'].includes(ext)) return 'image'
  if (['wav', 'mp3', 'amr', 'silk', 'ogg', 'flac', 'm4a', 'aac'].includes(ext)) return 'audio'
  if (['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext)) return 'video'
  return 'file'
}

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
 * List the account cache directories under one cache base.
 *
 * Accounts live under `<base>/QQ/<id>/`; extra named buckets sit directly under
 * `<base>/<name>/` (see cachepaths.js).
 * @param base - the cache base directory.
 * @returns an array of `{ account, path }`.
 */
async function listAccountDirs(base) {
  const out = []
  let top = []
  try {
    top = await readdir(base)
  } catch {
    return out
  }
  for (const name of top.sort()) {
    const dir = join(base, name)
    if (name === 'QQ') {
      let accounts = []
      try {
        accounts = await readdir(dir)
      } catch {
        accounts = []
      }
      for (const account of accounts.sort()) {
        const accountPath = join(dir, account)
        try {
          if ((await stat(accountPath)).isDirectory()) out.push({ account, path: accountPath })
        } catch {
          // vanished between readdir and stat
        }
      }
    } else {
      try {
        if ((await stat(dir)).isDirectory()) out.push({ account: name, path: dir })
      } catch {
        // vanished
      }
    }
  }
  return out
}

/**
 * Build the whole inventory.
 * @param config - the effective plugin config (decides the workspace cache base).
 * @returns a JSON-serializable description of every plugin-owned file.
 */
export async function inventory(config) {
  const configFile = { path: configPath(), exists: false, size: 0, mtime: 0 }
  const configInfo = await fileInfo(configFile.path)
  if (configInfo !== undefined) {
    configFile.exists = true
    configFile.size = configInfo.size
    configFile.mtime = configInfo.mtime
  }

  const logs = []
  const logFile = logPath()
  const logInfo = await fileInfo(logFile)
  if (logInfo !== undefined) {
    logs.push({ path: logFile, size: logInfo.size, mtime: logInfo.mtime, lines: await countLines(logFile) })
  }

  const root = cacheBase(config)
  const accounts = []
  const files = []
  let truncated = false
  let cacheTotal = 0
  for (const { account, path: dir } of await listAccountDirs(root)) {
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
        files.push({ account, name: entry, size: info.size, mtime: info.mtime, kind: kindOf(entry) })
      } else {
        truncated = true
      }
    }
    accounts.push({ account, path: dir, size: accountSize, count: accountCount })
    cacheTotal += accountSize
  }

  const totalBytes = configFile.size
    + logs.reduce((sum, item) => sum + item.size, 0)
    + cacheTotal

  return {
    root,
    totalBytes,
    config: configFile,
    logs,
    cache: { totalBytes: cacheTotal, accounts, files, truncated },
  }
}

/**
 * Remove a chosen slice of storage.
 *
 * `target` is one of: `logs`, `files`, `account:<qq>`, `all`. The settings file
 * is never a valid target — losing it would silently reset the whole channel.
 * @param target - what to clear.
 * @param config - the effective plugin config (decides the workspace cache base).
 * @returns `{ ok, freed, error? }` with the number of bytes removed.
 */
export async function clearCache(target, config) {
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
    const before = await inventory(config)
    await rm(cacheBase(config), { recursive: true, force: true })
    freed += before.cache.totalBytes
  }

  const clearAccount = async (qq) => {
    const dir = accountDir(config, qq)
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
    } else if (what === 'files' || what === 'images') {
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
