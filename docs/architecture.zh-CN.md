# Cypheria 架构

Cypheria 是一个 TypeScript Web3 agent 产品：它复用 Codex 承载软件工程 agent 工作流，并由 Cypheria 自己实现 Web3 runtime，包括钱包、签名策略、dApp 浏览、自动化、本地状态和审计能力。

架构的核心规则是：agent 工作、Web3 签名、自动化执行、本地文件和 dApp 浏览不能混在同一个信任边界里。

## 系统概览

```txt
apps/expo / apps/cli / @cypheria/client / 未来的 packages/sdk
  -> @cypheria/protocol
  -> 通过 HTTP 或 WebSocket 连接 apps/server

apps/server
  -> Hono control plane + supervised worker
  -> Server-internal Agent and Web3 services
  -> 内置 apps/expo web export

remote clients
  -> @cypheria/relay E2EE
  -> apps/relay（single，或 cluster gateway -> worker）
  -> apps/server relay data socket

apps/desktop renderer
  -> @cypheria/client
  -> apps/server
  -> canonical Agent/Thread timeline

apps/desktop Electron main
  -> 发现、复用或启动 protocol-compatible 的本地 server
  -> Electron 专属 browser、secure storage、window、update 与 OS integration

apps/marketplace
  -> TanStack Start on Cloudflare Workers
  -> D1 publication system of record + R2 immutable artifacts
  -> Queues + Workflows for scan/review/publication
  -> official GitHub repo marketplace projection
```

Cypheria 有一个特权 server、多个 client、一个独立 marketplace 与一个共享 runtime：

- `apps/server`：Node.js/Hono control plane，负责 runtime ownership、版本化 client session、运维、进程监督与 web hosting。
- `apps/expo`：第一个 Cypheria protocol client，一套代码构建 iOS、Android 与静态 web。
- `packages/client`：Cypheria clients 共用的 WebSocket protocol driver 与能力门面；它既不持有特权 runtime，也不持有 Codex process。
- `apps/cli`：用于 Server lifecycle 与共享资源 API 的 Node CLI；`packages/sdk` 仍在规划中。
- `apps/desktop`：自托管 server 的 Electron + TanStack Start client；Electron main 管理兼容的本地 server，renderer 使用共享 project、section、Thread 与 timeline API。
- `apps/marketplace`：部署在 Cloudflare Workers 上的 TanStack Start 应用，负责 ChatGPT/Codex-compatible 插件的提交、扫描、审核、发布与发现，再把 approved entry 同步到 Cypheria 官方 GitHub repo marketplace。
- `apps/server/src/runtime`：Cypheria 自有非 agent 能力的 TypeScript runtime。
- `apps/relay`：可选的 Go gateway/worker 数据面，负责不透明远程 WebSocket 转发。
- `packages/relay`：server/client 共用、传输无关的 TypeScript E2EE 与 relay URL 工具。

Codex 负责 agent threads、turns、model execution、code edits、shell/tool execution、MCP 和 Codex approvals。Cypheria 负责 Web3 context、wallets、signing intents、policy evaluation、dApp browser permissions、schedule state、本地数据和 audit logs。

## Server 与 Protocol 边界

`apps/server` 是目标架构中唯一持有 the `apps/server` runtime 的进程。它提供小型 Hono HTTP 运维 API，以及由 `@cypheria/protocol` 定义的版本化 WebSocket session protocol。Supervisor 持有 PID lock、双向 liveness supervision、有界 crash restart、process-group termination 与 graceful shutdown；可替换 worker 持有 Hono、逻辑 session、runtime lifecycle。直连 socket 和解密后的 relay channel 进入同一个物理连接边界。逻辑 session 以 authenticated principal 加 `clientId` 为 key，可以同时持有多条物理 transport，并且只在最后一条 transport 断开后进入有界 grace period；同一身份重连会自动恢复，不使用公开 session ID 或 resume token。Desired server 与共享 Agent config 位于 `$CYPHERIA_HOME/config/config.json`；worker 在启动时一次性解析环境变量覆盖，并暴露 desired-versus-running restart state，但不会返回只存在于环境中的认证 token。

`@cypheria/protocol` 定义公开的 Agent/Thread、project/section 与 server 消息族。WebSocket 层沿用 Paseo：顶层 `hello`、`ping` 与 `pong` 处理物理连接，`{ type: "session", message }` 承载逻辑 traffic。逻辑 `server.status.notification` 表示挂接完成，不存在公开 session handle。`@cypheria/client` 把该边界分成 `ServerClient`、借用连接的 `CypheriaApi` 和持有生命周期的 `CypheriaClient` 三层。公开 API 只暴露 `agent`、`thread`、`projectThread` 与 `server`；provider-native endpoint 和 client subpath facade 不公开。

Protocol package 仍持有 generated 且固定版本的 Codex、ACP、Claude 与 Pi schema/type。它们是经过 drift check 的 server adapter contract，不属于 live public client/server message union。Server 通过 `ThreadProviderAdapter` 把它们转换为 provider-neutral 的 Thread 生命周期、timeline、turn、配置和 interaction 消息，从而保留精确上游校验，而不把 provider 生命周期或订阅概念泄漏给 client。

`threadId` 是唯一公开的 Thread 操作句柄；`agentSessionId` 是可空、只读的 provider 元数据。创建或显式恢复 Thread 会确保 agent runtime 已就绪，启动或加载 provider session，并在内部绑定新发现的 provider ID；`thread.get` 和 `thread.list` 不产生副作用。Provider history 在重启或替换后 hydration 到新 timeline epoch；只有 canonical timeline row 获得 sequence。Canonical item model 保留消息、推理、工具、计划、命令、diff、审批、artifact、状态与错误这些共性体验，并通过 typed provider item 和 `providerData` 保存 agent 个性化 payload，而不暴露 provider transport。Server 向所有客户端广播 Thread 状态、timeline 与 interaction notification，首个合法 interaction response 生效。

Codex 与 OpenCode 使用 server 共享进程，Claude、Pi 与 ACP runtime 按 Thread 隔离。OpenCode 在 loopback server 上运行，并在内部使用稳定 SDK root API 与两条 event stream。Claude `canUseTool`、Pi extension UI、OpenCode permission/question event、Codex reverse request 与 ACP permission request 都归一为 typed Thread interaction。ACP agent 必须支持原生 session 删除才能创建 Cypheria Thread，使 provider-first 删除在失败时可保留 Cypheria 记录。详见 [Thread 协议](thread-protocol.zh-CN.md)。

`AgentManager` 持有 ACP Registry、异步安装与更新、显式 enable 和运行状态。Disabled agent 不能启动，也不能接收业务调用。Codex 与 OpenCode 是共享进程；Claude、Pi 与 registry ACP agent 按 session 隔离。`ToolchainManager` 持有最新稳定 Node LTS、uv、受管 CPython，以及按完整依赖指纹共享的不可变 Python environment。详见 [Agent 管理](agent-management.zh-CN.md)。

Cypheria 自有 object schema 会剥离未知 key。可选的 `server.status.features` record 是例外：
它会保留未知 boolean flag，以支持不同版本 peer。每个具名 compatibility gate 必须保持可选，
并通过 `COMPAT(name)` comment 记录引入版本与移除日期。最终 protocol union 使用 Zod 显式
AOT compile。Provider-native request 在内部 adapter boundary 使用选中的 schema 校验后再 dispatch。

Wallet、policy、browser、schedule 与其余产品 service 不属于当前 Agent/Thread 工作范围。详见 [Cypheria Server](server.zh-CN.md)。

## Relay 边界

远程 client 可以用 `ConnectionOfferV2` 替代直连 URL/token。受认证的 server pairing endpoint
生成包含 relay endpoint、server ID 和服务端 X25519 公钥的 `cypheria://pair` URL。
`@cypheria/client` 在发送顶层 `hello` 前完成 E2EE；`apps/server` 把每条解密后的 relay
data socket 转换为直连 WebSocket 共用的 transport-neutral `ClientSession`。relay 能看到路由
metadata 和密文，但看不到直连 Bearer token 或应用明文。

当前部署范围是单 region。`--mode=single` 让 gateway 与 worker 严格共存于唯一一个进程，
使用内存路由，不需要 etcd 或内部 listener。cluster 模式拆分 `--role=gateway` 与
`--role=worker`，使用 etcd ownership 和 mTLS，并可跨可用区部署。TOML 配置与 Kustomize
base 覆盖这两类运行形态；etcd 与 OpenTelemetry Collector 仍是外部组件。独立的各 region
集群、home-region 路由、全局线性一致
coordinator、fencing generation 与自动故障转移已经设计但暂缓实现。详见
[Cypheria Relay](relay.zh-CN.md)。

## Expo Client

`apps/expo` 是 Expo SDK 57 + Expo Router 应用，一套 source tree 面向 iOS、Android 与 web。它执行版本化 session hello、关联 server request、使用有界 backoff 重连，并读取 server information。Static web export 会复制到 server build 中，由 Hono 提供 SPA fallback。Credential 不会编译进公开 Expo bundle。

Marketplace 是独立的远程 trust boundary。D1 是 review/publication system of record；后端将 published release 确定性投影到 Cypheria 官方 GitHub repository 的 `$REPO_ROOT/.agents/plugins/marketplace.json`。Entry 只能使用由 commit SHA 固定的 public open-source GitHub `url` 或 `git-subdir` source。R2 保存不可变 evidence，Queues 分发有界工作，Workflows 编排 scan、review 与 catalog publication。Marketplace 不在 request Worker 中执行任意第三方代码，也不接收本地 wallet、Codex home、终端用户 connector credential 或 runtime state。详见 [Cypheria Marketplace 设计](marketplace.zh-CN.md)。

## Runtime 边界

the `apps/server` runtime 是 Cypheria 非 agent runtime。它负责：

- Runtime home 解析与目录初始化。
- Settings 和本地 metadata。
- Wallet/account/chain/RPC service boundaries。
- Signing intent 创建与 policy evaluation hooks。
- dApp browser permission 和 session domain state。
- Schedule task 和 run orchestration。
- Audit log writes。
- Database 与 vault service wiring。

Runtime 不实现 Codex model turns、patches、terminal sessions 或 agent tool execution。

目标 runtime API：

```ts
class CypheriaRuntime {
  start(): Promise<void>
  stop(): Promise<void>
  request(method: string, params?: unknown): Promise<unknown>
  events(): AsyncIterable<CypheriaRuntimeEvent>
}
```

Runtime method namespaces：

```txt
runtime.*
wallet.*
chain.*
policy.*
browser.*
dapp.*
audit.*
settings.*
```

## CLI

`apps/cli` 是 Node-based CLI，V1 不做 TUI。它是 `apps/server` 的 Cypheria protocol client，不依赖 `@cypheria/sdk`，也不导入特权 runtime、database、Agent SDK 或 desktop internals。

初始命令组：

```txt
cypheria server start|stop|status|logs
cypheria agents list
cypheria projects list
cypheria threads list
cypheria schedules list
```

Lifecycle command 调用已安装的 Server supervisor；资源 command 使用 `@cypheria/client`。`CYPHERIA_SERVER_BIN`、`CYPHERIA_SERVER_URL` 与 `CYPHERIA_TOKEN` 提供显式部署覆盖。交互式 Thread streaming 与 Web3 管理等待相应共享 Server API 就绪后再开放。

## SDK

`@cypheria/sdk` 是规划中的公共 TypeScript client。它封装其他 client 共用的版本化 server protocol，不持有 runtime 或 Codex process lifecycle。

目标 SDK 形态：

```ts
import { Cypheria } from "@cypheria/sdk"

const cypheria = new Cypheria()
const info = await cypheria.runtime().info()

const thread = cypheria.agent().startThread({ workingDirectory: process.cwd() })
const result = await thread.run("Analyze this repo")
```

SDK 不应依赖 Electron、desktop IPC、Server runtime 内部实现或 Server Codex adapter。

## Desktop

Desktop 保留现有 Electron + TanStack Start 实现，以及源自 Codex Desktop 的视觉和交互模型。Electron main 确保 protocol-compatible 的本地 Cypheria server 正在运行；renderer 通过 `@cypheria/client` 使用 projects、sections、Threads、canonical history、live turns、integrations、Web3、schedules 与 terminals。

```txt
TanStack Start Renderer
  - product UI
  - route state
  - Jotai UI state
  - TanStack Query cache
  - @cypheria/client 访问共享 server state
  - typed IPC 访问 Electron-only capability

Electron Main Process
  - 本地 Cypheria server 发现、启动与 readiness
  - dApp WebContents/session management
  - secure storage、window、update 与 OS integration
```

Desktop startup：

```txt
Electron main starts
  -> resolve CYPHERIA_HOME
  -> ensure runtime directories
  -> probe configured local server
  -> protocol version 兼容时复用
  -> 否则启动 bundled server 并等待 /api/v1/ready
  -> create renderer window
```

Renderer 规则：

- Renderer 使用 `@cypheria/client` 访问共享产品与 Agent/Thread state。
- Renderer 只通过 typed IPC 访问 Electron-local capability。
- Renderer 不访问 Node.js APIs。
- Renderer 不访问私钥、raw filesystem services、Codex WebSocket 或 dApp internals。
- Renderer 将 preload capabilities 视为唯一 privileged bridge。
- Renderer 从 canonical timeline 读取持久 history，并通过统一 AI SDK providers 消费实时 turn。

保留的 Sidebar 展示模型现在直接接收 Cypheria API 的 `ProjectView`、`ThreadView` 与 `SectionView`。Section 归属、Project 嵌套、Pinned state、排序、分页、归档、Fork、重命名与移动不再从 Codex metadata 推断。现有 Pinned、自定义 Sections、Projects、Recents 层级，以及 virtualization、渐进展示、菜单、键盘行为、未读状态和带回滚的乐观更新继续作为 UI 基线。

保留的会话 scope 继续持有草稿、附件、缓存的 `Chat`、虚拟列表、滚动恢复与导航连续性。Codex 实时 turn 使用 `@cypheria/ai-sdk-provider/codex`；持久 history 从 server-owned canonical timeline 恢复。通用 message、reasoning、tool、command、diff、plan、approval、artifact、status 与 error item 复用同一 renderer。运行中 steer 是按 capability 开启的通用 Thread operation：Codex 映射到 App Server steer，Pi 映射到 Pi RPC，不支持的 provider 明确拒绝。

Desktop 的信息架构以对话为中心。新对话与搜索固定在常驻侧栏顶部；待审批、钱包、Schedules、签名策略、审计、插件与技能，与可折叠的 Pinned、自定义 Sections、Projects、Recents 共用同一虚拟滚动区域。Projects、Threads、Sections、直接归属、排序、分页、归档、Fork 与搜索全部通过 `@cypheria/client` 使用 Cypheria Projects/Threads/Sections API；renderer 不再根据 Codex metadata 推断 Section 归属，也不再通过 IPC 调用 App Server 方法。Electron main 只保留目录选择器与路径显示操作。会话工作区保留现有 Codex 衍生的 Composer、按 Thread Scope、虚拟滚动、草稿、附件、未读状态、命令/diff/plan/审批/artifact 展示、面板与导航行为，并依据 `ThreadView.agentId` 选择 provider extension。

会话内容区使用 TanStack Virtual，支持实测可变高度 row、稳定 timeline ID、末端锚定、追加跟随与 overscan。Renderer 持有最多 20 项的 Thread Scope，在导航期间保留草稿、附件、运行中 stream、row 测量、稳定可见锚点、原始 offset、距底部距离、viewport 高度与跟随状态。所有 Agent 共用同一工作区、Composer、Timeline、Terminal panel 与错误恢复；provider 个性化只存在于带判别字段的 canonical timeline extension、Header 操作、模型控件与权限流程。项目范围 PTY 通过 `client.terminals` 打开、resize、写入和关闭；Server 解析 project root 并负责进程回收。

插件与技能工作台通过 `@cypheria/client` 消费规范化 Integration 视图。Skills 与 MCP server 携带 Agent 兼容标签。插件同时保留生态（`cypheria`、`openai`、`claude`、`pi` 或 `opencode`）与市场来源（`cypheria`、`openai`、`claude`、`pi`、`opencode` 或 `custom`），不再从展示名称推断信任。Server 调用各 Agent 的原生集成机制；Codex 操作当前映射到 generated App Server method。Cypheria 原生插件使用独立的权限清单和受控 Server/Desktop 扩展点。共享 renderer component 不得压平 provenance、trust、compatibility 或 failure。

Settings 仍提供含插件/应用/MCP/技能/市场五个页签的 Plugins 页面。Cypheria Server 持有清单、限定启用、HTTP MCP 添加、市场变更、插件安装与授权链接创建。Codex Apps 仍是 `client.providers.codex.apps` 下的 Codex 专属 provider extension。Electron main 只负责校验并通过操作系统打开 Server 返回的 HTTP(S) 授权地址。Renderer 监听授权完成通知并刷新状态，不把打开登录页当作授权成功。Renderer 只接收安全 schema，不直接读取 `$CYPHERIA_HOME`，也不会获得 MCP 凭据。详见[插件与技能管理](plugin-skill-management.zh-CN.md)和 [Cypheria Marketplace 设计](marketplace.zh-CN.md)。

Web3 工作台完成本地管理闭环。钱包页面可以创建或导入加密 vault 钱包、添加 watch-only accounts、选择 active account 与 chain、锁定或解锁 vault，并启动隔离 dApp session。Policy 页面可以创建、编辑和停用 signing rules。Approval 页面会在接受或拒绝之前展示 canonical intent 与 payload hash，audit 页面则展示由此产生的本地安全历史。Network、wallet、policy、approval 与 audit record 都通过版本化 `client.web3` API 访问；Renderer 不再使用旧 Electron IPC 数据路径。钱包秘密表单值从 uncontrolled form 经认证的 Cypheria connection 直接提交，不会复制到 React state、localStorage、IndexedDB 或普通 SQLite table。

生产 renderer assets 由 Electron main 通过 privileged standard `cypheria://` scheme 提供。缺失的应用路径回退到 SPA shell，已解析的 assets 则被限制在构建后的 renderer directory 内。这样无需在生产环境运行 TanStack Start server bundle，也能直接导航到 workbench 与 settings routes。

Desktop 本地化在 TanStack Start renderer 中使用 Lingui，语言偏好的持久化和操作系统 locale 解析由 Electron main 负责。常规设置页中的可搜索语言选择器把偏好写入 Electron 本地的 `$CYPHERIA_HOME/desktop/desktop-settings.json`，绝不修改 Codex `config.toml`。经过类型校验和编码的 preload argument 同时提供用户选择与最终 catalog locale。预渲染 SPA shell 与首次客户端渲染统一使用英语 source catalog，hydration 后 renderer 立即激活 bootstrap locale，从而保持 hydration 的确定性；初始及后续语言变化都通过 typed settings IPC 响应式生效。选择器提供桌面端参考截图中的完整 Codex 语言集合；renderer 当前随包提供英语与简体中文 catalog，其他显式选择或系统 locale 均回退到英语，同时保留已保存的语言选择。

Renderer 通过 `@cypheria/ai-sdk-provider` 与 `@cypheria/client` 使用 Codex、Claude、Pi、OpenCode 和 ACP。实时 stream 与恢复后的历史都以 Server-owned Canonical Timeline 为准，稳定 provider metadata 保留原生 ID 与 provider 专属细节。Server 拥有 provider 安装、登录、配置、进程、session、protocol validation 与 interaction routing。Electron main 不依赖 Agent SDK、ACP SDK、Codex bridge、数据库、Web3 runtime 或 terminal process。

每个受管 ACP harness 都会获得合成 OS home 与该 harness 专用的 home 环境变量，因此二进制、配置、凭据、缓存和可变状态都留在 Cypheria home 下。Hermes 始终接收 `HERMES_HOME` 和 `HERMES_INSTALL_DIR`，且绝不安装 desktop 包。每次成功安装都会写入收据，记录安装器来源与参数、非秘密的受管环境、探测到的版本、可执行文件 SHA-256，以及该 harness 根目录下所有新增或变化的文件。Connections 拥有由 `node-pty` 支撑的页面级多标签 PTY dock；切换 harness 卡片不会关闭标签，离开该路由时 Electron 会关闭全部终端。上游命令、认证路径、更新信号和各 harness 的目录约束见 [ACP Harness Connections 设计](acp-harness-connections-design.zh-CN.md)。

Desktop 将连接代理偏好作为本地设置，并应用于 Electron network traffic。Agent 启动参数、共享 provider 代理行为、凭据与进程重启属于 Server 职责，通过 Cypheria settings 和 provider API 暴露；Desktop 不直接重启 provider process。

## Codex 集成

`apps/server` 持有 Codex process、原生 JSON-RPC transport、generated-schema validation、reverse request，以及向 Cypheria Thread 与 Canonical Timeline 的投影。包括 Desktop 在内的所有 client 都通过版本化 Cypheria protocol 调用，不直接连接 Codex App Server。浏览器安全的 `@cypheria/ai-sdk-provider/codex` 只消费 `@cypheria/client` 的 Thread operation 与 Timeline event，不启动 Codex，也不读取 Codex 文件。

Codex 特有的高保真展示数据继续属于 `@cypheria/protocol`：`CodexTurnProjector` snapshot、generated-image metadata、native ID、plan、diff、reroute 与其他无法映射的事件可以和通用 Timeline item 共存。Desktop 保留已经打磨的 Codex turn UI；共享会话 shell 则为所有 Agent 统一处理草稿、附件、streaming、取消、虚拟列表、滚动恢复、未读与导航。

Account/login、configuration、approval、Skills、MCP、Plugins、Marketplaces 与 OpenAI Apps 等 application operation 通过 `client.providers.codex` 暴露，不经过 AI SDK。Reverse request 在 Server 边界保持 fail-closed 且可审计。

Codex app-server generated artifacts 放在：

```txt
packages/protocol/src/generated/codex/
  ts/      generated TypeScript
  schema/  generated 与 validation-adapter JSON Schema
```

通过以下命令生成：

```sh
pnpm codex:generate
```

Generated protocol files 需要提交。不要手写 Codex app-server protocol request、response、notification 或 server request types。

## ACP AI Provider

`apps/server` 持有 ACP process 与 protocol execution。`@cypheria/ai-sdk-provider/acp` 是基于 `@cypheria/client` 的浏览器安全 AI SDK facade：选择 ACP registry Agent，创建或恢复 Cypheria Thread，流式消费 Canonical Timeline，并通过 Thread API 取消。ACP capabilities 与 native metadata 通过带判别字段的 protocol extension 保留，不向 client 暴露 ACP SDK。

## Wallet Provider 与 dApp Browser 边界

每个 dApp origin 都运行在独立 Electron session 中。dApp 页面会收到 Ethereum 与 Solana wallet-provider surfaces，但 requests 会转发到 Electron main，并通过 origin-scoped permissions 和 signing policy 评估。

`@cypheria/web3/provider` 负责：

- Origin-scoped session keys。
- Persistent partition names。
- Ethereum 与 Solana dApp permission records，以及有界 request/response envelopes。
- 完整的 EIP-1193 provider API：`request`、`on`、`removeListener`，包括五种标准事件和 `ProviderRpcError` 映射。
- EIP-6963 provider metadata、不可变 announcement、request/re-announcement 生命周期，以及传统 `window.ethereum` 兼容性。
- 实现 `standard:connect`、`standard:disconnect`、`standard:events`、`solana:signMessage`、`solana:signTransaction` 和 `solana:signAndSendTransaction` features 的 Solana Wallet Standard wallet。
- 使用官方 Wallet Standard packages 对 Solana account、chain、feature、byte envelope 和批量响应边界进行运行时验证。
- 用于 account、chain、connect、disconnect 与 message changes 的 protocol-scoped provider event envelopes。

dApp browser 不与 Codex preview/browser capabilities 共享钱包权限模型。

已实现的 browser boundary 会把远程 origin 规范化为 HTTPS（仅 loopback 开发环境允许 HTTP），通过 Drizzle/libSQL 持久化 `dapp_origins`、Ethereum `dapp_permissions` 与 `solana_dapp_permissions`，并且只在同一 origin 内复用一个持久化 Electron partition。Electron 的 session-data root 设置为 `$CYPHERIA_HOME/browser`。Desktop 创建 dApp `WebContentsView` 时禁用 Node integration，并启用 context isolation、sandbox 与 web security，同时拒绝跨 origin 导航、popup window 和环境 Electron permission request。独立的 dApp preload 把 EIP-1193 provider 暴露为 `window.ethereum`，通过 EIP-6963 announcement 发布它，并通过 Wallet Standard events 注册 Solana provider。Sandbox preload 会打包除 Electron 外的所有 runtime dependencies，使用 plain-data facade 让 Wallet Standard accounts 跨越 `contextBridge`，并把 provider icons 限制为 raster data URI。真实 Electron smoke test 会在这些 production isolation settings 下验证两种 discovery 机制。

Electron main 会把每个已创建的 WebContents ID 与其规范化 origin、session key 绑定。每个 Ethereum 或 Solana provider IPC request 必须同时匹配这一可信注册信息和 sender 当前 URL，之后才能进入 the `apps/server` runtime 的 `dapp.provider-request` 或 `dapp.solana-provider-request`。Ethereum runtime 无需钱包权限即可转发有界 allowlist 中常用的公共只读 RPC methods，对 privileged methods 检查未过期的 origin/account/method permission，审计脱敏结果，并在 injected executor 完成前把 signing methods 转换为 dApp 来源的 signing intents。Solana runtime 实现 silent/interactive connection、持久化 origin permissions、内存连接状态、account/feature/chain authorization，以及 message signing、transaction signing 和 sign-and-send 的 policy-backed signing intents。Main 只会向已注册的 dApp WebContents 发送成功的 account 与 chain changes；preload 再把它们转换为 EIP-1193 或 Wallet Standard events。Renderer 或 dApp 自报的 origin 字段绝不作为权限依据。Desktop runtime options 只会在提供相应 authorizer、dispatcher 或 executor 后安装 provider service；否则 bridge 会 fail closed。

## 签名流程

```txt
dApp, schedule, or agent context
  -> signing intent
  -> PolicyEngine
  -> persisted decision / approval request
  -> simulation/risk metadata when available
  -> approval UI if required
  -> WalletService
  -> durable one-time intent claim
  -> RPC broadcast if applicable
  -> AuditLogService
```

Agent 与 schedule 都不能直接签名交易，只能创建 signing intent 并交给 Cypheria policy 处理。

钱包签名 capability 绑定具体账户，并且只消费 intent 一次。它们要求注入 policy/approval authorizer，只通过 scoped callback 访问已解锁 vault 秘密，验证派生 signer 与生成签名，并写入脱敏 audit record。交易广播由独立 capability 提供。

Signing policy 按钱包划分 scope，持久化在 libSQL 中，并通过使用严格 schema 和乐观 revision 检查的 runtime service 管理。评估具有确定性；conditional auto-signing 没有匹配的 allow policy 时会退回 human approval。Policy 变更和每次评估结果均写入 audit。

Signing-intent runtime 只接受严格的来源上下文（`dapp`、`schedule` 或 `agent`），由自身分配 intent ID 与创建时间，在持久化前完成 policy evaluation，并把精确的 canonical payload 及其 hash 保存到 libSQL。人工决议通过受乐观 revision 保护的 libSQL atomic batch 同时更新 `approval_requests` 与 `signing_intents`。Approval IPC 会暴露知情审阅所需的精确 intent，但绝不暴露 vault 材料；audit entry 只包含 payload hash 与脱敏摘要。

## Schedule 流程

```txt
once、interval、cron cadence 或 manual run
  -> Server ScheduleService
  -> 原子 SQLite lease 与 next-run advance
  -> ThreadManager 或受 policy 控制的 Web3 executor
  -> signing intent for write operations
  -> PolicyEngine
  -> approval or policy decision
  -> 持久化 run result 与 audit record
```

`apps/server` 持有 schedules，并且只通过版本化 Cypheria protocol 对外提供。Schedule 可以启动新的 Agent thread、继续已有 Thread，或调用有界的 Web3 method；definition 支持 once、固定 interval 与五字段 cron cadence。执行前，Server 会原子 claim 到期 slot 并推进 next-run state，避免 timer 重叠或重启恢复造成重复执行。

Run 会持久化 target type、scheduled time、status、result、error 与创建的 Thread ID。重启后，遗留的 running record 会被标记为 `interrupted`；进行中的 Web3 签名或广播绝不重放。Desktop 和 CLI 通过 `@cypheria/client` 执行 list、create、update、pause、resume、delete、manual-run 与 history 操作。Cloud Agent execution 与通用 workflow engine 仍不在范围内。

## 数据模型

SQLite 是非敏感本地数据的 source of truth。Drizzle 通过 libSQL 的 SQLite 入口访问本地 `file:` 数据库；这不需要、也不代表使用远程 Turso/libSQL 服务。敏感钱包材料保存在 encrypted vault 中。Desktop 可以接入 OS-backed key protection；headless Server fallback 把 vault master key 放在 SQLite 之外的 owner-only 文件中，并用它加密 vault entry 与受保护的 RPC credential。

钱包领域与 vault 的详细设计见 `docs/wallet-management.zh-CN.md`。

当前核心表：

```txt
settings
audit_logs
workspaces
runtime_metadata
schedules
schedule_runs
wallets
wallet_accounts
chain_accounts
wallet_hd_schemes
active_wallet_context
signing_policies
signing_intent_claims
signing_intents
approval_requests
dapp_origins
dapp_permissions
```

规划中的 runtime tables：

```txt
rpc_endpoints
```

## Runtime Home

Cypheria-owned data 位于 `$CYPHERIA_HOME`，默认 `~/.cypheria`。

```txt
$CYPHERIA_HOME/
  codex/        Cypheria-managed Codex 的 home
  db/
  vault/
  logs/
  cache/
  browser/
  config/
```

Cypheria 管理的 Codex 进程必须使用：

```sh
CODEX_HOME="$CYPHERIA_HOME/codex"
```

## 安全模型

默认规则：

- `nodeIntegration: false`。
- `contextIsolation: true`。
- `sandbox: true`。
- `webSecurity: true`。
- 严格 Content Security Policy。
- dApp permissions 按 origin 隔离。
- 私钥只进入 encrypted vault。
- Renderer 和 dApp pages 永远不能访问私钥。
- Codex 和 schedule flows 创建 signing intents，而不是 direct signatures。
- 每个 signing intent 都经过 `@cypheria/web3/policy`。
- Auto-signing 默认关闭。
- 每个 policy decision、signature、rejection、schedule run 和 transaction hash 都可审计。

## Package 边界

```txt
apps/server/src/runtime
  Server 私有 runtime host 与 Web3 service orchestration；client 不得依赖。

@cypheria/protocol
  版本化、transport-neutral 的 Cypheria client/server contract 与 Zod validation。

@cypheria/client
  分层的 WebSocket protocol driver、借用 API 门面与持有连接的 client。

@cypheria/sdk
  规划中的 Cypheria server protocol 公共 TS client。

apps/server Codex adapter
  Server 持有的 Codex App Server transport、validation、reverse request 与 event normalization。

@cypheria/ai-sdk-provider/acp
  基于 Cypheria client 与 Canonical Timeline 的浏览器安全 AI SDK provider。

@cypheria/web3/network
  Canonical chain identity、严格 network/RPC model、catalog entry 与 protocol conversion helper。

apps/desktop/ipc
  Desktop-local typed Electron IPC contracts, schemas, channel names, and envelopes.

@cypheria/web3/wallet
  Wallet domain types、accounts、chain-account bindings、permissions 与 signing intents。

@cypheria/web3/policy
  Signing policy schemas, evaluator, and policy decisions.

@cypheria/web3/provider
  dApp session, provider bridge, and browser permission models.

@cypheria/db
  SQLite schema, migrations, and local persistence helpers.

@cypheria/ui
  Shared UI primitives and Cypheria product components.
```

## Network 与 RPC 边界

Chain identity、network metadata、RPC connectivity 与 active selection 是相互独立的概念。无论 network 当前是否已配置，wallet account 与历史 record 都会保留 canonical chain identity。`@cypheria/web3/network` 负责严格的 EVM/Solana identity 与 configuration schema；the `apps/server` runtime 负责 catalog reconciliation、endpoint probe、credential resolution、health-aware routing，以及 workspace/origin-scoped selection。

RPC connection secret 在普通 SQLite 列之外受保护，永远不会跨越 renderer 或 dApp IPC。Read-only call 可以在经过验证的 endpoints 间 failover；broadcast 收到模糊响应后绝不盲目重试。Custom destination 必须经过 SSRF control，dApp 只有在批准后才能切换自身 origin-scoped provider context。

完整模型、持久化方案、routing rule 与实施顺序见 `docs/network-management.zh-CN.md`。

## V1 约束

- 不 fork Codex runtime。
- 不创建 `@cypheria/codex-protocol`。
- 不手写 Codex app-server protocol types。
- 不实现 TUI。
- 不将私钥存入 renderer、localStorage、IndexedDB 或普通 SQLite 表。
- 不在不同 dApp origins 间共享 browser sessions。
- 不把 wagmi 作为核心钱包层。
- 不引入 cloud agent execution。
- 在 local runner 形态稳定前，不引入复杂 workflow engine。
