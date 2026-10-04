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
  - 完成 [Plugin Extensions 限制](plugin-extensions.zh-CN.md#限制)中的各项：Claude 工具调用的只读 App 与对 Claude 隐藏仅供 App 使用的工具、Expo 与 CLI 托管、表单上传，以及 implicit resource 选择。
  - 在开发与打包的 Electron 构建中用 Bits & Bolts 插件端到端验证 Desktop App 沙箱：入口、global 页面的工作区 Thread、文件查看器、模型上下文、消息、设置、提及与表单。
  - 定义 Cypheria 原生 manifest，以及第三方 `cypheria/*` host 请求的权限模型。
  - 以 custom source 的形式添加 Pi 和 OpenCode 插件适配器，并支持 Claude 使用托管在 claude.ai 的 marketplace。

## 本地 Git 与拉取请求

- [ ] 使用真实 ChatGPT 账户对照 OpenAI 后端验证代码审查：GitHub 和 GitLab 连接（包括多个账户）、收件箱分区、详情读取、写入、检查和私密审查，并确认 GitLab 的响应结构。
- [ ] 端到端验证创建 PR：使用已登录的 `gh`，使用在 ChatGPT 中关联的 GitHub 和 GitLab 账户（确认 `github.create_pull_request` 与 `gitlab.create_merge_request` 的参数和结果结构），以及通过浏览器页面。

## 内置浏览器

- [ ] 在开发版和打包版 Electron 中端到端验证内置浏览器：标签页常驻与停放标签页截图、Agent 命令、弹窗，以及 dApp provider smoke test。
- [ ] 测量第三方 frame 中的 `document.cookie` 是否绕过 dApp Cookie 过滤，并为共享的 dApp 配置加入跳转追踪（bounce tracking）防护。
- [ ] 在 Server 提供按 origin 的权限管理后，为 dApp 标签页加入已连接账户、断开连接和撤销权限的控制。

## Computer Use

- [ ] 通过各自的 harness adapter，为 Pi、OpenCode 和 ACP Agent 提供 `cua_repl` server，使用与 Codex、Claude 相同的按 Thread 划分的 host。
- [ ] 在开发版和打包版 Electron 中端到端验证 Computer Use：Codex 与 Claude Thread 在每个界面上的使用、macOS、Windows 和 Linux 上的外部浏览器、MCP App 的截图与操作，以及使用内嵌 cua-driver daemon 及其 macOS 授权的原生应用。
- [ ] 在 Desktop 打包流程就绪后，将获取的 cua-driver 可执行文件放在 ASAR 之外随 Desktop 应用一并签名。
- [ ] 支持在 composer 中提及外部浏览器标签页（`plugin://chrome@cypheria-bundled?mention=tab-v1&…`），并提供按浏览器的开关。
- [ ] 在 Agent 首次操作某个桌面应用或认领外部浏览器标签页之前询问用户，并支持按应用和按站点的授权。

## Codex 桌面版对齐

- [ ] 在各平台打包应用的 manifest 中声明 `cypheria://` URL scheme，使其他应用的链接能到达已安装的 Desktop；开发版在启动时注册。
- [ ] 移植官方指令中依赖 Cypheria 尚缺客户端功能的章节：工作区依赖、LaTeX、运行摘要、写作块、非技术 UI 和 heartbeat 卡片。
- [ ] 补充官方桌面版挂载而 Cypheria 尚未提供的 Agent 工具：`set_thread_read_state`、`get_thread_emoji`、`set_thread_emoji`、`create_project`、`list_hosts`、`read_settings`、`write_settings`、`get_usage_limits` 和 `consume_usage_reset`。

## Expo

Expo 当前保持为可构建客户端基础。移动端产品工作会在 Desktop 体验成熟后规划；本文不维护未经批准的功能 checklist。
