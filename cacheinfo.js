/**
 * 本插件写下的文件清单，供缓存页面展示。
 *
 * 插件拥有三类存储：
 *  - 设置文件，绝不能从这个页面删除；
 *  - JSONL 日志，运营者可清空；
 *  - 会话缓存（空间图片 + 入站媒体），按 cachepaths.js 的约定落在配置的
 *    工作区下：`{workspacePath}/onebot-mini-cache/QQ/{qq}/`。
 *
 * 这里只负责可见性：运营者能看到积累了什么、占多少空间，并有意识地清理。
 * 没有任何定时任务，每次删除都来自一次直接请求。
 */

import { existsSync } from 'node:fs'
import { readdir, readFile, rm, stat, truncate } from 'node:fs/promises'
import { join } from 'node:path'
import { configPath, logPath } from './config.js'
import { accountDir, cacheBase, walkAccounts } from './cachepaths.js'

/** 一次最多列出的单个缓存文件数；其余只做汇总。 */
const MAX_LISTED_FILES = 200

/**
 * 按扩展名给一个缓存文件分类。
 *
 * 缓存不只有图片：后续功能可能缓存媒体或其他载荷，所以每个条目都给出
 * 页面可展示的粗略类型。
 * @param name - 文件名。
 * @returns `image` | `audio` | `video` | `file`。
 */
function kindOf(name) {
  const ext = String(name).toLowerCase().split('.').pop() ?? ''
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif'].includes(ext)) return 'image'
  if (['wav', 'mp3', 'amr', 'silk', 'ogg', 'flac', 'm4a', 'aac'].includes(ext)) return 'audio'
  if (['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext)) return 'video'
  return 'file'
}

/**
 * 一个文件的大小与修改时间，文件不存在时返回 undefined。
 * @param path - 文件路径。
 * @returns `{ size, mtime }` 或 undefined。
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
 * 统计文本文件的行数（不整份读入即可）。
 * @param path - 文件路径。
 * @returns 行数，或 0。
 */
async function countLines(path) {
  try {
    const text = await readFile(path, 'utf8')
    if (text === '') return 0
    return text.split('\n').filter((line) => line !== '').length
  } catch {
    return 0
  }
}

/**
 * 生成完整清单。
 * @param config - 生效的插件配置（决定工作区缓存根）。
 * @returns 可 JSON 序列化的、本插件所有文件的描述。
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
  for (const { account, path: dir } of await walkAccounts(root)) {
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
 * 删除选定的存储切片。
 *
 * `target` 取值为：`logs`、`files`、`account:<qq>`、`all`。设置文件永远不是
 * 合法目标 —— 丢掉它会静默重置整个通道。
 * @param target - 要清理的对象。
 * @param config - 生效的插件配置（决定工作区缓存根）。
 * @returns `{ ok, freed, error? }`，其中 freed 为释放的字节数。
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
      // 目录在检查之间消失，就不再额外计入释放量。
    }
    await rm(dir, { recursive: true, force: true })
    freed += size
  }

  try {
    if (what === 'logs') {
      await clearLogs()
    } else if (what === 'files') {
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
