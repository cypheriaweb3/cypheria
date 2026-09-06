# Plugin and Skill Management

## Screenshot-driven design

The user's eight Codex desktop screenshots are the visual reference, superseding the earlier documentation thumbnail.

- Directory: centered narrow content, left-aligned heading, full-width rounded search, installed icon rail, Public/Personal filters, borderless two-column category rows.
- Available plugins have plus actions; installed plugins have Try now/Manage/Uninstall menus. Hover is subtle; descriptions truncate to one line. Enablement switches belong in settings.
- Search replaces the installed rail and category sections with flat results. Clearing restores discovery. Breadcrumb return preserves the current in-page search.
- Skills use six-item previews, expandable groups, scope filters and checkmarks.
- Details use breadcrumbs, optional logo, install/try action, optional share link, suggested prompts, description, grouped apps, MCP servers, skills and metadata. Missing sections collapse.
- `/settings/plugins` uses the existing settings shell, single-column rows, count tabs and switches. Shared Base UI/shadcn-style primitives provide menus, dialogs, tooltips and switches.

## Provider Model

The Desktop Plugins area composes two discovery/trust providers over one Codex App Server installation path:

- **Cypheria Marketplace provider (planned):** reads the versioned public API from `apps/marketplace` for paginated discovery, review state, advisories, and the expected catalog commit. Electron main registers or upgrades the official Cypheria GitHub repo marketplace and installs through App Server.
- **Codex App Server provider (implemented):** owns the public, personal, shared, workspace, repository, Git/npm-backed, and local marketplace discovery and installation supported by the bundled App Server.

Every Cypheria listing is a standard ChatGPT/Codex plugin from a public open-source GitHub repository. The generated Cypheria catalog allows only `url` and `git-subdir` entries pinned by commit SHA. Renderer models carry provider ID and source provenance. Search and category views may combine results, but details, trust labels, errors, and advisories route to the owning provider. A Cypheria review badge never applies to another App Server result.

## Implemented App Server Path

Electron main maps generated App Server protocol into strict Zod IPC views. Supported operations: `plugin/list`, `plugin/read`, `plugin/install`, `plugin/uninstall`, `config/value/write` for plugin enablement, `skills/list`, `skills/config/write`, `marketplace/add`, `marketplace/upgrade`, and guarded `marketplace/remove`.

Plugin logos use remote metadata or main-process conversion of App Server-provided local image paths (known formats, maximum 2 MB). Renderer does not choose those paths. Managed state remains under `CODEX_HOME="$CYPHERIA_HOME/codex"`; no default-home import occurs.

Browser-only mode is explicitly labeled sample data and demonstrates local state changes, not real installation. Electron uses live data. Asset sources are documented in the plugin assets README.

Create plugin/skill and Try now populate the task composer without submitting. App install links appear only when supplied. Installed does not imply authenticated. Missing share URLs do not produce fake links.

## Remaining parity work

Apps and MCP now have dedicated management tabs. `app/list` provides accessibility/local enablement while `app/installed` provides effective enabled/callable state. UI distinguishes Available, Ready, Disabled and Restricted; accessibility alone is not called authenticated. If the runtime snapshot fails, metadata remains visible with unknown runtime state.

App connection actions resolve a known app in main and open its validated HTTP(S) install URL externally. Returning to the window refreshes status. MCP inventory uses paginated `mcpServerStatus/list` plus a private `config/read` projection to retain disabled servers. Credentials, environment variables and commands are never included in this projection. Standalone enablement writes only its scoped key and reloads MCP configuration. Plugin-owned servers are managed via their plugin.

MCP OAuth opens the validated URL from `mcpServer/oauth/login`. The page listens for `mcpServer/oauthLogin/completed`, handles failure/timeout and refreshes inventory; opening a URL is not success. Add MCP supports trusted HTTP(S) servers with validated names and refuses existing names. It does not expose arbitrary shell-command configuration or credential inputs.

Marketplace discovery queries every generated App Server kind separately and merges duplicates while retaining provenance: `vertical` for the public remote directory, plus `workspace-directory`, `shared-with-me`, `created-by-me-remote`, and `local`. The current directory presents Public and Personal tabs; Personal contains Created by me, Shared with me, Local marketplaces, and Workspace sections when present. Repository, Git, npm, and filesystem transport are resolved by App Server and are not visibility labels. Failed sources report errors without hiding successful sources.

Skill chips are source groups, not topic categories. `user`, `system`, and `admin` scopes become Personal, System, and Admin installed. For `repo`, Codex Desktop labels the skill with the final segment of the longest workspace root containing its path; Cypheria derives the equivalent available label from the `skills/list` entry cwd, producing names such as `ai` or `codex`. Recommended is a separate desktop recommendation catalog and is not fabricated from `skills/list`; Cypheria will expose it only after integrating that source.

Local marketplace removal requires confirmation and a fresh main-process lookup by exact name. Ambiguous/missing/remote-only sources, load errors and installed plugins block removal. Users must explicitly uninstall those plugins first; this guard is a Cypheria policy, not a claimed App Server limitation. Cleanup belongs to `marketplace/remove`, never renderer-selected filesystem deletion. Browser preview removal changes only sample state.

The Cypheria Marketplace discovery/trust provider and automatic registration of its GitHub repo, skill recording, advanced MCP editing, and remaining visual states remain open. Live authenticated Electron authorization is not yet end-to-end verified. Category names follow server metadata; popularity is not fabricated.

51 desktop tests cover lifecycle, source provenance, partial-source failure, guarded marketplace removal, pagination, disabled MCP entries, safe redirects, credential exclusion, scoped writes, duplicate-name prevention and incomplete forms. Browser checks cover application switches, search/empty state, MCP details/login preview, validated addition, source tabs, removal confirmation and responsive management navigation. Browser checks use sample data; live authenticated Electron installation is not verified. See `design-qa.md` for visual findings.

## Official references

- [Plugins](https://learn.chatgpt.com/docs/plugins)
- [Package your plugin](https://developers.openai.com/plugins/build/plugins)
- [Submit plugins](https://developers.openai.com/plugins/deploy/submission)
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Cypheria Marketplace Design](marketplace.md)

The generated protocol in `packages/codex-bridge/src/generated` is the implementation contract. Documentation maturity labels do not disable implemented capabilities.
