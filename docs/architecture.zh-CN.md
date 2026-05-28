# Cypheria 架构

Cypheria 是一款 local-first Web3 agent desktop。它的架构围绕一个核心约束设计：Web3 签名、自动化、本地文件、shell 访问和 dApp 浏览不能共享同一个信任边界。

## 系统概览

```txt
                          +----------------------------+
                          |  TanStack Start Renderer   |
                          |  - UI and routing          |
                          |  - Jotai UI state          |
                          |  - TanStack Query cache    |
                          +-------------+--------------+
                                        |
                                        | typed IPC
                                        v
+-------------------------+-------------+--------------+-------------------------+
|                         Electron Main Process                                  |
|                                                                                |
|  +----------------+  +---------------+  +----------------+  +---------------+ |
|  | CodexService   |  | WalletService |  | PolicyEngine   |  | AuditLog      | |
|  +-------+--------+  +-------+-------+  +-------+--------+  +-------+-------+ |
|          |                   |                  |                   |         |
|          v                   v                  v                   v         |
|  Codex App Server      Encrypted Vault     Policy Store        SQLite / FTS   |
|  child process         + OS keychain        + Zod schemas       + append logs  |
|                                                                                |
|  +--------------------+  +-------------------+  +----------------------------+ |
|  | DappBrowserService |  | AutomationRunner  |  | Chain/RPC/Simulation       | |
|  +---------+----------+  +---------+---------+  +----------------------------+ |
|            |                       |                                            |
+------------+-----------------------+--------------------------------------------+
             |                       |
             v                       v
 +-------------------------+   +-------------------------+
 | Isolated dApp sessions  |   | worker_threads / child  |
 | Electron WebContents    |   | processes for tasks     |
 +-------------------------+   +-------------------------+
```

Renderer 是产品 UI，不是特权运行时。它通过 typed IPC 请求能力，并从 main process 接收事件流。私钥、签名操作、dApp 浏览器权限、Codex 进程管理、本地数据库访问和自动化执行都留在 renderer 之外。

## 进程边界

### Electron Main Process

Main process 拥有本地特权能力：

- 解析 `$CYPHERIA_HOME`、创建 runtime directories，并为 Cypheria 管理的 Codex 进程准备 `CODEX_HOME`。
- 拥有 Electron app lifecycle、single-instance lock 和 top-level window creation。
- 启动并监管 Codex App Server 子进程。
- 管理钱包、加密本地 vault、Privy 绑定和外部钱包 session。
- 在任何签名或交易广播前评估签名策略。
- 创建隔离的 dApp browser sessions，并注入 provider bridge。
- 运行自动化 workers。
- 读写本地 SQLite 数据。
- 为审批、拒绝、策略决策和自动化运行写入审计日志。

### Renderer

Renderer 拥有用户体验：

- TanStack Start app shell、file-based routing、导航、面板、标签页和 inspectors。
- 钱包、浏览器、Codex、自动化、审批和安全视图。
- 使用 Jotai 管理 optimistic UI state。
- 使用 TanStack Query 进行本地/server-like 数据获取。
- 使用 TanStack Form + Zod 构建表单。

Renderer 不得访问 Node.js APIs、私钥、原始 shell 执行能力或 dApp 内部状态。

初始 renderer shell 位于 `apps/desktop/renderer/src`，由 desktop package 的 Vite config 构建。它包含 root route、Workspaces route、app frame、Workspaces、Browser、Wallets、Automations、Security 和 Settings 侧边栏导航、empty-state panels、theme baseline CSS，以及 Jotai/TanStack Query providers。本地开发时，可以通过设置 `CYPHERIA_RENDERER_URL` 让 Electron 加载 renderer dev server。

第一版 preload bridge 通过 Electron `contextBridge` 暴露 `window.cypheria`。它提供 typed 的只读 app metadata 和 runtime info 调用，并由 main-process IPC handlers 支撑。Renderer 将该 bridge 视为可选能力，因此 TanStack Start dev server 仍可在普通浏览器中运行，且不需要 Node.js access。

### Web3 dApp WebContents

每个 dApp origin 都运行在独立 Electron session 中。这可以防止 cookies、localStorage、钱包权限和账户状态在不同 dApp 之间泄漏。

dApp 会收到注入的 EIP-1193 provider bridge。Provider 请求会转发到 main process，并通过 origin-scoped 权限和签名策略评估。

`@cypheria/web3-browser` 定义 V1 browser domain model。Session keys 会规范化为 `cypheria:dapp:<origin>`，并映射到 persistent Electron partitions。Permission records 会将 origin session 绑定到 wallet id、chain id、account addresses、允许的 provider methods 和可选 expiration。Provider request/response types 覆盖账户请求、链切换、链添加、personal signing、typed-data signing、transaction sending、accounts 和 chain id reads。

Provider bridge baseline 是 browser-side transport abstraction。它接收 EIP-1193 风格的 `request({ method, params })` 调用，在进入 transport 前拒绝不支持的方法，将支持的请求序列化为包含 request id、origin、session key、可选 chain id、method 和 params 的消息，并把结构化 provider errors 映射回 `ProviderRpcError`。真实 Electron WebContents 注入和 main-process handler wiring 是后续工作。

### Codex App Server Child Process

Cypheria 在 V1 中嵌入 Codex App Server，而不是 fork Codex runtime。Main process 通过 JSON-RPC over stdio / JSONL 与它通信，并将 Codex events 适配为 Cypheria UI events。

`@cypheria/codex-bridge` 拥有这条集成的第一层稳定 transport boundary。它将 JSON-RPC 2.0 requests、notifications、success responses 和 errors 建模为 newline-delimited JSON messages；提供 chunk-safe JSONL parsing；定义 request id generation、lifecycle states、transport errors，以及标准化的 `codex.message`、`codex.transport.error` 和 `codex.lifecycle` events。进程启动与监管仍留给 Electron main-process Codex service。

Desktop main process 现在具备 Codex child process supervisor baseline。它使用 Cypheria runtime context 中的 `CODEX_HOME` 启动 `codex app-server --listen stdio://`，暴露 start/stop 与 request/notification 写入能力，通过 Codex JSONL bridge 解析 stdout，将 stderr lines 转发给 logger hook，记录最近一次 exit code/signal，并且当前 restart decision placeholder 返回 `false`。

Codex 拥有：

- Threads 和 turns。
- Workspace 操作。
- Diffs 和文件变更。
- Terminal events。
- Approval prompts。
- MCP 集成。

Cypheria 拥有：

- Web3 tool context。
- 钱包和签名审批。
- 策略评估。
- dApp browser context。
- 自动化调度和审计。

## 核心服务

```txt
CodexService
  - start/stop Codex App Server
  - manage JSONL transport
  - normalize Codex events
  - expose threads, turns, diffs, terminal, approvals

WalletService
  - manage local wallets and Privy wallets
  - maintain active account context
  - coordinate vault access

SigningService
  - create signing intents
  - call PolicyEngine
  - request user approval when needed
  - sign and broadcast transactions

PolicyEngine
  - evaluate read-only, human-approval, and conditional auto-signing modes
  - enforce origin, wallet, chain, method, contract, value, and time constraints

DappBrowserService
  - create origin-isolated Electron sessions
  - manage WebContents lifecycle
  - inject the provider bridge
  - intercept popups, downloads, and permission requests

AutomationRunner
  - run manual and scheduled tasks
  - launch isolated workers
  - route signing intents through the same policy path as the UI

@cypheria/automation-core 定义 V1 共享 automation task model。它覆盖 manual、scheduled 和 agent-triggered tasks，task/workspace identity、wallet policy scope、enabled/paused/draft/archive state、run status 与 logs，以及用于关联 task definitions、runs、policy decisions 和 audit log records 的 audit correlation ids。

Desktop main process 现在包含 local automation runner baseline。它接收 enabled manual no-op tasks，通过 database automation persistence service 持久化 queued/running/final run state，经由 worker boundary 执行 no-op body，记录 structured run logs，为 queued/succeeded/failed runs 追加 audit events，并暴露显式 cancellation placeholder。Scheduled execution、真实 task bodies 和 policy-mediated signing 属于后续工作。

AuditLogService
  - record signatures, rejections, policy decisions, task runs, and transaction hashes
```

## 关键数据流

### Codex Thread Flow

```txt
Renderer
  -> codex.thread.create typed IPC
  -> CodexService
  -> Codex App Server stdio
  -> JSON-RPC response and events
  -> CodexService normalizer
  -> Renderer event subscription
```

### dApp Signing Flow

```txt
dApp WebContents
  -> injected EIP-1193 provider
  -> preload bridge
  -> DappBrowserService
  -> SigningService
  -> PolicyEngine
  -> SimulationService
  -> Approval UI if required
  -> wallet signing
  -> RPC broadcast
  -> AuditLogService
```

### Automation Flow

```txt
Scheduler or manual trigger
  -> AutomationRunner
  -> worker_threads / child_process
  -> persist queued/running/final run status
  -> CodexService / ChainService / WalletService as needed
  -> signing intent if a write operation is needed
  -> PolicyEngine
  -> approval or auto-signing decision
  -> AuditLogService
```

## 安全模型

默认规则：

- `nodeIntegration: false`。
- `contextIsolation: true`。
- `sandbox: true`。
- 严格 Content Security Policy。
- dApp 权限按 origin 设定。
- 私钥只进入 encrypted vault。
- Renderer 和 dApp 页面永远不能访问私钥。
- Codex 默认不能直接签名交易。
- Agents 和 automations 创建的是 signing intents，而不是 signatures。
- 每一个 signing intent 都必须经过 PolicyEngine。
- 自动签名默认关闭。
- 每一次策略决策、签名、拒绝和 transaction hash 都会被记录。

## 数据模型基线

SQLite 是非敏感本地数据的 source of truth。敏感钱包材料应保存在受 OS-backed key storage 保护的 encrypted vault 中。

`@cypheria/db` 默认将 SQLite 文件解析到 `$CYPHERIA_HOME/db/cypheria.sqlite`。当前 Drizzle schema baseline 首批包含 `settings`、`audit_logs`、`workspaces` 和 `runtime_metadata`；生成的 migrations 位于 `packages/db/drizzle`。

Database package 现在提供了一个轻量的 main-process audit log service。调用方可以 append 带有 `eventType`、`actor`、`createdAt`、`source`、`payloadHash`、`payloadSummary` 和 `correlationId` 的结构化记录；service 会在需要时分配 id，并支持按 id 读取以及查询最近记录。Schema initialization helper 会在 service 面向新 database file 打开前应用 baseline SQLite tables。

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

## IPC Contract 基线

`@cypheria/ipc` 负责 renderer、preload 和 main-process services 共享的 IPC contracts。当前协议版本是 `1`。Channel 名称使用带 namespace 的点分格式，例如 `app.metadata.read` 和 `runtime.info.read`。

当前 contract package 包含：

- `app`、`runtime`、`codex`、`wallet`、`chain`、`browser`、`dapp`、`policy`、`automation`、`approval`、`settings` 和 `audit` 的 namespace definitions。
- 初始 app metadata 与 runtime info APIs 的 Zod schemas 和 TypeScript types。
- Request、success response、error response 和 event envelope types。
- 标准 error code 集合，覆盖 bad requests、validation failures、forbidden access、missing resources、unavailable services 和 internal errors。

后续 main-process handlers 应该使用这些 contracts 验证 inputs 和 outputs。Renderer 与 preload code 只应在边界处导入需要的 contract types 和 channel constants。

Electron main 通过 desktop IPC router helper 注册 routes。每个 route 都由一个 `@cypheria/ipc` contract 支撑；router 会用 request schema 解析 invoke payload，并在返回 preload 前用 response schema 解析 handler result。当前首批注册 routes 包括 runtime info、app metadata 和 app health。

## Package 边界

```txt
@cypheria/ui
  Reusable shadcn-style product UI primitives、Base UI-backed overlays、CSS tokens，
  以及 Cypheria-specific components。

@cypheria/ipc
  Typed IPC contracts, schemas, and namespace definitions.

@cypheria/codex-bridge
  Codex App Server protocol adapter and event normalization.

@cypheria/wallet-core
  Wallet domain types, account models, signing intents, and wallet policies.

@cypheria/web3-browser
  dApp session model, provider bridge types, and browser permission types.

@cypheria/policy-engine
  Signing policy schemas, evaluator, and policy decision types.

@cypheria/automation-core
  共享 automation task、trigger、run history、wallet policy scope 和 audit correlation types。

@cypheria/runtime
  Cypheria home directory resolution, runtime path derivation, runtime directory creation,
  and Codex environment setup.

@cypheria/db
  Database schema, migrations, and local persistence helpers.
```

## V1 约束

- V1 不 fork Codex runtime。
- 不允许 renderer 或 dApp 页面访问私钥。
- 不把 wagmi 作为核心钱包层。
- 不在不同 dApp origins 之间共享 browser sessions。
- 除非显式用户策略命中，否则不自动签名。
- V1 不引入 cloud agent execution。
- 在本地 runner 的形状稳定前，不引入复杂 workflow engine。
