# Cypheria 技术选型

Cypheria V1 是一个 TypeScript Web3 agent 产品，包含 CLI、SDK、desktop 和 runtime surfaces。它复用 Codex 承载 agent 工作流，并在本地实现 Cypheria 自有 Web3 能力。

## 平台选型

| 分类 | 选型 |
| --- | --- |
| Primary language | TypeScript |
| Monorepo | Turborepo |
| Package manager | pnpm |
| Lint / format | Biome |
| Tests | Vitest、Testing Library、Playwright |
| Runtime validation | Zod |
| Desktop runtime | Electron |
| Frontend app | TanStack Start |
| Router | TanStack Router |
| Server/cache state | TanStack Query |
| UI state | Jotai |
| Forms | TanStack Form + Zod |
| Desktop build | Renderer 使用 Vite，Electron main/preload 使用 tsdown |
| Desktop packaging | electron-builder |
| CLI/SDK Codex integration | `@openai/codex-sdk` |
| Desktop Codex integration | `codex app-server` over WebSocket JSON-RPC |
| Desktop Codex protocol types | `codex app-server generate-ts --out packages/codex-bridge/src/generated` |
| Local database | SQLite |
| ORM | Drizzle ORM |
| SQLite driver | better-sqlite3 |

## Workspace 结构

```txt
apps/cli
  无 TUI 的命令行应用。

apps/desktop
  main/
  preload/
  renderer/

packages/sdk
packages/runtime
packages/codex-bridge
packages/ipc
packages/ui
packages/wallet-core
packages/web3-browser
packages/policy-engine
packages/automation-core
packages/db
```

`apps/cli` 和 `packages/sdk` 是规划中的 packages。当前仓库已经包含 desktop app 和主要 domain packages。

## Runtime Stack

`@cypheria/runtime` 是 Cypheria 自有非 agent services 的 TypeScript host。它应该组合 domain packages，而不是重复定义它们的模型。

Runtime 职责：

- 解析 `$CYPHERIA_HOME`，默认 `~/.cypheria`。
- 派生 `CODEX_HOME=$CYPHERIA_HOME/codex`。
- 初始化 runtime directories。
- 连接 database、audit、wallet、policy、browser、automation 和 settings services。
- 为 CLI、SDK 和 desktop main 暴露 typed request/event API。

Runtime 不实现 Codex agent internals。

## CLI Stack

`apps/cli` 是没有 TUI 的 Node CLI。它直接依赖：

- `@cypheria/runtime`
- `@openai/codex-sdk`

它不得依赖：

- `@cypheria/sdk`
- `@cypheria/codex-bridge`
- Electron 或 desktop packages

初始命令行为：

- `cypheria run <prompt>` 使用 Codex SDK 执行 agent。
- `cypheria run --jsonl <prompt>` 输出机器可读的 event/result。
- `cypheria runtime info` 读取 Cypheria runtime metadata。
- Web3 命令直接使用 runtime services。

## SDK Stack

`@cypheria/sdk` 是面向 Node 应用的公共 TypeScript library。它直接依赖：

- `@cypheria/runtime`
- `@openai/codex-sdk`

它不得依赖：

- `apps/cli`
- Electron 或 desktop packages
- `@cypheria/codex-bridge`

SDK clients 应该是 runtime services 与 Codex SDK agent threads 之上的轻量 wrappers。

## Desktop Stack

Desktop 保留 Electron + TanStack Start。

| Area | Choice |
| --- | --- |
| Main process | TypeScript built with tsdown |
| Preload | TypeScript built with tsdown |
| Renderer | TanStack Start built with Vite |
| IPC | 来自 `@cypheria/ipc` 的 Zod-validated contracts |
| Renderer state | Jotai + TanStack Query |
| UI primitives | `@cypheria/ui` |
| Codex process | `codex app-server` |
| Codex transport | localhost WebSocket JSON-RPC |
| Codex protocol types | generated into `packages/codex-bridge/src/generated` |

Electron browser defaults：

```ts
{
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
}
```

Renderer code 只使用 typed IPC。Electron main 拥有 privileged services 和 Codex App Server lifecycle。

## Codex 集成

Cypheria 通过两种方式使用 Codex：

```txt
CLI / SDK
  -> @openai/codex-sdk

Desktop
  -> @cypheria/codex-bridge
  -> codex app-server over WebSocket JSON-RPC
```

`@cypheria/codex-bridge` 只负责 desktop 集成。它应该：

- 使用 `src/generated` 中生成的 Codex app-server TypeScript 文件。
- 实现 WebSocket transport。
- 执行 `initialize` request 和 `initialized` notification handshake。
- 关联 JSON-RPC requests 和 responses。
- 流式处理 server notifications。
- 将 approvals 等 server requests 路由到 Electron main。
- 处理 disconnect 和 overload errors。

通过以下命令生成 protocol types：

```sh
codex app-server generate-ts --out packages/codex-bridge/src/generated
```

Generated files 需要提交，这样 CI 和贡献者不必为了 typecheck 而拥有完全匹配的本地 Codex binary。

## UI Stack

UI 策略是复用成熟 primitives，只为 Cypheria-specific workflows 构建自定义组件。

| Category | Choice |
| --- | --- |
| Component model | shadcn-style copied components |
| Primitive layer | Base UI for overlays and interactive primitives |
| Styling | Cypheria CSS tokens and class variants |
| Icons | lucide-react |
| Motion | motion |
| Command menu | cmdk/shadcn command patterns |
| Code editor | Monaco Editor |
| Terminal | xterm.js |

Cypheria-specific components：

- Wallet switcher。
- Signature approval。
- Transaction simulation panel。
- dApp permission inspector。
- Chain/RPC selector。
- Policy rule builder。
- Web3 browser address bar。
- Codex thread event adapter。

视觉方向：安静、工作导向、低饱和、面板化，信息密度足够支撑真实工程工作流，并接近 Codex Desktop。避免 Web3 霓虹营销风格。

## Web3 Stack

| 分类 | 选型 |
| --- | --- |
| EVM client | viem |
| React wallet hooks | wagmi only for lightweight UI state if needed |
| Local wallets | viem/accounts + encrypted vault |
| Embedded wallets | Privy |
| External wallets | WalletConnect / Reown |
| Chain registry | 兼容 viem chain format 的自维护 registry |
| Asset providers | Alchemy / Reservoir / SimpleHash / Moralis 的 adapter boundary |
| Transaction simulation | Tenderly / Blocknative first; self-hosted simulation later |

核心 packages：

- `@cypheria/wallet-core`：wallet/account/chain/signing intent models。
- `@cypheria/web3-browser`：dApp session、permission 和 EIP-1193 provider bridge models。
- `@cypheria/policy-engine`：signing policy schemas 和 deterministic evaluation。

私钥永远不进入 renderer、dApp pages、localStorage、IndexedDB 或普通 SQLite tables。

## Policy And Automation Stack

| 分类 | 选型 |
| --- | --- |
| Policy schema | Zod-validated JSON policy |
| Policy evaluator | Deterministic TypeScript evaluator |
| Scheduler | cron-parser or equivalent local scheduler |
| Runner | worker_threads or child_process |
| Logs | Structured logs persisted through runtime/db |

Policy modes：

- Read-only。
- Human approval。
- Conditional auto-signing。

Automation 是 local-first。Tasks 可以使用 Codex SDK、读取链上状态、创建 signing intents，并写入 audit logs。Tasks 不得绕过 policy engine。

## Data Stack

| 分类 | 选型 |
| --- | --- |
| Database | SQLite |
| ORM | Drizzle ORM |
| Driver | better-sqlite3 |
| Migrations | drizzle-kit |
| Search | SQLite FTS5 when needed |
| Sensitive data | encrypted vault，不进普通 SQLite tables |

初始 tables：

```txt
settings
audit_logs
workspaces
runtime_metadata
automation_tasks
automation_runs
```

规划 tables：

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

## 工程规则

- 使用 pnpm，不使用 npm/yarn/bun，除非用户明确要求。
- pnpm 相关命令通常应在沙盒外执行，以便 pnpm 使用全局存储。
- 保持 TypeScript strict。
- 在 runtime boundaries 使用 Zod：IPC、policy schemas、wallet inputs、automation definitions 和 generated-protocol adapters。
- 保持 package boundaries 明确。
- 保持 domain/data packages 不依赖 `@cypheria/runtime`；runtime 通过显式 service injection 组合它们，而不是让它们反向 import runtime。
- 架构、行为、命令、package boundary 或 runtime path 变化时，英文和中文文档同步更新。

## V1 暂不采用

- 不做 TUI。
- 不 fork Codex runtime。
- 不创建 `@cypheria/codex-protocol` package。
- 不手写 Codex app-server protocol types。
- 不做 cloud agent execution。
- 在 local runner 被验证前，不引入复杂 workflow engine。
- 不将私钥放入 renderer、localStorage、IndexedDB 或普通 SQLite tables。
- 不在 dApp origins 之间共享 browser sessions。
- 不把 wagmi 作为核心钱包层。
