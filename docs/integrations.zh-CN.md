---
title: Integrations
---

# Integrations

> 计划中：Cypheria 原生插件执行尚未完成。

Server 通过统一 integration facade 展示 Skills、MCP servers、plugins、marketplaces 和 Codex Apps，同时保留各 harness 的来源和语义。

## 通用模型

每个 integration view 都包含所属 Agent 和可选原生 identifier。Compatibility tags 声明对 `codex`、`claude`、`pi`、`opencode` 或 ACP 兼容桶的支持。Server 在启用或启动前校验兼容性；客户端展示兼容、不兼容和 Agent 专属状态。

Harness records 会被归一化用于展示，但 mutation 仍路由回所属 Agent adapter。Cypheria 不会声称某个生态支持另一个生态的安装或信任模型。

## Skills

Skill 是可复用 instruction bundle。API 报告展示 metadata、scope、path、dependency count、enablement、harness、plugin membership 和 compatibility。在内容与 harness 支持允许时，Skill 被视为跨 Agent 概念；仅适用于某 Agent 的 Skill 携带对应 compatibility tag。

文件系统发现与启用由 Server 负责。客户端不直接扫描 harness home。

## MCP

MCP server 也是通用概念。Integration API 报告 tools、resources、authentication state、runtime state、enablement、plugin membership 和 compatibility，支持列表、添加 URL server、修改 enablement，以及启动 harness 支持的登录流程。

传输凭证和 OAuth 状态留在 Server 或 harness runtime。MCP elicitation 进入通用 Thread interaction 生命周期。

对于 Codex 的 `codex_apps` server，只有工具 metadata 中的 connector、账户 link 和动作 resource URI 相互一致时，发现结果才为该工具报告 `appScope`；其他工具返回 `null`。调用 connector 工具前，消费者仍需重新校验此作用域和当前账户；仅发现工具不代表已获得访问权限。

## 插件生态

`ecosystem` 标识插件契约：

- `cypheria`：Cypheria 原生 manifest 与 contribution points；
- `openai`：ChatGPT/Codex plugin format；
- `claude`：Claude plugin ecosystem；
- `pi`：Pi extensions；
- `opencode`：OpenCode plugins。

Plugin view 保留 source type、marketplace identity、install policy、availability、version、capabilities、compatibility 和 harness provenance。Harness 支持时，通过 harness adapter 实现列表、详情、安装、卸载和启用操作。

Codex 远程插件的目录 ID 与展示名称不同。Server 在远程详情和安装请求前，从最新的 `plugin/list` 结果解析该 ID，避免用展示名称调用 Codex 安装接口。

为 Codex 或 Claude 启用插件时，Server 会注册随程序分发的 `cypheria-bundled` marketplace，并在对应 Agent 管理的 home 中安装其中的插件 `cypheria-app-tools` 和 `code-review`，对应官方桌面端随附的 `codex-app-tools` 和 `code-review`。详见 [Cypheria app tools](#cypheria-app-tools)。它们不声明 OpenAI App ID，也不持有 GitHub 或 GitLab connector 凭据。
内置 marketplace 是双格式 plugin root：同时包含 Codex 的 marketplace 与 manifest，以及 Claude 的 marketplace 与 manifest；各 Agent 的 MCP 声明放在各自文件中，与插件的 server 放在一起。
Cypheria 更新后若发现已安装的内置插件，Server 会先检查其本地版本，并从随程序分发的 marketplace 更新插件，再返回列表。

### Cypheria app tools

内置插件是 Codex 和 Claude 访问 Cypheria 自有工具的途径。每个插件声明一个 MCP server，两者运行同一个中继程序，它本身不执行工具：它通过 `/api/v1/app-tools/*` 列出和调用所属 server 的工具，Server 以与客户端相同的代码为发起调用的 Thread 执行。Codex dynamic tools 只承载浏览器工具。

- `cypheria-app-tools`，server 为 `cypheria_app_tools`：[Agent harnesses](agent-harnesses.zh-CN.md#codex) 列出的 Thread、项目、侧边栏、worktree、handoff 和 automation 工具。
- `code-review`，server 为 `code-review`：官方插件的 31 个 `pull_requests.*` 工具及其 MCP App `ui://pull-requests/app`。只有 `pull_requests.checks` 对模型可见；它通过 OpenAI 后端读取 GitHub 拉取请求的检查或 GitLab 合并请求的流水线，不含 job 日志。其他工具服务于该 App，Desktop 将其承载为代码审查页面和 Thread 拉取请求面板。App 资源和工具列表由 Server 自己提供；见[代码审查](code-review.zh-CN.md)。

Agent 在自己的命令中用 `git` 和 `gh` 完成本地 Git 工作；Server Git 协议仍是客户端契约，不提供给模型，与官方桌面端一致。

这些路由只接受 app tools token，不接受 Server 自己的 token；Server 也会从所有 Agent 环境中移除 `CYPHERIA_SERVER_TOKEN`。Server 用仅保存在内存中的 secret 派生 token，并在启动 Agent 进程时连同 `CYPHERIA_SERVER_URL` 一起传入：

- Claude 会话通过 SDK 环境变量获得绑定其 Thread 的 token，Claude manifest 再把它展开到 MCP server 的环境中。Claude 不会告诉 MCP server 是哪个会话在调用，因此 token 就是 Thread 身份。Claude 运行的命令可以读到这个 token，但它只允许该 Thread 的 Agent 本来就能做的事。
- Codex app-server 用一个进程服务所有 Codex Thread，因此整个进程只获得一个 token。Codex 会在每次 MCP 调用中附带 `x-codex-turn-metadata`，Server 依次用其中的 `thread_id`、子 agent 的 `parent_thread_id`、`session_id` 找到对应的活动 Cypheria Thread。除非用户的 `shell_environment_policy` 排除了该变量，Codex 运行的命令会继承这个环境，因此也能调用 app tools；而 app tools 本来就能按 ID 操作任何 Thread。

`cypheria-app-tools` 的 Codex manifest 与官方 `codex-app-tools` 一致：Codex 直接列出所有工具而不经工具搜索；除 `create_thread`、`send_message_to_thread`、`fork_thread`、`handoff_thread` 和 `automation_update` 外，调用免提示批准；每次调用最长一小时。`pull_requests.checks` 标记为只读，因此 Codex 运行它时不提示。Claude 对两个 server 都使用自己的权限模式。MCP 客户端取消调用时，中继程序会中止 HTTP 请求，Server 也会停止 `wait_threads` 的等待。

Codex Thread 启动、恢复或 fork 前，以及 Claude turn 开始前，Server 会安装或更新内置插件，每个 Server 进程只做一次。关闭了插件的 Agent 没有 app tools，此时 Codex developer instructions 会省略提到这些工具的章节；用户单独关闭 `cypheria-app-tools` 时也是如此。

### Claude 插件管理

Server 通过运行受管 Claude CLI 的 `claude plugin … --json` 命令管理 Claude 插件，并把 `CLAUDE_CONFIG_DIR` 设为 Cypheria 的 Claude home；它不会直接编辑 Claude 的状态文件，用户自己的 Claude home 不受影响。同一 Agent 的插件变更串行执行。

- 首次列出 Claude 插件时，Server 注册 `claude-plugins-official` 和随程序分发的 `cypheria-bundled` marketplace。注册内置 marketplace 不会安装任何内容：用户为 Claude 打开该插件时才会安装。其他 marketplace（GitHub 仓库、git URL、本地目录或托管的 `marketplace.json`）由用户自行添加。不会添加托管在 claude.ai 的 marketplace；从 claude.ai 同步或仅为单个会话加载的插件以只读方式列出。
- **Plugins 开关。** Claude 没有关闭插件的设置，因此 Cypheria 在 `$CYPHERIA_HOME/config/config.json` 中保存 `agents.claude.pluginsEnabled`（默认 `true`），并像 Codex 的 Plugins 设置一样显示在 Claude 设置页。关闭期间，Cypheria 不列出也不管理 Claude 插件，跨 Agent 操作会跳过 Claude，每个新的 Claude 会话都会通过 flag settings 把所有已安装插件强制禁用。已在运行的会话在重启前保留原有插件。
- 安装、卸载和启用可指定 scope：`user`（默认）、`project` 或 `local`。
- Marketplace 可以通过在本机运行命令来安装插件。Server 会拒绝这类安装，并返回命令及其 SHA-256；只有客户端在用户查看命令后重新提交该 SHA-256，才会执行安装。Cypheria 从不传 `--yes`。
- 移除 marketplace 会卸载其插件并删除已保存的数据。Server 会列出受影响的插件，并要求显式的 `confirmUninstall`。
- 插件选项来自插件声明的 `userConfig`。取值通过 stdin 写入，敏感值不会返回。
- 变更后，Server 会在运行中的 Claude 会话里重新加载插件，除非这会使会话的 prompt cache 失效；被保留的会话在重启后生效。
- 已安装的插件，以及位于其 marketplace 内部的插件，可以查看 skills、MCP server 等组件详情；其他未安装插件只显示 catalog 条目。

Cypheria 原生插件使用独立契约。目标 manifest 声明 Server entry points、Desktop UI contributions、可选的未来 Expo contributions、permissions、兼容 Cypheria 版本和 contribution points。Server 代码必须运行在受控子进程中。Desktop contribution 必须沙箱化，并只获得受限 host API，而不是 Node.js、文件系统、数据库或密钥权限。完成该 runtime 与 UX 仍是计划工作。

## Marketplace 来源

Marketplace source 与 plugin ecosystem 是独立字段。Source kind 为 `cypheria`、`openai`、`claude`、`pi`、`opencode` 和 `custom`。自定义 marketplace 仍必须声明其中每个 plugin 的 ecosystem。

当前 integration facade 支持 harness 自己的 marketplace list、add、upgrade 和 remove 操作。它保留 marketplace name 和 path，避免把不同来源的同名插件合并为一个身份。

独立的公开 Cypheria Marketplace 服务仍在计划中，见 [Marketplace](marketplace.zh-CN.md)。它尚不存在，不影响 harness-native 或 custom marketplace 支持。

## Agent 兼容性

某个插件被哪些 Agent 支持，由列出它的 marketplace 文件决定，而不是插件里的字段。每个 Agent 读取自己的 marketplace 文件：

| Agent | Marketplace 文件 |
| :- | :- |
| Codex | `.agents/plugins/marketplace.json` |
| Claude | `.claude-plugin/marketplace.json` |

一个仓库可以同时包含多个这样的文件，并在每个文件中列出同一个插件。请让它们使用相同的 marketplace `name`：名称一致时，Cypheria 才把不同 Agent 中的 marketplace 和插件视为同一个。Cypheria 不会根据插件文件推断兼容性，不会在 manifest 或 marketplace 条目中添加兼容性字段，也不会在生态之间转换插件。要在多个 Agent 中加载，plugin root 需并列提供各 Agent 的 manifest（`.codex-plugin/`、`.claude-plugin/`），共用 `skills/` 和 server 代码，并把各 Agent 的 MCP 声明放在各自文件中。

### Marketplace

Marketplace 总是对所有能读取它的 Agent 开放。

- **添加**会尝试所有 Agent。找到自己 marketplace 文件的 Agent 会注册它，其余 Agent 会报告该 marketplace 没有适用于它们的文件，Server 会记住来源。
- **添加会检查来源和各 Agent 读到的内容。** 来源必须是 `owner/repo`（可带 `#ref`）、`http(s)`、`ssh` 或 `git` URL、`scp` 形式的 `git@host:path`，或存在且含 marketplace 文件的绝对本地路径。类似选项的字符串、相对路径、其他 URL scheme 和带凭据的 URL 都会被拒绝，可被当作选项或逃出仓库的 git ref 与稀疏路径也会被拒绝。Agent 接受后，每个注册都必须可读，所有 Agent 读到的 marketplace `name` 必须一致，且该名称必须是普通名称，不能是 Cypheria 或厂商保留的名称（`cypheria-bundled`、`openai-*`）。已从另一个来源添加过的同名 marketplace 会被拒绝。任一检查失败时，本次调用创建的注册会被撤销。
- **更新**会先在每个 Agent 中刷新 marketplace，再让各 Agent 与其当前内容保持一致。新增了 marketplace 文件的 Agent 会根据记住的来源获得该 marketplace；失去文件的 Agent 会连同其插件一起移除该 marketplace；已从某个 Agent 文件中移除的插件会在该 Agent 中卸载。
- **移除**会从所有 Agent 中移除该 marketplace 并卸载其插件，客户端需先确认受影响的插件列表。

### 插件

插件只安装一次，再按 Agent 启用或禁用。

- **安装**会在每个 marketplace 列出该插件的 Agent 中安装，并在每个 Agent 中启用。
- **启用**按 Agent 独立控制。插件详情页只在插件已安装后，为每个列出该插件的 Agent 显示一个开关，因此插件可以在 Codex 中运行而在 Claude 中保持关闭。
- **之后新增的支持**不会自动启用任何内容。更新后才列出该插件的 Agent 会显示为关闭，打开开关时会先为该 Agent 安装。
- **卸载**会从所有持有该插件的 Agent 中移除它。

## Codex Apps

Apps 遵循 OpenAI App Server/connector 模型，只属于 Codex harness 扩展。它们通过 `client.harnesses.codex.apps` 暴露，包括 list、enablement、connect、callable/accessibility state、install URL 和 plugin association。

代码审查使用用户在这里建立的 GitHub 和 GitLab 连接，并凭 ChatGPT 登录通过 OpenAI 后端读取；见[代码审查](code-review.zh-CN.md#前提条件)。

Desktop 在系统浏览器中打开 App 安装页面。窗口重新获得焦点后，会刷新 App 和 MCP 的可用状态；外部页面不会向本地发送可信的完成回调。

Apps 不会被改名为通用 Agent 功能。如果其他 harness 未来提供类似能力，应获得自己的 harness extension 与术语。

## 缓存与刷新

Server 可以缓存 harness list；协议允许时，调用方可请求刷新。Mutation 会使相关 harness 和 integration views 失效。客户端使用返回的权威 view，而不是猜测 harness 原生操作的结果。

## 安全规则

- 校验 manifests、identifiers、URLs、marketplace locations 和 compatibility metadata。
- 在存储和 UI 中保留 ecosystem、marketplace source 和 harness provenance。
- 原生 plugin contribution 必须声明明确 permissions。
- 不向 renderer extension 暴露 harness credential 或 host filesystem。
- 把远程 description、icon、prompt、tool 和 plugin code 视为不可信内容。
- 安装与执行留在 Server；客户端只请求受限操作。
