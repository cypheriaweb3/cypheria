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
  - 验收：desktop-local IPC contracts 定义初始 app/runtime contracts，desktop main 会验证 handler inputs/outputs。
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

- [x] 将 Cypheria-owned service orchestration 放到 runtime 后面。
  - 验收：runtime 可以连接 database、audit、automation、policy、wallet domain 和 browser domain service boundaries，且不导入 desktop renderer code。
  - 包括：为 `runtime.*`、`wallet.*`、`chain.*`、`policy.*`、`browser.*`、`dapp.*`、`automation.*`、`audit.*` 和 `settings.*` 定义清晰 method namespaces。
  - 验证：`pnpm run ci`、`pnpm build`、runtime 与受影响 package tests。

- [x] 将现有 desktop bootstrap 适配到 runtime host。
  - 验收：Electron main 初始化 `CypheriaRuntime`，通过 runtime request path 读取 runtime info，并在 app quit 时关闭 runtime。
  - 包括：desktop bootstrap tests，以及不重新引入 db-to-runtime dependency 的显式 database path wiring。
  - 验证：`pnpm run ci`、`pnpm build`、`pnpm --filter @cypheria/desktop test`。

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

- [x] 将 Codex app-server TypeScript 生成到 `@cypheria/codex-bridge`。
  - 验收：generated files 位于 `packages/codex-bridge/src/generated` 且提交进仓库。
  - 命令：`codex app-server generate-ts --out packages/codex-bridge/src/generated`。
  - 包括：添加 package script，用于显式 Codex 升级时重新生成文件。
  - 不得创建：`@cypheria/codex-protocol`。
  - 验证：`pnpm --filter @cypheria/codex-bridge check`。

- [x] 重构 `@cypheria/codex-bridge` 使用 generated app-server types。
  - 验收：bridge 使用 generated request、response、notification 和 server request types，不再手写 Codex app-server protocol types。
  - 包括：WebSocket transport、initialize/initialized handshake、request/response correlation、notification stream、server request routing、disconnect handling 和 overload retry handling。
  - 验证：`pnpm run ci`、`pnpm build`、`pnpm --filter @cypheria/codex-bridge test`。

- [x] 更新 desktop 使用 persistent Codex App Server over WebSocket。
  - 验收：Electron main 以 `CODEX_HOME=$CYPHERIA_HOME/codex` 启动 Codex App Server，通过 `@cypheria/codex-bridge` 连接，并经 typed IPC 向 renderer 暴露 Codex events。
  - 包括：localhost port selection、process lifecycle、readiness、shutdown、stderr logging 和 renderer-safe event mapping。
  - 验证：`pnpm run ci`、`pnpm build`、`pnpm --filter @cypheria/desktop test`，如果 Codex 可用则做本地 desktop smoke test。

- [x] 固定 Codex App Server runtime 与 generated protocol 版本。
  - 验收：workspace 与 desktop 使用精确的 `@openai/codex` 版本；protocol generation 解析该 workspace binary；desktop 在启动前拒绝版本不匹配的 binary。
  - 包括：development package resolution、显式 `CYPHERIA_CODEX_PATH` override，以及从 Electron resources 解析 packaged sidecar。
  - 验证：`pnpm codex:version`、`pnpm run ci`、`pnpm build` 和 desktop tests。

- [x] 添加以任务为中心的 desktop workspace、Codex 身份验证与原生模型设置。
  - 验收：左侧导航展示 projects 与最近 threads；主工作区通过 App Server 流式传输 AI SDK UI messages；账户设置支持 ChatGPT、OpenAI API key 与 Amazon Bedrock；模型设置支持 OpenAI、Bedrock、Ollama 与 LM Studio。
  - 包括：无需登录的本地模型、任务中断、model/reasoning/service-tier 控件、automation 管理、隔离 dApp 启动、approval 与 plugin/skill 工作台路由，以及用于 Electron 构建的 client-only route shells。
  - 不包括：在 provider 策略确定前，不实现通用 custom providers 与 OpenCodex 集成。
  - 验证：`pnpm run ci`、`pnpm build` 和 `pnpm --filter @cypheria/desktop test`。

## Runtime Web3 能力

- [x] 采用 Drizzle + libSQL 本地数据库适配器，并确定钱包架构。
  - 验收：数据库服务使用 `@libsql/client` 替代 `better-sqlite3`；持久化 API 全部异步；中英文钱包设计文档明确公开数据、加密 vault、内存和签名边界。
  - 验证：`pnpm run ci`、`pnpm build`、数据库与 desktop tests。

- [x] 替换 wallet domain baseline。
  - 验收：`@cypheria/wallet-core` 在与 provider、storage 解耦的前提下建模 HD、private-key、private-key-group、watch 和 watch-group 钱包。
  - 包括：Zod boundary schemas、稳定标识、wallet/account/chain-account 层次、fingerprints、生命周期状态、派生方案和 renderer-safe projections。
  - 验证：`pnpm --filter @cypheria/wallet-core test`、`pnpm run ci`、`pnpm build`。

- [x] 添加钱包公开状态持久化。
  - 验收：`@cypheria/db` 通过 Drizzle + libSQL 持久化 wallets、wallet accounts、chain accounts 和 HD derivation schemes，且不包含秘密材料。
  - 包括：migrations、约束、repository APIs、恢复状态和内存数据库 tests。
  - 验证：`pnpm --filter @cypheria/db test`、`pnpm run ci`、`pnpm build`。

- [x] 实现加密钱包 vault。
  - 验收：钱包秘密以每钱包一个原子 vault 文件的形式保存在 `$CYPHERIA_HOME/vault`，使用根植于 OS-backed key storage 的每 entry 密钥加密，并且只解密到 runtime 内存。
  - 包括：窄边界 ethers Web3 Secret Storage codec、key-provider abstraction 与 test double、atomic writes、orphan recovery、lock、unlock、delete 和脱敏错误。
  - 验证：wallet vault tests、`pnpm run ci`、`pnpm build`。

- [x] 实现本地钱包与观察钱包管理。
  - 验收：runtime 可以生成/导入 HD 钱包、导入单个/分组私钥、管理单个/分组观察钱包、使用 viem 派生 EVM 账户、检测重复、列出 renderer-safe 状态并暴露 active account context。
  - 包括：新生成钱包快速初始化、导入成功前完成持久化、地址一致性检查、rename/delete 和 audit events。
  - 验证：runtime、wallet、database 与 vault tests。

- [x] 将钱包 signer 接入 signing-intent pipeline。
  - 验收：调用方获得签名能力而不是秘密材料；每次 message、typed-data 和 transaction 签名都绑定已批准 intent 并写入 audit。
  - 包括：viem signing adapters、signer/address 一致性检查、lock behavior、replay protection，并确保 renderer、dApp、agent 和 automation contexts 均不接触私钥。
  - 验证：runtime、policy、wallet 与 desktop IPC tests。

- [x] 实现 policy runtime service。
  - 验收：runtime 可以 list、validate、create、update、disable 和 evaluate signing policies。
  - 验证：runtime 和 policy-engine tests。

- [x] 实现 signing intent 与 approval runtime flow。
  - 验收：dApp、automation 和 agent contexts 可以创建 signing intents；每个 intent 都经过 policy evaluation 且可审计。
  - 验证：runtime、policy、db 和 desktop IPC tests。

- [x] 实现 wallet-provider 与 dApp browser runtime service。
  - 验收：desktop 可以创建 origin-isolated dApp sessions；暴露并发现 Ethereum 与 Solana providers；持久化 protocol-scoped permissions；转发常用 Ethereum read-only RPC；投递 scoped provider events；并让 EVM 或 Solana signing 经过 policy-backed intents 与 injected executors。
  - 验证：wallet-provider、database、runtime、desktop controller 与真实 sandboxed Electron discovery tests。

- [x] 实现 automation runtime service。
  - 验收：runtime 可以 create、list、run、pause、resume 和 inspect automation tasks/runs。
  - 包括：tasks 可以调用 Codex SDK 或创建 signing intents，但不能绕过 policy。
  - 验证：automation-core、db、runtime 和 desktop tests。

## Review Rule

每完成一个 todo item 后：

- 停下来请求用户 review，再开始下一项。
- 运行相关验证命令。
- 如果 behavior、architecture、command、public interface、package boundary 或 runtime path 变化，同步更新英文和中文文档。
- 保持 commit 聚焦在已完成项上。
