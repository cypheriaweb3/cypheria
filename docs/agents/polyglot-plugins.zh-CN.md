---
title: Polyglot Plugins
---

# Polyglot Plugins

Polyglot Plugin 是可以在多个 Agent 中加载的同一个插件包。插件包携带某个 Agent 能读取的 manifest 时，该 Agent 原生使用它。Agent 读取不了插件包的任何 manifest 时即不支持它；Cypheria 不转换插件包，也不把其中的部分传给并非为其编写的 Agent。

插件包从哪里来、存放在哪里，见 [插件市场](plugin-marketplaces.zh-CN.md)。各 Agent 的原生格式与命令见 [Agent 插件能力](agent-plugin-capabilities.zh-CN.md)。

## 标准基础

通用布局采用 [Agent Plugins 规范](https://github.com/agentplugins/agent-plugins-spec) v1.0.0：

- **Manifest：** 插件包根目录的 `plugin.json` 声明名称、版本、作者、许可证与厂商扩展命名空间。
- **Skills：** `skills/*/SKILL.md`，遵循 Agent Skills 标准。
- **MCP server：** 插件包根目录的 `mcp.json`，支持 `stdio`、`streamable-http` 或 `sse` server。
- **厂商扩展：** 客户端专用设置位于 `plugin.json` 的 `extensions.<namespace>` 下，厂商自有文件位于 `<namespace>/`。

## 多格式布局

一个插件包根目录可以并列携带多个 Agent 的 manifest，它们共用 `skills/` 与 server 代码：

```text
my-polyglot-plugin/
├── plugin.json               # Agent Plugins v1 manifest
├── mcp.json                  # 可移植的 MCP server
├── skills/                   # Agent Skills（SKILL.md）
│   └── review-helper/
├── .codex-plugin/            # Codex manifest 与 OpenAI App 声明
│   └── plugin.json
├── .claude-plugin/           # Claude manifest 与 userConfig 选项
│   └── plugin.json
├── package.json              # 含 "pi" 字段时为 Pi package manifest
└── hooks/                    # Agent 生命周期 hooks（hooks.json）
```

## 格式检测

Server 检查插件包文件，并把找到的每种格式记录到 `detectedFormats`：

| 格式 | 检测依据 |
| :- | :- |
| `agent_plugin` | 插件包根目录的 `plugin.json` |
| `codex` | `.codex-plugin/plugin.json` |
| `claude` | `.claude-plugin/plugin.json` |
| `copilot` | `.github/plugin/plugin.json` |
| `cursor` | `.cursor-plugin/plugin.json` |
| `devin` | `.devin-plugin/plugin.json` |
| `goose` | `.goose-plugin/plugin.json` |
| `gemini` | `gemini-extension.json` |
| `grok` | `.grok-plugin/plugin.json` |
| `pi` | 含 `"pi"` 字段的 `package.json` |
| `cline` | 含 `"cline"` 字段的 `package.json`，或 `cline-official` 的任一条目 |

仅凭目录名称不会判定格式。特别是 `skills/`、`extensions/`、`prompts/` 或 `themes/` 不会让插件包成为 Pi package，因为 `skills/` 也属于通用布局。

## 原生支持与优先级

Agent 能读取检测到的某种格式时即原生支持该插件包，对应关系见 [Agent 插件能力](agent-plugin-capabilities.zh-CN.md#能力矩阵)。同时能读取自身 manifest 与其他格式的 Agent 优先使用自身 manifest：

- Codex 依次使用 `.codex-plugin/plugin.json`、根目录 `plugin.json`、`.claude-plugin/plugin.json` 与 `.cursor-plugin/plugin.json`。
- Claude 优先使用 `.claude-plugin/plugin.json`，其次是根目录 `plugin.json`。
- Goose 依次使用 `.goose-plugin/plugin.json`、`.plugin/plugin.json`、根目录 `plugin.json` 与 `gemini-extension.json`。
- Grok Build 依次使用 `.grok-plugin/plugin.json`、`.claude-plugin/plugin.json` 与根目录 `plugin.json`。
- Copilot CLI 依次使用根目录 `plugin.json`、`.github/plugin/plugin.json` 与 `.claude-plugin/plugin.json`。
- Pi 使用含 `"pi"` 字段的 `package.json`。

能读取根目录 `plugin.json` 但找不到自身 manifest 的 Agent，按 Agent Plugins v1 布局加载插件包。

Agent 可能原生支持某个插件包，却不读取其全部组件，例如 Goose 不读取 `mcp.json`。Cypheria 不补充 Agent 跳过的组件。

## 启用生命周期

插件只安装一次，再按 Agent 启用或禁用。安装了它的每个 Agent 在 `plugin_agent_bindings` 中有一行，见 [插件市场](plugin-marketplaces.zh-CN.md#数据库-schema)。

- **安装**会在每个原生支持的 Agent 中原生安装并启用插件。之后才支持它的 Agent 不会自动启用。
- **启用**按 Agent 独立控制，且只存在于支持该插件的 Agent 中。插件安装后，详情页为每个支持它的 Agent 显示一个开关，因此插件可以在 Codex 中运行而在 Claude 中保持关闭。
- **之后新增的支持**不会自动启用任何内容。更新后才原生支持该插件的 Agent 会显示为关闭，打开开关时会先为该 Agent 安装。
- **卸载**会从所有持有该插件的 Agent 中原生卸载，并删除 binding。

## 不支持的 Agent

读取不了插件任何已检测格式的 Agent 没有 binding，也没有开关。插件详情页将其列为不支持，Agent 的插件列表把已安装的该插件显示为不支持，Server 也会拒绝在该 Agent 中启用它的请求。安装一个已安装 Agent 都不支持的插件时，只记录该插件，不在任何 Agent 中启用。
