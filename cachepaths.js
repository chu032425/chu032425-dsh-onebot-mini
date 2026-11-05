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

import { dirname, join } from 'node:path'
import { configPath } from './config.js'

/** The cache root that sits beside the settings file, used only when no workspace is configured. */
export function profileCacheRoot() {
  return join(dirname(configPath()), 'onebot-mini-cache')
}

/**
 * The cache base directory for the current config.
 *
 * Follows the documented convention: `{workspacePath}/onebot-mini-cache`, or the
 * profile-local fallback when no workspace is configured.
 * @param config - the effective plugin config.
 * @returns the absolute cache base directory.
 */
export function cacheBase(config) {
  const workspace = String(config?.workspacePath ?? '').trim()
  if (workspace !== '') return join(workspace, 'onebot-mini-cache')
  return profileCacheRoot()
}

/**
 * A safe folder name for an arbitrary cache key.
 * @param key - a name that is not a numeric account id.
 * @returns a filesystem-safe folder name (never empty).
 */
function safeName(key) {
  const name = String(key ?? '').replace(/[^A-Za-z0-9\u4e00-\u9fa5._-]/g, '_').replace(/^\.+/, '').slice(0, 60)
  return name === '' ? 'misc' : name
}

/**
 * The cache directory for one account (QQ or group) or a named fallback bucket.
 *
 * Numeric ids live under `QQ/<id>/`; anything else lives directly under
 * `<base>/<name>/`, per the documented convention.
 * @param config - the effective plugin config.
 * @param key - a QQ号 / 群号, or a custom bucket name.
 * @returns the absolute account cache directory.
 */
export function accountDir(config, key) {
  const base = cacheBase(config)
  const digits = String(key ?? '').replace(/[^0-9]/g, '')
  if (digits !== '') return join(base, 'QQ', digits)
  return join(base, safeName(key))
}
