/**
 * Host half of dsh-onebot-mini.
 *
 * Responsibilities:
 *  1. Read the plugin's own settings file (see config.js for why it is not a
 *     Loader `config:` block).
 *  2. Own the OneBot transport and the chat ↔ session bridge.
 *  3. Serve the JSON routes the browser half uses for the config page and the
 *     log page.
 *
 * Only Node builtins and `@deepseek-ai/*` peers are imported, so the package
 * works both as a git install and as a `link:` to a local checkout.
 */

import { ChatBridge } from './bridge.js'
import { OneBotConnection } from './connection.js'
import { ConfigStore, configPath, logPath } from './config.js'
import { LogBus } from './logbus.js'
import { registerRoutes } from './api.js'

/** Services this plugin uses. */
export const inject = ['agents', 'systemPrompt', 'tools', 'webServer', 'connection']

/** Human-readable error text for logs. */
function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}

/** The status object reported before any transport exists. */
function offlineStatus(mode) {
  return { state: 'offline', mode, address: '', selfId: '', onlineSince: 0, pendingActions: 0, reconnectAttempt: 0 }
}

/**
 * Mount the plugin.
 * @param ctx - the plugin context.
 */
export function apply(ctx) {
  const store = new ConfigStore(configPath())
  const initial = store.read()
  const log = new LogBus({
    capacity: initial.logCapacity,
    messagePreview: initial.logMessagePreview,
    file: initial.logToFile === true ? logPath() : '',
  })
  const sessionTitle = ctx.get('sessionTitle')

  ctx.effect(async () => {
    log.record('bridge', { note: 'plugin starting', configPath: store.path, mode: initial.mode })

    /** The live transport, replaced on every config save. */
    let connection

    /**
     * Build and start one transport.
     * @param config - the effective config.
     * @returns the started connection.
     */
    async function startTransport(config) {
      const next = new OneBotConnection({ config, log })
      next.onEvent = (frame) => {
        void bridge.handleInbound(frame)
      }
      await next.start()
      return next
    }

    /**
     * A stable facade the bridge talks to, so a transport swap needs no
     * re-wiring of the bridge or of any chat's agent.
     */
    const transport = {
      get selfId() {
        return connection?.selfId ?? ''
      },
      get state() {
        return connection?.state ?? 'offline'
      },
      status: () => connection?.status() ?? offlineStatus(store.read().mode),
      sendText: (chat, text) => {
        if (connection === undefined) throw new Error('transport is not running')
        return connection.sendText(chat, text)
      },
      call: (action, params) => {
        if (connection === undefined) throw new Error('transport is not running')
        return connection.call(action, params)
      },
    }

    const bridge = new ChatBridge({
      ctx,
      config: initial,
      connection: transport,
      log,
      sessionTitle,
      describeError,
    })
    const disposeEvents = bridge.start()

    /**
     * Swap the transport after a config save.
     *
     * The bridge and every chat's agent survive: only the link is rebuilt.
     * @param config - the new effective config.
     */
    async function applyConfig(config) {
      const previous = connection
      connection = undefined
      if (previous !== undefined) await previous.stop()
      log.configure({ capacity: config.logCapacity, messagePreview: config.logMessagePreview })
      log.file = config.logToFile === true ? logPath() : ''
      bridge.reconfigure(config)
      connection = await startTransport(config)
    }

    const disposeRoutes = registerRoutes(ctx, {
      store,
      log,
      getConnection: () => connection,
      applyConfig,
    })

    try {
      connection = await startTransport(initial)
    } catch (error) {
      log.record('error', { note: 'initial transport start failed: ' + describeError(error) })
    }
    log.record('bridge', { note: 'plugin mounted', mode: initial.mode, state: connection?.state ?? 'offline' })

    return async () => {
      log.record('bridge', { note: 'plugin stopping' })
      const live = connection
      connection = undefined
      if (live !== undefined) await live.stop()
      try {
        disposeEvents()
      } catch {
        // Already disposed with the agent scope.
      }
      await bridge.stop()
      disposeRoutes()
    }
  }, 'onebot-mini.lifecycle')
}
