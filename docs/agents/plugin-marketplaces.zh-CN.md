---
title: 插件市场
---

# 插件市场

Cypheria 通过市场发现与分发插件。每个市场都有一个本地目录，由管理它的 Agent 或 Cypheria 持有，因此 Server 可以直接读取目录清单与插件文件。同一个插件包如何在多个 Agent 中加载，见 [Polyglot Plugins](polyglot-plugins.zh-CN.md)。

## 市场分类

市场分为三组，每个市场见 [市场参考](#市场参考)。

1. **预置目录：** `cypheria-bundled`、`cypheria-curated`、`openai-curated`、`claude-plugins-official`，Agent 目录 `cursor-plugins`、`cline-official`、`devin-marketplace`、`xai-official`、`copilot-plugins` 与 `awesome-copilot`，以及 `pi-package-catalog`。
2. **自定义市场：** 用户添加的 Git 仓库、本地目录或托管的市场 JSON 文件。自定义市场可以使用 Polyglot、Codex 或 Claude 市场格式。
3. **`standalone-plugins`：** 一个由系统管理的市场，记录在任何目录之外安装的单个 Git 仓库、npm package 与本地目录。

Server 启动时会记录所有预置市场与 `standalone-plugins`。它们是内置的（`isBuiltin`），用户无法移除；`openai-curated` 与 `claude-plugins-official` 在 `ownerAgentId` 中记录管理它们的 Agent。不再内置的内置记录（例如改名后的 Agent 目录）会连同 Cypheria 为其获取的目录一起移除。

## 目录市场与独立插件包

Agent 以两种方式分发插件：

| 分发模型 | Agent | 特征 |
| :- | :- | :- |
| **目录市场** | Codex、Claude、Cursor、Copilot CLI、Grok Build、Cypheria | 一个市场文件列出多个插件。注册一个仓库或 endpoint 后，其中所有插件都可安装。 |
| **独立插件包** | Pi、Devin、Goose、Cline、Gemini CLI | Agent 的 CLI 通过 Git URL、npm 标识、本地路径或（Cline 的）官方 slug 逐个安装插件包。Cline 与 Devin 发布了 CLI 无法列出的官方目录，Cypheria 将其作为 Agent 目录列出。 |

`standalone-plugins` 让独立插件包拥有与目录插件相同的生命周期。用户安装 Pi package、Goose Git 插件或本地插件包目录时，Server 把它记录在 `standalone-plugins` 下，使其像其他插件一样被列出、搜索、更新，并按 Agent 启用。

## 插件标识

插件以 `<pluginName>@<marketplaceId>` 标识，例如 `code-review@cypheria-bundled` 或 `my-tool@standalone-plugins`。同一标识用于所有 Agent、数据库以及 `plugin://` 引用。来自不同市场的同名插件是不同的插件。

## 市场参考

下文路径相对于 `$CYPHERIA_HOME`，Agent 的 home 为 `agents/<agentId>/home`。“可安装的 Agent”指能通过 Cypheria 安装该市场插件的 Agent：自身列出该市场的目录型 Agent，以及能读取插件某种格式的每个 package Agent，见 [Agent 插件能力](agent-plugin-capabilities.zh-CN.md#能力矩阵)。安装插件时会同时在所有这些 Agent 中安装并启用，见 [启用生命周期](polyglot-plugins.zh-CN.md#启用生命周期)。

Agent 目录携带 Codex 或 Claude 能读取、且列出整个目录的市场文件时，会向其注册。Codex 依次读取 `.agents/plugins/marketplace.json`、`.claude-plugin/marketplace.json` 与 `.cursor-plugin/marketplace.json`，使用第一个找到的；Claude 读取 `.claude-plugin/marketplace.json`。未向其注册的目录，通过 Cypheria 列给它们以及其他所有 Agent。

| 市场 | 来源 | 本地目录 | 读取目录的一方 | 可安装的 Agent |
| :- | :- | :- | :- | :- |
| `cypheria-bundled` | 随应用打包的 `plugins/` | `marketplaces/cypheria-bundled/` | Codex、Claude、Cypheria | Codex 与 Claude 自动安装；Copilot CLI、Devin、Grok Build 按需安装 |
| `cypheria-curated` | `https://cypheria.dev/marketplace` | 发布后为 `marketplaces/cypheria-curated/` | Cypheria | 尚不可用 |
| `openai-curated` | 由 Codex 管理 | `agents/codex/home/.tmp/plugins/` | Codex | Codex |
| `claude-plugins-official` | `anthropics/claude-plugins-official` | `agents/claude/home/plugins/marketplaces/claude-plugins-official/` | Claude | Claude，以及 Copilot CLI、Devin 与 Grok Build |
| `cursor-plugins` | `cursor/plugins` | `marketplaces/cursor-plugins/` | Cypheria | 一个插件，适用于 Devin、Goose 与 Grok Build |
| `cline-official` | `cline/plugins` | `marketplaces/cline-official/` | Cypheria | Cline |
| `devin-marketplace` | `CognitionAI/devin-marketplace` | `marketplaces/devin-marketplace/` | Cypheria | Devin |
| `xai-official` | `xai-org/plugin-marketplace` | `marketplaces/xai-official/` | Cypheria | Grok Build，以及按格式适用的其他 Agent |
| `copilot-plugins` | `github/copilot-plugins` | `marketplaces/copilot-plugins/` | Codex、Claude、Cypheria | Codex、Claude、Copilot CLI，以及按格式适用的其他 Agent |
| `awesome-copilot` | `github/awesome-copilot` | `marketplaces/awesome-copilot/` | Cypheria | Copilot CLI、Goose、Grok Build |
| `pi-package-catalog` | npm 搜索 `keywords:pi-package` | 已安装的 package 位于 `marketplaces/.sources/pi-package-catalog/` | Cypheria | Pi |
| 自定义市场 | Git、本地目录或托管 JSON | `marketplaces/<marketplaceId>/`，或原地使用的本地目录 | 携带其文件时为 Codex 与 Claude，以及 Cypheria | 按格式适用的所有 Agent |
| `standalone-plugins` | Git、npm 或本地目录 | `marketplaces/standalone-plugins/<pluginName>/`，或原地使用的本地目录 | Cypheria | 按格式适用的 package Agent，Copilot CLI 除外 |

目录条目指向其他 Git 仓库或 npm package 的插件会获取到 `marketplaces/.sources/<marketplaceId>/<pluginName>/`。通过 Cypheria 安装它的 Agent 使用这份副本；Copilot CLI 自行获取其自带市场中的插件。

### cypheria-bundled

- **来源与目录：** 代码仓库的 `plugins/` 目录随应用打包，连同生成的 `cua` 插件一起生成到 `marketplaces/cypheria-bundled/`。它携带 `.agents/plugins/marketplace.json` 与 `.claude-plugin/marketplace.json`，其插件携带 `.codex-plugin` 与 `.claude-plugin` manifest。
- **安装：** 在使用 app tools 的 Agent 会话启动前，Codex 与 Claude 注册该目录并安装 `cypheria-app-tools`、`code-review`、`browser`、`chrome`、`computer-use` 与 `cua`，见 [Cypheria app tools](plugins.zh-CN.md#cypheria-app-tools)。Copilot CLI、Devin 与 Grok Build 读取 `claude` manifest，在用户从 Cypheria 安装内置插件时安装它。
- **更新：** Cypheria 更新时从打包来源重新生成。已安装版本与打包版本不同时，Codex 与 Claude 更新该内置插件；安装了它的 package Agent 通过 [自动更新](agent-plugin-capabilities.zh-CN.md#更新) 获得新修订版本。

### cypheria-curated

计划中的 [Cypheria Marketplace](../planned/marketplace.zh-CN.md) 服务的官方目录，提供经过审查的 release 与多 Agent manifest。其记录先于服务存在；服务发布、来源变更之前不会获取任何内容。

### openai-curated

- **来源与目录：** OpenAI 的 Codex 精选目录，由 Codex 同步到 `agents/codex/home/.tmp/plugins/`。
- **安装：** Codex 以 `plugin/install` 从中安装，并把已安装插件保存在 `plugins/cache/openai-curated/`。Cypheria 只把它列给 Codex。只有插件携带其他 Agent 能读取的格式时，其他 Agent 才会在 Codex 之后安装它，而精选插件通常不携带。
- **更新：** 每次刷新都会请 Codex 刷新其市场；Codex 没有运行中的会话时，会重新安装版本发生变化的插件。

### claude-plugins-official

- **来源与目录：** `anthropics/claude-plugins-official`，由 Claude 克隆到 `agents/claude/home/plugins/marketplaces/claude-plugins-official/`。
- **安装：** Claude 以 `claude plugin install` 从中安装，并把已安装插件保存在 `plugins/cache/claude-plugins-official/`。Cypheria 只把它列给 Claude。安装时会记录插件目录（位于 Claude 的克隆中，或获取到 `.sources`），并为能读取其某种格式的每个 package Agent 安装：Devin 与 Grok Build 读取 `claude` manifest，Copilot CLI 把 Claude 的克隆注册为本地市场并从中安装 `<plugin>@claude-plugins-official`。
- **更新：** 每次刷新都会运行 `claude plugin marketplace update`，并在 Claude 没有运行中的会话时，对其已安装插件运行 `claude plugin update`。获取到 `.sources` 的插件会重新获取，其他 Agent 的副本按 [自动更新](agent-plugin-capabilities.zh-CN.md#更新) 处理。

### cursor-plugins

- **来源与目录：** `cursor/plugins`，在 Server 首次启动时于后台克隆到 `marketplaces/cursor-plugins/`。Cypheria 读取 `.cursor-plugin/marketplace.json`，其中列出 97 个插件。
- **安装：** 96 个插件只携带 `.cursor-plugin` manifest，Cypheria 驱动的 Agent 都无法安装：Cursor 不支持插件，Codex 能读取该格式但该目录未向其注册。只有 `origin-apps` 同时携带根目录 `plugin.json` 与 `.claude-plugin/plugin.json`，因此 Devin、Goose 与 Grok Build 可以安装它。
- **不向 Codex 或 Claude 注册：** 它的 `.claude-plugin/marketplace.json` 只列出 `origin-apps`，而 Codex 与 Claude 只会读取该文件。
- **更新：** 更新市场时重新获取；已安装副本按 [更新](agent-plugin-capabilities.zh-CN.md#更新) 处理。

### cline-official

- **来源与目录：** `cline/plugins`，克隆到 `marketplaces/cline-official/`。它没有市场文件；每个 `plugins/<slug>/` 目录是一个插件，每个条目都视为 `cline` 格式。
- **安装：** 用户确认命令后，Cline 以 `cline plugin install <slug> --force --json` 按 slug 安装到 `agents/cline/home/plugins/_installed/`。
- **更新：** 更新市场时重新获取。Cline 保留其当前版本，直到用户关闭再打开插件以重新安装。

### devin-marketplace

- **来源与目录：** `CognitionAI/devin-marketplace`，克隆到 `marketplaces/devin-marketplace/`。`.devin-plugin/plugin.json` 在 `requiredPlugins` 与 `optionalPlugins` 中列出 221 个插件，其中 219 个携带 `.devin-plugin` manifest。
- **安装：** Devin 按市场 URL 与路径安装插件：`devin plugins install <url>#<path> --yes --local`，由 Devin 自行获取到 `agents/devin/home/data/devin/cli/plugins/cache/`。
- **更新：** 更新市场时重新获取；文件发生变化的已启用插件由 Devin 重新安装。

### xai-official

- **来源与目录：** `xai-org/plugin-marketplace`，克隆到 `marketplaces/xai-official/`。`.grok-plugin/marketplace.json` 列出 31 个插件：3 个位于仓库内并携带 `.grok-plugin` manifest，28 个位于固定到某个 commit 的其他仓库中，安装时获取到 `.sources`。Grok Build 的 CLI 不自带该市场。
- **安装：** Grok Build 以 `grok plugin install <path> --trust` 从插件目录安装到 `agents/grok-build/home/installed-plugins/`。外部插件携带其他 Agent 能读取的格式时，其他 Agent 也会安装。
- **更新：** 更新市场时重新获取，包括外部插件；文件发生变化的插件由 Grok Build 重新安装。

### copilot-plugins

- **来源与目录：** `github/copilot-plugins`，克隆到 `marketplaces/copilot-plugins/`。它携带 `.github/plugin/marketplace.json` 与 `.claude-plugin/marketplace.json`，两者都列出 17 个插件，其中 15 个位于其他仓库。
- **安装：** 向 Codex 与 Claude 注册，由它们自行列出与安装。Copilot CLI 自带该市场，按名称安装插件：`copilot plugin install <plugin>@copilot-plugins`，由它自行获取到 `agents/github-copilot-cli/home/installed-plugins/copilot-plugins/`。插件携带其他 package Agent 能读取的格式时，它们也会安装。
- **更新：** 更新市场时重新获取；Codex 与 Claude 重新读取它，Copilot CLI 以 `copilot plugin update` 更新其副本。

### awesome-copilot

- **来源与目录：** `github/awesome-copilot`，克隆到 `marketplaces/awesome-copilot/`。`.github/plugin/marketplace.json` 列出 170 个插件：100 个位于仓库内并带根目录 `plugin.json`，70 个位于其他仓库。Codex 与 Claude 不读取其市场文件。
- **安装：** Copilot CLI 按名称安装插件：`copilot plugin install <plugin>@awesome-copilot`，安装到 `agents/github-copilot-cli/home/installed-plugins/awesome-copilot/`。Goose 与 Grok Build 读取仓库内插件的 Agent Plugins 格式，并从仓库内安装。
- **更新：** 与 `copilot-plugins` 相同。

### pi-package-catalog

- **来源：** 带 `pi-package` keyword 的 npm package，与 [Pi package gallery](https://pi.dev/packages) 是同一索引。Server 用 npm registry 搜索 `keywords:pi-package`，最多取 250 条结果，并在内存中缓存一小时；刷新会重新获取，离线时该目录显示错误。scoped package `@scope/name` 列为插件 `scope__name`。
- **安装：** package 被解包到 `marketplaces/.sources/pi-package-catalog/<pluginName>/` 供检查；由于 npm 会运行 package 的脚本，用户确认命令后 Pi 以 `pi install npm:<name>` 安装。
- **更新：** 每次刷新都会重新搜索 npm 并重新获取已安装的 package。安装更新版本会运行其脚本，因此 Pi 保留当前版本，插件会提示关闭再打开以审查并安装新版本。

### 自定义市场

- **来源与目录：** Git 来源克隆到 `marketplaces/<marketplaceId>/`，托管的市场文件保存为其中的 `.claude-plugin/marketplace.json`，本地目录原地引用且从不修改。
- **安装：** 携带 Codex 或 Claude 能读取的市场文件时向其注册，由它们自行列出与安装；Copilot CLI 首次从中安装时注册该目录。其他 package Agent 按格式从插件目录安装。
- **更新：** 更新市场时，Git 来源重新获取，托管文件重新下载；本地目录只在用户修改时变化。已安装副本按 [更新](agent-plugin-capabilities.zh-CN.md#更新) 处理。

### standalone-plugins

- **来源与目录：** Git 仓库被克隆、npm package 被解包到 `marketplaces/standalone-plugins/<pluginName>/`，以其 manifest 命名；本地目录原地引用。
- **安装：** 能读取其某种格式的每个 package Agent 都会安装。Codex 与 Claude 不会安装，因为它不在其目录中；Copilot CLI 也不会，因为它只从市场安装。
- **更新：** 每次刷新都会重新获取 Git 或 npm package。本地目录以同样方式检查变化，因此对它的修改会通过 [自动更新](agent-plugin-capabilities.zh-CN.md#更新) 到达各 Agent。

## 本地存储拓扑

### Cypheria 管理的目录

Cypheria 把自己的目录、自定义市场与独立插件包保存在 `$CYPHERIA_HOME/marketplaces/` 下，每个市场一个目录，见 [市场参考](#市场参考)。文件位于其他 Git 仓库或 npm package 的插件获取到 `marketplaces/.sources/<marketplaceId>/<pluginName>/`，位于市场克隆之外，因此刷新不会影响它们。用户指定的目录原地引用，从不修改。

读取 Cypheria 管理的市场的 Agent 会注册其本地目录，而不是再次获取来源，因此每个 Agent 看到的是同一个修订版本。Server 无需启动 Agent 即可检查元数据、图标、配置 Schema 与 Skills。

每个市场的本地目录记录在 `local_path`，每个已安装插件的目录记录在 `install_path`。

package Agent 从插件当前修订版本的不可变副本安装，其布局与 Codex 的插件缓存相同：`$CYPHERIA_HOME/plugins/cache/<marketplaceId>/<pluginName>/<version>-<hash>/`。`<version>` 是 manifest 中的版本，没有时为 `local`；`<hash>` 是插件文件 SHA-256 的前 12 位十六进制，例如 `1.2.0-2a8ad9f74633`。哈希用于区分版本号未变而文件已变的修订版本，因此新修订版本不会替换其他 Agent 仍在使用的目录，刷新市场也从不改变 Agent 正在使用的文件。每个 Agent 的 binding 在 `installed_sha256` 中记录其持有的修订版本，没有 Agent 持有的修订版本会被移除。按 URL 安装的 Devin、按 slug 安装的 Cline、Copilot CLI 与 Pi 的 npm package 自行获取文件，SHA-256 只用于告诉它们有更新的修订版本。

### Agent 安装目录

Cypheria 启动每个 Agent 时都把其 home 重定向到 `$CYPHERIA_HOME/agents/<agentId>/home`，因此不会触及用户自己的 Agent 配置。在该 home 中，各 Agent 保存其市场与已安装插件：

| Agent | 市场 | 已安装插件 |
| :- | :- | :- |
| **Codex** | `openai-curated` 位于 `.tmp/plugins/`，其他 Git 市场位于 `.tmp/marketplaces/`，本地目录按路径注册 | 副本位于 `plugins/cache/<marketplaceName>/<pluginName>/` |
| **Claude** | Git 市场位于 `plugins/marketplaces/<marketplaceName>/`，本地目录原地使用 | 副本位于 `plugins/cache/<marketplaceName>/<pluginName>/` |
| **Copilot CLI** | 已注册的本地目录原地使用；其自带市场通过 `COPILOT_CACHE_HOME` 缓存在 `cache/marketplaces/` | 本地市场目录中的插件直接从该目录加载；自带市场中的插件复制到 `installed-plugins/<marketplaceName>/<pluginName>/` |
| **Grok Build** | Cypheria 不使用 | 副本位于 `installed-plugins/<id>/`，名称记录在 `installed-plugins/registry.json` |
| **Cline** | 不使用 | 副本位于 `plugins/_installed/`，依赖由 npm 安装 |
| **Devin** | 不使用 | 按 URL 获取，或从路径复制，到 `data/devin/cli/plugins/cache/` |
| **Goose** | 不使用 | 指向插件修订版本副本的链接 `.agents/plugins/<name>` |
| **Gemini CLI** | 不使用 | 由 `gemini extensions link` 建立的指向插件修订版本副本的链接 |
| **Pi** | 不使用 | 本地 package 从其修订版本副本加载；npm package 由 Pi 安装 |

## 市场生命周期

市场总是对所有能读取它的 Agent 开放。

- **添加**会校验来源，将其获取到 `$CYPHERIA_HOME/marketplaces/<marketplaceId>/`（或引用本地目录），并向每个能找到自身市场文件的 Agent 注册该目录。没有自身目录机制的 Agent 从本地目录树逐个安装其中的插件。来源必须是 `owner/repo`（可带 `#ref`）、`http(s)`、`ssh` 或 `git` URL、`scp` 形式的 `git@host:path`，或存在且含市场文件的绝对本地路径。类似选项的字符串、相对路径、其他 URL scheme 和带凭据的 URL 都会被拒绝，可被当作选项或逃出仓库的 git ref 与稀疏路径也会被拒绝。所有 Agent 读到的市场 `name` 必须一致，且该名称必须是普通名称，不能是 Cypheria 或厂商保留的名称（`cypheria-*`、`openai-*`、`standalone-plugins`、`pi-package-catalog` 以及 Agent 目录的名称）。已从另一个来源添加过的同名市场会被拒绝。任一检查失败时，本次调用创建的目录与注册都会被移除。
- **更新**会刷新本地目录，再让各 Agent 重新读取，并使各 Agent 与市场当前内容一致。新增了市场文件的 Agent 会注册该市场；失去文件的 Agent 会连同其插件一起移除该市场；已从某个 Agent 文件中移除的插件会在该 Agent 中卸载。文件位于其他仓库或 package 中的插件会重新获取。已安装插件的文件发生变化时，Server 按 [更新](agent-plugin-capabilities.zh-CN.md#更新) 使各 package Agent 的安装保持最新；Codex 与 Claude 随各自的市场更新自己的副本。
- **移除**会从所有 Agent 中移除该市场，卸载其插件并删除 Cypheria 获取的目录；客户端需先确认受影响的插件列表。

添加、移除、原生安装、独立安装与卸载都会写入审计日志。

## 数据库 Schema

持久化使用 SQLite 与 Drizzle ORM，共三张表。每一列都在定义处说明，见 [`packages/db/src/schema/plugin.ts`](../../packages/db/src/schema/plugin.ts)。

| 表 | 键 | 内容 |
| :- | :- | :- |
| `plugin_marketplaces` | 市场名称 | 来源、Git ref 与稀疏路径、本地目录、管理它的 Agent，以及是否内置 |
| `installed_plugins` | `<pluginName>@<marketplaceId>` | 名称、版本与描述；文件来源（`local`、`git`、`npm`；Codex 或 Claude 从 Cypheria 无法读取的目录安装的副本为 `agent_cache`；只有它们持有文件时为 `remote`，此时目录为 null）及其目录；以及在其中检测到的格式 |
| `plugin_agent_bindings` | 插件与 Agent | 安装了该插件的每个 Agent 一行：启用状态、package Agent 安装时报告的回执、它在 `installed_sha256` 中持有的修订版本，以及状态消息。不支持该插件的 Agent 没有行 |

移除市场会删除其插件，移除插件会删除其 binding。
