---
title: Codex Configuration in Cypheria
---

# Codex Configuration in Cypheria

This document describes only the Codex configuration semantics Cypheria currently depends on. It is not a complete Codex configuration reference. Exact App Server fields remain governed by the generated protocol and the pinned `@openai/codex` version.

## Sources of truth

Shared Cypheria defaults are stored in `$CYPHERIA_HOME/config/config.json` under `agents.codex`. Cypheria-managed Codex runs with `CODEX_HOME=$CYPHERIA_HOME/codex`, isolating its native files from the user's default Codex home.

When a user changes supported Codex settings through `client.harnesses.codex`, the Server:

1. validates and atomically updates Cypheria configuration;
2. writes the corresponding native Codex keys through App Server configuration operations;
3. asks App Server to reload user configuration where supported;
4. returns the effective Cypheria view and managed restrictions.

Cypheria remains the shared product source of truth. Native Codex configuration is an execution projection, not a location for Desktop appearance or other client-local preferences.

## Supported shared settings

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
| `showFullAccessInComposer` | `desktop.showFullAccessInComposer` | Whether the risky full-access choice may be shown |

Null values mean “use the model or provider default” where the protocol allows it.

## Managed requirements

The Server reads App Server configuration requirements before presenting permission choices. Allowed approval policies, sandbox modes, web-search modes, reviewers, and permission profiles restrict the effective catalog. A managed default permission profile takes precedence over local defaults.

Clients must render the returned catalog. They must not expose a disallowed choice, infer policy from raw files, or claim that a successful Cypheria write overrides an administrator-managed requirement.

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

Advanced native configuration—custom providers, permission profiles, MCP transports, plugin policy, Apps, Skills, hooks, project trust, shell environment, telemetry, and experimental features—remains Server-owned and may be edited through harness-supported flows. It is not copied into Cypheria's small shared settings schema unless the product depends on it.

Harness-native Skills, MCP, plugins, marketplaces, and Apps are exposed through the Cypheria [Integrations](integrations.md) facade. Codex permission presentation is specified in [Codex Permissions](codex-permissions.md).

## Client-local exclusions

The following never belong in Codex configuration:

- theme, font, language, density, and layout;
- window, tray, browser, update, and OS integration state;
- Sidebar expansion, draft, cache, and scroll position;
- Server executable and auto-start preferences.

Desktop stores those values in Electron's `desktop-settings.json`.
