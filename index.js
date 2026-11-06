/**
 * dsh-onebot-mini 的宿主侧。
 *
 * 三件事：
 *  1. 读插件自己的设置文件（为什么不用 Loader 的 `config:` 块，见 config.js）。
 *  2. 管住 OneBot 传输层，以及「聊天 ↔ 会话」的桥。
 *  3. 提供浏览器侧要用的 JSON 路由（设置页与日志页）。
 *
 * 只 import Node 内置模块和相对路径文件，所以无论是从 git 安装还是以 `link:`
 * 指向本地检出，都能正常工作。
 */

import { ChatBridge } from './bridge.js'
import { OneBotConnection } from './connection.js'
import { ConfigStore, configPath, logPath } from './config.js'
import { LogBus, errorText } from './logbus.js'
import { registerRoutes } from './api.js'

/** 本插件用到的宿主服务。 */
export const inject = ['agents', 'systemPrompt', 'tools', 'webServer', 'connection']

/**
 * 挂载插件。
 * @param ctx - 插件上下文。
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

    /** 当前生效的传输层，每次保存设置都会换一个。 */
    let connection

    /**
     * 建一个传输层并启动它。
     * @param config - 生效中的配置。
     * @returns 已启动的连接。
     */
    async function startTransport(config) {
      const next = new OneBotConnection({ config, log })
      next.onEvent = (frame) => {
        void bridge.handleInbound(frame)
      }
      // 从活连接回填机器人账号：不该让运营者自己去查，而存着对不上的旧号只会误导。
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
     * 给桥用的稳定外壳：换传输层时，桥和每个会话的 agent 都不用重新接线。
     */
    const transport = {
      get selfId() {
        return connection?.selfId ?? ''
      },
      get state() {
        return connection?.state ?? 'offline'
      },
      status: () => connection?.status() ?? { state: 'offline', mode: store.read().mode, address: '', selfId: '', onlineSince: 0, pendingActions: 0, reconnectAttempt: 0 },
      sendText: (chat, text) => {
        if (connection === undefined) throw new Error('transport is not running')
        return connection.sendText(chat, text)
      },
      // 桥会自己拼完整的段列表（文字加媒体标记），所以外壳也要暴露段级发送。
      sendMessage: (chat, message) => {
        if (connection === undefined) throw new Error('transport is not running')
        return connection.sendMessage(chat, message)
      },
      call: (action, params) => {
        if (connection === undefined) throw new Error('transport is not running')
        return connection.call(action, params)
      },
    }

    // 按需取：工作区注册表是异步初始化的，挂载时抓到的值可能还是 undefined。
    // 它本身也是可选的——精简组合里没有工作区服务，插件仍要能跑。
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
      errorText,
    })
    const disposeEvents = bridge.start()

    /**
     * 保存设置后换掉传输层。
     *
     * 桥和每个会话的 agent 都活着，重建的只是那条链路。
     * @param config - 新的生效配置。
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
     * 一个会话可以挂靠哪些工作区，供设置页的下拉框使用。
     * @returns `{ available, workspaces }`；服务缺失时安静降级。
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
     * 一个会话可以跑在哪些「提供方 / 模型」组合上，供设置页的下拉框使用。
     * 取值写成 `provider::model`，这样模型 id 里带斜杠也不会被截断。
     * @returns `{ available, models, defaultModel }`。
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
     * 一个会话可以跑在哪些权限预设下。
     * @returns `{ available, options, defaultPreset }`。
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

    /**
     * 一个会话可以挂靠哪些工作区。
     * @returns `{ available, workspaces }`。
     */
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
      getSessionIdForChat: (chatId) => bridge.sessionOf(chatId),
      forgetChat: (chatId) => bridge.forgetChat(chatId),
      reattachWorkspace: (chatId) => bridge.reattachWorkspace(chatId),
    })

    try {
      connection = await startTransport(initial)
    } catch (error) {
      log.record('error', { note: 'initial transport start failed: ' + errorText(error) })
    }
    // 在任何 agent 出现之前，先在插件作用域注册一次工具：写在 setup 回调里的
    // 注册必须传到那个 agent 的视野里，而全局注册能覆盖之后新建的每个 agent。
    try {
      await bridge.registerToolsFor(ctx, '')
    } catch (error) {
      log.record('warn', { note: 'early tool registration failed: ' + errorText(error) })
    }
    log.record('bridge', { note: 'plugin mounted', mode: initial.mode, state: connection?.state ?? 'offline' })
    // 启动自检：确认从这个 ctx 摸得到工具服务。摸不到的话，每个 agent 都会
    // 悄悄少掉 OneBot 工具，表现出来就是模型自己编一个「没权限发图」的理由。
    try {
      const toolsService = ctx.get('tools') ?? ctx.tools
      log.record('bridge', {
        note: toolsService === undefined ? 'startup check: no tools service on this ctx' : 'startup check: tools service is available',
        hasRegister: typeof toolsService?.register === 'function',
      })
    } catch (error) {
      log.record('warn', { note: 'startup check failed: ' + errorText(error) })
    }

    return async () => {
      log.record('bridge', { note: 'plugin stopping' })
      const live = connection
      connection = undefined
      if (live !== undefined) await live.stop()
      try {
        disposeEvents()
      } catch {
        // 已经随 agent 作用域一起释放了。
      }
      await bridge.stop()
      disposeRoutes()
    }
  }, 'onebot-mini.lifecycle')
}
