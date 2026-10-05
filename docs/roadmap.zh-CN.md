---
title: 路线图
---

# 路线图

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

详细的未来服务边界与威胁模型见 [Marketplace](planned/marketplace.zh-CN.md)。

## 插件体验

- [ ] 完成其余 Desktop plugin 体验。
  - 在 harness 支持时添加 Skill recording。
  - 完成 loading、empty、error、disabled、update、advisory 和 permission states。
  - 在打包 Electron build 中验证 authenticated connector authorization。
  - 完成 [Plugin Extensions 限制](agents/plugin-extensions.zh-CN.md#限制)中的各项：Claude 工具调用的只读 App 与对 Claude 隐藏仅供 App 使用的工具、Expo 与 CLI 托管、表单上传，以及 implicit resource 选择。
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

设计见 [Computer Use](features/computer-use.zh-CN.md) 和[浏览器扩展](features/browser-extension.zh-CN.md)。

- [ ] 在开发版和打包版 Desktop 中用 Codex 和 Claude Thread 端到端验证。
  - `iab` 与 `mcpapps`，包括 MCP App 的截图与操作。
  - 分别使用 `extension` 与 `cdp` 的 `chrome`，覆盖 Chrome 和 Edge，以及扩展在 macOS、Windows（named pipe 与注册表项）和 Linux 上的运行。
  - 分别使用内嵌 cua-driver daemon（含其 macOS 授权）与 ChatGPT Computer Use 的 `computer`，包括由第二个客户端回答的应用批准，以及一次电脑音频录制。
  - 在已登录的浏览器中用 `tab.content` 导出 Google 文档和 YouTube 字幕稿；Google 会对无头测试浏览器显示机器人验证。
- [ ] 发布扩展：在 CI 中为每个平台构建宿主（`pnpm --filter @cypheria/browser-extension-host build:all`），把它复制到 Desktop 构建的 `resources/browser-extension-host/<platform>-<arch>/`，随 Desktop 一起签名和公证，把扩展发布到 Chrome 网上应用店和 Edge 加载项，并把商店 ID 加入 `EXTENSION_IDS` 和宿主的 `allowedIDs` 构建参数。
- [ ] 在 Desktop 打包流程就绪后，将获取的 cua-driver 可执行文件放在 ASAR 之外随 Desktop 应用一并签名。
- [ ] 通过各自的 harness adapter，为 Pi、OpenCode 和 ACP Agent 提供 `cua_repl` server，使用与 Codex、Claude 相同的按 Thread 划分的 host。
- [ ] 在 Agent 首次通过 cua-driver 操作某个桌面应用或认领外部浏览器标签页之前，通过 ChatGPT Computer Use 已在使用的 `computer.host.approval.request` 问题询问用户，并跨 Thread 记住按应用和按站点的决定。
- [ ] 通过 Server 发布内置浏览器标签页的元数据，使每个客户端的 Browser 面板和 composer 提及都能显示 Thread 在其他设备上的标签页。
- [ ] 按 Thread 广播 Computer Use 活动（设备、目标、操作），并在每个客户端提供停止控件。
- [ ] 在停放层中按需挂载 MCP App，使 Agent 能操作当前没有窗口显示的 Thread App。
- [ ] 在同一设备上为多个 Thread 的原生应用操控做仲裁。

## Codex 桌面版对齐

- [ ] 在各平台打包应用的 manifest 中声明 `cypheria://` URL scheme，使其他应用的链接能到达已安装的 Desktop；开发版在启动时注册。
- [ ] 移植官方指令中依赖 Cypheria 尚缺客户端功能的章节：工作区依赖、LaTeX、运行摘要、写作块、非技术 UI 和 heartbeat 卡片。
- [ ] 补充官方桌面版挂载而 Cypheria 尚未提供的 Agent 工具：`set_thread_read_state`、`get_thread_emoji`、`set_thread_emoji`、`create_project`、`list_hosts`、`read_settings`、`write_settings`、`get_usage_limits` 和 `consume_usage_reset`。

## Desktop

- [ ] 正式会话工作区已经采用共享 Chat 组件，删除 Chat Demo。
  - 删除 `chat-demo.tsx`、`chat-demo-files.tsx` 及其测试和 `chat-demo` 路由；移除 Sidebar 菜单项和开发项过滤；如果没有其他功能使用，再删除 `development-mode.ts`、`bootstrap.development` 及 main 与 preload 中的接线。用 `pnpm --filter @cypheria/desktop build:renderer` 重新生成 `routeTree.gen.ts`。
  - 保留 `packages/ui/src/components/chat`、完整的 icons 镜像和会话 UI 参考；它们是正式资产。
  - 删除文档中对 Chat Demo 的提及。

## Expo

Expo 当前保持为可构建客户端基础。移动端产品工作会在 Desktop 体验成熟后规划；本文不维护未经批准的功能 checklist。
