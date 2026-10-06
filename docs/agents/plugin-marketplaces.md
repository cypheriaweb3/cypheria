---
title: Plugin Marketplaces
---

# Plugin Marketplaces

Cypheria discovers and distributes plugins through marketplaces. Every marketplace has a local directory, owned either by the Agent that manages it or by Cypheria, so Server can read catalogs and plugin files directly. How one package loads in several Agents is described in [Polyglot Plugins](polyglot-plugins.md).

## Marketplace categories

Marketplaces fall into three groups. Each one is described in [Marketplace reference](#marketplace-reference).

1. **Predefined catalogs:** `cypheria-bundled`, `cypheria-curated`, `openai-curated`, `claude-plugins-official`, the Agent catalogs `cursor-plugins`, `cline-official`, `devin-marketplace`, `xai-official`, `copilot-plugins`, and `awesome-copilot`, and `pi-package-catalog`.
2. **Custom marketplaces:** Git repositories, local directories, or hosted marketplace JSON files that the user adds. A custom marketplace may use the Polyglot, Codex, or Claude marketplace format.
3. **`standalone-plugins`:** one system-managed marketplace that records individual Git repositories, npm packages, and local directories installed outside any catalog.

Server records every predefined marketplace and `standalone-plugins` when it starts. They are built in (`isBuiltin`) and cannot be removed by the user; `openai-curated` and `claude-plugins-official` record the Agent that manages them in `ownerAgentId`. A built-in record that is no longer built in, such as a renamed Agent catalog, is removed together with the directory Cypheria fetched for it.

## Catalog marketplaces and standalone packages

Agents distribute plugins in two ways:

| Distribution model | Agents | Characteristics |
| :- | :- | :- |
| **Catalog marketplaces** | Codex, Claude, Cursor, Copilot CLI, Grok Build, Cypheria | One marketplace file lists many plugins. Registering one repository or endpoint makes all of them installable. |
| **Standalone packages** | Pi, Devin, Goose, Cline, Gemini CLI | The Agent's CLI installs one package at a time by Git URL, npm specifier, local path, or, for Cline, an official slug. Cline and Devin publish an official catalog the CLI cannot list, which Cypheria lists as an Agent catalog. |

`standalone-plugins` gives standalone packages the same lifecycle as catalog plugins. When the user installs a Pi package, a Goose Git plugin, or a local package directory, Server records it under `standalone-plugins`, so it is listed, searched, updated, and enabled per Agent like any other plugin.

## Plugin identity

A plugin is identified as `<pluginName>@<marketplaceId>`, for example `code-review@cypheria-bundled` or `my-tool@standalone-plugins`. The same identity is used across Agents, in the database, and in `plugin://` references. Two plugins with the same name from different marketplaces are different plugins.

## Marketplace reference

Paths below are relative to `$CYPHERIA_HOME`, and an Agent's home is `agents/<agentId>/home`. "Installs for" names the Agents that can install the marketplace's plugins through Cypheria: a catalog Agent that lists the marketplace itself, and every package Agent that reads one of a plugin's formats, as listed in [Agent Plugin Capabilities](agent-plugin-capabilities.md#capabilities-matrix). Installing a plugin installs and enables it in all of them at once, as described in [Enablement lifecycle](polyglot-plugins.md#enablement-lifecycle).

An Agent catalog is registered with Codex and Claude when it ships a marketplace file they read that lists the whole catalog. Codex reads `.agents/plugins/marketplace.json`, `.claude-plugin/marketplace.json`, then `.cursor-plugin/marketplace.json` and uses the first it finds; Claude reads `.claude-plugin/marketplace.json`. A catalog they do not list is listed to them, and to every other Agent, through Cypheria.

| Marketplace | Source | Local directory | Catalog read by | Installs for |
| :- | :- | :- | :- | :- |
| `cypheria-bundled` | Packaged `plugins/` | `marketplaces/cypheria-bundled/` | Codex, Claude, Cypheria | Codex and Claude automatically; Copilot CLI, Devin, and Grok Build on request |
| `cypheria-curated` | `https://cypheria.dev/marketplace` | `marketplaces/cypheria-curated/` once published | Cypheria | Not available yet |
| `openai-curated` | Managed by Codex | `agents/codex/home/.tmp/plugins/` | Codex | Codex |
| `claude-plugins-official` | `anthropics/claude-plugins-official` | `agents/claude/home/plugins/marketplaces/claude-plugins-official/` | Claude | Claude, then Copilot CLI, Devin, and Grok Build |
| `cursor-plugins` | `cursor/plugins` | `marketplaces/cursor-plugins/` | Cypheria | One plugin, for Devin, Goose, and Grok Build |
| `cline-official` | `cline/plugins` | `marketplaces/cline-official/` | Cypheria | Cline |
| `devin-marketplace` | `CognitionAI/devin-marketplace` | `marketplaces/devin-marketplace/` | Cypheria | Devin |
| `xai-official` | `xai-org/plugin-marketplace` | `marketplaces/xai-official/` | Cypheria | Grok Build, and others by format |
| `copilot-plugins` | `github/copilot-plugins` | `marketplaces/copilot-plugins/` | Codex, Claude, Cypheria | Codex, Claude, Copilot CLI, and others by format |
| `awesome-copilot` | `github/awesome-copilot` | `marketplaces/awesome-copilot/` | Cypheria | Copilot CLI, Goose, Grok Build |
| `pi-package-catalog` | npm search for `keywords:pi-package` | `marketplaces/.sources/pi-package-catalog/` for installed packages | Cypheria | Pi |
| Custom marketplaces | Git, local directory, or hosted JSON | `marketplaces/<marketplaceId>/`, or the local directory in place | Codex and Claude when it ships their file, and Cypheria | Every Agent that reads it, by format |
| `standalone-plugins` | Git, npm, or local directory | `marketplaces/standalone-plugins/<pluginName>/`, or the local directory in place | Cypheria | Package Agents by format, except Copilot CLI |

A plugin whose catalog entry points to another Git repository or npm package is fetched into `marketplaces/.sources/<marketplaceId>/<pluginName>/`. The Agents that install it from Cypheria use that copy; Copilot CLI fetches plugins of its own marketplaces itself.

### cypheria-bundled

- **Source and directory:** the repository's `plugins/` directory, packaged with the application and materialized, with the generated `cua` plugin, into `marketplaces/cypheria-bundled/`. It ships `.agents/plugins/marketplace.json` and `.claude-plugin/marketplace.json`, and its plugins carry `.codex-plugin` and `.claude-plugin` manifests.
- **Install:** Codex and Claude register the directory and install `cypheria-app-tools`, `code-review`, `browser`, `chrome`, `computer-use`, and `cua` before an Agent session that uses app tools starts, as described in [Cypheria app tools](plugins.md#cypheria-app-tools). Copilot CLI, Devin, and Grok Build read the `claude` manifests and install a bundled plugin when the user installs it from Cypheria.
- **Update:** rebuilt from the packaged source when Cypheria is updated. Codex and Claude update a bundled plugin whose installed version differs from the packaged one; a package Agent that installed one receives the new revision through [automatic updates](agent-plugin-capabilities.md#updates).

### cypheria-curated

The official catalog of the planned [Cypheria Marketplace](../planned/marketplace.md) service, with reviewed releases and multi-Agent manifests. Its record exists before the service does; nothing is fetched until the service is published and its source changes.

### openai-curated

- **Source and directory:** OpenAI's curated Codex catalog, synchronized by Codex into `agents/codex/home/.tmp/plugins/`.
- **Install:** Codex installs from it with `plugin/install` and keeps installed plugins in `plugins/cache/openai-curated/`. Cypheria lists it only to Codex. Other Agents install a plugin after Codex only when it carries a format they read, which curated plugins usually do not.
- **Update:** each refresh asks Codex to refresh its marketplaces, and Codex installs again a plugin whose version changed while it has no running session.

### claude-plugins-official

- **Source and directory:** `anthropics/claude-plugins-official`, cloned by Claude into `agents/claude/home/plugins/marketplaces/claude-plugins-official/`.
- **Install:** Claude installs from it with `claude plugin install` and keeps installed plugins in `plugins/cache/claude-plugins-official/`. Cypheria lists it only to Claude. Installing records the plugin's directory, inside Claude's clone or fetched into `.sources`, and installs it for every package Agent that reads one of its formats: Devin and Grok Build read `claude` manifests, and Copilot CLI registers Claude's clone as a local marketplace and installs `<plugin>@claude-plugins-official` from it.
- **Update:** each refresh runs `claude plugin marketplace update`, then `claude plugin update` for Claude's installed plugins while it has no running session. Plugins fetched into `.sources` are fetched again, and the other Agents' copies follow [automatic updates](agent-plugin-capabilities.md#updates).

### cursor-plugins

- **Source and directory:** `cursor/plugins`, cloned into `marketplaces/cursor-plugins/` in the background the first time the Server starts. Cypheria reads `.cursor-plugin/marketplace.json`, which lists 97 plugins.
- **Install:** 96 plugins carry only a `.cursor-plugin` manifest, which no Agent Cypheria drives installs: Cursor supports no plugins, and Codex reads the format but the catalog is not registered with it. One plugin, `origin-apps`, also carries root `plugin.json` and `.claude-plugin/plugin.json`, so Devin, Goose, and Grok Build install it.
- **Not registered with Codex or Claude:** its `.claude-plugin/marketplace.json` lists only `origin-apps`, and Codex and Claude would read only that file.
- **Update:** fetched again when marketplaces are updated; installed copies follow [Updates](agent-plugin-capabilities.md#updates).

### cline-official

- **Source and directory:** `cline/plugins`, cloned into `marketplaces/cline-official/`. It has no marketplace file; every `plugins/<slug>/` directory is one plugin, and every entry counts as the `cline` format.
- **Install:** Cline installs an entry by slug with `cline plugin install <slug> --force --json`, after the user confirms the command, into `agents/cline/home/plugins/_installed/`.
- **Update:** fetched again when marketplaces are updated. Cline keeps its version until the user turns the plugin off and on again, which reinstalls it.

### devin-marketplace

- **Source and directory:** `CognitionAI/devin-marketplace`, cloned into `marketplaces/devin-marketplace/`. `.devin-plugin/plugin.json` lists 221 plugins in `requiredPlugins` and `optionalPlugins`; 219 carry a `.devin-plugin` manifest.
- **Install:** Devin installs a plugin by the marketplace URL and path, `devin plugins install <url>#<path> --yes --local`, so Devin fetches it itself into `agents/devin/home/data/devin/cli/plugins/cache/`.
- **Update:** fetched again when marketplaces are updated; Devin reinstalls an enabled plugin whose files changed.

### xai-official

- **Source and directory:** `xai-org/plugin-marketplace`, cloned into `marketplaces/xai-official/`. `.grok-plugin/marketplace.json` lists 31 plugins: 3 inside the repository, carrying `.grok-plugin` manifests, and 28 in other repositories pinned to a commit, which are fetched into `.sources` when installed. Grok Build's CLI does not ship this marketplace.
- **Install:** Grok Build installs a plugin from its directory with `grok plugin install <path> --trust` into `agents/grok-build/home/installed-plugins/`. Other Agents install an external plugin when it carries a format they read.
- **Update:** fetched again when marketplaces are updated, including the external plugins; Grok Build reinstalls a plugin whose files changed.

### copilot-plugins

- **Source and directory:** `github/copilot-plugins`, cloned into `marketplaces/copilot-plugins/`. It ships `.github/plugin/marketplace.json` and `.claude-plugin/marketplace.json`, both listing 17 plugins, 15 of them in other repositories.
- **Install:** registered with Codex and Claude, which list and install it themselves. Copilot CLI ships this marketplace and installs a plugin by name, `copilot plugin install <plugin>@copilot-plugins`, fetching it itself into `agents/github-copilot-cli/home/installed-plugins/copilot-plugins/`. Other package Agents install a plugin that carries a format they read.
- **Update:** fetched again when marketplaces are updated; Codex and Claude re-read it, and Copilot CLI updates its copy with `copilot plugin update`.

### awesome-copilot

- **Source and directory:** `github/awesome-copilot`, cloned into `marketplaces/awesome-copilot/`. `.github/plugin/marketplace.json` lists 170 plugins: 100 inside the repository with a root `plugin.json`, and 70 in other repositories. Codex and Claude do not read its marketplace file.
- **Install:** Copilot CLI installs a plugin by name, `copilot plugin install <plugin>@awesome-copilot`, into `agents/github-copilot-cli/home/installed-plugins/awesome-copilot/`. Goose and Grok Build read the Agent Plugins format of the plugins inside the repository and install them from there.
- **Update:** as for `copilot-plugins`.

### pi-package-catalog

- **Source:** npm packages with the `pi-package` keyword, the same index as the [Pi package gallery](https://pi.dev/packages). Server queries the npm registry search for `keywords:pi-package`, up to 250 results, and caches them in memory for an hour; Refresh fetches them again, and the catalog shows an error while offline. A scoped package `@scope/name` is listed as the plugin `scope__name`.
- **Install:** the package is unpacked into `marketplaces/.sources/pi-package-catalog/<pluginName>/` for inspection, and Pi installs it with `pi install npm:<name>` after the user confirms the command, because npm runs the package's scripts.
- **Update:** each refresh searches npm again and fetches installed packages again. Installing a newer version runs its scripts, so Pi keeps its version and the plugin shows that turning it off and on again reviews and installs the new one.

### Custom marketplaces

- **Source and directory:** a Git source is cloned into `marketplaces/<marketplaceId>/`, a hosted marketplace file is saved there as `.claude-plugin/marketplace.json`, and a local directory is referenced in place and never modified.
- **Install:** registered with Codex and Claude when it ships a marketplace file they read, so they list and install it themselves; Copilot CLI registers the directory when it first installs from it. Other package Agents install a plugin from its directory by format.
- **Update:** a Git source is fetched again and a hosted file downloaded again when marketplaces are updated; a local directory changes only when the user changes it. Installed copies follow [Updates](agent-plugin-capabilities.md#updates).

### standalone-plugins

- **Source and directory:** a Git repository is cloned and an npm package is unpacked into `marketplaces/standalone-plugins/<pluginName>/`, named after its manifest; a local directory is referenced in place.
- **Install:** every package Agent that reads one of its formats installs it. Codex and Claude do not, because it is not in their catalogs, and Copilot CLI does not, because it installs only from marketplaces.
- **Update:** each refresh fetches a Git or npm package again. A local directory is checked for changes the same way, so editing it reaches the Agents through [automatic updates](agent-plugin-capabilities.md#updates).

## Local storage topology

### Cypheria-owned directories

Cypheria stores its own catalogs, custom marketplaces, and standalone packages under `$CYPHERIA_HOME/marketplaces/`, one directory per marketplace, as listed in [Marketplace reference](#marketplace-reference). Plugins whose files live in another Git repository or npm package are fetched into `marketplaces/.sources/<marketplaceId>/<pluginName>/`, outside the marketplace clone, so a refresh does not touch them. A directory the user names is referenced in place and never modified.

Agents that read a Cypheria-owned marketplace register its local directory instead of fetching the source again, so every Agent sees the same revision. Server can inspect metadata, icons, configuration schemas, and Skills without starting an Agent.

The local directory of every marketplace is recorded in `local_path`, and the directory of every installed plugin in `install_path`.

Package Agents install from an immutable copy of the plugin's current revision, laid out like Codex's plugin cache: `$CYPHERIA_HOME/plugins/cache/<marketplaceId>/<pluginName>/<version>-<hash>/`. `<version>` is the manifest version, or `local` without one, and `<hash>` is the first 12 hex digits of the SHA-256 of the plugin's files, for example `1.2.0-2a8ad9f74633`. The hash keeps apart revisions whose files changed without a new version, so a new revision never replaces a directory another Agent is still using, and refreshing a marketplace never changes files an Agent is using. Each Agent's binding records the revision it holds in `installed_sha256`, and a revision no Agent holds is removed. Devin installing by URL, Cline installing by slug, Copilot CLI, and Pi's npm packages fetch their files themselves, so the SHA-256 only tells them that a newer revision exists.

### Agent installation directories

Cypheria starts every Agent with its home redirected to `$CYPHERIA_HOME/agents/<agentId>/home`, so the user's own Agent configuration is never touched. Inside that home, each Agent keeps its marketplaces and installed plugins:

| Agent | Marketplaces | Installed plugins |
| :- | :- | :- |
| **Codex** | `openai-curated` in `.tmp/plugins/`, other Git marketplaces in `.tmp/marketplaces/`, and local directories registered by path | Copies in `plugins/cache/<marketplaceName>/<pluginName>/` |
| **Claude** | Git marketplaces in `plugins/marketplaces/<marketplaceName>/`, local directories in place | Copies in `plugins/cache/<marketplaceName>/<pluginName>/` |
| **Copilot CLI** | Registered local directories in place; its own marketplaces cached in `cache/marketplaces/` through `COPILOT_CACHE_HOME` | Plugins of a local marketplace directory load from it; plugins of its own marketplaces are copied into `installed-plugins/<marketplaceName>/<pluginName>/` |
| **Grok Build** | Not used by Cypheria | Copies in `installed-plugins/<id>/`, named in `installed-plugins/registry.json` |
| **Cline** | Not used | Copies in `plugins/_installed/`, with dependencies installed by npm |
| **Devin** | Not used | Fetched by URL, or copied from a path, into `data/devin/cli/plugins/cache/` |
| **Goose** | Not used | A link `.agents/plugins/<name>` to the plugin's revision copy |
| **Gemini CLI** | Not used | A link to the plugin's revision copy made by `gemini extensions link` |
| **Pi** | Not used | A local package loaded from its revision copy; an npm package installed by Pi |

## Marketplace lifecycle

A marketplace is offered to every Agent that can read it.

- **Adding** validates the source, fetches it into `$CYPHERIA_HOME/marketplaces/<marketplaceId>/` (or references a local directory), and registers that directory with every Agent whose marketplace file it ships. Agents without a catalog of their own install its plugins individually from the local tree. The source must be `owner/repo` (optionally `#ref`), an `http(s)`, `ssh`, or `git` URL, an `scp`-style `git@host:path`, or an absolute local path that exists and holds a marketplace file. Options-like strings, relative paths, other URL schemes, and URLs with credentials are refused, and so are git refs and sparse paths that could be read as options or escape the repository. Every Agent must read the same marketplace `name`, and that name must be plain and not one Cypheria or a vendor owns (`cypheria-*`, `openai-*`, `standalone-plugins`, `pi-package-catalog`, and the Agent catalog names). A name already added from a different source is refused. If a check fails, the directory and every registration this call created are removed.
- **Updating** refreshes the local directory, then asks each Agent to re-read it and matches the Agents to what the marketplace now ships. An Agent that gained a marketplace file gets the marketplace registered, an Agent that lost its file has the marketplace removed together with its plugins, and a plugin that left an Agent's file is uninstalled there. A plugin whose files live in another repository or package is fetched again. When an installed plugin's files changed, Server brings each package Agent's installation up to date as described in [Updates](agent-plugin-capabilities.md#updates); Codex and Claude update their own copies with their marketplaces.
- **Removing** removes the marketplace from every Agent, uninstalls its plugins, and deletes the directories Cypheria fetched, after the client confirms the list of affected plugins.

Adding, removing, native installs, standalone installs, and uninstalls are written to the audit log.

## Database schema

Persistence uses SQLite through Drizzle ORM across three tables. Every column is described where it is defined, in [`packages/db/src/schema/plugin.ts`](../../packages/db/src/schema/plugin.ts).

| Table | Key | Holds |
| :- | :- | :- |
| `plugin_marketplaces` | Marketplace name | Source, Git ref and sparse paths, local directory, the Agent that manages it, and whether it is built in |
| `installed_plugins` | `<pluginName>@<marketplaceId>` | Name, version, and description; where its files came from (`local`, `git`, `npm`, `agent_cache` for the copy Codex or Claude installed from a catalog Cypheria cannot read, or `remote` when only they hold the files and the directory is null) and their directory; and the formats detected there |
| `plugin_agent_bindings` | Plugin and Agent | One row per Agent that installed the plugin: enablement, the receipt a package Agent's installation reported, the revision it holds in `installed_sha256`, and a status message. An Agent that does not support the plugin has no row |

Removing a marketplace deletes its plugins, and removing a plugin deletes its bindings.
