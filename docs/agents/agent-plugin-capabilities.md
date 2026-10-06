---
title: Agent Plugin Capabilities
---

# Agent Plugin Capabilities

Server manages plugins through each Agent's own CLI or API. An Agent without a plugin installation Cypheria can drive supports no plugins. This page lists what each Agent supports. The package model and per-Agent enablement are in [Polyglot Plugins](polyglot-plugins.md); marketplaces and storage are in [Plugin Marketplaces](plugin-marketplaces.md).

Every command runs with the Agent's home redirected to `$CYPHERIA_HOME/agents/<agentId>/home`, and every path below is inside that home. Server never reads or writes the user's own Agent configuration.

## Capabilities matrix

| Agent | Catalogs | Native formats | Native commands |
| :- | :- | :- | :- |
| **Codex** | Yes | `codex`, `agent_plugin`, `claude`, `cursor` | App Server `marketplace/*`, `plugin/install` |
| **Claude** | Yes | `claude`, `agent_plugin` | `claude plugin marketplace add`, `claude plugin install` |
| **Copilot CLI** | Yes | `agent_plugin`, `copilot`, `claude`, from a marketplace directory or a marketplace it ships | `copilot plugin marketplace add`, `copilot plugin install`, `enable`, `disable`, `uninstall` |
| **Grok Build** | Yes | `grok`, `claude`, `agent_plugin` | `grok plugin install <path> --trust`, `enable`, `disable`, `uninstall`, `list --json` |
| **Devin** | No | `devin`, `claude` | `devin plugins install <url>#<path> --yes --local` or `<path>`, `devin plugins remove` |
| **Goose** | No | `goose`, `agent_plugin`, `gemini` | `goose plugin install <gitUrl>`; list, enablement, and uninstall through [Goose's plugin layout](#goose) |
| **Cline** | No | `cline`, every `cline-official` entry | `cline plugin install <slug>` or `<path>` `--force --json`, `cline plugin uninstall <installPath>` |
| **Gemini CLI** | No | `gemini` | `gemini extensions link <path> --consent`, `enable`, `disable`, `uninstall` |
| **Pi** | No | `pi` | `pi install <source>`, `pi remove <source>` |
| **Cursor** | Yes | None | None |
| **OpenCode** | No | None | None |

Cursor supports no plugins in Cypheria. Its CLI only adds, lists, updates, and removes marketplaces, and Cypheria runs it as `cursor-agent acp`, which loads no plugins: neither those in `~/.cursor/plugins/local` nor those passed with `--plugin-dir`, which only the CLI's chat mode reads. `cursor-plugins` is listed through Cypheria and not registered with Codex or Claude, because its `.claude-plugin` marketplace file lists only one of its plugins. OpenCode and the other registry ACP Agents have no plugin installation either.

## Native installation

When an Agent supports a package natively, Server installs it with that Agent's own command:

- **Codex:** `marketplace/add` and `plugin/install` through the supervised App Server.
- **Claude:** `claude plugin … --json` with `CLAUDE_CONFIG_DIR` set to the managed home, as described in [Claude plugin management](plugins.md#claude-plugin-management).
- **Copilot CLI:** `copilot plugin marketplace add <marketplacePath>` registers the marketplace directory once, then `copilot plugin install <plugin>@<marketplace>`. A plugin of `copilot-plugins` or `awesome-copilot`, which Copilot ships, installs by name without registering anything, and Copilot fetches it itself. Copilot deprecates installing directly from a path, URL, or repository, so a standalone package and a plugin of any other Agent catalog are not supported. `COPILOT_CACHE_HOME` keeps Copilot's marketplace cache in its managed home.
- **Devin:** a plugin of a Git marketplace, such as `devin-marketplace`, installs as `devin plugins install <url>#<path> --yes --local`, so Devin records its source and can update it; any other package installs from its `install_path`. Devin must be signed in. `--yes` skips Devin's own trust prompt because the user already confirmed the install in Cypheria. Devin cannot switch a plugin off, so disabling removes it and enabling installs it again.
- **Cline:** a `cline-official` entry installs by slug with `cline plugin install <slug> --force --json`, the way Cline's own official installs work, and any other Cline plugin from its `install_path`. Cline copies the plugin into `plugins/_installed/` under its managed home and runs `npm install` for its dependencies, so every Cline install follows the review rule below. Server keeps the install path Cline reports and uninstalls with it. Cline cannot switch a plugin off from its CLI, so disabling removes it and enabling installs it again.
- **Goose:** Server links the package in place; see [Goose](#goose).
- **Grok Build:** `grok plugin install <installPath> --trust` with `GROK_HOME` set to the managed home. Grok copies the package into `installed-plugins/` and enables it; `--trust` lets its hooks and MCP servers load because the user already chose to install it in Cypheria. Grok names the plugin after its manifest, so Server records that name from `grok plugin list --json` and switches and uninstalls the plugin by it.
- **Gemini CLI:** `gemini extensions link <installPath> --consent`, so the extension is used in place.
- **Pi:** `pi install <installPath>` for a package whose `package.json` has a `"pi"` property, loaded in place. A package from `pi-package-catalog` installs as `pi install npm:<name>`, which runs npm and the package's scripts, so it follows the review rule below. Pi cannot switch a package off, so disabling removes it and enabling adds it again.

Every Agent receives the plugin's `install_path` from [Plugin Marketplaces](plugin-marketplaces.md#local-storage-topology), so it installs the same revision Cypheria inspected. Commands that run package code on this computer during installation follow the same review rule as Claude: Server returns the command and its SHA-256 and runs it only after the client resubmits that SHA-256. Native installs and removals are audited.

## Updates

Plugins update automatically, in two parts, without changing what a running session uses:

1. **Marketplace catalogs:** two minutes after the Server starts and then every six hours, Server refreshes every Cypheria-owned marketplace, asks Codex and Claude to refresh theirs, searches the Pi package catalog again, and fetches again the plugins whose files live in another repository or package and the standalone Git and npm packages. Updating marketplaces from the client runs the same refresh at once. Refreshes and updates run one at a time.
2. **Installed plugins:** after each refresh, and every ten minutes, Server updates the plugins of each Agent that has no running session, that is no Thread whose session is not stopped. An Agent with a running session keeps its plugins, and the update waits until it is idle; the next session it starts uses the new version. No running session is reloaded.

Codex installs again a plugin whose installed version differs from its marketplace's, and Claude runs `claude plugin update` for each installed plugin. A package Agent holds a revision copy, as described in [Plugin Marketplaces](plugin-marketplaces.md#cypheria-owned-directories), and receives the current revision when its SHA-256 differs from the one it holds:

- **Pi** removes the old revision and installs the new one; a disabled package is not installed, and its next enable installs the new revision.
- **Goose** has its link pointed at the new revision; its enablement is keyed by the link and stays.
- **Gemini CLI** uninstalls the extension and links the new revision, then disables it again if it was off.
- **Copilot CLI** runs `copilot plugin update <plugin>@<marketplace>`, which does nothing when the plugin is current.
- **Grok Build** copies the plugin but treats a local install as a live link, so `grok plugin update` does not copy it again. Server reinstalls it with `grok plugin uninstall <name> --keep-data`, then `grok plugin install`, and disables it again if it was off.
- **Devin** reinstalls an enabled plugin; a disabled one is not installed, and its next enable installs the new revision.
- **Cline** and **Pi's npm packages** run package code when they install, which needs the user's review, so Server keeps their version and the plugin shows that turning it off and on again reviews and installs the new one.

A failed update keeps the old revision and shows the error on the plugin. Updates are audited.

## Goose

Goose 1.52 has `goose plugin install` and `update` but no list, enable, or uninstall command. Server implements them on Goose's own plugin layout, with `GOOSE_PATH_ROOT` set to Goose's managed home:

- **Layout:** each user plugin is a directory `.agents/plugins/<name>/`. A plugin installed by Goose holds `.goose-plugin-install.json` with its Git source, format (`open-plugins` or `gemini`), and auto-update setting. Goose reads the manifest from `.goose-plugin/plugin.json`, `.plugin/plugin.json`, or `plugin.json`, or a Gemini `gemini-extension.json`, and Skills from `skills/`.
- **List:** read the directories in `.agents/plugins/`, their install metadata and manifests, and their enablement.
- **Enablement:** the `plugins` map in `config/config.yaml`, keyed by the plugin directory path with `{ enabled: boolean }`. Goose adds newly discovered plugins as enabled. `enabledPlugins` and `disabledPlugins` in `.config/goose/settings.json` also apply by name; Server does not write them, and reports a plugin they disable.
- **Install in place:** Server links `.agents/plugins/<name>` to the package's `install_path` instead of letting Goose clone it again, and enables it in the `plugins` map. Goose follows the link, and Server updates the source itself. A directory Goose installed itself is never replaced.
- **Uninstall:** remove `.agents/plugins/<name>`, or only the link, and its entry in the `plugins` map.

Goose reads plugin MCP servers only from `.mcp.json` or a path the manifest declares, and only `stdio` servers, so an Agent Plugins package whose servers are in `mcp.json` gives Goose its Skills but not its servers.
