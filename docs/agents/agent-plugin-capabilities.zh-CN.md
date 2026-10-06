---
title: Agent 插件能力
---

# Agent 插件能力

Server 通过各 Agent 自己的 CLI 或 API 管理插件。没有 Cypheria 可驱动的插件安装方式的 Agent 不支持任何插件。本页列出各 Agent 的支持情况。插件包模型与按 Agent 启用见 [Polyglot Plugins](polyglot-plugins.zh-CN.md)；市场与存储见 [插件市场](plugin-marketplaces.zh-CN.md)。

每条命令运行时，Agent 的 home 都被重定向到 `$CYPHERIA_HOME/agents/<agentId>/home`，下文所有路径都位于该 home 内。Server 从不读写用户自己的 Agent 配置。

## 能力矩阵

| Agent | 目录市场 | 原生格式 | 原生命令 |
| :- | :- | :- | :- |
| **Codex** | 支持 | `codex`、`agent_plugin`、`claude`、`cursor` | App Server `marketplace/*`、`plugin/install` |
| **Claude** | 支持 | `claude`、`agent_plugin` | `claude plugin marketplace add`、`claude plugin install` |
| **Copilot CLI** | 支持 | 市场目录或其内置市场中的 `agent_plugin`、`copilot`、`claude` | `copilot plugin marketplace add`、`copilot plugin install`、`enable`、`disable`、`uninstall` |
| **Grok Build** | 支持 | `grok`、`claude`、`agent_plugin` | `grok plugin install <path> --trust`、`enable`、`disable`、`uninstall`、`list --json` |
| **Devin** | 不支持 | `devin`、`claude` | `devin plugins install <url>#<path> --yes --local` 或 `<path>`、`devin plugins remove` |
| **Goose** | 不支持 | `goose`、`agent_plugin`、`gemini` | `goose plugin install <gitUrl>`；列表、启用与卸载依据 [Goose 插件布局](#goose) |
| **Cline** | 不支持 | `cline`、`cline-official` 的每个条目 | `cline plugin install <slug>` 或 `<path>` `--force --json`、`cline plugin uninstall <installPath>` |
| **Gemini CLI** | 不支持 | `gemini` | `gemini extensions link <path> --consent`、`enable`、`disable`、`uninstall` |
| **Pi** | 不支持 | `pi` | `pi install <source>`、`pi remove <source>` |
| **Cursor** | 支持 | 无 | 无 |
| **OpenCode** | 不支持 | 无 | 无 |

Cursor 在 Cypheria 中不支持插件。它的 CLI 只能添加、列出、更新与移除市场，而 Cypheria 以 `cursor-agent acp` 运行它，该模式不加载任何插件：既不加载 `~/.cursor/plugins/local` 中的插件，也不加载 `--plugin-dir` 传入的插件，后者只有 CLI 的聊天模式读取。`cursor-plugins` 通过 Cypheria 列出，不向 Codex 或 Claude 注册，因为它的 `.claude-plugin` 市场文件只列出其中一个插件。OpenCode 与其他 registry ACP Agent 同样没有插件安装方式。

## 原生安装

Agent 原生支持某个插件包时，Server 使用该 Agent 自己的命令安装：

- **Codex：** 通过受监管的 App Server 调用 `marketplace/add` 与 `plugin/install`。
- **Claude：** 在 `CLAUDE_CONFIG_DIR` 指向受管 home 的环境中运行 `claude plugin … --json`，见 [Claude 插件管理](plugins.zh-CN.md#claude-插件管理)。
- **Copilot CLI：** 先用 `copilot plugin marketplace add <marketplacePath>` 注册一次市场目录，再运行 `copilot plugin install <plugin>@<marketplace>`。Copilot 内置的 `copilot-plugins` 与 `awesome-copilot` 中的插件直接按名称安装，无需注册，由 Copilot 自行获取。Copilot 已弃用直接从路径、URL 或仓库安装，因此不支持独立插件包与其他 Agent 目录中的插件。`COPILOT_CACHE_HOME` 使 Copilot 的市场缓存留在其受管 home 中。
- **Devin：** Git 市场（例如 `devin-marketplace`）中的插件以 `devin plugins install <url>#<path> --yes --local` 安装，使 Devin 记录其来源并可更新；其他插件包从其 `install_path` 安装。Devin 必须已登录。用户已在 Cypheria 中确认安装，因此用 `--yes` 跳过 Devin 自己的信任提示。Devin 无法关闭插件，因此禁用即移除，启用即重新安装。
- **Cline：** `cline-official` 条目以 `cline plugin install <slug> --force --json` 按 slug 安装，与 Cline 自己的官方安装方式相同；其他 Cline 插件从其 `install_path` 安装。Cline 会把插件复制到受管 home 下的 `plugins/_installed/` 并为其依赖运行 `npm install`，因此每次 Cline 安装都遵循下文的审查规则。Server 保存 Cline 报告的安装路径并用它卸载。Cline 无法从 CLI 关闭插件，因此禁用即移除，启用即重新安装。
- **Goose：** Server 原地链接插件包，见 [Goose](#goose)。
- **Grok Build：** 在 `GROK_HOME` 指向受管 home 的环境中运行 `grok plugin install <installPath> --trust`。Grok 把插件包复制到 `installed-plugins/` 并启用它；用户已在 Cypheria 中选择安装，因此用 `--trust` 让其 hooks 与 MCP server 得以加载。Grok 以 manifest 命名插件，因此 Server 从 `grok plugin list --json` 记录该名称，并用它开关与卸载插件。
- **Gemini CLI：** 运行 `gemini extensions link <installPath> --consent`，使 extension 原地使用。
- **Pi：** 对 `package.json` 含 `"pi"` 字段的插件包运行 `pi install <installPath>`，原地加载。来自 `pi-package-catalog` 的 package 以 `pi install npm:<name>` 安装，这会运行 npm 与 package 的脚本，因此遵循下文的审查规则。Pi 无法关闭 package，因此禁用即移除，启用即重新添加。

每个 Agent 都会收到 [插件市场](plugin-marketplaces.zh-CN.md#本地存储拓扑) 中插件的 `install_path`，因此安装的是 Cypheria 检查过的同一个修订版本。安装期间会在本机运行 package 代码的命令遵循与 Claude 相同的审查规则：Server 返回命令及其 SHA-256，只有客户端重新提交该 SHA-256 后才运行。原生安装与移除都会写入审计。

## 更新

插件分两部分自动更新，且不改变运行中会话所使用的内容：

1. **市场目录：** Server 启动两分钟后、之后每六小时，Server 刷新每个 Cypheria 管理的市场，请 Codex 与 Claude 刷新各自的市场，重新搜索 Pi package 目录，并重新获取文件位于其他仓库或 package 中的插件以及独立的 Git 与 npm package。从客户端更新市场会立即执行同样的刷新。刷新与更新一次只运行一个。
2. **已安装插件：** 每次刷新之后以及每十分钟，Server 更新没有运行中会话（即没有未停止会话的 Thread）的 Agent 的插件。有运行中会话的 Agent 保留其插件，更新等到它空闲时进行；它启动的下一个会话使用新版本。不会重新加载任何运行中的会话。

Codex 重新安装已安装版本与其市场版本不同的插件，Claude 对每个已安装插件运行 `claude plugin update`。package Agent 持有修订版本副本，见 [插件市场](plugin-marketplaces.zh-CN.md#cypheria-管理的目录)；当其持有的 SHA-256 与当前修订版本不同时，获得当前修订版本：

- **Pi** 移除旧修订版本并安装新修订版本；已禁用的 package 并未安装，下次启用时安装新修订版本。
- **Goose** 的链接改为指向新修订版本；其启用状态以链接为键，保持不变。
- **Gemini CLI** 卸载该 extension 并链接新修订版本；原本关闭的会再次关闭。
- **Copilot CLI** 运行 `copilot plugin update <plugin>@<marketplace>`，插件已是最新时不做任何事。
- **Grok Build** 会复制插件，却把本地安装当作实时链接，因此 `grok plugin update` 不会重新复制。Server 先用 `grok plugin uninstall <name> --keep-data` 卸载、再用 `grok plugin install` 重新安装；原本处于关闭状态的插件会再次关闭。
- **Devin** 重新安装已启用的插件；已禁用的插件并未安装，下次启用时安装新修订版本。
- **Cline** 与 **Pi 的 npm package** 安装时会运行 package 代码，需要用户审查，因此 Server 保留其当前版本，插件会提示关闭再打开以审查并安装新版本。

更新失败时保留旧修订版本，并在插件上显示错误。更新会写入审计。

## Goose

Goose 1.52 有 `goose plugin install` 与 `update`，但没有列表、启用或卸载命令。Server 在 `GOOSE_PATH_ROOT` 指向 Goose 受管 home 的环境下，依据 Goose 自身的插件布局实现这些操作：

- **布局：** 每个用户插件是一个 `.agents/plugins/<name>/` 目录。由 Goose 安装的插件包含 `.goose-plugin-install.json`，记录其 Git 来源、格式（`open-plugins` 或 `gemini`）与自动更新设置。Goose 从 `.goose-plugin/plugin.json`、`.plugin/plugin.json` 或 `plugin.json` 读取 manifest，或读取 Gemini 的 `gemini-extension.json`，并从 `skills/` 读取 Skills。
- **列表：** 读取 `.agents/plugins/` 中的目录、它们的安装元数据、manifest 与启用状态。
- **启用：** `config/config.yaml` 中的 `plugins` 映射，以插件目录路径为键，值为 `{ enabled: boolean }`。Goose 会把新发现的插件加为启用。`.config/goose/settings.json` 中的 `enabledPlugins` 与 `disabledPlugins` 也按名称生效；Server 不写入它们，并报告被它们禁用的插件。
- **原地安装：** Server 把 `.agents/plugins/<name>` 链接到插件包的 `install_path`，而不是让 Goose 再次克隆，并在 `plugins` 映射中启用它。Goose 会跟随该链接，由 Server 自己更新来源。Goose 自己安装的目录不会被替换。
- **卸载：** 移除 `.agents/plugins/<name>`（或仅移除链接）及其在 `plugins` 映射中的条目。

Goose 只从 `.mcp.json` 或 manifest 声明的路径读取插件 MCP server，且只支持 `stdio` server，因此 MCP server 位于 `mcp.json` 的 Agent Plugins 插件包只为 Goose 提供 Skills，不提供 server。
