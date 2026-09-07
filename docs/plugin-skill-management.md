# Plugin and Skill Management

## Screenshot-driven design

The user's eight Codex desktop screenshots are the visual reference, superseding the earlier documentation thumbnail.

- Directory: centered narrow content, left-aligned heading, full-width rounded search, installed icon rail, Public/OpenAI/Personal filters, borderless two-column category rows.
- Available plugins have plus actions; installed plugins have Try now/Manage/Uninstall menus. Hover is subtle; descriptions truncate to one line. Enablement switches belong in settings.
- Search replaces the installed rail and category sections with flat results. Clearing restores discovery. Breadcrumb return preserves the current in-page search.
- Skills use six-item previews, expandable groups, scope filters and checkmarks.
- Details use breadcrumbs, optional logo, install/try action, optional share link, suggested prompts, description, grouped apps, MCP servers, skills and metadata. Missing sections collapse. While a detail request is pending, the breadcrumb remains visible and a page-sized neutral overlay replaces all detail content with the centered Cypheria mark, preventing stale plugin information from flashing during navigation.
- `/settings/plugins` uses the existing settings shell, single-column rows, count tabs and switches. Shared Base UI/shadcn-style primitives provide menus, dialogs, tooltips and switches.

## Provider Model

The Desktop Plugins area composes two discovery/trust providers over one Codex App Server installation path:

- **Cypheria Marketplace provider (planned):** reads the versioned public API from `apps/marketplace` for paginated discovery, review state, advisories, and the expected catalog commit. Electron main registers or upgrades the official Cypheria GitHub repo marketplace and installs through App Server.
- **Codex App Server provider (implemented):** owns OpenAI's official catalog plus user-added Git and local-directory marketplaces and installs both through the bundled App Server.

Every Cypheria listing is a standard ChatGPT/Codex plugin from a public open-source GitHub repository. The generated Cypheria catalog allows only `url` and `git-subdir` entries pinned by commit SHA. Renderer models carry provider ID and source provenance. Search and category views may combine results, but details, trust labels, errors, and advisories route to the owning provider. A Cypheria review badge never applies to another App Server result.

## Implemented App Server Path

Electron main maps generated App Server protocol into strict Zod IPC views. Supported operations: `plugin/list`, `plugin/read`, `plugin/install`, `plugin/uninstall`, `config/value/write` for plugin enablement, `skills/list`, `skills/config/write`, `marketplace/add`, `marketplace/upgrade`, and guarded `marketplace/remove`.

Cypheria pins `@openai/codex` and its generated protocol to `0.153.4`.

Plugin logos use remote metadata or main-process conversion of App Server-provided local image paths (known formats, maximum 2 MB). Renderer does not choose those paths. Managed state remains under `CODEX_HOME="$CYPHERIA_HOME/codex"`; no default-home import occurs.

Browser-only mode does not synthesize plugin, skill, app, or MCP records. It reports that the capability requires Cypheria Desktop. Electron always reads live data through typed IPC from the Cypheria-managed Codex App Server.

The plugin directory also reads `account/read`. When App Server rejects remote catalog requests because the current session uses an API key, the UI hides the repeated low-level source errors and explains that model access remains connected while the requested remote catalog requires ChatGPT authentication. Its action opens `/settings/connections?focus=codex`, selects the existing Codex connection surface, and scrolls the login card into view. An API-key connection also explains there that the user should sign out before choosing ChatGPT sign-in. Signed-out and stale ChatGPT sessions receive corresponding copy; unrelated source failures remain visible.

Create plugin/skill and Try now populate the task composer without submitting. App install links appear only when supplied. Installed does not imply authenticated. Missing share URLs do not produce fake links.

## Remaining parity work

Apps and MCP now have dedicated management tabs. `app/list` provides accessibility/local enablement while `app/installed` provides effective enabled/callable state. UI distinguishes Available, Ready, Disabled and Restricted; accessibility alone is not called authenticated. If the runtime snapshot fails, metadata remains visible with unknown runtime state.

App connection actions resolve a known app in main and open its validated HTTP(S) install URL externally. Returning to the window refreshes status. MCP inventory uses paginated `mcpServerStatus/list` plus a private `config/read` projection to retain disabled servers. Credentials, environment variables and commands are never included in this projection. Standalone enablement writes only its scoped key and reloads MCP configuration. Plugin-owned servers are managed via their plugin.

MCP OAuth opens the validated URL from `mcpServer/oauth/login`. The page listens for `mcpServer/oauthLogin/completed`, handles failure/timeout and refreshes inventory; opening a URL is not success. Add MCP supports trusted HTTP(S) servers with validated names and refuses existing names. It does not expose arbitrary shell-command configuration or credential inputs.

App Server exposes no separate `marketplace/list` method. Its `plugin/list` response is the live marketplace inventory: `marketplaces[]`, with every record containing its own `plugins[]`. Cypheria classifies those records with trusted exact-name allowlists. Known OpenAI marketplace names are OpenAI; the pinned Cypheria official marketplace identity `cypheria-curated` is Public; every other marketplace is Personal, including user-controlled names containing `openai` or `cypheria`. Personal is grouped by marketplace and uses `interface.displayName`, falling back to the App Server marketplace name. Until the Cypheria provider returns its official record, Public presents an explicit placeholder.

`openai-bundled` and `openai-primary-runtime` are also classified as OpenAI when App Server returns them. They may be configured by a first-party installation and are not assumed to exist in Cypheria's isolated Codex home; their absence is a normal empty condition, not a catalog error.

Codex Desktop obtains its current directory sections from a separate authenticated ChatGPT endpoint (`/ps/plugins/home`) and loads a complete section through `/ps/plugin-categories/{category_slug}/plugins`; these endpoints are not App Server methods. `featuredPluginIds` is only a local fallback signal and is not the membership list for the current **Popular** section. When only App Server data is available, Cypheria uses the first 50 entries in the ordered `openai-curated-remote` marketplace as the first Popular page without merging entries from other marketplaces. If the remote marketplace is absent, it falls back to `featuredPluginIds`. Topic sections include every plugin according to `PluginInterface.category`, even when a plugin also appears in Popular, and **Other** is always last. App Server `0.153.4` exposes neither publication time nor a New & Noteworthy membership list, so Cypheria does not infer recency.

Skill chips are source groups, not topic categories. `user`, `system`, and `admin` scopes become Personal, System, and Admin installed. For `repo`, Codex Desktop labels the skill with the final segment of the longest workspace root containing its path; Cypheria derives the equivalent available label from the `skills/list` entry cwd, producing names such as `ai` or `codex`. Recommended is a separate desktop recommendation catalog and is not fabricated from `skills/list`; Cypheria will expose it only after integrating that source.

Personal marketplace removal requires confirmation and a fresh main-process lookup by exact name. Official, ambiguous, missing, unresolved, or failed marketplaces and marketplaces with installed plugins cannot be removed. Users must explicitly uninstall those plugins first. Cleanup belongs to `marketplace/remove`, never renderer-selected filesystem deletion.

The Cypheria Marketplace discovery/trust provider and automatic registration of its GitHub repo, skill recording, advanced MCP editing, and remaining visual states remain open. Live ChatGPT-authenticated discovery is verified against Codex `0.153.4`: Cypheria's managed home returned `openai-curated-remote`, while a first-party-managed default home additionally returned bundled and primary-runtime marketplaces. Topic category names follow App Server metadata; Popular uses the ordered compatibility fallback described above until App Server exposes directory sections.

Desktop tests cover lifecycle, source provenance, partial-source failure, guarded marketplace removal, pagination, disabled MCP entries, safe redirects, credential exclusion, scoped writes, duplicate-name prevention and incomplete forms. Real authenticated catalog and connector inspection must run in Electron; no sample catalog is available in production routes. See `design-qa.md` for visual findings.

## Official references

- [Plugins](https://learn.chatgpt.com/docs/plugins)
- [Package your plugin](https://developers.openai.com/plugins/build/plugins)
- [Submit plugins](https://developers.openai.com/plugins/deploy/submission)
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Cypheria Marketplace Design](marketplace.md)

The generated protocol in `packages/codex-bridge/src/generated` is the implementation contract. Documentation maturity labels do not disable implemented capabilities.
