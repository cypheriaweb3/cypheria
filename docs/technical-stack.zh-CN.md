# Cypheria 技术选型

Cypheria V1 定位为跨平台 Web3 agent desktop：复刻 Codex Desktop 中适合本地工程协作的能力，同时加入钱包管理器、Web3 应用浏览器、任务自动化和 Web3 Vibe Coding。

## 总体架构

```txt
Electron Main Process
  - 本地权限、安全、钱包、Codex 子进程、自动化、数据库、审计

TanStack Start Renderer
  - UI、路由、状态展示、用户操作入口

Isolated Web3 Browser WebContents
  - dApp 页面，每个 origin 独立 session

Codex App Server Child Process
  - 复用 Codex 的 thread、turn、approval、diff、terminal 能力
```

核心原则：

- 私钥、签名、自动化执行、Codex 子进程和系统权限都放在 Electron main process 或独立进程中。
- Renderer 只通过 typed IPC 请求能力和订阅事件，不直接接触私钥、Node.js、系统命令或 dApp 页面内部状态。
- Web3 dApp browser 和 Codex preview browser 分开设计，权限模型不同，不共享钱包上下文。
- 默认安全策略是人工确认；只读和自定义条件自动签名作为可配置模式。

## Desktop 与前端

| 分类 | 选型 |
| --- | --- |
| Desktop runtime | Electron |
| App framework | TanStack Start |
| Router | TanStack Router |
| Server/cache state | TanStack Query |
| Client/UI state | Jotai |
| Form | TanStack Form + Zod |
| IPC schema | Zod validated typed IPC |
| Build | Renderer 使用 Vite，Electron main 使用 tsdown |
| Monorepo | Turborepo |
| Package manager | pnpm |
| Lint / Format | Biome |
| Test | Vitest + Testing Library + Playwright |
| Package/release | electron-builder |

推荐 Turborepo + pnpm workspace 结构：

```txt
apps/desktop
  main/
  preload/
  renderer/

packages/ui
packages/ipc
packages/codex-bridge
packages/wallet-core
packages/web3-browser
packages/policy-engine
packages/runtime
packages/db
```

Turborepo 负责 apps 与 packages 之间的任务编排、缓存和依赖感知 pipeline。pnpm 负责依赖安装，并通过 `pnpm-workspace.yaml` 管理 workspace linking。

Desktop app 目前通过 `apps/desktop/vite.config.ts` 构建 TanStack Start renderer。Start source directory 是 `apps/desktop/renderer/src`，file routing 的生成文件为 `routeTree.gen.ts`。本地开发时可以设置 `CYPHERIA_RENDERER_URL=http://127.0.0.1:5173`，让 Electron 加载 renderer dev server。

## UI 选型

UI 策略是优先复用成熟组件，少开发基础组件，只为 Cypheria 特有 Web3/agent 场景自研组件。

| 分类 | 选型 |
| --- | --- |
| Component system | shadcn/ui |
| Primitive layer | 接受 shadcn 组件实际使用的 Radix UI / Base UI 依赖 |
| Styling | Tailwind CSS |
| AI UI reference | OpenAI Apps SDK UI、ai-elements patterns |
| Icons | lucide-react |
| Motion | motion |
| Toast | Sonner |
| Command menu | shadcn command / cmdk |
| Code editor | Monaco Editor |
| Terminal | xterm.js |

组件策略：

- 直接使用 shadcn：Button、Input、Textarea、Dialog、Sheet、Popover、Dropdown Menu、Tabs、Tooltip、Select、Checkbox、Switch、Badge、Table、Command、Sidebar、Resizable、Scroll Area、Toast/Sonner。
- 参考 OpenAI Apps SDK UI / ai-elements：Conversation、Message、Reasoning、Tool Call、Approval Prompt、Artifact、Diff Review、Prompt Input、Task Timeline。
- Cypheria 自研：Wallet Switcher、Signature Approval、Transaction Simulation Panel、DApp Permission Inspector、Chain/RPC Selector、Policy Rule Builder、Web3 Browser Address Bar、Codex Thread Event Adapter。

视觉方向接近 Codex Desktop：安静、工程工具感、信息密度适中、低饱和色、面板化布局、diff/terminal/thread/workspace 为主视觉。避免典型 Web3 霓虹渐变和营销页风格。

## Codex 集成

| 分类 | 选型 |
| --- | --- |
| Codex 基座 | 嵌入 Codex App Server |
| 进程模型 | Electron main process 启动 `codex app-server` 子进程 |
| 通信 | JSON-RPC over stdio / JSONL |
| UI bridge | Main process 封装 `CodexService`，renderer 通过 typed IPC 订阅事件 |
| 配置 | 兼容 Codex 原生 config、MCP、workspace、approval flow |

Cypheria 不在 V1 fork Codex runtime。Codex 负责代码 agent、workspace 操作、diff、terminal、approval、MCP 和 thread/run lifecycle。Cypheria 在其外层提供 Web3 工具、钱包审批、dApp 浏览器上下文、任务自动化、策略引擎和审计日志。

`@cypheria/codex-bridge` 是 protocol adapter package。它定义 JSON-RPC 2.0 wire messages、chunk-safe JSONL parsing、outbound request/notification helpers、request id generation、transport lifecycle states、transport error types，以及供 Electron main process 消费的 normalized Codex events。

第一版 desktop supervisor 位于 Electron main，默认运行 `codex app-server --listen stdio://`。它传入 runtime-scoped `CODEX_HOME`，将 stdout 交给 `@cypheria/codex-bridge` 解析，捕获 stderr lines，记录 exit state，并在后续策略定义前保持 automatic restart disabled。

```txt
Renderer
  -> ipc.invoke("codex.thread.create")
  -> Main CodexService
  -> codex app-server stdio
  -> JSON-RPC response / event
  -> Renderer event stream
```

Cypheria runtime paths 应由 `@cypheria/runtime` 解析。`$CYPHERIA_HOME` 用于配置 app home directory，默认值为 `~/.cypheria`；启动 Codex App Server 时，Cypheria 应传入 `CODEX_HOME="$CYPHERIA_HOME/codex"`。Runtime directories 由 Electron main process 的启动辅助函数 `initializeDesktopRuntime()` 显式创建，该函数内部调用 `ensureRuntimeDirectories()`。

## 钱包与链交互

| 分类 | 选型 |
| --- | --- |
| EVM client | viem |
| React wallet hooks | wagmi 仅用于 UI 层轻量状态 |
| 本地钱包 | viem/accounts + encrypted vault |
| Embedded wallet | Privy |
| External wallet | WalletConnect / Reown |
| 多链配置 | 自维护 chain registry，兼容 viem chain format |
| 资产数据 | Alchemy / Reservoir / SimpleHash / Moralis 中选择适配 |
| 交易模拟 | V1 可先接 Tenderly / Blocknative，后续补自建模拟 |

核心服务：

```txt
WalletService
  - account lifecycle
  - local wallet vault
  - Privy wallet binding
  - active wallet context

ChainService
  - RPC clients
  - chain registry
  - gas estimation
  - read contract / write contract

SigningService
  - personal_sign
  - typed data
  - transaction signing
  - policy check before signing

AssetService
  - token balances
  - NFT balances
  - transaction history
```

`@cypheria/wallet-core` 定义 V1 共享的钱包领域边界。它包含 wallet modes（`read-only`、`human-approval`、`conditional-auto-signing`）、local/Privy/external/read-only wallet sources、wallet accounts、chain definitions、RPC endpoints、EIP-1193 permission methods、origin-scoped wallet permissions，以及 personal signing、typed data、transaction signing 和 transaction sending 的 signing intents。

本地钱包安全：

- 密钥派生：Argon2id。
- 对称加密：XChaCha20-Poly1305 或 AES-256-GCM。
- 系统密钥保护：keytar / Electron safeStorage。
- 助记词显示：一次性 reveal，强确认。
- 导出：需要密码和本地确认。

## Web3 应用浏览器

| 分类 | 选型 |
| --- | --- |
| Browser container | Electron `WebContentsView` |
| 隔离策略 | 每 dApp origin 独立 persistent session |
| Provider | 自研 EIP-1193 provider bridge |
| 权限模型 | origin + wallet + chain + method |
| 弹窗/下载 | Main process 统一拦截和审批 |

Web3 browser 不复用 Codex preview browser 的权限模型。Codex preview browser 面向本地开发预览、截图和视觉检查，不接钱包。Web3 app browser 面向真实 dApp 使用，需要登录态、cookies、钱包连接、签名审批、origin 隔离和 provider injection。

`@cypheria/web3-browser` 拥有共享的 browser session model。它提供稳定的 origin-scoped session keys、persistent partition names、permission records、EIP-1193 provider method coverage，以及 typed provider request/response envelopes。

初始 provider bridge 通过注入的 transport callback 暴露 EIP-1193 风格 request function。它会序列化 request id、origin、session key、可选 chain id、method 和 params，并在不向 dApp pages 暴露 Node.js APIs 的前提下返回成功结果或结构化 `ProviderRpcError` failures。

Session key 示例：

```txt
cypheria:dapp:https://app.uniswap.org
cypheria:dapp:https://opensea.io
cypheria:dapp:https://app.aave.com
```

Provider bridge 需要拦截：

```txt
eth_requestAccounts
wallet_requestPermissions
wallet_switchEthereumChain
wallet_addEthereumChain
personal_sign
eth_signTypedData_v4
eth_sendTransaction
eth_accounts
eth_chainId
```

交易请求流程：

```txt
dApp
  -> injected provider
  -> preload bridge
  -> Main DappBrowserService
  -> PolicyEngine
  -> SimulationService
  -> Approval UI
  -> SigningService
  -> RPC broadcast
  -> AuditLog
```

## 策略引擎与自动化

| 分类 | 选型 |
| --- | --- |
| Policy schema | JSON policy + Zod schema |
| Policy execution | 自研 deterministic evaluator |
| 高级策略 | 后续可引入 CEL |
| Scheduler | cron-parser + 自研 scheduler |
| Runner | worker_threads 或 child_process |
| Logs | pino structured logs |

V1 策略模式：

- 只读：只允许链上读取、资产查询、合约分析。
- 人工确认：所有签名必须弹窗确认。
- 条件自动签名：命中 policy 才允许自动执行。

Baseline `@cypheria/policy-engine` package 使用 Zod 验证 signing policies，并评估 `allow`、`deny` 或 `require-human-approval`。Read-only mode 只允许 `eth_accounts` 和 `eth_chainId`；human-approval mode 永远要求审批；conditional auto-signing 只有在 enabled、未过期的策略同时匹配 wallet、chain、origin、method、可选 contract allowlist 和可选 native value limit 时才允许请求。显式 deny policies 优先于 allow policies。

`@cypheria/automation-core` 负责共享 automation task model。V1 tasks 可以是 manual、带 RRULE 和 timezone 的 scheduled，或从 Codex context 触发的 agent-triggered。每个 task 会记录 workspace、wallet policy scope、lifecycle status、run history、structured run logs 和 audit correlation ids，这样后续 runner 可以在不重定义 wire shape 的情况下持久化并审计任务执行。

第一版 local runner 位于 desktop main process。它支持 enabled manual no-op tasks，通过 `@cypheria/db` 将 task/run state 持久化到 SQLite，经由 worker boundary 执行，把 structured logs 写入 run record，并为 queued、succeeded 和 failed runs 追加 audit log entries。Cancellation 目前返回明确的 not-implemented result，同时保留公开 runner shape。

策略示例：

```ts
type SigningPolicy = {
  id: string
  enabled: boolean
  walletId: string
  chainIds: number[]
  origins: string[]
  methods: string[]
  contractAllowlist?: string[]
  maxNativeValue?: string
  expiresAt?: string
  effect: "allow" | "deny" | "require-human-approval"
  requireHumanApproval: boolean
}
```

V1 自动化能力：

- 定时检查钱包资产、授权和风险。
- 定时打开 workspace 让 Codex 执行任务。
- 生成合约、测试和前端集成代码。
- 监控 dApp/合约状态。
- 构造交易草案。
- 命中策略后自动签名，否则进入人工审批。

V1 不做高频交易、MEV、复杂 DeFi 策略自动执行和跨链桥大额自动操作。

## 数据层

| 分类 | 选型 |
| --- | --- |
| Local database | SQLite |
| ORM | Drizzle ORM |
| SQLite driver | better-sqlite3 |
| Migration | drizzle-kit |
| Search | SQLite FTS5 |
| Sensitive data | encrypted vault，不明文进入普通 SQLite 表 |

初始 `@cypheria/db` baseline 将 app database 解析到 `$CYPHERIA_HOME/db/cypheria.sqlite`，定义 settings、audit logs、workspaces 和 runtime metadata 的首批 Drizzle tables，并将生成的 SQLite migrations 存放在 `packages/db/drizzle`。

`@cypheria/db` 使用 `better-sqlite3` 打开 SQLite，以 Drizzle 包装 schema，并暴露用于 append/read flows 的 audit log service。单元测试使用 Vitest 和 in-memory SQLite database。

核心表：

```txt
settings
audit_logs
workspaces
runtime_metadata

后续计划：
  wallets
  accounts
  chains
  rpc_endpoints
  dapp_origins
  dapp_permissions
  signing_policies
  approval_requests
  automation_tasks
  automation_runs
  codex_threads
```

## IPC 与安全

IPC namespace：

```txt
app.*
runtime.*
codex.*
wallet.*
chain.*
browser.*
dapp.*
policy.*
automation.*
approval.*
settings.*
audit.*
```

IPC contract conventions：

- `@cypheria/ipc` 拥有 protocol version `1` 和共享 channel constants。
- Request、response、error 和 event envelopes 都包含 protocol version。
- 初始 app metadata 与 runtime info APIs 具备 Zod schemas 和推导出的 TypeScript types。
- Main-process IPC routes 通过 helper 注册，并用 `@cypheria/ipc` contracts 验证 request payloads 和 handler responses。
- Error envelopes 使用标准 codes：`BAD_REQUEST`、`VALIDATION_ERROR`、`FORBIDDEN`、`NOT_FOUND`、`UNAVAILABLE` 和 `INTERNAL_ERROR`。

安全默认值：

- `nodeIntegration: false`。
- `contextIsolation: true`。
- `sandbox: true`。
- 严格 CSP。
- dApp 权限按 origin 隔离。
- 私钥只进入 encrypted vault。
- Renderer 和 dApp 永远不接触私钥。
- Codex agent 默认不能直接签名，只能创建 signing intent。
- signing intent 必须经过 PolicyEngine。
- 所有签名、拒签、自动签名和策略判断都写 AuditLog。
- 自动签名策略默认关闭。

## 工程化

Biome 统一 lint 和 format：

```txt
biome.json
  - formatter
  - linter
  - import sorting
  - organize imports

package scripts
  - check: biome check .
  - lint: biome lint .
  - format: biome format --write .
  - ci: biome ci .
```

推荐依赖：

```txt
electron
electron-builder
tsdown
@tanstack/react-start
@tanstack/react-router
@tanstack/react-query
@tanstack/react-form
jotai
react
react-dom
typescript
vite
zod
@biomejs/biome
tailwindcss
lucide-react
cmdk
sonner
motion
monaco-editor
xterm
viem
wagmi
@privy-io/react-auth
@walletconnect/sign-client
drizzle-orm
drizzle-kit
better-sqlite3
keytar
cron-parser
pino
nanoid
date-fns
vitest
@testing-library/react
playwright
```

pnpm 相关命令在本项目中通常需要在沙盒外执行，以便使用 pnpm 的全局存储。

## 暂不采用

- 不在 V1 使用 Tauri。
- 不在 V1 fork Codex runtime。
- 不把 wagmi 作为核心钱包层。
- 不把私钥放入 renderer、localStorage 或 IndexedDB。
- 不在 V1 做云端 agent execution。
- 不在 V1 引入复杂 workflow engine。
- 不为了规避 shadcn 的底层依赖而重写 Dialog、Dropdown、Popover、Tooltip 等基础组件。
