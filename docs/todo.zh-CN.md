# Cypheria 开发 Todo

这个 todo 用于追踪可审查粒度的实现工作。每一项都应该足够小，可以在一次专注实现中完成、验证和审查；同时也要足够大，能交付一个有意义的项目能力。

状态说明：

- `[ ]` 未开始
- `[~]` 进行中
- `[x]` 已完成

## 基础设施

- [x] 初始化 Turborepo + pnpm monorepo。
  - 验收：根 scripts、workspace packages、TypeScript base config、Biome、Turbo pipeline 和 lockfile 已存在。
  - 验证：`pnpm run ci`、`pnpm build`。

- [x] 添加项目 README、架构文档、技术选型和 agent 指令。
  - 验收：英文主文档和适用的 `.zh-CN.md` 中文伴随文档已存在。
  - 验证：`pnpm run ci`。

- [x] 添加 runtime home 解析。
  - 验收：`@cypheria/runtime` 可解析 `$CYPHERIA_HOME`，默认值为 `~/.cypheria`，并派生 `CODEX_HOME=$CYPHERIA_HOME/codex`。
  - 验证：`pnpm run ci`、`pnpm build`。

- [x] 添加 runtime directory 初始化。
  - 验收：runtime package 可以显式创建所有 Cypheria 拥有的 runtime directories。
  - 验证：`pnpm run ci`、`pnpm build`。

- [x] 添加 Electron main runtime bootstrap helper。
  - 验收：desktop main package 暴露 `initializeDesktopRuntime()`，并返回 runtime paths 与 Codex environment。
  - 验证：`pnpm run ci`、`pnpm build`。

## Desktop App Shell

- [x] 添加真实 Electron main entrypoint。
  - 验收：`@cypheria/desktop` 有可运行的 main process entry，在创建窗口前初始化 runtime directories。
  - 包括：app lifecycle、single-instance lock、graceful shutdown hooks 和基础 error logging。
  - 如启动行为或 runtime paths 有变化，更新文档。
  - 验证：`pnpm run ci`、`pnpm build`、launch smoke test。

- [x] 添加 TanStack Start renderer skeleton。
  - 验收：renderer 有最小 app shell，包含 routing、layout placeholders 和 root route。
  - 包括：app frame、sidebar placeholders、main content area、theme baseline、Jotai/TanStack Query providers。
  - 如 frontend 结构变化，更新文档。
  - 验证：`pnpm run ci`、`pnpm build`，可运行时做 browser/Electron screenshot smoke test。

- [x] 添加 typed preload bridge baseline。
  - 验收：renderer 可通过 preload 暴露的小型 typed API 调用能力，且没有 Node.js access。
  - 包括：runtime info read endpoint 和 app metadata endpoint。
  - 如 IPC 边界变化，更新架构文档。
  - 验证：`pnpm run ci`、`pnpm build`、preload typecheck。

## IPC And Service Contracts

- [x] 定义 typed IPC contract package。
  - 验收：`@cypheria/ipc` 包含初始 runtime/app APIs 的共享 request/response/event contract types 和 Zod schemas。
  - 包括：namespace conventions、error envelope、event envelope 和 version field。
  - 如 IPC wire shape 变化，更新架构文档。
  - 验证：`pnpm run ci`、`pnpm build`。

- [x] 实现 main-process IPC router。
  - 验收：Electron main 可以注册 typed handlers，并用共享 contracts 验证 inputs/outputs。
  - 包括：runtime info route 和 health route。
  - 如果 handler registration patterns 成为架构约定，更新文档。
  - 验证：`pnpm run ci`、`pnpm build`、renderer/preload smoke call。

## Local Data

- [x] 添加 database package baseline。
  - 验收：`@cypheria/db` 定义 `$CYPHERIA_HOME/db` 下的 SQLite path resolution、Drizzle config 和初始 schema shell。
  - 包括：settings、audit logs、workspaces 和 runtime metadata tables 作为初始 schema candidates。
  - 如 table names 或 data boundaries 变化，更新文档。
  - 验证：`pnpm run ci`、`pnpm build`、migration generation/check。

- [x] 添加 audit log write path。
  - 验收：main-process service 可以向本地 SQLite append structured audit events。
  - 包括：event type、actor、timestamp、source、payload hash/summary 和 correlation id。
  - 如 audit model 变化，更新架构文档。
  - 验证：`pnpm run ci`、`pnpm build`、`pnpm --filter @cypheria/db test`。

## Codex Integration

- [x] 定义 Codex App Server transport adapter。
  - 验收：`@cypheria/codex-bridge` 建模 JSONL messages、request ids、lifecycle states 和 normalized events。
  - 包括：transport interface、message parser、event normalization shell 和 error handling types。
  - 如 Codex event model 变化，更新文档。
  - 验证：`pnpm run ci`、`pnpm build`、`pnpm --filter @cypheria/codex-bridge test`。

- [x] 实现 Codex child process supervisor。
  - 验收：Electron main 可以用 `CODEX_HOME=$CYPHERIA_HOME/codex` 启动配置好的 Codex App Server 进程。
  - 包括：start/stop、stdout JSONL stream、stderr logging、exit state 和 restart decision placeholder。
  - 如 process lifecycle 变化，更新文档。
  - 验证：`pnpm run ci`、`pnpm build`、`pnpm --filter @cypheria/desktop test`，如果 Codex binary 可用则做 local start smoke test。

## Wallet And Policy

- [x] 定义 wallet domain types。
  - 验收：`@cypheria/wallet-core` 包含 account、chain、RPC、signing intent、wallet source 和 permission types。
  - 包括：local wallet、Privy wallet、external wallet、read-only mode、human approval mode 和 conditional auto-signing mode。
  - 如 wallet boundaries 变化，更新技术选型文档。
  - 验证：`pnpm run ci`、`pnpm build`。

- [x] 定义 policy engine schema 和 evaluator baseline。
  - 验收：`@cypheria/policy-engine` 可以验证 signing policies，并评估简单 allow/deny/require-human-approval decisions。
  - 包括：origin、wallet、chain、method、contract allowlist、value limit、expiration 和 enabled flag。
  - 如 policy shape 变化，更新文档。
  - 验证：`pnpm run ci`、`pnpm build`、`pnpm --filter @cypheria/policy-engine test`。

## Web3 Browser

- [x] 定义 dApp browser session model。
  - 验收：`@cypheria/web3-browser` 定义 origin-scoped session keys、permission records 和 provider request/response types。
  - 包括：覆盖账户请求、链切换、签名、交易发送等 EIP-1193 方法。
  - 如 browser isolation model 变化，更新架构文档。
  - 验证：`pnpm run ci`、`pnpm build`、`pnpm --filter @cypheria/web3-browser test`。

- [x] 添加 provider bridge baseline。
  - 验收：preload/browser bridge 可将 provider requests 序列化给 main-process handlers，且不暴露 Node.js APIs。
  - 包括：request id、origin、chain id、method、params 和 structured provider errors。
  - 如 provider bridge wire shape 变化，更新文档。
  - 验证：`pnpm run ci`、`pnpm build`、`pnpm --filter @cypheria/web3-browser test`。

## Automation

- [x] 定义 automation task model。
  - 验收：shared types 描述 manual、scheduled 和 agent-triggered tasks。
  - 包括：task id、workspace、wallet policy scope、trigger、status、run history 和 audit correlation id。
  - 如 automation scope 变化，更新文档。
  - 验证：`pnpm run ci`、`pnpm build`、`pnpm --filter @cypheria/automation-core test`。

- [x] 添加 local automation runner baseline。
  - 验收：main process 可通过 worker boundary 运行 no-op/manual task，并持久化 run status。
  - 包括：cancellation placeholder、structured logs 和 audit event hook。
  - 如 runner model 变化，更新架构文档。
  - 验证：`pnpm run ci`、`pnpm build`、`pnpm --filter @cypheria/db test`、`pnpm --filter @cypheria/desktop test`、`pnpm --filter @cypheria/db db:check`。

## UI

- [x] 添加 shadcn-based UI package baseline。
  - 验收：`@cypheria/ui` 暴露 shared primitives 或复制进仓的 shadcn components，并遵循 Cypheria styling conventions。
  - 包括：Button、Input、Dialog/Sheet、Sidebar shell、Tooltip、Badge 和 Toast baseline。
  - 如 UI dependency choices 变化，更新技术选型文档。
  - 验证：`pnpm run ci`、`pnpm build`、`pnpm --filter @cypheria/ui test`。

- [ ] 添加第一个 app shell screen。
  - 验收：desktop renderer 展示接近 Codex Desktop 风格的 shell，sidebar navigation 包含 Workspaces、Browser、Wallets、Automations、Security 和 Settings。
  - 包括：仅 empty states，不做深层功能实现。
  - 稳定后更新 README screenshots/usage。
  - 验证：`pnpm run ci`、`pnpm build`、screenshot review。

## Review Rule

每完成一个 todo item 后：

- 停下来请求用户 review，再开始下一项。
- 运行相关验证命令。
- 对任何 behavior、architecture、command 或 interface 变化，同步更新英文和中文文档。
- 保持 commit 聚焦在已完成的这一项上。
