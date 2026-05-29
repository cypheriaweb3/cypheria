# Cypheria

Cypheria 是一款受 Codex 启发的跨平台 Web3 agent 产品。它使用 TypeScript 构建，将 Codex 驱动的软件工程工作流与 Cypheria 自己实现的 Web3 runtime 能力结合起来，包括钱包、隔离的 dApp 浏览器、签名策略、本地自动化和审计日志。

Cypheria 不重新实现 Codex agent core。CLI 和 SDK 使用官方 Codex TypeScript SDK 执行 agent 工作流。Desktop 启动常驻 Codex App Server，并通过 WebSocket JSON-RPC 与其通信。Web3 权限、钱包状态、签名、自动化、策略评估和审计能力属于 Cypheria runtime。

## 产品方向

Cypheria V1 有四个入口：

- **Runtime**：Cypheria 自己的 TypeScript 非 agent 核心，负责钱包、链、策略、自动化、浏览器权限、设置、本地状态和审计日志。
- **CLI**：无 TUI 的命令行入口，直接组合 `@cypheria/runtime` 和 `@openai/codex-sdk`。
- **SDK**：面向外部应用的 TypeScript library，直接组合 `@cypheria/runtime` 和 `@openai/codex-sdk`。
- **Desktop**：Electron + TanStack Start 应用，在 main process 中运行 Cypheria runtime，并启动持久化 Codex App Server 承载富 agent 工作流。

默认安全模型是人工审批。只读模式和条件自动签名都是显式策略模式。Codex 和 automation flow 可以创建 signing intent，但每个 signing intent 都必须先经过 Cypheria policy evaluation，之后才能签名或广播交易。

## 技术栈

- **Language**：TypeScript
- **Monorepo**：Turborepo + pnpm workspace
- **Desktop**：Electron
- **Frontend**：TanStack Start、TanStack Router、TanStack Query
- **State**：Jotai
- **Forms and validation**：TanStack Form + Zod
- **Lint/format**：Biome
- **UI**：shadcn-style copied components、Base UI primitives、Cypheria CSS tokens、lucide-react
- **CLI/SDK agent integration**：`@openai/codex-sdk`
- **Desktop agent integration**：`codex app-server` over WebSocket JSON-RPC
- **Desktop Codex protocol types**：通过 `codex app-server generate-ts --out packages/codex-bridge/src/generated` 生成
- **Web3**：viem、Privy、WalletConnect / Reown
- **Data**：SQLite + Drizzle ORM

完整技术选型见 [docs/technical-stack.zh-CN.md](docs/technical-stack.zh-CN.md)。

## 架构

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
  -> persistent codex app-server over WS
```

Desktop renderer 是产品 UI，不是特权 runtime。它通过 typed IPC 向 Electron main 请求能力。私钥、签名操作、dApp browser sessions、本地数据库访问、自动化执行和 Codex App Server 生命周期管理都留在 renderer 之外。

架构基线见 [docs/architecture.zh-CN.md](docs/architecture.zh-CN.md)。

## 仓库结构

```txt
apps/cli
  无 TUI 的命令行应用。

apps/desktop
  main/       Electron main process
  preload/   面向 app 与 browser surface 的安全 bridge
  renderer/  TanStack Start renderer app

packages/sdk
packages/runtime
packages/codex-bridge
packages/ipc
packages/ui
packages/wallet-core
packages/automation-core
packages/web3-browser
packages/policy-engine
packages/db
```

`apps/cli` 和 `packages/sdk` 是规划中的 packages，属于目标架构，会按 todo 顺序实现。

## Runtime Home

Cypheria 拥有自己的本地应用目录：

```sh
CYPHERIA_HOME="${CYPHERIA_HOME:-~/.cypheria}"
CODEX_HOME="$CYPHERIA_HOME/codex"
```

推荐布局：

```txt
$CYPHERIA_HOME/
  codex/        Cypheria 管理的 Codex home
  db/           SQLite databases
  vault/        加密钱包 vault 文件和 metadata
  logs/         app、automation、policy 和 audit logs
  cache/        可丢弃 app caches
  browser/      dApp browser session partitions 和 metadata
  automation/   task definitions、run state 和 worker metadata
  config/       Cypheria settings
```

## 开发

安装依赖：

```sh
pnpm install
```

运行完整检查：

```sh
pnpm run ci
```

通过 Turborepo 运行 TypeScript 检查：

```sh
pnpm check
```

运行 build pipeline：

```sh
pnpm build
```

运行 renderer dev server：

```sh
pnpm --filter @cypheria/desktop dev:renderer
```

本地开发时让 Electron 加载 renderer：

```sh
CYPHERIA_RENDERER_URL=http://127.0.0.1:5173 pnpm --filter @cypheria/desktop dev
```

格式化文件：

```sh
pnpm format
```

在本仓库中，pnpm 相关命令通常应在沙盒外执行，以便 pnpm 使用全局存储。

## 当前状态

仓库已经包含基础 pnpm/Turborepo workspace、typed IPC contracts、runtime home handling、Electron main process bootstrap、persistent desktop Codex App Server lifecycle、wallet/policy/Web3 browser domain baselines、本地 SQLite audit 与 automation persistence、共享 UI primitives，以及第一版 TanStack Start desktop shell。

下一步实现顺序记录在 [docs/todo.zh-CN.md](docs/todo.zh-CN.md)。

## License

MIT
