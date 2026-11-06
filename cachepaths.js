/**
 * 缓存目录约定（唯一权威说明，新增缓存请先读这里，不要另起炉灶）。
 *
 * 本插件产生的“会话缓存”一律放在**配置里的工作区目录**下，再套一层
 * `onebot-mini-cache/`，然后按 QQ 号 / 群号分文件夹：
 *
 *     {workspacePath}/onebot-mini-cache/QQ/{qq号或群号}/<缓存文件>
 *
 * 例如工作区是 /workspace/QQ：
 *
 *     /workspace/QQ/onebot-mini-cache/QQ/2000001/            ← 与 2000001 的私聊缓存
 *     /workspace/QQ/onebot-mini-cache/QQ/2000003/            ← 群 2000003 的缓存
 *     /workspace/QQ/onebot-mini-cache/QQ/2000001/space-*.jpg ← 该账号的 QQ 空间图片
 *
 * 为什么这样放：
 *  - 空间图片是按账号（QQ 号）抓取的，收发消息也都带着 QQ 号 / 群号，所以用
 *    `QQ/{号}` 作二级目录既能覆盖空间，也能覆盖聊天媒体，互相不打架；
 *  - 统一在同一个 `onebot-mini-cache/` 根下，「缓存」页面能一处看见、一处清理；
 *  - 放在会话工作区里，模型用自带的 read/read_image 就能直接读到缓存文件。
 *
 * 例外（没有对应 QQ 号时）：直接放
 *
 *     {workspacePath}/onebot-mini-cache/{自定义名称}/
 *
 * 设置文件与日志文件仍然在 profile 目录（`~/.dsh/profiles/<profile>/`），
 * 不属于缓存，不参与上面的约定。
 *
 * 兼容/降级：如果配置里没有 workspacePath（正常不会），退回 profile 下的
 * `onebot-mini-cache/`，保证功能仍可用。
 */

import { readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { configPath } from './config.js'

/** 与设置文件同级的缓存根，仅在未配置工作区时使用。 */
export function profileCacheRoot() {
  return join(dirname(configPath()), 'onebot-mini-cache')
}

/**
 * 当前配置的缓存根目录。
 *
 * 遵循上面的约定：`{workspacePath}/onebot-mini-cache`；未配置工作区时退回
 * profile 下的目录。
 * @param config - 生效的插件配置。
 * @returns 缓存根目录的绝对路径。
 */
export function cacheBase(config) {
  const workspace = String(config?.workspacePath ?? '').trim()
  if (workspace !== '') return join(workspace, 'onebot-mini-cache')
  return profileCacheRoot()
}

/**
 * 任意缓存键的安全目录名。
 * @param key - 非纯数字账号的键。
 * @returns 文件系统安全的目录名（永不为空）。
 */
function safeName(key) {
  const name = String(key ?? '').replace(/[^A-Za-z0-9\u4e00-\u9fa5._-]/g, '_').replace(/^\.+/, '').slice(0, 60)
  return name === '' ? 'misc' : name
}

/**
 * 一个账号（QQ 号或群号）或具名桶的缓存目录。
 *
 * 纯数字 id 落在 `QQ/<id>/`；其余键直接落在 `<base>/<name>/`，与上面的约定一致。
 * @param config - 生效的插件配置。
 * @param key - QQ号 / 群号，或自定义桶名。
 * @returns 账号缓存目录的绝对路径。
 */
export function accountDir(config, key) {
  const base = cacheBase(config)
  const digits = String(key ?? '').replace(/[^0-9]/g, '')
  if (digits !== '') return join(base, 'QQ', digits)
  return join(base, safeName(key))
}

/**
 * 列出缓存根下的所有账号目录。
 *
 * 账号在 `<base>/QQ/<id>/`，具名桶在 `<base>/<name>/`（见上面的约定）。
 * 只返回真实存在的目录，按名字排序；根目录不存在时返回空数组。
 * @param base - 缓存根目录（通常来自 `cacheBase(config)`）。
 * @returns `[{ account, path }]`，按名字升序。
 */
export async function walkAccounts(base) {
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
          // readdir 与 stat 之间消失，跳过
        }
      }
    } else {
      try {
        if ((await stat(dir)).isDirectory()) out.push({ account: name, path: dir })
      } catch {
        // 已消失，跳过
      }
    }
  }
  return out
}
