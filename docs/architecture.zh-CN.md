# Cypheria 架构

Cypheria 是一个 TypeScript Web3 agent 产品：它复用 Codex 承载软件工程 agent 工作流，并由 Cypheria 自己实现 Web3 runtime，包括钱包、签名策略、dApp 浏览、自动化、本地状态和审计能力。

架构的核心规则是：agent 工作、Web3 签名、自动化执行、本地文件和 dApp 浏览不能混在同一个信任边界里。

## 系统概览

```txt
apps/cli
  -> @cypheria/runtime
  -> @openai/codex-sdk

packages/sdk
  -> @cypheria/runtime
  -> @openai/codex-sdk

apps/desktop renderer
  -> Electron typed IPC
  -> Electron main
  -> @cypheria/runtime
  -> @cypheria/codex-bridge
  -> persistent codex app-server over WebSocket JSON-RPC

apps/marketplace
  -> TanStack Start on Cloudflare Workers
  -> D1 publication system of record + R2 immutable artifacts
  -> Queues + Workflows for scan/review/publication
  -> official GitHub repo marketplace projection
```

Cypheria 有四个产品 surface 和一个共享 runtime：

- `apps/cli`：无 TUI 的命令行应用，直接组合 Cypheria runtime 和 Codex TypeScript SDK。
- `apps/desktop`：Electron + TanStack Start 应用，在 Electron main 中运行 Cypheria runtime，并连接常驻 Codex App Server。
- `apps/marketplace`：部署在 Cloudflare Workers 上的 TanStack Start 应用，负责 ChatGPT/Codex-compatible 插件的提交、扫描、审核、发布与发现，再把 approved entry 同步到 Cypheria 官方 GitHub repo marketplace。
- `packages/sdk`：公共 TypeScript SDK，直接组合 Cypheria runtime 和 Codex TypeScript SDK。
- `packages/runtime`：Cypheria 自有非 agent 能力的 TypeScript runtime。

Codex 负责 agent threads、turns、model execution、code edits、shell/tool execution、MCP 和 Codex approvals。Cypheria 负责 Web3 context、wallets、signing intents、policy evaluation、dApp browser permissions、automation state、本地数据和 audit logs。

Marketplace 是独立的远程 trust boundary。D1 是 review/publication system of record；后端将 published release 确定性投影到 Cypheria 官方 GitHub repository 的 `$REPO_ROOT/.agents/plugins/marketplace.json`。Entry 只能使用由 commit SHA 固定的 public open-source GitHub `url` 或 `git-subdir` source。R2 保存不可变 evidence，Queues 分发有界工作，Workflows 编排 scan、review 与 catalog publication。Marketplace 不在 request Worker 中执行任意第三方代码，也不接收本地 wallet、Codex home、终端用户 connector credential 或 runtime state。详见 [Cypheria Marketplace 设计](marketplace.zh-CN.md)。

## Runtime 边界

`@cypheria/runtime` 是 Cypheria 非 agent runtime。它负责：

- Runtime home 解析与目录初始化。
- Settings 和本地 metadata。
- Wallet/account/chain/RPC service boundaries。
- Signing intent 创建与 policy evaluation hooks。
- dApp browser permission 和 session domain state。
- Automation task 和 run orchestration。
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
automation.*
audit.*
settings.*
```

## CLI

`apps/cli` 是 Node-based CLI，V1 不做 TUI。它不依赖 `@cypheria/sdk`，而是直接组合：

- `@cypheria/runtime`：Cypheria 自有本地/Web3 能力。
- `@openai/codex-sdk`：agent 工作流。

初始命令组：

```txt
cypheria run <prompt>
cypheria run --jsonl <prompt>
cypheria runtime info
cypheria wallet list
cypheria policy list
cypheria automation run <task-id>
cypheria doctor
```

CLI 应支持 human-readable 输出和面向自动化的 JSONL 输出。CLI 不应导入 desktop internals。

## SDK

`@cypheria/sdk` 是面向外部 Node 应用的公共 TypeScript API。它直接组合：

- `@cypheria/runtime`：Cypheria 自有能力。
- `@openai/codex-sdk`：Codex agent threads。

目标 SDK 形态：

```ts
import { Cypheria } from "@cypheria/sdk"

const cypheria = new Cypheria()
const info = await cypheria.runtime().info()

const thread = cypheria.agent().startThread({ workingDirectory: process.cwd() })
const result = await thread.run("Analyze this repo")
```

SDK 不应依赖 Electron、desktop IPC 或 `@cypheria/codex-bridge`。

## Desktop

Desktop 保留现有 Electron + TanStack Start 架构。

```txt
TanStack Start Renderer
  - product UI
  - route state
  - Jotai UI state
  - TanStack Query cache
  - typed IPC client only

Electron Main Process
  - CypheriaRuntime lifecycle
  - Codex App Server lifecycle
  - Codex WebSocket bridge
  - wallet/signing/policy/database/automation services
  - dApp WebContents/session management
```

Desktop startup：

```txt
Electron main starts
  -> resolve CYPHERIA_HOME
  -> ensure runtime directories
  -> start CypheriaRuntime
  -> set CODEX_HOME=$CYPHERIA_HOME/codex
  -> start codex app-server --listen ws://127.0.0.1:<port>
  -> connect @cypheria/codex-bridge with initialize/initialized
  -> create renderer window
```

Renderer 规则：

- Renderer 只使用 typed IPC。
- Renderer 不访问 Node.js APIs。
- Renderer 不访问私钥、raw filesystem services、Codex WebSocket 或 dApp internals。
- Renderer 将 preload capabilities 视为唯一 privileged bridge。
- Renderer 通过 typed `codex.event` IPC channel 接收 Codex lifecycle、stderr、notification 和 server-request summaries。

Desktop 的信息架构以对话为中心。新对话和搜索固定在常驻左侧导航顶部；待审批、钱包、自动化、signing policies、audit logs、plugins 与 skills 则和可折叠的 Pinned、自定义分组、Projects、Recents 共用同一个虚拟滚动区域。侧栏菜单会持久化 Pinned 与普通对话各自的排序选择，并可在按项目组织和把全部对话合并到 Recents 的单列表模式之间切换。自定义分组通过 typed IPC 使用 experimental App Server 的 `threadSection/*` 生命周期与 `thread/section/move` 方法；从分组入口启动的新对话在 App Server 创建持久 thread 后立即移入该分组。会话条目菜单支持置顶、重命名、在项目/分区间移动、安全复制、归档与确认删除；项目菜单支持置顶、编辑、分区归属、在项目中新建会话、在访达中显示、批量归档会话与移除。项目位置通过 Cypheria 命名空间的 App Server project metadata 持久化；在访达中显示时，由 Electron main 根据 project ID 解析目录，不接受 renderer 传入的路径。分区菜单支持编辑、确认归档直接会话及所含项目中的全部会话，以及删除。Projects 直接来自 App Server `project/list`，因此没有对话的项目也可见；renderer-safe IPC 支持项目创建、重命名、删除，以及由 main process 承载的目录选择器。新对话可以选择项目，并把项目的 `projectId` 和第一个 root 作为 `cwd` 传给 `thread/start`。Pinned 与一级项目仅在用户明确点击 Show more 后再展示 5 条；展开后的每个项目也以每次 5 个对话的方式渐进展示。Recents 不设置展示数量上限，其末尾加载行进入视口时会获取下一页 App Server cursor。待审批入口会显示尚未决议的 signing approvals 实时数量。对话工作区将 AI Elements conversation 与 composer 放在主区域，提供 project、model、reasoning、sandbox 和 wallet-context 控件，右侧是 context/files/review/terminal 面板；该面板宽度以工作台实际可用空间为基准约束，而不是以整个 viewport 为基准。App Server 的 `fileChange` 与 `commandExecution` tool parts 会同时驱动实时对话和已恢复对话的右侧面板：Files 为每个变化路径保留最新状态，Review 渲染已记录的 unified diff 并提供复制操作，Terminal 则渲染每条命令的 ANSI 输出、流式状态和退出状态。进入 Settings 后，工作台左侧导航会替换为 Connections、Appearance、Models 和返回工作台入口组成的专用设置导航。所有设置页都由完整的右侧内容面板承载滚动，因此滚动条保持在窗口最右侧。

会话内容区使用 TanStack Virtual，并通过实测的可变高度消息行、稳定 message ID 和 overscan 避免长历史对话一次挂载全部 turn。标题栏支持通过 App Server 原位重命名 thread。输入框支持经过校验的附件与截图捕获、技能插入、语音输入、项目与权限选择、模型与推理档位，以及相互独立的停止、运行中 steer 和下一 turn queue 操作。工作区 chrome 采用嵌套的可调整尺寸布局：右侧面板限制在 320 像素到工作台宽度一半之间；底部面板默认 280 像素，并限制在 160 像素到可用高度一半之间。项目范围的 `node-pty` 终端可在底部 dock 和右侧标签之间移动而不丢失会话。Renderer IPC 只传可选的 App Server project ID；Electron main 在启动 shell 前解析可信项目根目录，并统一拥有终端输入、resize、output、exit 和清理流程。

插件与技能工作台包含两个 discovery provider 和一条 App Server 安装路径。已实现的 Codex provider 通过 typed IPC 投影 `plugin/list` 返回的 marketplace record，用精确名称白名单识别 OpenAI 与 Cypheria 官方 identity，并把其他 marketplace 全部归入 Personal。待实现的 Cypheria provider 读取版本化 `apps/marketplace` API，获得分页发现、review state 与 advisory；Electron main 随后通过 App Server 注册或升级固定的 Cypheria 官方 GitHub repo，并调用 `plugin/read`/`plugin/install`。两者可以复用 renderer component，但不能压平 provenance、trust 与 failure。

Settings 仍提供含插件/应用/MCP/技能/市场五个页签的 Plugins 页面。Main 负责应用可用性与 MCP 清单投影、限定启用配置写入、HTTP MCP 添加和经过校验的外部授权地址。Renderer 监听授权完成通知并刷新状态，不把打开登录页当作授权成功。Renderer 只接收安全 schema，不直接读取 `$CYPHERIA_HOME`，也不会获得 MCP 凭据。详见[插件与技能管理](plugin-skill-management.zh-CN.md)和 [Cypheria Marketplace 设计](marketplace.zh-CN.md)。

Web3 工作台完成本地管理闭环。钱包页面可以创建或导入加密 vault 钱包、添加 watch-only accounts、选择 active account 与 chain、锁定或解锁 vault，并启动隔离 dApp session。Policy 页面可以创建、编辑和停用 signing rules。Approval 页面会在接受或拒绝之前展示 canonical intent 与 payload hash，audit 页面则展示由此产生的本地安全历史。钱包秘密表单值会从 uncontrolled forms 直接提交到 preload，不会复制到 React state、localStorage 或 IndexedDB。

生产 renderer assets 由 Electron main 通过 privileged standard `cypheria://` scheme 提供。缺失的应用路径回退到 SPA shell，已解析的 assets 则被限制在构建后的 renderer directory 内。这样无需在生产环境运行 TanStack Start server bundle，也能直接导航到 workbench 与 settings routes。

Desktop 本地化在 TanStack Start renderer 中使用 Lingui，语言偏好的持久化和操作系统 locale 解析由 Electron main 负责。常规设置页中的可搜索语言选择器将 Codex 兼容的 `[desktop].localeOverride` 写入 `$CYPHERIA_HOME/codex/config.toml`；自动检测会删除该键。经过类型校验和编码的 preload argument 同时提供用户选择与最终 catalog locale。预渲染 SPA shell 与首次客户端渲染统一使用英语 source catalog，hydration 后 renderer 立即激活 bootstrap locale，从而保持 hydration 的确定性；初始及后续语言变化都通过 typed settings IPC 响应式生效。选择器提供桌面端参考截图中的完整 Codex 语言集合；renderer 当前随包提供英语与简体中文 catalog，其他显式选择或系统 locale 均回退到英语，同时保留已保存的语言选择。

Electron main 将 App Server 适配为 AI SDK `ProviderV4`，并通过 typed IPC 流式传输 AI SDK UI-message chunks。除了可移植的 AI SDK text、reasoning、file、source 与 tool parts，共享的 `CodexTurnProjector` 还会为完整 turn envelope、完整 generated `ThreadItem`、item 生命周期与 progress、terminal interaction、plan update、diff、model reroute 以及其他未映射的 turn notification 生成持久化 typed `data-codex-*` parts。稳定 ID 让后续 delta 与 completion event 可以替换对应 data part，而不会丢失原始 App Server 语义。新对话完成后会在 route 中采用 App Server thread ID；重新打开对话时会分页读取设置了 `itemsView: "full"` 的 `thread/turns/list`，并让每个已存 turn 经过同一个 projector，从而保留 status、timing、error、item order 与 final-answer phase，而不是根据扁平 item list 近似重建历史。后续 turn 仍恢复 canonical App Server thread，不会重放历史。Electron main 同时负责 agent harness login/logout 与 Codex config 读写。Connections 设置页为 Codex 实现 ChatGPT managed 浏览器身份验证与 OpenAI API key 登录。Grok Build、Cursor、Gemini CLI、Hermes 和 OpenCode 是可选的 ACP v1 harness：Electron 可将最新版本安装到 `$CYPHERIA_HOME/harnesses/<id>`、展示已安装版本、启用或禁用集成，并在接受安装前验证 ACP 初始化。V1 模型 provider 支持 Codex 原生的 OpenAI、Amazon Bedrock、Ollama 和 LM Studio。Ollama 与 LM Studio 无需 OpenAI 身份验证即可使用。通用 custom-provider 表单明确延后。

每个受管 ACP harness 都会获得合成 OS home 与该 harness 专用的 home 环境变量，因此二进制、配置、凭据、缓存和可变状态都留在 Cypheria home 下。Hermes 始终接收 `HERMES_HOME` 和 `HERMES_INSTALL_DIR`，且绝不安装 desktop 包。每次成功安装都会写入收据，记录安装器来源与参数、非秘密的受管环境、探测到的版本、可执行文件 SHA-256，以及该 harness 根目录下所有新增或变化的文件。Connections 拥有由 `node-pty` 支撑的页面级多标签 PTY dock；切换 harness 卡片不会关闭标签，离开该路由时 Electron 会关闭全部终端。上游命令、认证路径、更新信号和各 harness 的目录约束见 [ACP Harness Connections 设计](acp-harness-connections-design.zh-CN.md)。

Connections 还维护一份供所有 agent harness 共用的全局代理配置，其控件默认折叠。选择 system、direct 或 manual 路由时会立即持久化；只有手动代理字段与已保存配置不同时，表单才显示保存操作。HTTP、HTTPS、SOCKS5 路由通过 typed IPC 校验，并以明文保存在 `$CYPHERIA_HOME/config/proxy.json`。Electron 将该路由用于自身连接请求，harness 子进程则接收对应的标准代理环境变量，同时强制让 loopback 地址绕过代理。保存新路由后会重启 persistent Codex process，使登录、模型发现、MCP 与模型流量使用同一设置。API key 校验和代理测试使用 Electron 网络栈；测试通过未认证的 OpenAI models 请求确认能够到达 OpenAI 并收到其认证响应。

## Codex 集成

Cypheria 使用两条 Codex 集成路径：

- CLI 和 SDK 使用 `@openai/codex-sdk`。
- Desktop 使用 `codex app-server` over WebSocket JSON-RPC。

`@cypheria/codex-bridge` 是 desktop-side app-server client。它负责：

- WebSocket transport。
- JSON-RPC request/response correlation。
- `initialize` request 和 `initialized` notification handshake。
- Server notification stream。
- Server-initiated approval、user-input 与 MCP-elicitation request routing。
- Disconnect 和 lifecycle handling。
- app-server overload errors 的重试处理。
- 为使用 AI SDK / AI Elements 的聊天界面提供 AI SDK `ProviderV4` adapter。
- Experimental dynamic-tool registration，以及向 Electron-main handler 的 dispatch。

Desktop main 拥有 Codex App Server process lifecycle。它选择 localhost port，以 `CODEX_HOME=$CYPHERIA_HOME/codex` 启动 `codex app-server`，等待 bridge readiness，记录 stderr，并随 desktop runtime 一起关闭 child process。App Server binary 与 generated protocol 是原子 compatibility unit：development 解析精确固定的 workspace `@openai/codex` dependency，packaged build 解析 Electron 内置 resource，启动时拒绝 reported version 与 `CODEX_APP_SERVER_VERSION` 不一致的 binary。`CYPHERIA_CODEX_PATH` 仅用于显式 diagnostics，并继续接受相同的版本检查。

这套集成明确分为两个 capability plane。AI SDK adapter 是 `@ai-sdk/react` 与 AI Elements 使用的消息平面。它把可兼容的 Codex 输入和输出映射为 `LanguageModelV4`：text、reasoning、image、audio、structured output、provider-executed tool 及 progress、generated file、web source、token usage、response metadata、model listing、turn interrupt 与 mid-turn steer。兼容 part 的 provider metadata 会保留完整的 Codex item projection。Electron main 还会把每个 `CodexTurnProjector` update 作为 typed、persistent AI SDK data part 传输，使 renderer 获得完整 App Server turn，而无需把 Codex-specific 语义硬塞进可移植的 `LanguageModelV4` vocabulary。把已恢复 UI message 转回 model input 时，AI SDK 会忽略这些 data parts；canonical App Server thread 仍是模型历史的 source of truth。不支持的 AI SDK call setting 和 media 会形成 warning，不会静默改变语义。持久 thread resume 默认继承 App Server 已存的 approval 与 sandbox setting，只有调用方显式提供时才覆盖。

Renderer 会识别增强后的 turn shape，并把 final answer 与可折叠 activity 分开展示。它保留 commentary 和 `final_answer` phase 的差异，推导 Codex-style reasoning/tool group，展示实时与完成后的 duration label，并通过完整 item snapshot 渲染 command、file change、MCP/collaboration work、web result、generated image、plan、diff 与 reroute。Reverse-request card 仍通过独立 interaction channel 传输，但会按 turn ID 关联到对应 turn，并在等待用户操作时保持该 turn 的 activity 展开。对于没有 Codex turn part 的 message，通用 AI SDK message renderer 仍作为 compatibility fallback。

不属于 language-model generation 的 application operation 不经过 AI SDK。Thread/project lifecycle、review/diff state、account/login、plugin、skill、MCP server、terminal、configuration，以及其他 stable 或 experimental App Server method，均通过 direct bridge 使用 generated request/response type，并且只通过收窄的 typed IPC service 暴露给 renderer。Protocol type 使用 `--experimental` 生成，desktop 在 initialize 时声明 `experimentalApi: true`，因此可以接入新的 experimental method，而无需扩大 AI SDK abstraction。Cypheria 拥有真实的 platform attestation provider 之前，不声明 client attestation；使用 App Server-managed authentication 时也不安装外部 ChatGPT token-refresh callback。

反向 JSON-RPC request 不是 AI SDK stream part。Electron-main 中的 fail-closed broker 处理 command、file-change、permission approval、tool user-input question 与 MCP elicitation。它通过 typed IPC 转发经过验证、适合 renderer 的 prompt，按具体 request method 校验 response shape，将 decision 写入 audit log，并在 timeout、disconnect、shutdown 或 handler 缺失时取消或拒绝。Experimental dynamic tool 使用独立 registry：定义随 `thread/start` 发送，`item/tool/call` 则执行已注册的 Electron-main handler。这样 wallet、policy、signing 及其他 privileged implementation 都不会进入 renderer，也不会落入 AI SDK client-tool callback。

Codex app-server protocol TypeScript 文件放在：

```txt
packages/codex-bridge/src/generated/
```

通过以下命令生成：

```sh
pnpm codex:generate
```

Generated protocol files 需要提交。不要手写 Codex app-server protocol request、response、notification 或 server request types。

## ACP AI Provider

`@cypheria/acp-ai-provider` 独立于 desktop-only Codex bridge。它通过官方 ACP 1.4 app-style client，把稳定 ACP v1 agent 适配为 AI SDK 7 `LanguageModelV4`。Language-model plane 映射文本、推理、媒体、原生 resource link、嵌入资源、来源、工具、停止原因、warning 与 raw 累计 usage；ACP control plane 则保留协商能力、client callback、session lifecycle/configuration、provider 与 next-edit control、document synchronization、extension method 和无损协议事件。不同 language-model 实例不共享 session 状态。可执行 AI SDK tool 通过仅监听 loopback、每实例认证的 MCP proxy 运行；由于 ACP 无法把调用挂起并作为独立 AI SDK step 恢复，不带 `execute` 的 client-side tool 会被拒绝。

Client capability 由显式安装的 handler 派生。权限请求默认取消；host 安装对应 handler 前，filesystem、terminal、elicitation 与 ACP-transport MCP 能力均保持禁用。系统支持稳定 stdio 和自定义 stream；HTTP/WebSocket helper 与高级控制均需显式实验性 opt-in。Draft ACP v2 被隔离在独立 import 中，只暴露官方 v2 client context，不伪装成稳定 `LanguageModelV4` 实现。

Package 测试通过内存 stream 连接官方 ACP 1.4 client 与 agent app。真实 Codex ACP、Gemini ACP 和 Claude ACP 进程互操作仍作为后续 integration-test 层。

## Wallet Provider 与 dApp Browser 边界

每个 dApp origin 都运行在独立 Electron session 中。dApp 页面会收到 Ethereum 与 Solana wallet-provider surfaces，但 requests 会转发到 Electron main，并通过 origin-scoped permissions 和 signing policy 评估。

`@cypheria/wallet-provider` 负责：

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

Electron main 会把每个已创建的 WebContents ID 与其规范化 origin、session key 绑定。每个 Ethereum 或 Solana provider IPC request 必须同时匹配这一可信注册信息和 sender 当前 URL，之后才能进入 `@cypheria/runtime` 的 `dapp.provider-request` 或 `dapp.solana-provider-request`。Ethereum runtime 无需钱包权限即可转发有界 allowlist 中常用的公共只读 RPC methods，对 privileged methods 检查未过期的 origin/account/method permission，审计脱敏结果，并在 injected executor 完成前把 signing methods 转换为 dApp 来源的 signing intents。Solana runtime 实现 silent/interactive connection、持久化 origin permissions、内存连接状态、account/feature/chain authorization，以及 message signing、transaction signing 和 sign-and-send 的 policy-backed signing intents。Main 只会向已注册的 dApp WebContents 发送成功的 account 与 chain changes；preload 再把它们转换为 EIP-1193 或 Wallet Standard events。Renderer 或 dApp 自报的 origin 字段绝不作为权限依据。Desktop runtime options 只会在提供相应 authorizer、dispatcher 或 executor 后安装 provider service；否则 bridge 会 fail closed。

## 签名流程

```txt
dApp, automation, or agent context
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

Codex 不直接签名交易。Automation 不直接签名交易。两者都只能创建 signing intents，并交给 Cypheria policy 处理。

钱包签名 capability 绑定具体账户，并且只消费 intent 一次。它们要求注入 policy/approval authorizer，只通过 scoped callback 访问已解锁 vault 秘密，验证派生 signer 与生成签名，并写入脱敏 audit record。交易广播由独立 capability 提供。

Signing policy 按钱包划分 scope，持久化在 libSQL 中，并通过使用严格 schema 和乐观 revision 检查的 runtime service 管理。评估具有确定性；conditional auto-signing 没有匹配的 allow policy 时会退回 human approval。Policy 变更和每次评估结果均写入 audit。

Signing-intent runtime 只接受严格的来源上下文（`dapp`、`automation` 或 `agent`），由自身分配 intent ID 与创建时间，在持久化前完成 policy evaluation，并把精确的 canonical payload 及其 hash 保存到 libSQL。人工决议通过受乐观 revision 保护的 libSQL atomic batch 同时更新 `approval_requests` 与 `signing_intents`。Approval IPC 会暴露知情审阅所需的精确 intent，但绝不暴露 vault 材料；audit entry 只包含 payload hash 与脱敏摘要。

## 自动化流程

```txt
manual trigger or scheduler
  -> AutomationRunner
  -> worker boundary
  -> runtime services / Codex SDK as needed
  -> signing intent for write operations
  -> PolicyEngine
  -> approval or policy decision
  -> AuditLogService
```

V1 automation 是 local-first。Cloud agent execution 和复杂 workflow engine 不在范围内。

已实现的 automation runtime 会把经过严格验证的 task definition 与独立 run record 持久化到本地 SQLite。Task 通过乐观 revision 在 `draft`、`enabled`、`paused` 和 `archived` 状态间流转；只有 enabled task 可以运行，partial unique index 保证每个 task 最多只有一个 queued 或 running execution。Runtime methods 覆盖 task create、list、inspect、pause/resume、run start 与 run inspect；desktop 通过 typed IPC 暴露相同边界。

Task handler 是由持久化 handler name 和仅 JSON、拒绝 secret field 的 input 选择的受信 runtime extension。它们只能获得 abort signal，以及注入式 Codex agent runner 和 signing-intent creation 两种窄能力，绝不会获得 wallet signer 或 secret。Signing capability 会强制设置 `source: automation`、把 correlation ID 替换为 run audit ID、检查 task 的 wallet/account/chain/origin/policy scope，再委托给正常 signing-intent 与 policy pipeline。Runtime shutdown 会先中止并等待 active execution，再关闭数据库。

## 数据模型

SQLite 是非敏感本地数据的 source of truth。Drizzle 通过 libSQL 的 SQLite 入口访问本地 `file:` 数据库；这不需要、也不代表使用远程 Turso/libSQL 服务。敏感钱包材料保存在受 OS-backed key storage 保护的 encrypted vault 中。

钱包领域与 vault 的详细设计见 `docs/wallet-management.zh-CN.md`。

当前核心表：

```txt
settings
audit_logs
workspaces
runtime_metadata
automation_tasks
automation_runs
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
  automation/
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
- Codex 和 automation flows 创建 signing intents，而不是 direct signatures。
- 每个 signing intent 都经过 `@cypheria/policy-engine`。
- Auto-signing 默认关闭。
- 每个 policy decision、signature、rejection、automation run 和 transaction hash 都可审计。

## Package 边界

```txt
@cypheria/runtime
  Cypheria non-agent runtime host and service orchestration.

@cypheria/sdk
  Public TS SDK; composes runtime and @openai/codex-sdk.

@cypheria/codex-bridge
  Desktop-side Codex App Server bridge, generated protocol types, transport, and event normalization.

@cypheria/acp-ai-provider
  Node 侧 ACP 1.4 agent bridge，提供 AI SDK 7 LanguageModelV4 与 ACP callback/control/event surfaces。

@cypheria/network-core
  Canonical chain identity、严格 network/RPC model、catalog entry 与 protocol conversion helper。

apps/desktop/ipc
  Desktop-local typed Electron IPC contracts, schemas, channel names, and envelopes.

@cypheria/wallet-core
  Wallet domain types、accounts、chain-account bindings、permissions 与 signing intents。

@cypheria/policy-engine
  Signing policy schemas, evaluator, and policy decisions.

@cypheria/wallet-provider
  dApp session, provider bridge, and browser permission models.

@cypheria/automation-core
  Automation task, trigger, run, log, and audit correlation models.

@cypheria/db
  SQLite schema, migrations, and local persistence helpers.

@cypheria/ui
  Shared UI primitives and Cypheria product components.
```

## Network 与 RPC 边界

Chain identity、network metadata、RPC connectivity 与 active selection 是相互独立的概念。无论 network 当前是否已配置，wallet account 与历史 record 都会保留 canonical chain identity。`@cypheria/network-core` 负责严格的 EVM/Solana identity 与 configuration schema；`@cypheria/runtime` 负责 catalog reconciliation、endpoint probe、credential resolution、health-aware routing，以及 workspace/origin-scoped selection。

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
