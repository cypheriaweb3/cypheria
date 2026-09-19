# 当前路线图

> 状态：仅包含计划工作

本文只包含尚未完成且仍获批准的工作。已完成事项和架构历史属于 Git。事项按依赖关系排序，应作为可评审、可测试的变更实施。

## 公开 SDK

- [ ] 新增 `packages/sdk`，提供稳定的公开 `Cypheria` TypeScript client，覆盖 Agent、Thread、runtime、wallet、policy 和 schedule API。
  - 构建于版本化 Cypheria 协议与 `@cypheria/client` 行为之上。
  - 不得导入 CLI、Desktop、Electron、Server runtime 内部实现、数据库或原生 Agent SDK。
  - 发布前定义公开兼容性与 release policy。
- [ ] 为 SDK 添加 connection、runtime operation、Agent Thread、Timeline stream 和 approval test doubles，使测试无需 Electron 或原生 Agent 进程即可运行。

## CLI

- [ ] 添加交互式 Thread 执行和 Web3 管理命令。
  - 支持流式输出和 JSONL events。
  - Wallet、network、policy、approval、audit 和 diagnostics 只通过共享 Server API 操作。
  - 保持非交互式运行和可靠 exit code；不添加 TUI。

## Cypheria Marketplace

- [ ] 将 `apps/marketplace` 搭建为运行于 Cloudflare Workers 的 TanStack Start 应用。
  - 添加 locale-prefixed SSR routes、Cloudflare bindings、D1 migrations、共享 UI primitives、tests 和本地 preview。
  - 保持应用独立于 Electron、Desktop IPC、Server runtime 内部实现、Agent SDK 和 `@cypheria/db`。
- [ ] 实现 identity、organizations、authorization、publisher verification、CSRF protection、rate limits、step-up operations 和只追加 audit。
- [ ] 实现公开 GitHub source verification、固定 SHA 的 plugin drafts、license coverage checks、validation 和 submission。
- [ ] 实现受限 scanning 与 reviewer workflow，包括 durable jobs、不可变 evidence、change request、rejection、approval、suspension 和 withdrawal。
- [ ] 实现显式 publication、本地化 discovery、公开 `/api/v1`、advisories、确定性官方 catalog synchronization、reconciliation 和 rollback。
- [ ] 在 Desktop 中添加 Cypheria Marketplace discovery 与 trust integration。
  - 固定官方 repository identity 和 catalog commit。
  - 保留 source 与 ecosystem provenance。
  - 获取 capability approval，并通过 Codex harness 操作安装。

详细的未来服务边界与威胁模型见 [Marketplace](marketplace.zh-CN.md)。

## 插件体验

- [ ] 完成其余 Desktop plugin 体验。
  - 在 harness 支持时添加 Skill recording。
  - 完成 loading、empty、error、disabled、update、advisory 和 permission states。
  - 在打包 Electron build 中验证 authenticated connector authorization。
  - 完成 [Integrations](integrations.zh-CN.md) 所述 Cypheria 原生 plugin process、permission 和 Desktop contribution 契约。

## Expo

Expo 当前保持为可构建客户端基础。移动端产品工作会在 Desktop 体验成熟后规划；本文不维护未经批准的功能 checklist。
