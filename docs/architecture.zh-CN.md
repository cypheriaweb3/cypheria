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

- 启动并监管 Codex App Server 子进程。
- 管理钱包、加密本地 vault、Privy 绑定和外部钱包 session。
- 在任何签名或交易广播前评估签名策略。
- 创建隔离的 dApp browser sessions，并注入 provider bridge。
- 运行自动化 workers。
- 读写本地 SQLite 数据。
- 为审批、拒绝、策略决策和自动化运行写入审计日志。

### Renderer

Renderer 拥有用户体验：

- App shell、导航、面板、标签页和 inspectors。
- 钱包、浏览器、Codex、自动化、审批和安全视图。
- 使用 Jotai 管理 optimistic UI state。
- 使用 TanStack Query 进行本地/server-like 数据获取。
- 使用 TanStack Form + Zod 构建表单。

Renderer 不得访问 Node.js APIs、私钥、原始 shell 执行能力或 dApp 内部状态。

### Web3 dApp WebContents

每个 dApp origin 都运行在独立 Electron session 中。这可以防止 cookies、localStorage、钱包权限和账户状态在不同 dApp 之间泄漏。

dApp 会收到注入的 EIP-1193 provider bridge。Provider 请求会转发到 main process，并通过 origin-scoped 权限和签名策略评估。

### Codex App Server Child Process

Cypheria 在 V1 中嵌入 Codex App Server，而不是 fork Codex runtime。Main process 通过 JSON-RPC over stdio / JSONL 与它通信，并将 Codex events 适配为 Cypheria UI events。

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

核心表：

```txt
wallets
accounts
chains
rpc_endpoints
dapp_origins
dapp_permissions
signing_policies
approval_requests
audit_logs
automation_tasks
automation_runs
codex_threads
workspaces
settings
```

## Package 边界

```txt
@cypheria/ui
  Reusable product UI and Cypheria-specific components.

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
