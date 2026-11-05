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
      // Backfill the bot account from the live connection: an operator should not
      // have to look it up, and a stored value that no longer matches the gateway
      // would otherwise stay misleading.
      next.onLearnSelfId = (learned) => {
        const current = store.read()
        if (String(current.botQQ ?? '') === learned) return
        void store.write({ botQQ: learned }).then((result) => {
          if (result.ok) log.record('bridge', { note: 'bot account saved to config', selfId: learned })
        }).catch(() => undefined)
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

    // Resolved on demand: the workspace registry initializes asynchronously, so
    // a value captured at mount can still be undefined. Optional too — a bare
    // composition has no workspace service and the plugin must still run.
    const getWorkspaceRegistry = () => ctx.get('workspaceRegistry')

    const bridge = new ChatBridge({
      ctx,
      config: initial,
      connection: transport,
      log,
      sessionTitle,
      getWorkspaceRegistry,
      getAgentPresets: () => ctx.get('agentPresets'),
      getPermissionPresets: () => ctx.get('permissionPresets'),
      getPlanMode: () => ctx.get('planMode'),
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

    /**
     * The workspaces a chat Session may be pinned to, for the settings picker.
     * @returns `{ available, workspaces }`; a missing registry degrades quietly.
     */
    /**
     * The agent presets a chat may run under, for the settings picker.
     * @returns `{ available, presets }`; a missing registry degrades quietly.
     */
    async function listAgentPresets() {
      const registry = ctx.get('agentPresets')
      if (registry === undefined) return { available: false, presets: [] }
      try {
        const roster = await registry.list()
        let defaultId
        try {
          defaultId = (await registry.resolve()).id
        } catch {
          defaultId = undefined
        }
        return {
          available: true,
          defaultId: defaultId ?? '',
          presets: roster.map((preset) => ({
            id: String(preset.id),
            name: String(preset.name ?? preset.id),
            description: String(preset.description ?? ''),
            broken: preset.broken === undefined ? '' : String(preset.broken),
            isDefault: String(preset.id) === defaultId,
          })),
        }
      } catch {
        return { available: false, presets: [] }
      }
    }

    /**
     * The provider/model pairs a chat may run on, for the settings picker.
     * Values are `provider::model` so a model id containing a slash is preserved.
     * @returns `{ available, models, defaultModel }`.
     */
    async function listModels() {
      const llm = ctx.get('llm')
      if (llm === undefined) return { available: false, models: [], defaultModel: '' }
      try {
        let defaultModel = ''
        try {
          const selection = ctx.get('agentDefaultModel')?.currentSelection()
          if (selection !== undefined && selection !== null) {
            defaultModel = String(selection.provider ?? '') + '::' + String(selection.model ?? '')
          }
        } catch {
          defaultModel = ''
        }
        const providers = await llm.listProviders()
        const models = []
        for (const provider of providers) {
          let advertised = []
          try {
            advertised = await llm.listModels(provider.id)
          } catch {
            advertised = []
          }
          for (const model of advertised) {
            models.push({
              value: String(provider.id) + '::' + String(model.id),
              provider: String(provider.id),
              providerName: String(provider.name ?? provider.id),
              model: String(model.id),
              modelName: String(model.name ?? model.id),
            })
          }
        }
        return { available: true, models, defaultModel }
      } catch {
        return { available: false, models: [], defaultModel: '' }
      }
    }

    /**
     * The permission presets a chat may run under.
     * @returns `{ available, options, defaultPreset }`.
     */
    function listPermissionPresets() {
      const service = ctx.get('permissionPresets')
      if (service === undefined) return { available: false, options: [], defaultPreset: '' }
      try {
        const catalog = service.catalog()
        return {
          available: true,
          defaultPreset: String(catalog.defaultPreset ?? ''),
          options: (catalog.options ?? []).map((option) => ({
            value: String(option.value),
            name: String(option.name ?? option.value),
            description: String(option.description ?? ''),
          })),
        }
      } catch {
        return { available: false, options: [], defaultPreset: '' }
      }
    }

    function listWorkspaces() {
      const registry = getWorkspaceRegistry()
      if (registry === undefined) return { available: false, workspaces: [] }
      try {
        return {
          available: true,
          workspaces: registry.list().map((workspace) => ({
            id: String(workspace.id),
            path: String(workspace.path),
            title: String(workspace.title ?? ''),
          })),
        }
      } catch {
        return { available: false, workspaces: [] }
      }
    }

    const disposeRoutes = registerRoutes(ctx, {
      store,
      log,
      getConnection: () => connection,
      applyConfig,
      listWorkspaces,
      listAgentPresets,
      listPermissionPresets,
      listModels,
      getPendingQueues: () => bridge.queueSnapshot(),
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
