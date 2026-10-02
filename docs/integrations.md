---
title: Integrations
---

# Integrations

> Planned: Cypheria-native plugin execution is not yet complete.

The Server presents Skills, MCP servers, plugins, marketplaces, and Codex Apps through one integration facade while preserving each harness's provenance and semantics.

## Common model

Every integration view carries an owning Agent and optional native identifier. Compatibility tags declare support for `codex`, `claude`, `pi`, `opencode`, or the ACP compatibility bucket. The Server validates compatibility before enablement or launch; clients show compatible, incompatible, and Agent-specific states.

Harness records are normalized for presentation, but mutation is routed back to the owning Agent adapter. Cypheria does not claim that one ecosystem supports another ecosystem's installation or trust model.

## Skills

Skills are reusable instruction bundles. The API reports display metadata, scope, path, dependency count, enablement, harness, plugin membership, and compatibility. Skills are treated as cross-Agent concepts when their content and harness support permit it; Agent-only Skills carry the corresponding compatibility tag.

Filesystem discovery and enablement are Server responsibilities. Clients never scan harness homes directly.

## MCP

MCP servers are also a common concept. The integration API reports tools, resources, authentication state, runtime state, enablement, plugin membership, and compatibility. It supports listing, adding URL-based servers, changing enablement, and starting harness-supported login flows.

Transport credentials and OAuth state stay in the Server or harness runtime. MCP elicitation enters the common Thread interaction lifecycle.

For Codex's `codex_apps` server, each discovered tool reports an `appScope` only when its metadata identifies a consistent connector, account link, and action resource URI. Other tools report `null`. Consumers must recheck this scope and the current account before invoking a connector tool; discovery alone does not grant access.

## Plugin ecosystems

`ecosystem` identifies the plugin contract:

- `cypheria`: Cypheria-native manifest and contribution points;
- `openai`: ChatGPT/Codex plugin format;
- `claude`: Claude plugin ecosystem;
- `pi`: Pi extensions;
- `opencode`: OpenCode plugins.

Plugin views retain source type, marketplace identity, install policy, availability, version, capabilities, compatibility, and harness provenance. Listing, detail, install, uninstall, and enablement operations are implemented through harness adapters where the harness supports them.

Codex remote plugins have a catalog ID distinct from their displayed name. Server resolves that ID from a fresh `plugin/list` result before remote detail or install requests, so a visible plugin is not sent to Codex's install endpoint under its display name.

When plugins are enabled for Codex or Claude, Server registers the bundled `cypheria-bundled` marketplace and installs `cypheria-app-tools` in that Agent's managed home. This MCP plugin carries the Cypheria app tools and the local Git tools described in [Cypheria app tools](#cypheria-app-tools). It declares no OpenAI App ID and has no GitHub or GitLab connector credentials.
The bundled marketplace is a dual-format plugin root: it carries a Codex marketplace and manifest and a Claude marketplace and manifest, and each Agent's MCP declaration lives in its own file next to the shared server implementation.
When an installed bundled plugin is discovered after a Cypheria update, Server checks its local version and updates it from the bundled marketplace before returning the plugin list.
The Git backend and Agent-tool relationship are explained in [Local Git design](git.md).
Its worktree tools create detached worktrees under `CYPHERIA_HOME/worktrees`, list managed and external worktrees, and delete or restore clean managed worktrees from a saved commit ref.

### Cypheria app tools

`cypheria-app-tools` is the one path through which Codex and Claude reach Cypheria's own tools: the Thread, project, sidebar, worktree, handoff, and automation tools listed in [Agent harnesses](agent-harnesses.md#codex), and the Git tools generated from the public Git protocol. Codex dynamic tools carry only the browser tools. The plugin runs no tool itself: it lists and calls tools through `/api/v1/app-tools/*` on the Server, and the Server executes each call for the calling Thread with the same code the clients use.

Those routes accept only an app tools token, never the Server's own token, and Server removes `CYPHERIA_SERVER_TOKEN` from every Agent environment. Server derives tokens from a secret held in memory and passes them to the Agent processes it starts, together with `CYPHERIA_SERVER_URL`:

- A Claude session receives a token bound to its Thread through the SDK environment, and the Claude manifest expands it into the MCP server's environment. Claude does not tell an MCP server which session calls it, so the token is the Thread identity. Commands Claude runs can read the token, which allows only what that Thread's Agent may already do.
- The Codex app-server serves every Codex Thread from one process, so it receives one token for the process. Codex attaches `x-codex-turn-metadata` to each MCP call, and Server resolves its `thread_id`, then `parent_thread_id` for a subagent, then `session_id`, to the live Cypheria Thread. Commands Codex runs inherit that environment unless the user's `shell_environment_policy` excludes the variable, so they can also call app tools, which already act on any Thread by ID.

The Codex manifest runs the server three times, because Codex sets tool exposure and approval per server: `cypheria_app_tools` for the Git tools with Codex's default approval, `cypheria_app` for app tools found through tool search, and `cypheria_app_direct` for `list_artifacts`, which Codex lists directly. Both app tool servers approve calls without prompting and allow an hour per call. Claude uses one server for every tool, under Claude's own permission mode. When the MCP client cancels a call, the plugin aborts the HTTP request and Server stops waiting in `wait_threads`.

Before a Codex Thread starts, resumes, or forks, and before a Claude turn starts, Server installs or updates the bundled plugin once per Server process. An Agent whose plugins are turned off has no app tools.

### Claude plugin management

Server manages Claude plugins by running the managed Claude CLI's `claude plugin … --json` commands with `CLAUDE_CONFIG_DIR` set to Cypheria's Claude home; it never edits Claude's state files, and the user's own Claude home is untouched. Plugin changes are serialized per Agent.

- Server registers `claude-plugins-official` and the bundled `cypheria-bundled` marketplace the first time Claude plugins are listed. Registering the bundled marketplace installs nothing: the plugin is installed when the user turns it on for Claude. Other marketplaces (a GitHub repository, git URL, local directory, or hosted `marketplace.json`) are added by the user. Marketplaces hosted on claude.ai are not added; plugins synced from claude.ai or loaded for one session are listed read-only.
- **The Plugins switch.** Claude has no setting that turns plugins off, so Cypheria keeps `agents.claude.pluginsEnabled` (default `true`) in `$CYPHERIA_HOME/config/config.json` and shows it on Claude's Settings page, like Codex's Plugins setting. While it is off, Cypheria lists and manages no Claude plugins, cross-Agent operations skip Claude, and every new Claude session starts with all installed plugins forced disabled through its flag settings. Sessions that are already running keep their plugins until they restart.
- Install, uninstall, and enablement take a scope of `user` (default), `project`, or `local`.
- A marketplace can install a plugin by running a command on this computer. Server refuses that install, returns the command and its SHA-256, and installs only when the client resubmits that SHA-256 after the user reviews the command. Cypheria never passes `--yes`.
- Removing a marketplace uninstalls its plugins and deletes their saved data. Server lists the affected plugins and requires an explicit `confirmUninstall`.
- Plugin options come from the plugin's declared `userConfig`. Values are written over stdin, and sensitive values are never returned.
- After a change, Server reloads plugins in running Claude sessions unless that would invalidate a session's prompt cache; held sessions pick the change up when they restart.
- Component details, such as skills and MCP servers, are available for installed plugins and for plugins that live inside their marketplace. Other uninstalled plugins show only their catalog entry.

Cypheria-native plugins are a separate contract. The intended manifest declares Server entry points, Desktop UI contributions, optional future Expo contributions, permissions, compatible Cypheria versions, and contribution points. Server code must run in a controlled child process. Desktop contributions must be sandboxed and receive scoped host APIs rather than Node.js, filesystem, database, or secret access. Completing this runtime and UX remains planned work.

## Marketplace sources

Marketplace source and plugin ecosystem are independent fields. Source kinds are `cypheria`, `openai`, `claude`, `pi`, `opencode`, and `custom`. A custom marketplace must still declare the ecosystem of every plugin it contains.

The current integration facade supports harness-owned marketplace listing, add, upgrade, and removal operations. It retains marketplace name and path so similarly named plugins from different sources do not collapse into one identity.

The independent public Cypheria Marketplace service is planned and documented separately in [Marketplace](marketplace.md). Its absence does not change harness-native or custom marketplace support.

## Agent compatibility

Which Agents support a plugin is decided by the marketplace files that list it, not by a field in the plugin. Each Agent reads its own marketplace file:

| Agent | Marketplace file |
| :- | :- |
| Codex | `.agents/plugins/marketplace.json` |
| Claude | `.claude-plugin/marketplace.json` |

A repository can carry several of these files and list the same plugin in each. Give them the same marketplace `name`: Cypheria treats a marketplace and a plugin as the same across Agents when their names match. Cypheria does not infer compatibility from plugin files, does not add a compatibility field to manifests or marketplace entries, and never converts a plugin between ecosystems. To load in more than one Agent, a plugin root carries each Agent's manifest side by side (`.codex-plugin/`, `.claude-plugin/`), shares `skills/` and server code, and keeps each Agent's MCP declaration in its own file.

### Marketplaces

A marketplace is always offered to every Agent that can read it.

- **Adding** tries every Agent. Each Agent that finds its own marketplace file registers it, the others report that the marketplace has no file for them, and Server remembers the source.
- **Adding checks the source and what the Agents read.** The source must be `owner/repo` (optionally `#ref`), an `http(s)`, `ssh`, or `git` URL, an `scp`-style `git@host:path`, or an absolute local path that exists and holds a marketplace file. Options-like strings, relative paths, other URL schemes, and URLs with credentials are refused, and so are git refs and sparse paths that could be read as options or escape the repository. After the Agents accept it, each registration must be readable, every Agent must have read the same marketplace `name`, and that name must be plain and not one Cypheria or a vendor owns (`cypheria-bundled`, `openai-*`). A name that was already added from a different source is refused. If a check fails, the registrations this call created are removed.
- **Updating** refreshes the marketplace in each Agent, then matches the Agents to what it now ships. An Agent that gained a marketplace file gets the marketplace from the remembered source, an Agent that lost its file has the marketplace removed together with its plugins, and a plugin that left an Agent's file is uninstalled there.
- **Removing** removes the marketplace from every Agent and uninstalls its plugins, after the client confirms the list of affected plugins.

### Plugins

A plugin is installed once and then enabled or disabled per Agent.

- **Installing** installs the plugin in every Agent whose marketplace lists it and enables it in each.
- **Enablement** is independent per Agent. The plugin detail page shows one switch for every Agent that lists the plugin, only once the plugin is installed, so it can run in Codex and stay off in Claude.
- **Support added later** does not enable anything. An Agent that gains the plugin after an update shows it switched off, and turning the switch on installs it for that Agent first.
- **Uninstalling** removes the plugin from every Agent that holds it.

## Codex Apps

Apps follow the OpenAI App Server/connector model and belong exclusively to the Codex harness extension. They are exposed through `client.harnesses.codex.apps`, including list, enablement, connect, callable/accessibility state, install URL, and plugin association.

Desktop opens an App's install URL in the system browser. When focus returns, it refreshes App and MCP availability; the external page does not send a trusted local completion callback.

Apps are not renamed into a universal Agent feature. If another harness later offers an equivalent capability, it receives its own harness extension and terminology.

## Caching and refresh

The Server may cache harness lists, but callers can request a refresh where the protocol exposes it. Mutations invalidate the relevant harness and integration views. Clients use the returned authoritative view rather than guessing the result of a harness-native operation.

## Security rules

- Validate manifests, identifiers, URLs, marketplace locations, and compatibility metadata.
- Preserve ecosystem, marketplace source, and harness provenance in storage and UI.
- Require explicit permissions for native plugin contributions.
- Do not expose harness credentials or host filesystem access to renderer extensions.
- Treat remote descriptions, icons, prompts, tools, and plugin code as untrusted content.
- Keep installation and execution in the Server; clients only request scoped operations.
