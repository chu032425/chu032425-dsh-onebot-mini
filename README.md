# dsh-onebot-mini

[English](README.en.md) | 中文

把 DeepSeek Harness 接到 **OneBot 11**（NapCat / Lagrange / LLOneBot）的最小通道插件：

- QQ 私聊与群聊消息 → dsh 会话（一个 chat 一个持久会话，重启自动续）；
- 模型回复 → 通过 OneBot 接口发回原聊天；
- `onebot_call` 工具：模型可直接调任意 OneBot 动作（发图、发文件、群管理）；
- **配置页**：改连接参数并立即重连；
- **日志页**：实时看 WebSocket 连接 / 断开 / 发送 / 接收。

零运行时依赖（WebSocket 服务端为手写实现），可从 git、tarball 或本地 `link:` 安装。

## 安装

```sh
dsh plugin --profile web add https://github.com/<you>/dsh-onebot-mini
```

或在 Web 界面 **Plugins → Add plugin** 里填仓库地址。安装后重启 `dsh web`。

**NapCat 侧配置**（二选一）：

- **反向（推荐）**：NapCat → 网络设置 → 新建「WebSocket 客户端」，上报地址
  `ws://<dsh 所在机器 IP>:8643`（端口填你配置里的 `port`），token 填本插件的 `accessToken`。
- **正向**：NapCat 启用「WebSocket 服务端」（默认 `3001`），本插件 `url` 填
  `ws://<NapCat 所在机器 IP>:3001`。

两侧 token 必须一致；消息上报格式建议选「数组」。

## 首次配置

左侧栏点 **OneBot** 图标，面板左侧是选项卡、右侧是详情页：

- **设置**：连接、访问控制、会话、诊断四组；
- **日志**：实时 WebSocket 收发。

（配置不放在 Plugins 页里，本插件的侧栏面板就是唯一操作入口。）最小可用配置：

1. `连接模式`：反向（默认）；
2. `监听地址`：**NapCat 与本插件不在同一网络命名空间时必须填 `0.0.0.0`**——
   填 `127.0.0.1` 只监听回环，NapCat 连容器 IP 会得到 `ECONNREFUSED`；
   同机同命名空间才可用 `127.0.0.1`；
3. `访问令牌`：与 NapCat 一致（**反向模式留空会拒绝启动**）；
4. 保存 → 提示「已保存，网关已重连」。

配置存在 `<DSH_HOME>/profiles/<profile>/onebot-mini.json`，不是 Loader 的
`config:` 块——所以**通过配置页保存**只重建 WebSocket 连接，不重启插件，进行中的会话不受影响。

注意：该文件在插件挂载时读取一次。**手改这个文件需要重启 `dsh web` 才生效**；
日常改配置请用配置页。

## 配置项

| 键 | 默认 | 说明 |
|---|---|---|
| `mode` | `reverse` | `reverse`=网关拨入；`forward`=插件拨出 |
| `host` / `port` | `127.0.0.1` / `8643` | 反向监听；跨机部署改 `0.0.0.0` |
| `url` | `ws://127.0.0.1:3001` | 正向目标 |
| `accessToken` | 空 | 反向必填；正向作为 `Authorization: Bearer`。**设置页明文回显**（密码型输入框，便于与 NapCat 逐字比对），文件里也是明文 |
| `botQQ` | 空 | 机器人账号，留空从事件自动学习 |
| `requireMention` | `true` | 群聊需 @ 机器人才响应（`botQQ` 未知时 fail-closed） |
| `allowFrom` / `allowGroups` | `[]` | 空=不限制 |
| `workspacePath` | 空 | 会话工作目录，空=宿主进程 cwd |
| `agentPreset` | 空 | 会话使用的 agent 预设 |
| `senderPrefix` | `true` | 群消息加 `[HH:MM 昵称(QQ)]` 前缀 |
| `sessionPrefix` | `onebot` | 会话 ID 前缀；小写字母开头，只含小写字母/数字/连字符 |
| `titleEqualsId` | `true` | 会话标题钉成会话 ID（见下） |
| `logCapacity` | `500` | 日志保留条数 |
| `logMessagePreview` | `true` | 日志是否记消息正文前缀 |
| `sendTimeoutMs` | `30000` | 动作超时 |

## 会话 ID 与标题

会话 ID = `<sessionPrefix>-private-<QQ号>` / `<sessionPrefix>-group-<群号>`，
默认前缀 `onebot`，可在设置页的「会话」组改：

- **必须以小写字母开头**，只允许小写字母、数字、连字符；不合规的值会被拒绝并回退默认值
  （配置页会显示具体原因，不会静默改写）；
- **改前缀不会迁移已有会话**：新前缀只影响之后新建的会话，旧会话仍以旧 ID 留在侧栏。
  想让某个 chat 换到新前缀，需要先删掉旧会话再发一条新消息。

`titleEqualsId: true` 时，创建会话后立刻把标题钉成同一个字符串（走宿主的
`sessionTitle.rename`），所以侧栏里会话名就是 ID，后续新消息不会触发自动改名。
关掉这项则交给宿主的默认标题逻辑。

## 日志页

左侧栏 **OneBot** 面板，显示 7 类事件：

| 类型 | 内容 |
|---|---|
| 连接 / 断开 / 重连 | 模式、地址、断开原因、第几次重连与退避 |
| 发送 / 接收 | action 名、参数、retcode、耗时 |
| 事件 | 网关推送的消息 / meta 事件（正文只记前缀） |
| 桥接 | 会话创建/恢复、投递、回复发送、门禁拒绝 |
| 错误 | 超时、解析失败、发送失败 |

页面每 1.5 秒拉增量（`after=<seq>`），有暂停 / 清空 / 自动滚动。
`accessToken` 与任何 `token` 字段在写入日志前就脱敏，不会出现在页面或文件里。

## 出站行为

模型一轮回复里的所有 `text` 块会被缓冲，在 `turn/end` 时合并成**一条**消息发出——
多步回合不会刷屏。`reasoning` 与 `tool-call` 块不会发出去。
回合出错且没有文本时，发一条 `⚠️ 本轮出错：…` 提示。

## 已知限制

- **不下载媒体**：图片 / 语音 / 视频 / 文件只以 `[图片]` `[语音]` `[视频]` `[文件]`
  占位出现在文本里，模型看不到内容。要让模型看图需另加媒体管线。
- **不做 Markdown 转换**：提示词要求模型输出纯文本，但插件不做格式剥离。
- **无斜杠命令**：没有 `/new` `/stop` 之类，重启会话请用 dsh 界面。
- **无权限分档**：所有通过门禁的用户都用同一个 agent 预设。

## 卸载

```sh
dsh plugin --profile web remove dsh-onebot-mini
```

配置与日志文件保留在 `<DSH_HOME>/profiles/<profile>/onebot-mini.json`，需要时手动删。

## 许可证

MIT
