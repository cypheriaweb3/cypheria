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
| SQLite driver | libSQL 本地 SQLite 入口（`@libsql/client/sqlite3`） |

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
packages/network-core
packages/wallet-core
packages/wallet-provider
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

桌面内部导航使用 TanStack Router 链接，保留当前文档、全局样式和外观状态。全局 CSS 在客户端 hydration 之前由根文档链接加载。任务查询参数由首页路由校验；切换任务或点击 New task 会重置任务会话，而不重新加载整个应用。

Search 在当前页面上打开 shadcn Command 对话框，支持防抖任务搜索、最近任务、键盘选择，以及加载、错误和空结果状态。关闭对话框保留当前草稿，选择结果则导航至对应任务。

| Area | Choice |
| --- | --- |
| Main process | TypeScript built with tsdown |
| Preload | TypeScript built with tsdown |
| Renderer | TanStack Start built with Vite |
| Production renderer transport | 带 SPA fallback 的 privileged standard Electron `cypheria://` protocol |
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

Desktop main bundle 将 `@libsql/client` 及其 platform packages 保持为 external，使 Electron 在运行时加载匹配的 native binary。`build:main` 会把已提交的 Drizzle migrations 复制到 `dist/drizzle`，因此 packaged startup 与 tests、development 使用同一 migration source。应用 ready 之前，Electron user/session data 会以 `$CYPHERIA_HOME/browser` 为根目录。

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

Electron main 拥有 `codex app-server` child process。它选择 localhost port，以 `CODEX_HOME=$CYPHERIA_HOME/codex` 启动进程，等待 WebSocket handshake readiness，通过 `codex.event` 转发 renderer-safe Codex summaries，记录 stderr，并随 runtime 一起关闭进程。Workspace 与 desktop manifests 精确固定 `@openai/codex` 版本。Development 解析该 package，而不是用户的 `PATH`；packaged build 解析 `resources/codex/codex`（Windows 为 `codex.exe`）。`CYPHERIA_CODEX_PATH` 是显式 diagnostic override。Desktop 在启动 App Server 前检查 `codex --version` 是否与生成 committed protocol types 的版本一致。

通过以下命令生成 protocol types：

```sh
pnpm codex:generate
```

Generated files 需要提交，这样 CI 和贡献者不必为了 typecheck 而拥有完全匹配的本地 Codex binary。升级 Codex 时，必须在同一 change 中更新两处精确 dependency declaration、更新 `CODEX_APP_SERVER_VERSION`、重新生成这些文件，并运行 bridge 与 desktop tests。

## UI Stack

UI 策略是复用成熟 primitives，只为 Cypheria-specific workflows 构建自定义组件。

完整的 shadcn `base-nova` 预设组件集已安装到 `packages/ui/src/components`，依赖由 `@cypheria/ui` 管理。通过 `@cypheria/ui/components/<name>` 导入组件。主要控件使用 `text-sm`（默认外观设置下为 14px），次要标签和应用层显式覆盖的字号仍可能更小。保留现有 Cypheria 兼容适配。若需补充后续发布的组件，运行 `pnpm --filter @cypheria/ui shadcn:add --all --yes`，对已定制文件选择不覆盖。有意使用 `--overwrite` 重新安装时，需要补回兼容适配并运行 UI/桌面测试。

完整的 AI Elements registry 源码位于 `packages/ui/src/components/ai-elements`，并通过 `@cypheria/ui/ai-elements/<name>` 导出。重新生成步骤以及 Base UI、NodeNext、严格 TypeScript、React 19 和 AI SDK 7 所需的兼容性修改，参见 [AI Elements 集成与升级指南](./ai-elements.zh-CN.md)。

Desktop renderer 使用 `@ai-sdk/react` 管理 chat state，并通过基于 typed Electron IPC 的自定义 `ChatTransport` 通信。Electron main 使用 `@cypheria/codex-bridge` 的 `ProviderV4` adapter，将 App Server 输出转换为 AI SDK UI-message chunks。较重的交互式 route shells 仅在客户端加载，因为 Electron 通过 `cypheria://` 发布 SPA 输出，运行时不会执行 TanStack Start server bundle。

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

桌面侧栏动画与悬停预览由 `apps/desktop/renderer/src/components/desktop-sidebar.tsx` 及其 CSS 实现，复用共享 UI 侧栏基础组件。固定侧栏收起时同步改变布局占位宽度并将面板滑出；悬停预览覆盖内容，不占布局宽度。任务标题栏的左侧预留空间与收起后的工具栏同步变化。原生窗口控制按钮保持固定，并在用户偏好减少动态效果时禁用过渡。 窗口工具栏使用固定像素尺寸：标题栏 44px、点击区域 28px、图标 15px、间距 6px；这些尺寸不随 UI 字体设置缩放，工具栏中心与 macOS 原生红黄绿按钮的 y=22px 中心对齐。 侧栏工具栏图标保持固定，由收起中的面板裁切，并露出下方收起工具栏，不交叉淡化。标题栏底部分隔线位于侧栏下方，侧栏工具栏底部不显示分隔线。点击收起后，只有光标移出切换按钮再进入才触发预览。拖拽右边线可在 240–480px 范围内调宽（同时受窗口宽度约束），双击恢复 288px；聚焦边线后支持方向键与 Home/End。拖到 240px 最小宽度后继续向左超过 120px（最小宽度的一半） 会收起侧栏并关闭预览；再次展开时保留最小宽度。宽度在当前应用会话的页面切换间保留。

## Web3 Stack

| 分类 | 选型 |
| --- | --- |
| EVM client | viem |
| React wallet hooks | wagmi only for lightweight UI state if needed |
| Vault wallets | viem/accounts + encrypted vault |
| Embedded wallets | Privy |
| External wallets | WalletConnect / Reown |
| Chain registry | 兼容 viem chain format 的自维护 registry |
| RPC routing | 按用途选择的有序 endpoints；仅对幂等读取进行基于 health 的 failover |
| RPC credentials | SQLite 只保存引用，连接记录由 OS-backed 机制保护 |
| Asset providers | Alchemy / Reservoir / SimpleHash / Moralis 的 adapter boundary |
| Transaction simulation | Tenderly / Blocknative first; self-hosted simulation later |

核心 packages：

- `@cypheria/network-core`：canonical chain identity、严格 network/RPC schema、catalog record 与 protocol conversion helper。
- `@cypheria/wallet-core`：wallet/account/chain/signing intent models。
- `@cypheria/wallet-provider`：origin-scoped dApp sessions、Ethereum EIP-1193/EIP-6963 injection 与 discovery、有界 Ethereum JSON-RPC 和 permissions、Solana Wallet Standard discovery 与 byte envelopes、protocol-scoped events，以及 persistence contracts。
- `@cypheria/policy-engine`：signing policy schemas 和 deterministic evaluation。

私钥永远不进入 renderer、dApp pages、localStorage、IndexedDB 或普通 SQLite tables。

Network configuration、endpoint selection、credential protection、dApp-scoped chain selection 与 failure behavior 详见 `docs/network-management.zh-CN.md`。

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

Signing intents 与 approval requests 保存在显式的 libSQL tables 中。系统保留精确 canonical intent payload，以确保审批内容与最终签名的字节完全一致；audit log 只保留其 SHA-256 hash 和脱敏摘要。审批决议使用基于 revision 的 compare-and-swap 与原子 libSQL batch，防止两个 reviewer 对同一请求作出不同决议。待审批尝试会先授权、后执行一次性 replay claim，因此批准后可以重试；已批准尝试则在访问秘密并签名前立即 claim。

Automation 是 local-first。Tasks 可以使用 Codex SDK、读取链上状态、创建 signing intents，并写入 audit logs。Tasks 不得绕过 policy engine。

`@cypheria/runtime` 拥有 automation service，并暴露 `automation.task.create`、`automation.task.list`、`automation.task.get`、`automation.task.pause`、`automation.task.resume`、`automation.run.start`、`automation.run.get` 与 `automation.run.list`。`@cypheria/automation-core` 负责严格 task/run schema 和状态流转，`@cypheria/db` 负责异步 SQLite 持久化与乐观更新。Executor 按 handler name 注入，且只能获得受 scope 限制的 agent 与 signing-intent capabilities。SDK 可以直接用 `@openai/codex-sdk` 组合 agent capability；desktop 继续保持独立的 persistent App Server boundary。

## Data Stack

| 分类 | 选型 |
| --- | --- |
| Database | SQLite |
| ORM | Drizzle ORM |
| Driver | libSQL 本地 SQLite 入口（`@libsql/client/sqlite3`） |
| Migrations | Drizzle Kit code-first `generate` + `migrate` |
| Search | SQLite FTS5 when needed |
| Sensitive data | encrypted vault，不进普通 SQLite tables |

数据库字段约定和单一来源迁移流程见 [`docs/database.zh-CN.md`](./database.zh-CN.md)。

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
signing_intents
approval_requests
dapp_origins
dapp_permissions
```

规划 tables：

```txt
rpc_endpoints
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
