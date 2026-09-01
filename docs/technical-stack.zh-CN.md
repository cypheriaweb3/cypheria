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
| SQLite driver | libSQL（`@libsql/client`） |

## Workspace 结构

```txt
apps/cli
  无 TUI 的命令行应用。

apps/desktop
  ipc/
  main/
  preload/
  renderer/

packages/sdk
packages/runtime
packages/codex-bridge
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
| IPC | 位于 `apps/desktop/ipc` 的 Zod-validated contracts |
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
- 暴露 AI SDK `ProviderV4` adapter，供需要 AI SDK / AI Elements streams 的聊天界面使用，同时保留直接 bridge request API 给非 AI SDK 调用方。
- 适配器实现 `LanguageModelV4`，声明 `specificationVersion: "v4"`，要求 Node.js 22 或更高版本。
- V4 图片输入接受带类型标签的 URL 或内联 base64/字节数据；内联图片必须指定完整媒体类型。内联文本文件转换为文本输入。Provider 文件引用和不支持的媒体会返回警告。
- 顶层 `reasoning` 映射到 Codex turn effort；显式 Codex `reasoningEffort` 设置优先，`provider-default` 不指定 effort。各推理级别是否受模型支持由 Codex 决定。
- 无状态历史将 V4 工具结果内容转换为文本（文件 URL/标签仍是文本）。二进制/引用工具文件、自定义工具内容、助手自定义内容及推理文件无法原生重放，会返回警告。

Electron main 拥有 `codex app-server` child process。它选择 localhost port，以 `CODEX_HOME=$CYPHERIA_HOME/codex` 启动进程，等待 WebSocket handshake readiness，通过 `codex.event` 转发 renderer-safe Codex summaries，记录 stderr，并随 runtime 一起关闭进程。

通过以下命令生成 protocol types：

```sh
codex app-server generate-ts --out packages/codex-bridge/src/generated
```

Generated files 需要提交，这样 CI 和贡献者不必为了 typecheck 而拥有完全匹配的本地 Codex binary。

## UI Stack

UI 策略是复用成熟 primitives，只为 Cypheria-specific workflows 构建自定义组件。

完整的 shadcn `base-mira` 预设组件集已安装到 `packages/ui/src/components`，依赖由 `@cypheria/ui` 管理。通过 `@cypheria/ui/components/<name>` 导入组件，并保留现有 Cypheria 定制。若需补充后续发布的组件，运行 `pnpm --filter @cypheria/ui shadcn:add --all --yes`，对已定制文件选择不覆盖。

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

主题处理遵循 Tailwind v4 和 shadcn 的 CSS variable 模型。Codex-compatible
appearance config、shadcn token mapping、theme preset 行为和 font-size 规则见
`docs/theme.zh-CN.md`。

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

Signing policy 保存在显式的 `signing_policies` libSQL 表中。`@cypheria/runtime` 提供严格的 create、get、list、update、disable 和 evaluate 操作。记录包含 timestamp 与单调递增 revision；update 和 disable 使用 compare-and-swap 语义，避免并发编辑静默覆盖。

评估时先应用 wallet mode，再匹配已启用且未过期的钱包 policy。显式 deny 优先于 human approval，human approval 优先于 allow；policy ID 作为确定性 tie breaker。未匹配的 conditional auto-signing 请求必须进入 human approval。每次变更和评估结果都有稳定的 decision 或 policy 标识以及脱敏 audit record。

Automation 是 local-first。Tasks 可以使用 Codex SDK、读取链上状态、创建 signing intents，并写入 audit logs。Tasks 不得绕过 policy engine。

## Data Stack

| 分类 | 选型 |
| --- | --- |
| Database | SQLite |
| ORM | Drizzle ORM |
| Driver | libSQL（`@libsql/client`） |
| Migrations | drizzle-kit |
| Search | SQLite FTS5 when needed |
| Sensitive data | encrypted vault，不进普通 SQLite tables |

当前核心 tables：

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
```

规划 tables：

```txt
rpc_endpoints
dapp_origins
dapp_permissions
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
