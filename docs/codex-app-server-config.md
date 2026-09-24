---
title: Codex Configuration in Cypheria
---

# Codex Configuration in Cypheria

This document describes only the Codex configuration semantics Cypheria currently depends on. It is not a complete Codex configuration reference. Exact App Server fields remain governed by the generated protocol and the pinned `@openai/codex` version.

## Sources of truth

Cypheria-managed Codex runs with `CODEX_HOME=$CYPHERIA_HOME/codex`, isolating its native `config.toml` from the user's default Codex home. Codex global settings are owned by this native configuration, not mirrored into Server configuration.

When a user changes supported Codex settings through `client.harnesses.codex`, the Server:

1. reads current values with App Server `config/read` and feature state with `experimentalFeature/list`;
2. writes the corresponding native Codex keys with `config/batchWrite` and reloads user configuration;
3. returns the effective native values and managed restrictions.

Desktop appearance and composer permissions-menu visibility remain local Desktop preferences.

Codex Settings writes each changed option immediately through App Server; no Save action is required. Ordinary selections write one native key. Changing the default model also clears an explicit reasoning effort when the new model does not support it.

## Supported Codex settings

| Cypheria field | Codex key | Meaning |
| --- | --- | --- |
| `model` | `model` | Default model for new Codex Threads |
| `provider` | `model_provider` | `openai`, `amazon-bedrock`, `ollama`, or `lmstudio` |
| `reasoningEffort` | `model_reasoning_effort` | Default reasoning effort |
| `serviceTier` | `service_tier` | Default service tier |
| `approvalPolicy` | `approval_policy` | When Codex may request approval |
| `approvalsReviewer` | `approvals_reviewer` | User or supported automatic reviewer |
| `sandboxMode` | `sandbox_mode` | Filesystem and process sandbox baseline |
| `networkAccess` | `sandbox_workspace_write.network_access` | Network access for workspace-write mode |
| `webSearch` | `web_search` | Disabled, cached, indexed, or live search |
| `modelVerbosity` | `model_verbosity` | Default response verbosity |
| `modelReasoningSummary` | `model_reasoning_summary` | Reasoning-summary presentation |
| `personality` | `personality` | Default communication style |
| `pluginsEnabled` | `features.plugins` | Plugin availability |

An unset native key is not written merely because Settings was opened. Its displayed fallback and runtime behavior depend on the setting, as described below.

## Unset values in Settings

On first launch, Codex loads an empty user configuration layer and its packaged defaults without creating `config.toml`. Opening Cypheria Settings only reads App Server state. The first native configuration edit creates the file; a later `thread/start` may also write project trust when effective permissions allow workspace edits. Cypheria does not populate the file with UI defaults.

| Setting | Display when the native key is unset | Source or runtime meaning |
| --- | --- | --- |
| Approval policy | On request | Codex's Auto permission preset asks when escalation is needed. |
| Approvals reviewer | User | Eligible approval prompts go to the user. Shown only for On request. |
| Sandbox | Workspace write | Matches the Auto preset. A directory without version control or without trust may start Read only until project trust is resolved. |
| Allow network access | Off | Applies only to Workspace write and is shown only for that sandbox. |
| Web search | Cached | Independent configuration preference; the effective search mode can change at execution time. |
| Model | The `isDefault` entry from `model/list` | No model identifier is hard-coded in Cypheria. |
| Reasoning effort | The selected model's `defaultReasoningEffort` | The UI uses Medium only as a display fallback if model metadata is unavailable. |
| Speed | Standard | Selecting Standard writes `service_tier = "default"`; Fast writes `"priority"`. The older native value `"fast"` is read as Fast. |
| Communication style | Pragmatic when the personality feature is enabled; otherwise None | Feature state comes from `experimentalFeature/list`. An explicit `personality` value takes precedence. |
| Output detail | Model default | An unset `model_verbosity` leaves detail to the model. |
| Reasoning summary | Model default | An unset `model_reasoning_summary` leaves the choice to Codex model metadata, which `model/list` does not expose. Selecting Auto explicitly writes `"auto"`. |
| Plugins | Enabled in the pinned Codex runtime | Actual feature state comes from `experimentalFeature/list`; an explicit edit writes `features.plugins`. |

The pinned runtime also enables the personality feature by default. The Settings page reads both feature states rather than assuming they remain enabled. [Codex's Auto preset](https://learn.chatgpt.com/docs/agent-approvals-security#common-sandbox-and-approval-combinations) supplies the Workspace write and On request baseline; the effective permission catalog and project trust can narrow it.

`web_search` is a separate setting from `sandbox_mode`. When its configured preference is Cached, Codex may select Live for a Full access turn, subject to provider capabilities and managed restrictions; the Settings page continues to show the configured preference. Explicit Disabled and Indexed preferences retain their requested mode when allowed. For reasoning summaries, [OpenAI documents `auto` as an explicit mode](https://developers.openai.com/api/docs/guides/reasoning), not as the absence of a setting.

## Managed requirements

The Server reads App Server configuration requirements before presenting permission choices. Allowed approval policies, sandbox modes, web-search modes, reviewers, and permission profiles restrict the effective catalog. A managed default permission profile takes precedence over local defaults.

Clients must render the returned catalog. They must not expose a disallowed choice, infer policy from raw files, or claim that a successful native write overrides an administrator-managed requirement.

## Thread and turn scope

Shared settings are defaults for new Threads. A Thread captures harness session state and may receive supported model, reasoning, service-tier, working-directory, and permission selections. Starting a normal turn does not recreate the Codex process or reload every native configuration field.

Provider replacement is a new-Thread concern. Per-turn response format and transient context are not persisted as global defaults. The Server passes typed App Server request fields when available rather than relying on an untyped configuration map.

## Reload behavior

App Server has several lifetimes:

- process-owned state such as authentication and shared catalogs may require process restart;
- Thread-owned settings become effective on start, resume, fork, or a supported settings update;
- MCP, Skill, plugin, App, and tool catalogs refresh through their own integration operations;
- inference-step tool availability also depends on live capability, permission, and provider state.

A configuration reload is therefore not equivalent to replacing all state in an existing Thread. Clients use returned capability and catalog data rather than predicting hot-reload behavior.

## Native extensions

Advanced native configuration—custom providers, permission profiles, MCP transports, plugin policy, Apps, Skills, hooks, project trust, shell environment, telemetry, and experimental features—remains Codex-owned and may be edited through harness-supported flows.

Harness-native Skills, MCP, plugins, marketplaces, and Apps are exposed through the Cypheria [Integrations](integrations.md) facade. Codex permission presentation is specified in [Codex Permissions](codex-permissions.md).

The versioned feature registry, effective-state APIs, and the feature overrides observed in the official Desktop client are documented in [Codex feature defaults and Desktop overrides](codex-app-server-features.md).

## Client-local exclusions

The following never belong in Codex configuration:

- theme, font, language, density, and layout;
- window, tray, browser, update, and OS integration state;
- Sidebar expansion, draft, cache, and scroll position;
- Server executable and auto-start preferences.
- `composer.permissionModeVisibility`, which only makes Full access visible in the composer permissions menu.

Desktop stores those values in Electron's `config.json`.
