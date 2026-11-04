/**
 * Message construction for plugin-originated turns.
 *
 * `@deepseek-ai/dsh-llm` exports `createUserMessage`, and the Host's resolver
 * supplies that package to a plugin that declares it as a peer. This module
 * prefers the real helper (so the message carries exactly what the Host
 * expects) and falls back to an equivalent local construction when the peer
 * cannot be resolved — which is what happens when the package is installed
 * straight from a git URL into a profile that does not hoist peers.
 *
 * The fallback reproduces the helper's contract: a fresh UUID identity, the
 * `user` role, and a frozen copy of the input.
 */

import { randomUUID } from 'node:crypto'

/**
 * Deep-freeze a JSON-ish value.
 * @param value - the value to freeze.
 * @returns the same value.
 */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const item of Object.values(value)) deepFreeze(item)
  }
  return value
}

/**
 * Build a user message the Host will accept.
 * @param input - `content` blocks and `source`.
 * @returns the frozen user message.
 */
function localUserMessage(input) {
  return deepFreeze(structuredClone({
    ...input,
    id: randomUUID(),
    role: 'user',
  }))
}

/** The resolved factory; `undefined` until the first call. */
let factory

/**
 * Resolve the Host helper once.
 * @returns the factory, or the local fallback.
 */
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

/**
 * Create one user message for a plugin turn.
 * @param input - `content` and `source`.
 * @returns the message.
 */
export async function createPluginUserMessage(input) {
  const build = await resolveFactory()
  return build(input)
}

/** The source tag that marks a message as produced by this plugin. */
export const PLUGIN_SOURCE = Object.freeze({ kind: 'plugin:dsh-onebot-mini' })
