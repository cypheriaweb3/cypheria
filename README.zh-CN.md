# Cypheria

Cypheria 是一款受 Codex Desktop 启发的跨平台 Web3 agent desktop。它将本地 coding agent 工作流与 Web3 原生能力结合起来，包括钱包管理、隔离的 dApp 浏览器、任务自动化和 Web3 Vibe Coding。

项目目前处于早期基础建设阶段。仓库中已经包含 monorepo 骨架、技术选型决策、架构基线、Electron main process bootstrap，以及第一版 TanStack Start renderer shell。

## 产品方向

Cypheria V1 聚焦四个产品界面：

- **钱包管理器**：本地钱包、Privy 钱包、账户上下文、链/RPC 配置、审批和签名策略。
- **Web3 应用浏览器**：基于 Electron 的 dApp 浏览器界面，每个 origin 使用独立 session，并注入 EIP-1193 provider bridge。
- **任务自动化**：支持定时和手动任务，可以调用 Codex、读取链上状态、生成交易草案，并将签名意图交给策略引擎评估。
- **Web3 Vibe Coding**：面向合约、dApp、索引器、集成、审计、测试和 workspace 自动化的 Codex Desktop 风格 coding 工作流。

默认安全模型是人工确认。只读模式和条件自动签名作为显式策略模式提供。

## 技术栈

- **Desktop**：Electron
- **Frontend**：TanStack Start、TanStack Router、TanStack Query
- **State**：Jotai
- **Forms**：TanStack Form + Zod
- **Monorepo**：Turborepo + pnpm workspace
- **Lint/format**：Biome
- **UI**：shadcn/ui、Tailwind CSS、lucide-react、Sonner、Monaco Editor、xterm.js
- **Codex 集成**：通过 Electron main process 嵌入 Codex App Server
- **Web3**：viem、Privy、WalletConnect / Reown
- **Data**：SQLite + Drizzle ORM

完整技术选型见 [docs/technical-stack.zh-CN.md](docs/technical-stack.zh-CN.md)。

## 架构

从高层看，Cypheria 将可信本地能力与不可信 Web 内容隔离：

```txt
Electron Main Process
  - 本地权限、钱包、签名、Codex 子进程、自动化、数据库、审计日志

TanStack Start Renderer
  - 产品 UI、路由、状态展示、用户操作入口

Isolated Web3 Browser WebContents
  - dApp 页面，每个 origin 一个持久化隔离 session

Codex App Server Child Process
  - Codex threads、turns、approvals、diffs、terminal、MCP、workspace 操作
```

架构基线见 [docs/architecture.zh-CN.md](docs/architecture.zh-CN.md)。

## 仓库结构

```txt
apps/desktop
  main/       Electron main process
  preload/   面向 app 与 browser surface 的安全 bridge
  renderer/  TanStack Start renderer app

packages/ui
packages/ipc
packages/codex-bridge
packages/wallet-core
packages/web3-browser
packages/policy-engine
packages/runtime
packages/db
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

运行当前 build pipeline：

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

仓库目前包含基础 monorepo 设置、占位 package 边界、Electron main process bootstrap，以及一个最小 TanStack Start renderer shell，包含 routing、Codex Desktop 风格 frame、Jotai 和 TanStack Query providers。接下来的实现里程碑包括：

- 定义 typed IPC contracts。
- 实现 Codex App Server bridge。
- 构建第一版 wallet、policy 和 Web3 browser service skeleton。
- 添加第一版基于 shadcn 的 UI shell。

## License

MIT
