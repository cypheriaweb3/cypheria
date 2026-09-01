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
```

Cypheria 有三个产品 surface 和一个共享 runtime：

- `apps/cli`：无 TUI 的命令行应用，直接组合 Cypheria runtime 和 Codex TypeScript SDK。
- `apps/desktop`：Electron + TanStack Start 应用，在 Electron main 中运行 Cypheria runtime，并连接常驻 Codex App Server。
- `packages/sdk`：公共 TypeScript SDK，直接组合 Cypheria runtime 和 Codex TypeScript SDK。
- `packages/runtime`：Cypheria 自有非 agent 能力的 TypeScript runtime。

Codex 负责 agent threads、turns、model execution、code edits、shell/tool execution、MCP 和 Codex approvals。Cypheria 负责 Web3 context、wallets、signing intents、policy evaluation、dApp browser permissions、automation state、本地数据和 audit logs。

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

## Codex 集成

Cypheria 使用两条 Codex 集成路径：

- CLI 和 SDK 使用 `@openai/codex-sdk`。
- Desktop 使用 `codex app-server` over WebSocket JSON-RPC。

`@cypheria/codex-bridge` 是 desktop-side app-server client。它负责：

- WebSocket transport。
- JSON-RPC request/response correlation。
- `initialize` request 和 `initialized` notification handshake。
- Server notification stream。
- Server-initiated approval request routing。
- Disconnect 和 lifecycle handling。
- app-server overload errors 的重试处理。
- 为使用 AI SDK / AI Elements 的聊天界面提供 AI SDK `ProviderV4` adapter。

Desktop main 拥有 Codex App Server process lifecycle。它选择 localhost port，以 `CODEX_HOME=$CYPHERIA_HOME/codex` 启动 `codex app-server`，等待 bridge readiness，记录 stderr，并随 desktop runtime 一起关闭 child process。

Codex app-server protocol TypeScript 文件放在：

```txt
packages/codex-bridge/src/generated/
```

通过以下命令生成：

```sh
codex app-server generate-ts --out packages/codex-bridge/src/generated
```

Generated protocol files 需要提交。不要手写 Codex app-server protocol request、response、notification 或 server request types。

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

apps/desktop/ipc
  Desktop-local typed Electron IPC contracts, schemas, channel names, and envelopes.

@cypheria/wallet-core
  Wallet domain types, accounts, chains, permissions, and signing intents.

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
