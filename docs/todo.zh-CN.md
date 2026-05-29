# Cypheria 开发 Todo

这个 todo 用于追踪可审查粒度的实现工作。每一项都应该有意义、可测试，并适合独立提交。

状态说明：

- `[ ]` 未开始
- `[~]` 进行中
- `[x]` 已完成

## 已完成的基础能力

- [x] 初始化 Turborepo + pnpm monorepo。
  - 验收：根 scripts、workspace packages、TypeScript base config、Biome、Turbo pipeline 和 lockfile 已存在。
  - 验证：`pnpm run ci`、`pnpm build`。

- [x] 添加项目 README、架构文档、技术选型、todo 文档和 agent 指令。
  - 验收：英文主文档和 `.zh-CN.md` 中文伴随文档已存在。
  - 验证：`pnpm run ci`。

- [x] 添加 runtime home 解析。
  - 验收：`@cypheria/runtime` 可解析 `$CYPHERIA_HOME`，默认值为 `~/.cypheria`，并派生 `CODEX_HOME=$CYPHERIA_HOME/codex`。
  - 验证：`pnpm run ci`、`pnpm build`。

- [x] 添加 runtime directory 初始化。
  - 验收：runtime package 可以显式创建所有 Cypheria-owned runtime directories。
  - 验证：`pnpm run ci`、`pnpm build`。

- [x] 添加 Electron main runtime bootstrap helper。
  - 验收：desktop main package 在创建窗口前初始化 runtime directories。
  - 验证：`pnpm run ci`、`pnpm build`。

- [x] 添加 Electron + TanStack Start desktop shell。
  - 验收：desktop 有可运行的 Electron main process、preload bridge baseline 和带 sidebar navigation 的 TanStack Start renderer shell。
  - 验证：`pnpm run ci`、`pnpm build`。

- [x] 添加 typed IPC contract 和 router baseline。
  - 验收：`@cypheria/ipc` 定义初始 app/runtime contracts，desktop main 会验证 handler inputs/outputs。
  - 验证：`pnpm run ci`、`pnpm build`。

- [x] 添加 database、audit、wallet、policy、Web3 browser、automation、Codex bridge 和 UI baselines。
  - 验收：domain packages 包含 V1 边界所需的初始 types/services/tests。
  - 验证：`pnpm run ci`、`pnpm build`，以及已有 package-level tests。

## 架构对齐

- [x] 按最终 Runtime / CLI / SDK / Desktop 架构重写文档。
  - 验收：README、architecture、technical stack、todo docs 和 `AGENTS.md` 只描述当前目标架构。
  - 包括：不创建 `@cypheria/codex-protocol`、CLI 不依赖 SDK、CLI/SDK 使用 `@openai/codex-sdk`、desktop 使用 Codex App Server over WebSocket、generated app-server TS 位于 `@cypheria/codex-bridge` 内部。
  - 验证：`pnpm run ci`、`pnpm build`。

## Runtime

- [x] 将 `@cypheria/runtime` 扩展为 Cypheria runtime host。
  - 验收：package 导出带 `start()`、`stop()`、`request()` 和 `events()` 方法的 `CypheriaRuntime`。
  - 包括：service registry、lifecycle state、runtime info handler、runtime event envelope 和 clean shutdown。
  - 保留：现有 home/path resolution exports。
  - 验证：`pnpm run ci`、`pnpm build`、`pnpm --filter @cypheria/runtime test`。

- [ ] 将 Cypheria-owned service orchestration 放到 runtime 后面。
  - 验收：runtime 可以连接 database、audit、automation、policy、wallet domain 和 browser domain service boundaries，且不导入 desktop renderer code。
  - 包括：为 `runtime.*`、`wallet.*`、`chain.*`、`policy.*`、`browser.*`、`dapp.*`、`automation.*`、`audit.*` 和 `settings.*` 定义清晰 method namespaces。
  - 验证：`pnpm run ci`、`pnpm build`、runtime 与受影响 package tests。

## SDK

- [ ] 添加 `packages/sdk`。
  - 验收：package 导出公共 `Cypheria` client。
  - 包括：runtime、wallet、policy、automation 和 agent clients。
  - Agent path：直接使用 `@openai/codex-sdk`。
  - 不得导入：`apps/cli`、`apps/desktop`、Electron 或 `@cypheria/codex-bridge`。
  - 验证：`pnpm run ci`、`pnpm build`、`pnpm --filter @cypheria/sdk test`。

- [ ] 为 SDK 添加 runtime 和 Codex SDK test doubles。
  - 验收：SDK tests 不需要启动 Codex 或 Electron。
  - 包括：fake runtime client 和 fake agent thread。
  - 验证：`pnpm --filter @cypheria/sdk test`。

## CLI

- [ ] 添加 `apps/cli`。
  - 验收：package 构建无 TUI 的 `cypheria` Node CLI。
  - 包括：argument parsing、runtime initialization、readable output、JSONL output mode 和 non-zero failure exits。
  - 依赖：直接 import `@cypheria/runtime` 和 `@openai/codex-sdk`。
  - 不得导入：`@cypheria/sdk`、Electron、desktop packages 或 `@cypheria/codex-bridge`。
  - 验证：`pnpm run ci`、`pnpm build`、`pnpm --filter @cypheria/cli test`。

- [ ] 实现初始 CLI commands。
  - 验收：`cypheria run`、`cypheria run --jsonl`、`cypheria runtime info`、`cypheria wallet list`、`cypheria policy list`、`cypheria automation run <task-id>` 和 `cypheria doctor` 接入 runtime 或 Codex SDK。
  - 验证：CLI unit tests 和 command smoke tests。

## Desktop Codex App Server Bridge

- [ ] 将 Codex app-server TypeScript 生成到 `@cypheria/codex-bridge`。
  - 验收：generated files 位于 `packages/codex-bridge/src/generated` 且提交进仓库。
  - 命令：`codex app-server generate-ts --out packages/codex-bridge/src/generated`。
  - 包括：添加 package script，用于显式 Codex 升级时重新生成文件。
  - 不得创建：`@cypheria/codex-protocol`。
  - 验证：`pnpm --filter @cypheria/codex-bridge check`。

- [ ] 重构 `@cypheria/codex-bridge` 使用 generated app-server types。
  - 验收：bridge 使用 generated request、response、notification 和 server request types，不再手写 Codex app-server protocol types。
  - 包括：WebSocket transport、initialize/initialized handshake、request/response correlation、notification stream、server request routing、disconnect handling 和 overload retry handling。
  - 验证：`pnpm run ci`、`pnpm build`、`pnpm --filter @cypheria/codex-bridge test`。

- [ ] 更新 desktop 使用 persistent Codex App Server over WebSocket。
  - 验收：Electron main 以 `CODEX_HOME=$CYPHERIA_HOME/codex` 启动 Codex App Server，通过 `@cypheria/codex-bridge` 连接，并经 typed IPC 向 renderer 暴露 Codex events。
  - 包括：localhost port selection、process lifecycle、readiness、shutdown、stderr logging 和 renderer-safe event mapping。
  - 验证：`pnpm run ci`、`pnpm build`、`pnpm --filter @cypheria/desktop test`，如果 Codex 可用则做本地 desktop smoke test。

## Runtime Web3 能力

- [ ] 实现 wallet runtime service。
  - 验收：runtime 可以列出 wallet/account state、管理 read-only accounts，并暴露 active account context，且私钥不进入 renderer。
  - 验证：runtime 和 wallet tests。

- [ ] 实现 policy runtime service。
  - 验收：runtime 可以 list、validate、create、update、disable 和 evaluate signing policies。
  - 验证：runtime 和 policy-engine tests。

- [ ] 实现 signing intent 与 approval runtime flow。
  - 验收：dApp、automation 和 agent contexts 可以创建 signing intents；每个 intent 都经过 policy evaluation 且可审计。
  - 验证：runtime、policy、db 和 desktop IPC tests。

- [ ] 实现 Web3 browser runtime service。
  - 验收：desktop 可以创建 origin-isolated dApp sessions、注入 provider bridge，并将 provider requests 路由到 runtime。
  - 验证：web3-browser tests 和 desktop smoke test。

- [ ] 实现 automation runtime service。
  - 验收：runtime 可以 create、list、run、pause、resume 和 inspect automation tasks/runs。
  - 包括：tasks 可以调用 Codex SDK 或创建 signing intents，但不能绕过 policy。
  - 验证：automation-core、db、runtime 和 desktop tests。

## Review Rule

每完成一个 todo item 后：

- 停下来请求用户 review，再开始下一项。
- 运行相关验证命令。
- 如果 behavior、architecture、command、public interface、package boundary 或 runtime path 变化，同步更新英文和中文文档。
- 保持 commit 聚焦在已完成项上。
