# Cypheria Marketplace

> 状态：计划中；`apps/marketplace` 尚不存在

计划中的 Cypheria Marketplace 是独立公开服务，负责插件提交、扫描、审核、发布、发现和信任 metadata。它不是 Server integration service，也不是使用 [Integrations](integrations.zh-CN.md) 所述 harness-native 或 custom marketplace 的前提。

## 产品边界

服务计划作为运行于 Cloudflare Workers 的 TanStack Start 应用，包含三个界面：

- 公开、本地化 catalog；
- 面向 publisher 的 draft、validation、submission、release 和 advisory console；
- 面向 reviewer 的 evidence、finding、decision、suspension 和 audit history console。

它不得导入 Electron、Desktop IPC、`apps/server` 内部实现、`@cypheria/db`、Agent SDK、wallet key 或本地 Cypheria 应用数据。

## 插件契约

初始发布目标是公开 ChatGPT/Codex plugin specification。Plugin root 包含 `.codex-plugin/plugin.json`，并可包含 Skills、hooks、app declaration、MCP declaration 和 assets。这使发布版本可以通过现有 Codex harness integration 安装，同时保留 `ecosystem: openai` provenance。

只有明确实现对应 manifest、scanning、installation 和 trust contract 后，才会增加 Cypheria-native、Claude、Pi 和 OpenCode 生态发布。Marketplace source 仍为 `cypheria`；ecosystem 是独立字段。

## 来源策略

初期只接受公开开源 GitHub source：

- `url`：plugin 位于 repository root；
- `git-subdir`：plugin 位于 monorepo 内的受限 path。

每个 release 固定完整不可变 commit SHA。Path 必须留在 repository 内。Validation 会拒绝 private repository、只有可移动 ref、必需的 Git LFS pointer、不安全 submodule indirection、缺失 plugin manifest，以及不覆盖提交路径的 license。

Publisher identity 与 repository relationship 的校验独立于开源 license coverage。

## 审核与发布

Submission 会冻结不可变 source revision。受限 scanner 为 manifest shape、secret、危险代码模式、dependency risk、声明 capability、MCP endpoint behavior、redirect、SSRF、tool annotation、CSP 和 policy URL 生成结构化 evidence。

Approval 与 publication 是不同操作。Reviewer 可以请求修改、拒绝、批准、暂停或撤回。获批 publisher 需要显式发布 release。任何与审核相关的内容变化都必须创建新版本和新审核周期。

每次状态转换都在 Server 侧授权，并记录到只追加 audit log。

## 计划平台

- Cloudflare Workers：request handling 与 SSR；
- D1：accounts、organizations、drafts、review state、releases 和 audit records；
- R2：不可变 snapshots、evidence 和 public assets；
- Queues 与 Workflows：受限 scanning 和 publication jobs；
- KV：仅用于可丢弃 cache 和 rate-limit 辅助；
- 外部 OIDC 与 GitHub verification：identity 和 source ownership。

Plugin code 绝不在 web Worker 内执行。MCP scanning 使用隔离、限制 egress 的执行环境，并有严格时间和大小限制。

## 官方 Catalog 交付

Publication 会把 active releases 确定性聚合到官方 Cypheria GitHub marketplace catalog。Entry 使用稳定排序和固定 SHA 的 `url` 或 `git-subdir` source。发布流程在通过 `/api/v1` 和本地化 catalog 页面暴露 release 前验证结果 commit。

Desktop 计划中的 Cypheria Marketplace integration 将：

1. 从 Marketplace API 获取 catalog 与 trust metadata；
2. 固定官方 repository identity 和预期 catalog commit；
3. 通过 Codex App Server marketplace 操作注册或升级 catalog；
4. 校验 plugin source URL、path、SHA、capabilities 和 approvals；
5. 通过 Codex harness 的 plugin 操作安装。

Discovery trust 与 installation execution 保持分离。OpenAI 和用户添加的 marketplace 保留各自 provenance，不会被重新标记为 Cypheria 已审核。

## 安全要求

- Organization-scoped authorization 和敏感操作 step-up checks。
- CSRF protection、rate limits、replay-safe identity challenges 和 session rotation。
- 不可变 source 与 evidence digests。
- 不持有终端用户 connector credential，不代理 MCP traffic。
- Catalog service 不执行任意 plugin code。
- 初始版本不包含 payment、token、rating 或 on-chain registry。
- 提供 suspension、advisory、withdrawal、reconciliation 和 publication rollback 路径。

## 交付阶段

1. 搭建 Worker、本地化 SSR、bindings、migrations 和 tests。
2. 实现 identity、organizations、roles、publisher verification 和 audit。
3. 实现 source verification、drafts、validation 和 submission。
4. 实现隔离 scanning 与 reviewer workflow。
5. 实现 publication、public catalog API 和确定性 GitHub synchronization。
6. 实现 Desktop discovery 与 trust integration。

未完成事项只在 [Todo](todo.zh-CN.md) 跟踪。
