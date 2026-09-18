# Cypheria

Cypheria 是一款受 Codex 启发的跨平台 Web3 Agent 产品。它使用 TypeScript 构建，将多 Agent 软件工程工作流与 Cypheria 自有的 Web3 能力结合起来，包括钱包、隔离的 dApp 浏览器、签名策略、Server-owned schedules 和审计日志。

Cypheria 不重新实现各 Agent runtime。目标架构由一个常驻 Cypheria Server 持有特权 Agent integration、Web3 权限、钱包状态、签名、schedules、策略评估和审计能力，Desktop、Expo、web、mobile、CLI 与 SDK 都是 client。

## 产品方向

Cypheria V1 围绕一个 server 与多个 client 组织：

- **Server runtime**：Server-owned services，负责钱包、链、策略、schedules、浏览器权限、设置、本地状态和审计日志。
- **Server**：基于 Hono + Node.js 的 control plane，负责 runtime lifecycle、Agent process 与 adapter、projects、threads、sections、timeline、integrations、schedules、Web3、数据库访问、client session、diagnostics 与静态 web hosting。
- **Expo client**：一套面向 iOS、Android 与静态 web output 的 Expo Router 应用；server 会内置其 web output。
- **共享 client**：`@cypheria/client` 提供 WebSocket protocol driver、借用与持有连接的门面，以及
  公开 Agent/Thread、project/section 和 server action，但不持有 provider runtime。
- **Relay**：Go `apps/relay` 服务和 TypeScript `@cypheria/relay` 包为同一 server protocol
  提供可选的 E2EE 远程通道。
- **CLI 与 SDK clients**：已实现的 Node CLI 与规划中的公共 SDK 都使用 server protocol。
- **Desktop client**：保留 Electron + TanStack Start 工作台，确保兼容的本地 server 正在运行，并通过 `@cypheria/client` 使用共享 Projects、Threads、Sections、canonical history 与实时 turn。Electron 专属 browser、secure storage、window、update 与 OS integration 仍留在本地。
- **Marketplace**：部署在 Cloudflare Workers 上的 TanStack Start 应用，负责 ChatGPT/Codex 标准插件的提交、扫描、审核、发布、发现，并同步到 Cypheria 官方 GitHub repo marketplace。

默认安全模型是人工审批。只读模式和条件自动签名都是显式策略模式。Agent 与 schedule flow 可以创建 signing intent，但每个 signing intent 都必须先经过 Cypheria policy evaluation，之后才能签名或广播交易。

## 技术栈

- **Languages**：TypeScript；relay 数据面使用 Go
- **Monorepo**：Turborepo + pnpm workspace
- **Desktop**：Electron
- **跨平台 client**：Expo SDK 57 + Expo Router
- **Server**：Node.js 上的 Hono，提供 HTTP 与 WebSocket transports
- **Relay**：Go、v2 control/data WebSocket、etcd 地域所有权、内部 mTLS、OTLP
- **Frontend**：TanStack Start、TanStack Router、TanStack Query
- **State**：Jotai
- **Forms and validation**：TanStack Form + Zod
- **Lint/format**：Biome
- **UI**：shadcn-style copied components、Base UI primitives、Cypheria CSS tokens、lucide-react
- **Cypheria client protocol**：`@cypheria/protocol` 中版本化的 Zod contracts，并支持带元数据的 `bigint` 传输
- **Agent/Thread API**：provider-neutral 的 agent 生命周期和持久 Thread execution；`threadId` 是唯一公开的对话句柄
- **Agent manager**：ACP Registry 同步、受管安装与工具链、显式 enable、生命周期 operation 和 disabled-agent 闸门
- **Provider adapter**：内部 Codex、Claude Agent SDK、Pi RPC、OpenCode SDK 与 ACP adapter 把 provider session、event、interaction 和 history 归一为 Thread
- **OpenCode runtime**：通过共享的 loopback OpenCode server 使用 `@opencode-ai/sdk@1.18.31` 稳定 root API 与两条 event stream
- **Desktop agent integration**：通过 `@cypheria/client` 使用统一 AI SDK providers；provider process 由 server 持有
- **Codex protocol types 与 validation**：由 `@cypheria/protocol` 持有，并通过 `pnpm --filter @cypheria/protocol generate:codex-all` 生成
- **Marketplace hosting**：Cloudflare Workers、D1、R2、Queues 与 Workflows
- **Web3**：viem、Privy、WalletConnect / Reown
- **Data**：SQLite + Drizzle ORM

完整技术选型见 [docs/technical-stack.zh-CN.md](docs/technical-stack.zh-CN.md)。
完整的 generated Codex App Server API 见 [docs/codex-app-server-api.zh-CN.md](docs/codex-app-server-api.zh-CN.md)。
Codex 有效配置在 process、thread、turn、reload 与 tool planning 各生命周期中的使用方式见 [docs/codex-app-server-config.zh-CN.md](docs/codex-app-server-config.zh-CN.md)。
Claude Agent SDK wire mapping 见 [docs/claude-agent-sdk-protocol.zh-CN.md](docs/claude-agent-sdk-protocol.zh-CN.md)。
Registry、安装、enable、工具链与 runtime ownership 见 [docs/agent-management.zh-CN.md](docs/agent-management.zh-CN.md)。
Thread 生命周期、provider-session ownership 与 timeline 连续性见 [docs/thread-protocol.zh-CN.md](docs/thread-protocol.zh-CN.md)。
Pi RPC wire mapping 见 [docs/pi-rpc-protocol.zh-CN.md](docs/pi-rpc-protocol.zh-CN.md)。

## 架构

```txt
apps/expo / apps/cli / @cypheria/client / 未来的 packages/sdk
  -> 通过 HTTP 或 WebSocket 使用 @cypheria/protocol
  -> apps/server
  -> Server-internal Agent and Web3 services

apps/server
  -> Hono HTTP + WebSocket control plane
  -> supervisor + worker lifecycle
  -> 内置 apps/expo static web export

remote @cypheria/client
  -> @cypheria/relay E2EE
  -> apps/relay gateway/worker
  -> apps/server relay data socket

apps/desktop renderer
  -> @cypheria/client
  -> apps/server
  -> canonical Agent/Thread timeline

apps/desktop Electron main
  -> 发现、复用或启动 protocol-compatible 的本地 apps/server
  -> Electron 专属 browser、secure storage、window、update 与 OS integration

apps/marketplace
  -> TanStack Start on Cloudflare Workers
  -> D1 publication system of record + R2 immutable artifacts
  -> Queues + Workflows for scan/review/publication
  -> 在官方 GitHub repo 生成 .agents/plugins/marketplace.json

apps/desktop plugins
  -> Cypheria Marketplace API 提供 discovery/trust（待实现）
  -> Codex App Server marketplace/add + plugin/install
```

Desktop renderer 是产品 UI，不是特权 runtime。共享产品数据和 agent 工作通过 Cypheria server protocol 完成；typed Electron IPC 只承载 desktop-local 能力。私钥、签名操作、dApp browser sessions、本地数据库访问、Schedules 与 provider process 都留在 renderer 之外。

架构基线见 [docs/architecture.zh-CN.md](docs/architecture.zh-CN.md)，Codex Desktop permissions 设计见 [docs/codex-permissions.zh-CN.md](docs/codex-permissions.zh-CN.md)，network 与 RPC 设计见 [docs/network-management.zh-CN.md](docs/network-management.zh-CN.md)。

## 仓库结构

```txt
apps/cli
  无 TUI 的命令行应用。

apps/expo
  面向 iOS、Android 与静态 web 的 Expo Router client。

apps/server
  Hono server、client-session protocol、runtime host、web host 与 supervised server process。

apps/relay
  以单进程或集群 gateway/worker 形态转发不透明 E2EE WebSocket 的 Go relay。

apps/desktop
  ipc/        Desktop-local typed IPC contracts and schemas
  main/       Electron main process
  preload/   面向 app 与 browser surface 的安全 bridge
  renderer/  TanStack Start renderer app

apps/marketplace
  插件提交、审核、发布、发现与 GitHub marketplace 同步应用

packages/sdk
packages/client
packages/protocol
packages/relay
packages/ai-sdk-provider
packages/web3
packages/ui
packages/db
```

`packages/sdk` 仍是规划中的 package。`apps/cli`、`apps/server`、`apps/desktop`、
`apps/expo`、`apps/marketplace`、`packages/client`、`packages/protocol`、
`packages/ai-sdk-provider` 和 `packages/relay` 已提供 client/server 基础。协议、运维、安全与
打包约定见 [docs/server.zh-CN.md](docs/server.zh-CN.md)。
relay 协议、安全、扩缩容、可观测性与未来多地域设计见
[docs/relay.zh-CN.md](docs/relay.zh-CN.md)。

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
  logs/         app、schedule、policy 和 audit logs
  cache/        可丢弃 app caches
  toolchains/   受管 Node、Python、uv 与不可变 Python environments
  agents/       运行时 ACP registry，以及受管 agent versions、home、staging data 与 receipts
  browser/      dApp browser session partitions 和 metadata
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

开发时运行 server 或 Expo client：

```sh
pnpm --filter @cypheria/server build
pnpm --filter @cypheria/server server start
pnpm --filter @cypheria/expo dev
```

运行不需要 etcd 的单进程 relay：

```sh
pnpm --filter @cypheria/cypheria-relay dev -- --mode=single
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

仓库现在已经包含版本化 Cypheria protocol、分层的 `@cypheria/client`、带 HTTP/WebSocket
运维与内置 web hosting 的 supervised Hono server，以及可导出 iOS、Android 与静态 web
surface 的 Expo SDK 57 client。仓库也包含 E2EE relay client、server integration，以及支持
`single` 模式和 `cluster` gateway/worker 角色的 Go relay。现有 desktop 实现刻意保持不变，在 server 评审
和独立迁移变更之前继续使用当前 direct-runtime path。

下一步实现顺序记录在 [docs/todo.zh-CN.md](docs/todo.zh-CN.md)。
规范化 logo、应用图标资产与使用规则见 [docs/brand.zh-CN.md](docs/brand.zh-CN.md)。

## License

MIT
