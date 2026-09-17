# Codex App Server configuration runtime semantics

This document explains how Codex App Server consumes an already-resolved, valid
`config.toml`. It deliberately excludes layer discovery and merge precedence. Its purpose is to
define the behavior Cypheria clients may rely on after Codex has produced one effective
configuration.

Cypheria currently pins `@openai/codex` and its generated protocol to `0.153.4`. The deeper
runtime trace behind this document was checked on 2026-09-16 against upstream Codex commit
`657a993cbee87acf52d14b758ce49dbd46d1b8eb`. Those are two different compatibility baselines:

- the bundled binary and the generated artifacts in `packages/protocol/src/generated/codex` are
  the wire-protocol source of truth for Cypheria;
- the upstream source trace explains the runtime model and likely upgrade behavior;
- a field seen in newer upstream source must not be sent to the pinned binary unless its generated
  schema accepts it.

See [Codex App Server API reference](codex-app-server-api.md) for the generated method catalog and
[Codex Permissions in Cypheria Desktop](codex-permissions.md) for the user-facing permission
model.

## Core model

App Server does not keep the effective TOML as one immutable dictionary that every subsystem
queries. It parses the TOML-shaped `ConfigToml`, validates and derives a runtime `Config`, and then
copies selected values into objects with different lifetimes:

```txt
effective ConfigToml
├── App Server process state
│   ├── authentication and ChatGPT backend
│   ├── model catalog and model manager
│   ├── SQLite and thread store
│   └── analytics and OpenTelemetry
├── thread Config
│   ├── model and provider
│   ├── instructions and context policy
│   ├── permissions and sandbox
│   └── MCP, apps, plugins, skills, hooks, and features
├── per-turn TurnContext
│   ├── cwd and runtime roots
│   ├── model request settings
│   ├── active permission/reviewer settings
│   └── output schema and request metadata
└── per-inference-step tool and prompt plan
    ├── refreshed project instructions and skills
    ├── connected MCP/app/plugin/dynamic/host tools
    └── model-, feature-, platform-, and permission-gated built-ins
```

Consequently, “present in effective config,” “present in runtime `Config`,” “applied to this
thread,” “applied to this turn,” and “visible in the current tool catalog” are distinct states.

## Lifecycle and effective scope

| Stage | What App Server does | Client consequence |
| --- | --- | --- |
| Process startup | Loads config and constructs authentication, model catalog, state store, thread manager, telemetry, and process services. | Changing a process-owned field generally requires an App Server restart. |
| `thread/start`, `thread/resume`, `thread/fork` | Loads current config, applies request/session overrides, derives a thread `Config`, and initializes the thread and its extension catalogs. | This is the main boundary at which changed defaults become effective. |
| `turn/start` or `thread/settings/update` | Starts from the thread settings and applies supported typed overrides. A normal turn does not reload the entire TOML. | Do not expect arbitrary config-file changes to affect an existing thread. |
| Inference step | Rebuilds instructions and the tool router from the turn context, model capabilities, live MCP/plugin/app state, dynamic tools, host tools, and features. | Never infer the final tool list from `config/read`. |
| Config reload | Refreshes only the explicitly supported thread-owned catalogs and settings. | Reload is not equivalent to replacing the thread `Config` or restarting the process. |

Selecting a named permission profile during a turn is a notable exception: Codex may reload config
to resolve that profile. This does not make all other fields hot-reloadable.

## Request configuration versus file configuration

`thread/start.config`, `thread/resume.config`, and `thread/fork.config` are untyped JSON maps at the
wire boundary. App Server interprets them as a session config layer using TOML-style paths. They
are not a separate tool-injection protocol and are not persisted as user configuration.

Typed request fields take responsibility for their own setting. Examples include `model`,
`modelProvider`, `cwd`, `permissions`, `sandbox`, `approvalPolicy`, `approvalsReviewer`,
`personality`, runtime workspace roots, and service tier. A client should prefer those typed fields
when they exist and reserve `config` for settings with no first-class request field.

App Server removes special host-only values such as `bypass_hook_trust` before deserializing the
remaining map as ordinary configuration.

Most turn setting changes are sticky thread settings and become defaults for later turns. Output
schema, additional turn context, and turn-specific Responses metadata are current-turn data.
Provider replacement is a new-thread operation; a client must not assume that changing the model
inside an existing thread changes its provider.

## Field families

### Models, providers, and Responses requests

- `model`, `review_model`, and `model_provider` select the normal model, review model, and provider.
  `model` can be changed through supported thread/turn settings, while provider changes belong at
  thread creation.
- `model_providers.<id>` defines a Responses provider: endpoint, environment credential key,
  command or AWS credential helper, static and environment-derived headers, query parameters,
  request/stream retry limits, stream idle timeout, WebSocket timeout, OpenAI-auth requirement, and
  capability flags. The supported wire API is Responses. Authentication mechanisms are mutually
  constrained and reserved built-in provider IDs generally cannot be replaced.
- `openai_base_url` changes the built-in OpenAI provider endpoint. `chatgpt_base_url` changes the
  ChatGPT backend used for authentication and ChatGPT-owned product services; they are not the same
  endpoint.
- `model_context_window`, `model_auto_compact_token_limit`, and
  `model_auto_compact_token_limit_scope` configure context and compaction accounting.
- `model_reasoning_effort`, `model_reasoning_summary`, `model_verbosity`, `personality`, and
  `service_tier` become model request settings. `plan_mode_reasoning_effort` is primarily a product
  UI default rather than an automatic App Server turn switch.
- `tool_output_token_limit` limits the amount of tool output retained in model context. Per-MCP-tool
  limits may refine it.
- `responses_api_metadata` is bounded product metadata attached to Responses requests. It is
  different from per-turn client metadata.
- `model_catalog_json` is applied to the process model catalog at startup. Supplying it as a
  per-thread config override does not rebuild the shared catalog.
- `apps_mcp_product_sku` is forwarded to host-owned Apps MCP requests.
- `oss_provider` is a CLI local-model preference and has no normal standalone App Server thread
  effect.

### Instructions, project context, and compaction

- `instructions`, `developer_instructions`, and `model_instructions_file` feed different prompt
  layers. A non-empty model-instructions file replaces the selected model's base instructions.
- `compact_prompt` and `experimental_compact_prompt_file` customize compaction. The inline value
  wins and empty content is treated as absent.
- `include_permissions_instructions`, `include_apps_instructions`,
  `include_collaboration_mode_instructions`, and `include_environment_context` control prompt
  blocks only; they do not disable enforcement or capabilities.
- `project_doc_max_bytes`, `project_doc_fallback_filenames`, and `project_root_markers` control
  project-root discovery and the AGENTS/project-instruction budget.
- `orchestrator.skills.enabled` and `orchestrator.mcp.enabled` gate orchestrator-owned sources, not
  every user or plugin source.
- `auto_review.policy` adds policy text to the fixed Guardian prompt; it does not replace the whole
  reviewer prompt.

### Permissions, sandbox, and shell environment

- `approval_policy` controls whether categories of requests can be escalated. Granular `false`
  means automatic rejection, not implicit approval.
- `approvals_reviewer` routes an escalated request to the user or Auto-review. It does not widen the
  sandbox.
- `sandbox_mode` and `sandbox_workspace_write` are the legacy sandbox path. A named `permissions`
  profile is the newer path; clients must not silently compose the two models.
- `default_permissions` selects a built-in (`:read-only`, `:workspace`, or
  `:danger-full-access`) or named profile. `[permissions.<id>]` may define inheritance, workspace
  roots, filesystem read/write/deny rules, glob scanning, sandbox network access, and managed-proxy
  policy. Profile cycles, unknown parents, and invalid attempts to broaden authority fail
  validation.
- `[projects.<path>].trust_level` participates in default sandbox/approval derivation and project
  configuration discovery. Trust is not a replacement for a concrete permission profile.
- `shell_environment_policy` filters/injects environment variables. Its canonical filters and
  legacy include/exclude arrays are mutually exclusive.
- `allow_login_shell = false` rejects explicit login-shell requests and makes an omitted choice use
  a non-login shell.
- `windows` configures Windows-specific sandbox/private-desktop behavior.
- `browser_use` and `computer_use` are host/product access-control descriptions exposed through
  configuration APIs. They are not the local shell filesystem sandbox.

The complete Cypheria mapping and UI rules remain in [codex-permissions.md](codex-permissions.md).

### MCP

`mcp_servers.<name>` defines either a stdio transport (`command`, `args`, environment, and `cwd`) or
a streamable-HTTP transport (`url`, bearer-token environment variable, headers, environment
headers, and header helper). Invalid mixtures fail validation; literal bearer-token configuration
is intentionally rejected in current source.

Shared server policy includes `environment_id`, authentication mode, enablement, whether startup is
required, startup/tool timeouts, parallel-call support, omission from code/deferred/direct modes,
default approval mode, enabled/disabled tools, OAuth scopes/resource/callback, and per-tool approval
and output-token limits. A required server failure fails thread start/resume. An optional failure
reduces the available catalog.

Global MCP fields select OAuth credential storage and callback behavior.
`mcp_optional_startup_grace_ms` bounds the shared optional-server startup grace; zero disables that
shared grace and uses each server timeout.

MCP configuration is read when a thread initializes and when MCP is explicitly refreshed. The
effective MCP/app/plugin/tool router is still rebuilt per inference step from live state.

### Apps, plugins, marketplaces, skills, and hooks

- `[apps]` defines global and per-app enablement, destructive/open-world policy, reviewer, default
  approval mode, default tool enablement, per-tool policy, and per-link policy. Managed policy wins
  over tool, link, app, and default settings.
- `[plugins.<name>]` enables a plugin and overlays policy for MCP servers and tools supplied by its
  manifest. Plugins may contribute MCP, skills, hooks, and apps.
- `[marketplaces.<name>]` records Git/local source, ref, sparse paths, and last synchronized revision.
  It drives marketplace operations rather than the model request itself.
- `[tool_suggest]` supplies discoverable connector/plugin IDs and disabled suggestions. The relevant
  feature gates decide whether recommendation/install tools are exposed.
- `[skills]` controls bundled skills, prompt inclusion, context budget, and path/name enable rules.
  Skill snapshots are rebuilt for turns and may include plugin roots.
- `[hooks]` configures lifecycle events such as pre/post tool use, permissions, compaction, session,
  user prompt, subagent, stop, and interrupt. Handlers may be commands, MCP tools, prompts, or
  agents. Hook trust state remains separate from enablement.
- `notify` is the legacy completed-turn command hook and is separate from lifecycle hooks.

### Agents, goals, and memories

- `[agents]` controls legacy multi-agent enablement, concurrency/depth, default child model and
  effort, interrupt behavior, and named role files. A child role may specialize or reduce parent
  capability but must not expand parent authority.
- `features.multi_agent_v2` owns the newer concurrency backend, wait timeouts, tool namespace,
  metadata visibility, subagent instructions, optional model overrides, and wait-tool exposure.
- `[goals].max_goal_token_budget` constrains goal creation when the goals feature is enabled.
- `[memories]` controls extraction, consolidation, use, model selection, retention, rollout sampling,
  idle/rate-limit thresholds, and dedicated tools. It is inert unless the memories feature is
  enabled.

### Web, built-in tools, and terminals

- `web_search` selects `disabled`, `cached`, `indexed`, or `live`. The final mode is also constrained
  by provider capability, permissions, and features.
- `[tools.web_search]` supplies allowed domains, context size, and location. Its legacy boolean form
  does not enable or disable search; use top-level `web_search`.
- `tools.experimental_request_user_input.enabled` and `tools.update_plan.enabled` affect tool
  registration, subject to model/mode/feature gates.
- `background_terminal_max_timeout` caps empty `write_stdin` polling; it is not a command execution
  timeout.
- Shell, unified exec, patch, image, web, permission request, collaboration, goals, sleep, time,
  code-mode, hosted, extension, and dynamic tools are selected by the step tool planner. No config
  response is a complete tool catalog.

### Authentication, storage, telemetry, and realtime

- `forced_chatgpt_workspace_id`, `forced_login_method`, and `cli_auth_credentials_store` constrain
  process authentication. A per-thread override does not recreate the process AuthManager.
- `sqlite_home` and `experimental_thread_store` configure process persistence. `history` controls
  CLI input history, not App Server thread/rollout persistence.
- `log_dir`, `file_opener`, `tui`, `disable_paste_burst`, `notice`, and most audio-device settings are
  product/TUI preferences rather than App Server agent semantics.
- `analytics`, `feedback`, and `otel` control process telemetry and feedback. Ordinary thread reload
  does not rebuild the telemetry pipeline.
- `realtime` and the experimental realtime endpoint/model/prompt fields configure realtime
  conversation sessions when that feature is enabled. `audio.microphone` and `audio.speaker` are
  machine-local UI preferences, not device-opening instructions for core.

### Compatibility, opaque, and no-op fields

- `desktop` is opaque product data that config APIs round-trip.
- `show_raw_agent_reasoning` affects raw reasoning event exposure; `hide_agent_reasoning` is mainly
  an output/UI preference.
- Legacy `profiles` data can be read, but top-level `profile` selection is rejected by current
  upstream in favor of named config files selected at process launch.
- `js_repl_node_path`, `js_repl_node_module_dirs`, and `ghost_snapshot` are compatibility-only.
- `experimental_thread_store_endpoint` is removed and fails fast instead of falling back locally.
- `check_for_update_on_startup` is a CLI/TUI product behavior, not an App Server client contract.
- `suppress_unstable_features_warning` only suppresses warnings; it does not stabilize a feature.

## Feature registry

Feature keys are versioned implementation switches, not protocol capability negotiation. A client
must use the matching generated schema and should not build permanent product behavior around an
experimental key. Keys seen in the upstream analysis are grouped below; aliases and retained no-op
keys are included so config editors do not accidentally misrepresent them.

### Active or experimental capability switches

```txt
apply_patch_preserve_line_endings  apply_patch_streaming_events
apps                               auth_elicitation
background_paginated_rollout_migration
bedrock_setup_wizard               browser_use
browser_use_external               browser_use_full_cdp_access
chronicle                          code_mode
code_mode_host                     code_mode_interrupt
code_mode_only                     code_mode_prewarm
compaction_image_budget            computer_use
concurrent_reasoning_summaries     content_item_kinds
context_management                 current_time_reminder
cwd_relative_turn_diffs            default_mode_request_user_input
deferred_executor                  deferred_tool_world_state
enable_mcp_apps                    enable_request_compression
exec_permission_approvals          executed_tool_call_metadata
executor_capability_discovery      fast_mode
external_agent_memory_import
goals                              guardian_approval
guardian_enhanced_node_repl_transcripts
guardian_ext                       guardian_node_repl_transcript_images
guardian_reuse_parent_compaction   guardianv2
hooks                              image_generation
image_resize_notice                in_app_browser
in_app_chat                        in_app_dictation
in_app_local_automation            in_app_updates
local_thread_store_compression     mcp_2026_07_28
mcp_oauth_refresh_coordination     memories
mentions_v2                        multi_agent
multi_agent_v2                     network_proxy
non_prefixed_mcp_tool_names        omit_app_server_notification_media
personality                        plugin_sharing
plugins                            powershell_shell_version
prevent_idle_sleep                 psp
realtime_conversation              recommended_plugins
remote_compaction_v2               remote_plugin
request_permissions_tool           respect_system_proxy
retain_client_developer_messages   rollout_budget
runtime_metrics                    secret_auth_storage
shell_snapshot                     shell_snapshot_v2
shell_tool                         shell_zsh_fork
skill_mcp_dependency_install       skill_search
skip_host_skill_discovery          sleep_tool
standalone_web_search              step_model_switching
terminal_visualization_instructions
token_budget                       tool_call_mcp_elicitation
tool_suggest                       transcript_v2
unbounded_connection_retries      unified_exec
unified_image_budget               use_agent_identity
use_legacy_landlock                view_image
web_search_cached                  web_search_request
workspace_dependencies             write_stdin_approval
```

Structured feature tables include `code_mode`, `code_mode_host`,
`non_prefixed_mcp_tool_names`, `guardianv2`, `multi_agent_v2`, `token_budget`, `rollout_budget`,
`current_time_reminder`, `sleep_tool`, `network_proxy`, and `context_management`.
`features.tool_registry` is a settings table with collision handling and turn-metadata controls, not
a normal `enabled` gate.

### Compatibility aliases

```txt
connectors                          -> apps
enable_experimental_windows_sandbox -> experimental_windows_sandbox
experimental_use_unified_exec_tool  -> unified_exec
request_permissions                 -> exec_permission_approvals
web_search                          -> web_search_request
imagegenext                         -> image_generation
collab                              -> multi_agent
memory_tool                         -> memories
telepathy                           -> chronicle
codex_hooks                         -> hooks
```

The top-level `experimental_use_unified_exec_tool` is another legacy alias.

### Removed, retained, or currently ineffective switches

```txt
apply_patch_freeform               apps_mcp_path_override
code_mode_buffered_exec            codex_git_commit
collaboration_modes               elevated_windows_sandbox
enable_fanout                      experimental_windows_sandbox
external_migration                image_detail_original
item_ids                           js_repl
js_repl_tools_only                local_thread_store_shared_compression
multi_agent_mode                  plugin_hooks
remote_control                    remote_models
request_rule                      resize_all_images
responses_websockets              responses_websockets_v2
search_tool                       send_async_message
skill_env_var_dependency_prompt   sqlite
steer                             terminal_resize_reflow
tool_search                       tool_search_always_defer_mcp_tools
tui_app_server                    unavailable_dummy_tools
undo                              unified_exec_zsh_fork
use_linux_sandbox_bwrap           workspace_owner_usage_nudge
```

The exact classification may change between Codex releases. Schema acceptance, default enablement,
and runtime effect are three separate questions and must be tested during every version upgrade.

## `config/read` is not a runtime-state dump

`config/read` returns an effective TOML-shaped API view. Some fields are explicit protocol fields;
others are flattened into `additional`. Keys inside the config object retain `snake_case` names.

It does not guarantee:

- every derived runtime default;
- the current thread's complete `Config`;
- current `TurnContext` values;
- the final provider capability set;
- the current tool catalog;
- complete provenance for packaged defaults or exact managed requirements.

Use the dedicated model, permission-profile, skill, hook, MCP-status, app, and plugin methods for
resolved catalogs. Use thread start/resume responses and thread settings APIs for effective thread
state.

## Reload behavior

The current upstream reload path refreshes the user layer, active project, tool suggestions, MCP
server definitions and grace/OAuth settings, selected security feature state, hooks, and
plugin/skill caches. It can rebuild those catalogs for existing threads.

It does not recreate process authentication, model catalogs, SQLite/thread stores, telemetry, or a
thread's entire settings snapshot. Model/provider/base instructions and permission state should not
be assumed to change merely because the file was written.

`config/mcpServer/reload` refreshes MCP only. `config/batchWrite` may request a broader user-config
reload, but writes limited to model/reasoning/plan-effort/service-tier/personality defaults can skip
the expensive existing-thread refresh because they are intended mainly for future threads.

## Cypheria client requirements

1. Generate protocol types, JSON Schemas, response mappings, and validators from the exact bundled
   Codex binary. Treat the binary and generated artifacts as one compatibility unit.
2. Negotiate experimental API support in `initialize` before using experimental methods. Feature
   flags in TOML do not replace protocol capability negotiation.
3. Prefer first-class request fields over the generic `config` map.
4. Model configuration application explicitly as process restart, next-thread, thread reload, or
   next-turn scope. Do not present a successful file write as proof that an active turn changed.
5. Never synthesize a final tool list from configuration. Consume live catalog/status APIs and
   actual turn tool events.
6. Treat unknown enum strings and flattened additional config as forward-compatible data when the
   generated validator permits them; do not silently reinterpret them.
7. Keep `CODEX_HOME="$CYPHERIA_HOME/codex"`. Cypheria must not read or mutate the user's default
   Codex home without an explicit import or migration flow.
8. On every Codex upgrade, regenerate artifacts, diff the config schema and feature registry, run
   startup/thread/turn/reload tests, and verify which settings require a process restart.

## References

- [Official OpenAI configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
- [Official OpenAI App Server documentation](https://learn.chatgpt.com/docs/app-server)
- [Codex App Server API reference](codex-app-server-api.md)
- [Codex permissions](codex-permissions.md)
