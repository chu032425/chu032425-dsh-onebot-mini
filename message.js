/** 构造插件自己发起的用户消息。
 * 宿主侧 `@deepseek-ai/dsh-llm` 导出 `createUserMessage`，只对声明了该 peer 的
 * 插件可解析。本模块优先用真身（消息形状与宿主完全一致），解析不到时退回等价
 * 的本地构造。
 * 本地构造复刻该 helper 的契约：全新 UUID 身份、`user` 角色、输入的深冻结副本。 */

import { randomUUID } from 'node:crypto'

/** 深冻结一个 JSON 风格的值。
 * @param value - 要冻结的值。
 * @returns 同一个值。 */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const item of Object.values(value)) deepFreeze(item)
  }
  return value
}

/** 构造一条宿主会接受的消息。
 * @param input - `content` 块与 `source`。
 * @returns 冻结后的用户消息。 */
function localUserMessage(input) {
  return deepFreeze(structuredClone({
    ...input,
    id: randomUUID(),
    role: 'user',
  }))
}

/** 已解析的工厂；首次调用前为 `undefined`。 */
let factory

/** 解析宿主 helper 一次，结果缓存。
 * 兼容层，保留是刻意的：本包未声明 `peerDependencies`，所以从 git URL 装进一个
 * 不提升 peer 的 profile 时，这里的动态 import 必然抛 ERR_MODULE_NOT_FOUND，
 * 永远落到 `localUserMessage`；而在宿主能解析到该 peer 的环境里，它仍会走真身。
 * 两种情况都不改变对外契约，因此不删这条 try 分支。
 * @returns 工厂函数，或本地兜底。 */
async function resolveFactory() {
  if (factory !== undefined) return factory
  try {
    const mod = await import('@deepseek-ai/dsh-llm')
    factory = typeof mod.createUserMessage === 'function' ? mod.createUserMessage : localUserMessage
  } catch {
    factory = localUserMessage
  }
  return factory
}

/** 为插件发起的一个回合构造用户消息。
 * @param input - `content` 与 `source`。
 * @returns 消息。 */
export async function createPluginUserMessage(input) {
  const build = await resolveFactory()
  return build(input)
}

/** 标记消息由本插件产出的来源标签。 */
export const PLUGIN_SOURCE = Object.freeze({ kind: 'plugin:dsh-onebot-mini' })
