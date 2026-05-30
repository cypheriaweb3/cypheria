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
- 为使用 AI SDK / AI Elements 的聊天界面提供 AI SDK `ProviderV3` adapter。

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

## Web3 Browser 边界

每个 dApp origin 都运行在独立 Electron session 中。dApp 页面会收到注入的 EIP-1193 provider bridge，但 provider requests 会转发到 Electron main，并通过 origin-scoped permissions 和 signing policy 评估。

`@cypheria/web3-browser` 负责：

- Origin-scoped session keys。
- Persistent partition names。
- dApp permission records。
- EIP-1193 provider request/response envelopes。
- Provider error mapping。

Web3 browser 不与 Codex preview/browser capabilities 共享钱包权限模型。

## 签名流程

```txt
dApp, automation, or agent context
  -> signing intent
  -> PolicyEngine
  -> simulation/risk metadata when available
  -> approval UI if required
  -> WalletService
  -> RPC broadcast if applicable
  -> AuditLogService
```

Codex 不直接签名交易。Automation 不直接签名交易。两者都只能创建 signing intents，并交给 Cypheria policy 处理。

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

## 数据模型

SQLite 是非敏感本地数据的 source of truth。敏感钱包材料保存在受 OS-backed key storage 保护的 encrypted vault 中。

当前核心表：

```txt
settings
audit_logs
workspaces
runtime_metadata
automation_tasks
automation_runs
```

规划中的 runtime tables：

```txt
wallets
accounts
chains
rpc_endpoints
dapp_origins
dapp_permissions
signing_policies
approval_requests
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

@cypheria/web3-browser
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
