---
title: 当前路线图
---

# 当前路线图

> 状态：仅包含计划工作

本文只包含尚未完成且仍获批准的工作。已完成事项和架构历史属于 Git。事项按依赖关系排序，应作为可评审、可测试的变更实施。

## CLI

- [ ] 添加交互式 Thread 执行和 Web3 管理命令。
  - 支持流式输出和 JSONL events。
  - Wallet、network、policy、approval、audit 和 diagnostics 只通过共享 Server API 操作。
  - 保持非交互式运行和可靠 exit code；不添加 TUI。

## Cypheria Marketplace

- [ ] 在 `apps/website` 中添加 Marketplace 动态路由，同时保持营销页与文档的 static-first 交付模型。
  - 添加双语 public SSR、需认证的 publisher 与 reviewer surface、Cloudflare bindings、D1 migrations、共享 UI primitives、tests 和本地 preview。
  - 保持 Marketplace service 独立于 Electron、Desktop IPC、Server runtime 内部实现、Agent SDK 和 `@cypheria/db`；scanner 运行在独立的受限 Worker 中。
- [ ] 实现 identity、organizations、authorization、publisher verification、CSRF protection、rate limits、step-up operations 和只追加 audit。
- [ ] 实现公开 GitHub source verification、固定 SHA 的 plugin drafts、license coverage checks、validation 和 submission。
- [ ] 实现受限 scanning 与 reviewer workflow，包括 durable jobs、不可变 evidence、change request、rejection、approval、suspension 和 withdrawal。
- [ ] 实现显式 publication、本地化 discovery、公开 `/api/v1`、advisories、确定性官方 catalog synchronization、reconciliation 和 rollback。
- [ ] 在 Desktop 中添加 Cypheria Marketplace discovery 与 trust integration。
  - 固定官方 repository identity 和 catalog commit。
  - 保留 source 与 ecosystem provenance。
  - 获取 capability approval，并通过 Codex harness 操作安装。
- [ ] 在 Claude 格式 release 的 manifest、scanning、installation 和 trust contract 就绪后开放发布。

详细的未来服务边界与威胁模型见 [Marketplace](marketplace.zh-CN.md)。

## 插件体验

- [ ] 完成其余 Desktop plugin 体验。
  - 在 harness 支持时添加 Skill recording。
  - 完成 loading、empty、error、disabled、update、advisory 和 permission states。
  - 在打包 Electron build 中验证 authenticated connector authorization。
  - 完成 [Integrations](integrations.zh-CN.md) 所述 Cypheria 原生 plugin process、permission 和 Desktop contribution 契约。
  - 以 custom source 的形式添加 Pi 和 OpenCode 插件适配器，并支持 Claude 使用托管在 claude.ai 的 marketplace。

## 本地 Git 与拉取请求

- [ ] 在 Server 中完成 ChatGPT Desktop 的本地 Git 操作清单，包括仓库查询、受保护的 Review 修改、轮次差异、工作树归属与迁移、缓存失效以及持久化 Git 设置。
- [ ] 按操作、仓库访问和实际工具 scope，在 `gh` CLI 与已连接 GitHub App 工具之间完成 GitHub PR 路由；补齐 Desktop PR 流程及失败恢复状态。
- [ ] 通过已连接 GitLab App 工具完成 GitLab MR 操作，并校验 connector、账户 link、工具 scope、项目和 URL；按需保留浏览器表单创建路径。
- [ ] 在打包 Electron 中验证 Connect 行为，并在 Cypheria 管理的 Codex home 中验证 GitHub/GitLab 授权和实际 PR/MR 调用。

## 内置浏览器

- [ ] 通过各自的 harness adapter，为 Claude、Pi、OpenCode 和 ACP Agent 提供 `browser_*` 工具，沿用与 Codex 相同的 Server broker 和 Thread 范围。
- [ ] 在开发版和打包版 Electron 中端到端验证内置浏览器：标签页常驻与停放标签页截图、Agent 命令、弹窗，以及 dApp provider smoke test。
- [ ] 测量第三方 frame 中的 `document.cookie` 是否绕过 dApp Cookie 过滤，并为共享的 dApp 配置加入跳转追踪（bounce tracking）防护。
- [ ] 在 Server 提供按 origin 的权限管理后，为 dApp 标签页加入已连接账户、断开连接和撤销权限的控制。

## Codex 桌面版对齐

- [ ] 在 `cypheria://review` 链接能打开确切的拉取请求后，开启拉取请求 diff 链接能力，并向操作系统注册 `cypheria://` scheme，以支持应用外链接。
- [ ] 移植官方指令中依赖 Cypheria 尚缺客户端功能的章节：工作区依赖、LaTeX、运行摘要、写作块、非技术 UI 和 heartbeat 卡片。
- [ ] 把可用模型和推理强度追加到 `create_thread` 与 `send_message_to_thread` 的 `model`、`thinking` 描述中。
- [ ] 补充官方桌面版挂载而 Cypheria 尚未提供的 Agent 工具：`set_thread_read_state`、`get_thread_emoji`、`set_thread_emoji`、`create_project`、`list_hosts`、`read_settings`、`write_settings`、`get_usage_limits` 和 `consume_usage_reset`。

## Expo

Expo 当前保持为可构建客户端基础。移动端产品工作会在 Desktop 体验成熟后规划；本文不维护未经批准的功能 checklist。
