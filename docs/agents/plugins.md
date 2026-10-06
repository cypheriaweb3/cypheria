---
title: Plugins, Skills, and MCP
---

# Plugins, Skills, and MCP

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

MCP management is available for Codex and Pi; other Agents report it as unsupported.

- **Codex:** through the App Server's MCP status, configuration, and OAuth requests.
- **Pi:** through the managed Pi CLI's `pi mcp list --json`, `add`, and `login` commands, run with Pi's home as the working directory so no project `.pi/mcp.json` is read. Pi has no command that changes enablement, so Server sets the `enabled` field of servers in Pi's own `mcp.json`, as Pi's `/mcp` does; project servers are read-only. A sign-in returns the authorization page for the client to open while `pi mcp login` waits for the browser's loopback callback for up to five minutes, with Pi's own browser launch suppressed except on Windows. Running Pi sessions pick up changes when they restart. Desktop shows Pi's servers under Pi's Agent settings.

For Codex's `codex_apps` server, each discovered tool reports an `appScope` only when its metadata identifies a consistent connector, account link, and action resource URI. Other tools report `null`. Consumers must recheck this scope and the current account before invoking a connector tool; discovery alone does not grant access.

## Plugin ecosystems

`ecosystem` identifies the plugin contract:

- `cypheria`: Cypheria-native manifest and contribution points (planned; no Cypheria-native plugin runs yet);
- `openai`: ChatGPT/Codex plugin format;
- `claude`: Claude plugin ecosystem;
- `pi`: Pi extensions;
- `opencode`: OpenCode plugins.

Plugin views retain source type, marketplace identity, install policy, availability, version, capabilities, compatibility, and harness provenance. Listing, detail, install, uninstall, and enablement operations are implemented through harness adapters where the harness supports them.

Codex remote plugins have a catalog ID distinct from their displayed name. Server resolves that ID from a fresh `plugin/list` result before remote detail or install requests, so a visible plugin is not sent to Codex's install endpoint under its display name.

When plugins are enabled for Codex or Claude, Server registers the bundled `cypheria-bundled` marketplace and installs its plugins, `cypheria-app-tools`, `code-review`, `browser`, `chrome`, `computer-use`, and the hidden, generated `cua`, in that Agent's managed home, as the official desktop bundles `codex-app-tools`, `code-review`, and its Computer Use plugins. They are described in [Cypheria app tools](#cypheria-app-tools). They declare no OpenAI App ID and have no GitHub or GitLab connector credentials.
The bundled marketplace's source is the dual-format `plugins/` directory packaged with Cypheria: it carries a Codex marketplace and manifests and a Claude marketplace and manifests, lists each plugin at `./<plugin>`, and each Agent's MCP declaration lives in its own file next to the plugin's server. Server materializes it into `$CYPHERIA_HOME/marketplaces/cypheria-bundled/`, and Agents register that directory; see [Plugin Marketplaces](plugin-marketplaces.md#cypheria-bundled).
When an installed bundled plugin is discovered after a Cypheria update, Server checks its local version and updates it from the bundled marketplace before returning the plugin list.

### Cypheria app tools

The bundled plugins are how Codex and Claude reach Cypheria's own tools. Each declares one MCP server, and all run the same relay, which runs no tool itself: it lists and calls the tools of its server through `/api/v1/app-tools/*`, and Server executes each call for the calling Thread with the same code the clients use. The Computer Use plugins are described in [Computer Use](../features/computer-use.md#plugins).

- `cypheria-app-tools`, server `cypheria_app_tools`: the Thread, project, sidebar, worktree, handoff, and automation tools described below.
- `code-review`, server `code-review`: the official plugin's 31 `pull_requests.*` tools and its MCP App `ui://pull-requests/app`. Only `pull_requests.checks` is visible to the model; it reads a GitHub pull request's checks or a GitLab merge request's pipelines through OpenAI's backend, without job logs. The other tools serve the App, which Desktop hosts as the Code Review page and the Thread pull request panel. Server serves the App resource and the tool list itself; see [Code Review](../features/code-review.md).
- `browser`, `chrome`, and `computer-use`: manifests and icons for Computer Use surfaces, which Agents operate through the hidden `cua` plugin's `cua_repl` server.

The `cypheria-app-tools` server offers `list_threads`, `list_archived_threads`, `read_thread`, `wait_threads`, `create_thread`, `fork_thread`, `send_message_to_thread`, `set_thread_title`, `set_thread_archived`, `list_projects`, and the sidebar tools `create_sidebar_section`, `rename_sidebar_section`, `delete_sidebar_section`, `move_thread_to_sidebar_section`, `move_project_to_sidebar_section`, `reorder_section`, `reorder_sidebar_projects`, and `reorder_sidebar_sections`; and the worktree and artifact tools `create_worktree`, `get_worktree_creation_status`, `archive_worktree`, `restore_worktree`, `list_artifacts`, `attach_artifact`, and `remove_artifact`; `handoff_thread` with `get_handoff_status`, and `automation_update`. Names, descriptions, and input schemas are the official Codex desktop's, minus the parts that need ChatGPT conversations, remote hosts, or the Work cloud. Each tool acts for the calling Thread through the same Server code the clients use, so every change is published to connected clients. Pinned is a Section: `move_thread_to_sidebar_section` with `pinned` pins, and `null` unpins. `create_worktree` attaches a managed worktree to the calling Thread without moving the Thread into it; `archive_worktree` stores a commit of the worktree's working state, including local changes and non-ignored untracked files, and refuses a worktree that a Thread works in or that has submodules or embedded repositories; `restore_worktree` recreates it at its original path with the changes committed. `handoff_thread` toggles another Thread between its checkout and a new managed worktree: it interrupts a running Thread, moves its branch and local changes, and can send a follow-up prompt afterwards, while `get_handoff_status` reports the current step and waits for a revision change. The Thread keeps its ID and changes working directory. The worktree takes the checkout's branch and the checkout falls back to the default branch; on the default branch the worktree gets a new branch instead. Changes are saved under a backup ref until the move completes and are restored if it fails, and a destination with uncommitted changes refuses the handoff. `automation_update` views, creates, updates, and deletes Server Schedules: a `heartbeat` wakes a Thread and a `cron` automation starts a new Thread for each run. It takes RRULE strings in the Server's time zone and accepts `FREQ=MINUTELY` or `HOURLY` with `INTERVAL`, and `DAILY`, `WEEKLY`, or `MONTHLY` with `BYHOUR`, `BYMINUTE`, and `BYDAY` or `BYMONTHDAY`; it rejects `DTSTART`, `COUNT`, and other forms. Model, reasoning-effort, notification-policy, and review-card (`suggested_*`) options of the official tool do not exist. At thread start the Server appends the Codex models and their reasoning efforts to the `model` description of `create_thread` and `send_message_to_thread`; a lookup that fails or exceeds five seconds leaves the plain description. `create_thread` starts a Thread of the calling Thread's Agent unless it names another installed, enabled Agent, and its `model` field lists every such Agent's models and reasoning efforts; `send_message_to_thread` applies model and effort overrides to a Thread of any Agent. The app-tool names present at thread start decide which sections of the Thread's developer instructions appear, so a Codex whose plugins or `cypheria-app-tools` are off gets none of them.

Agents do local Git work with `git` and `gh` in their own commands; the Server Git protocol stays a client contract and is not offered to the model, as in the official desktop.

Those routes accept only an app tools token, never the Server's own token, and Server removes `CYPHERIA_SERVER_TOKEN` from every Agent environment. Server derives tokens from a secret held in memory and passes them to the Agent processes it starts, together with `CYPHERIA_SERVER_URL`:

- A Claude session receives a token bound to its Thread through the SDK environment, and the Claude manifests expand it into the MCP servers' environment. Claude does not tell an MCP server which session calls it, so the token is the Thread identity. Commands Claude runs can read the token, which allows only what that Thread's Agent may already do.
- The Codex app-server serves every Codex Thread from one process, so it receives one token for the process. Codex attaches `x-codex-turn-metadata` to each MCP call, and Server resolves its `thread_id`, then `parent_thread_id` for a subagent, then `session_id`, to the live Cypheria Thread. Commands Codex runs inherit that environment unless the user's `shell_environment_policy` excludes the variable, so they can also call app tools, which already act on any Thread by ID.

The Codex manifest of `cypheria-app-tools` matches the official `codex-app-tools`: Codex lists every tool directly instead of through tool search, approves calls without prompting except `create_thread`, `send_message_to_thread`, `fork_thread`, `handoff_thread`, and `automation_update`, and allows an hour per call. `pull_requests.checks` is marked read-only, so Codex runs it without prompting. Claude applies its own permission mode to both servers. When the MCP client cancels a call, the relay aborts the HTTP request and Server stops waiting in `wait_threads`.

Before a Codex Thread starts, resumes, or forks, and before a Claude turn starts, Server installs or updates the bundled plugins once per Server process. An Agent whose plugins are turned off has no app tools, and Codex developer instructions then leave out the sections that name them, as they do when the user turns off `cypheria-app-tools` alone.

### Claude plugin management

Server manages Claude plugins by running the managed Claude CLI's `claude plugin … --json` commands with `CLAUDE_CONFIG_DIR` set to Cypheria's Claude home; it never edits Claude's state files, and the user's own Claude home is untouched. Plugin changes are serialized per Agent.

- Server registers `claude-plugins-official` and the bundled `cypheria-bundled` marketplace the first time Claude plugins are listed. Registering the bundled marketplace installs nothing: the plugin is installed when the user turns it on for Claude. Other marketplaces (a GitHub repository, git URL, local directory, or hosted `marketplace.json`) are added by the user. Marketplaces hosted on claude.ai are not added; plugins synced from claude.ai or loaded for one session are listed read-only.
- **The Plugins switch.** Claude has no setting that turns plugins off, so Cypheria keeps `agents.claude.pluginsEnabled` (default `true`) in `$CYPHERIA_HOME/config/config.json` and shows it on Claude's Settings page, like Codex's Plugins setting. While it is off, Cypheria lists and manages no Claude plugins, cross-Agent operations skip Claude, and every new Claude session starts with all installed plugins forced disabled through its flag settings. Sessions that are already running keep their plugins until they restart.
- Install, uninstall, and enablement take a scope of `user` (default), `project`, or `local`.
- A marketplace can install a plugin by running a command on this computer. Server refuses that install, returns the command and its SHA-256, and installs only when the client resubmits that SHA-256 after the user reviews the command. Cypheria never passes `--yes`.
- Removing a marketplace uninstalls its plugins and deletes their saved data. Server lists the affected plugins and requires an explicit `confirmUninstall`.
- Plugin options come from the plugin's declared `userConfig`. Values are written over stdin, and sensitive values are never returned.
- After a change the user makes, Server reloads plugins in running Claude sessions unless that would invalidate a session's prompt cache; held sessions pick the change up when they restart. [Automatic updates](agent-plugin-capabilities.md#updates) reload no session and run only while Claude has none running.
- Component details, such as skills and MCP servers, are available for installed plugins and for plugins that live inside their marketplace. Other uninstalled plugins show only their catalog entry.

Plugins contribute UI through MCP Apps and the OpenAI MCP Extensions, described in [Plugin Extensions](plugin-extensions.md). Cypheria-native plugins are planned to use the same contract. There is no separate Desktop contribution API. Server code runs in a controlled child process, and UI runs in sandboxed frames with scoped host requests rather than Node.js, filesystem, database, or secret access.

## Packages, marketplaces, and Agent support

A plugin package can carry the manifests of several Agents and is used natively by each Agent that reads one of them. An Agent that reads none of them does not support the plugin, and Cypheria does not convert it. The package formats, detection, and enablement are described in [Polyglot Plugins](polyglot-plugins.md).

Marketplace categories, plugin identity (`<pluginName>@<marketplaceId>`), local storage, the marketplace lifecycle, and the database schema are described in [Plugin Marketplaces](plugin-marketplaces.md). Each Agent's native formats and commands are listed in [Agent Plugin Capabilities](agent-plugin-capabilities.md).

## Codex Apps

Apps follow the OpenAI App Server/connector model and belong exclusively to the Codex harness extension. They are exposed through `client.harnesses.codex.apps`, including list, enablement, connect, callable/accessibility state, install URL, and plugin association.

Code Review uses the GitHub and GitLab connections the user makes here, read through OpenAI's backend with the ChatGPT sign-in; see [Code Review](../features/code-review.md#prerequisites).

Desktop opens an App's install URL in the system browser. When focus returns, it refreshes App and MCP availability; the external page does not send a trusted local completion callback.

Apps are not renamed into a universal Agent feature. If another harness later offers an equivalent capability, it receives its own harness extension and terminology.

## Hooks

Hooks provide automated command execution and security guards across Agent lifecycles.

### Discovery and sources

- **User hooks:** defined in `~/.cypheria/hooks.json`. Applied universally across all threads.
- **Project hooks:** defined in `<repo>/.cypheria/hooks.json`. Scoped to workspaces under that repository.
- **Plugin hooks:** declared in `<plugin_dir>/hooks/hooks.json` or within `plugin.json`'s `hooks` object.

### Trust model

Project-level hooks require explicit trust. The Server calculates a SHA-256 hash of `<repo>/.cypheria/hooks.json`. When the file is first discovered or modified, its trust status transitions to `untrusted` or `modified`, and the hook is skipped during dispatch until the user explicitly trusts it via the UI (`Settings -> Hooks`) or API.

### Execution boundary and deduplication

- **Codex harness:** When the active agent is Codex, plugin-level hooks are not executed in Cypheria's upper layer because Codex natively discovers and runs plugin hooks. Codex native hook runs are collected and reported through `hook/completed`. User-level and project-level Cypheria hooks are always executed by Cypheria.
- **Other harnesses (Claude, Pi, OpenCode, ACP):** Cypheria's native `HookEngine` executes enabled plugin-level hooks directly for lifecycles like `UserPromptSubmit`, `SessionStart`, `SessionEnd`, and `Stop`.

## Caching and refresh

The Server may cache harness lists, but callers can request a refresh where the protocol exposes it. Marketplaces and installed plugins are also refreshed on a schedule, as described in [Updates](agent-plugin-capabilities.md#updates). Mutations invalidate the relevant harness and integration views. Clients use the returned authoritative view rather than guessing the result of a harness-native operation.

## Security rules

- Validate manifests, identifiers, URLs, marketplace locations, and compatibility metadata.
- Preserve ecosystem, marketplace source, and harness provenance in storage and UI.
- Require explicit permissions for native plugin contributions.
- Do not expose harness credentials or host filesystem access to renderer extensions.
- Treat remote descriptions, icons, prompts, tools, and plugin code as untrusted content.
- Keep installation and execution in the Server; clients only request scoped operations.
