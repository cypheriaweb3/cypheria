---
title: Codex Feature Defaults and Desktop Overrides
---

# Codex Feature Defaults and Desktop Overrides

This reference separates Codex-owned defaults from client-supplied overrides. Feature keys and defaults are versioned implementation details, so clients must discover effective state from App Server instead of treating this snapshot as a permanent protocol contract.

## Version scope

The default inventory below is from the Cypheria-pinned `@openai/codex` `0.155.1`. The Desktop behavior is from a local static analysis of ChatGPT Desktop `26.908.40834`, build `8881`, whose bundled App Server reports `0.154.0-alpha.6.2`. The version difference matters: `0.155.1` adds `api_key_model_discovery` and `codex_apps_mcp_2026_07_28`, promotes `realtime_conversation` from removed compatibility state to beta, and changes `remote_compaction_v2` from stable/default-on to removed/default-off.

## Registry defaults in Codex 0.155.1

Every one of the 142 registered `FeatureSpec` entries has a `defaultEnabled` value. `Features::with_defaults` enables every entry whose value is true. App Server's `experimentalFeature/list` returns both `enabled` and `defaultEnabled`; when `threadId` is supplied, `enabled` is computed from that Thread's refreshed effective configuration.

The inventory contains 47 unconditional default-on entries, 94 default-off entries, and one platform-conditional entry.

### Default on

Stable, 38:

`shell_tool`, `view_image`, `sleep_tool`, `unified_exec`, `unified_exec_tty`, `shell_snapshot`, `content_item_kinds`, `code_mode_host`, `hooks`, `enable_request_compression`, `unbounded_connection_retries`, `multi_agent`, `apps`, `tool_suggest`, `plugins`, `in_app_browser`, `in_app_chat`, `in_app_dictation`, `in_app_local_automation`, `in_app_updates`, `browser_use`, `browser_use_full_cdp_access`, `browser_use_external`, `computer_use`, `remote_plugin`, `plugin_sharing`, `image_generation`, `skill_mcp_dependency_install`, `skill_search`, `mentions_v2`, `guardian_approval`, `goals`, `tool_call_mcp_elicitation`, `auth_elicitation`, `personality`, `fast_mode`, `compaction_image_budget`, `workspace_dependencies`.

Removed compatibility entries, 9:

`unified_exec_zsh_fork`, `terminal_resize_reflow`, `sqlite`, `tool_search_always_defer_mcp_tools`, `resize_all_images`, `item_ids`, `steer`, `collaboration_modes`, `tui_app_server`.

`secret_auth_storage` is the remaining conditional entry: its default is `cfg!(windows)`, so it is on for Windows builds and off elsewhere.

### Default off

Stable, 3:

`memories`, `multi_agent_v2`, `recommended_plugins`.

Beta, 4:

`network_proxy`, `worktrees`, `realtime_conversation`, `prevent_idle_sleep`. `prevent_idle_sleep` is beta only on macOS, Linux, and Windows; its stage is under development on other targets, but its default remains off.

Under development, 56:

`transcript_v2`, `shell_zsh_fork`, `powershell_shell_version`, `shell_snapshot_v2`, `deferred_executor`, `cwd_relative_turn_diffs`, `executed_tool_call_metadata`, `code_mode`, `code_mode_prewarm`, `code_mode_interrupt`, `code_mode_only`, `standalone_web_search`, `runtime_metrics`, `external_agent_memory_import`, `local_thread_store_compression`, `background_paginated_rollout_migration`, `chronicle`, `apply_patch_streaming_events`, `apply_patch_preserve_line_endings`, `exec_permission_approvals`, `write_stdin_approval`, `request_permissions_tool`, `windows_sandbox_service`, `api_key_model_discovery`, `respect_system_proxy`, `psp`, `enable_mcp_apps`, `mcp_2026_07_28`, `codex_apps_mcp_2026_07_28`, `mcp_oauth_refresh_coordination`, `deferred_tool_world_state`, `non_prefixed_mcp_tool_names`, `executor_capability_discovery`, `skip_host_skill_discovery`, `omit_app_server_notification_media`, `image_resize_notice`, `unified_image_budget`, `concurrent_reasoning_summaries`, `default_mode_request_user_input`, `terminal_visualization_instructions`, `guardianv2.thread_context`, `guardian_reuse_parent_compaction`, `guardian_enhanced_node_repl_transcripts`, `guardian_node_repl_transcript_images`, `guardianv2`, `guardian_ext`, `token_budget`, `context_management`, `rollout_budget`, `reasoning_effort_override`, `current_time_reminder`, `bedrock_setup_wizard`, `artifact`, `step_model_switching`, `retain_client_developer_messages`, `use_agent_identity`.

Deprecated, 3:

`web_search_request`, `web_search_cached`, `use_legacy_landlock`.

Removed compatibility entries, 28:

`undo`, `js_repl`, `code_mode_buffered_exec`, `js_repl_tools_only`, `search_tool`, `codex_git_commit`, `local_thread_store_shared_compression`, `apply_patch_freeform`, `use_linux_sandbox_bwrap`, `request_rule`, `experimental_windows_sandbox`, `elevated_windows_sandbox`, `remote_models`, `multi_agent_mode`, `enable_fanout`, `apps_mcp_path_override`, `tool_search`, `unavailable_dummy_tools`, `plugin_hooks`, `external_migration`, `skill_env_var_dependency_prompt`, `send_async_message`, `remote_control`, `image_detail_original`, `workspace_owner_usage_nudge`, `responses_websockets`, `responses_websockets_v2`, `remote_compaction_v2`.

Removed entries are advertised for compatibility and must not be presented as supported user toggles. Codex explicitly ignores writes for several removed keys, while other compatibility entries can still affect internal state. Clients use the returned `stage` instead of inferring editability from the presence of a key.

## App Server override surfaces

There are two distinct override surfaces:

1. `experimentalFeature/enablement/set` changes a supported subset of features process-wide. Omitted keys are unchanged and an empty map is a no-op. In `0.155.1`, the accepted canonical keys are `api_key_model_discovery`, `auth_elicitation`, `background_paginated_rollout_migration`, `codex_apps_mcp_2026_07_28`, `mcp_2026_07_28`, `memories`, `mentions_v2`, `remote_control`, `remote_plugin`, `tool_suggest`, and `windows_sandbox_service`. Unsupported keys are removed from the response and logged as warnings.
2. `thread/start.config`, `thread/resume.config`, and other Thread config layers can contain `features.<key>` overrides. These are Thread-scoped configuration and are not restricted to the process-wide allowlist.

Process-wide runtime enablement cannot replace a feature key that is explicitly present in the effective `[features]` table or in managed feature requirements. Thread config is a later configuration layer and is not covered by that runtime-protection rule.

## ChatGPT Desktop local Codex behavior

The following findings apply only to local Codex mode in the analyzed Desktop build. They do not describe cloud Chat, ChatGPT Work, or remote Codex execution.

### Startup and initialization

Desktop starts App Server with `-c features.code_mode_host=true app-server --analytics-default-enabled`. `code_mode_host` is already default-on in the bundled Codex version, so this is an explicit confirmation rather than an effective change.

The `initialize` request sets `capabilities.experimentalApi=true`. This exposes experimental App Server methods; it does not itself enable any Codex feature.

### Process-wide runtime enablement

After a local App Server connection is established, and again when execution assignments change, Desktop calls `experimentalFeature/enablement/set`. It constructs the following map:

| Key | Value source | Accepted by bundled 0.154 App Server |
| --- | --- | --- |
| `memories` | Always `false` | Yes |
| `auth_elicitation` | Boolean execution assignment, when present | Yes |
| `tool_suggest` | Boolean execution assignment, when present | Yes |
| `mcp_2026_07_28` | Account feature gate, always sent as a boolean | Yes |
| `remote_plugin` | Curated remote marketplace gate, always sent as a boolean | Yes |
| `background_paginated_rollout_migration` | Sent only when the gate is true | Yes |
| `windows_sandbox_service` | Forced true only for Nightly and Internal Alpha builds | Yes |
| `apps_mcp_path_override` | Boolean execution assignment, when present | No; ignored with a warning |
| `local_thread_store_compression` | Account feature gate, always sent as a boolean | No; ignored with a warning |

The bundled `0.154.0-alpha.6.2` endpoint also accepts `mentions_v2` and `remote_control`, but this Desktop synchronizer does not send them. Desktop separately removes legacy `remote_control` and `features.remote_control` values from user configuration.

Because explicit user or managed feature configuration protects process-wide keys, `[features] memories = true` is not changed by Desktop's runtime `memories = false`. This protection does not apply to later Thread config overrides.

### Per-Thread execution assignments

Desktop reads account-scoped Statsig execution assignments, converts selected keys to `features.<key>`, and merges them into `thread/start.config`; the caller's explicit request config wins over these defaults. Thread creation waits until this execution configuration is ready. Resume paths apply only the relevant default override keys.

One-way feature gates add a key only when true:

`apply_patch_preserve_line_endings`, `unified_exec`, `unified_image_budget`, `code_mode_buffered_exec`, `code_mode_interrupt`, `executed_tool_call_metadata`, `shell_snapshot`, `shell_snapshot_v2`, `remote_models`, `responses_websockets_v2`, `standalone_web_search`, `collaboration_modes`, `default_mode_request_user_input`, `request_rule`, `image_generation`, `item_ids`, `image_detail_original`, `image_resize_notice`, `codex_git_commit`, `workspace_dependencies`, `guardian_approval`, `write_stdin_approval`, `guardian_reuse_parent_compaction`, `apps_mcp_path_override`, `mcp_oauth_refresh_coordination`, `tool_search_always_defer_mcp_tools`, `deferred_tool_world_state`, `thread_tools`, `settings_tools`, `writing_blocks`, and `concurrent_reasoning_summaries`.

A dynamic `feature_overrides` config may send true or false for this allowlist:

`powershell_shell_version`, `shell_snapshot`, `shell_snapshot_v2`, `unified_exec`, `write_stdin_approval`, `code_mode_buffered_exec`, `code_mode_interrupt`, `responses_websockets_v2`, `default_mode_request_user_input`, `tool_search_always_defer_mcp_tools`, `deferred_tool_world_state`, `image_generation_sse`, and `compaction_image_budget`.

Product layers may set `enable_mcp_apps`; `apps`, `plugins`, and `recommended_plugins`; `tool_suggest`; `auth_elicitation`; and `tool_call_mcp_elicitation`. A separate dynamic config supplies structured `guardianv2`, and the realtime gate always supplies a boolean `realtime_conversation` override.

Before sending Thread config, Desktop deliberately excludes `auth_elicitation`, `plugins`, `apps`, `tool_suggest`, `tool_call_mcp_elicitation`, and `writing_blocks` from generic `features.<key>` conversion. `auth_elicitation` and `tool_suggest` instead use the process-wide synchronizer. `apps` and `plugins` are controlled by their product and plugin paths. `writing_blocks` remains a Desktop behavior flag. `thread_tools`, `settings_tools`, and `image_generation_sse` are not registry keys in the bundled App Server and therefore do not enable Codex features there.

Desktop version-gates `apply_patch_preserve_line_endings`, `compaction_image_budget`, `deferred_tool_world_state`, `mcp_oauth_refresh_coordination`, and `recommended_plugins`. It also downgrades structured `guardianv2` to a boolean for older servers.

The static bundle defines which keys may be evaluated, but not their value for a particular account. A client cannot reproduce current Desktop behavior by hard-coding the list: it would also need the authenticated execution-assignment payload.

### Hard-coded Thread cases

- Normal local/projectless starts enable `request_permissions_tool` when the approval policy is absent or granular, and related resume paths also enable it when Desktop must manage permissions.
- Token-budget side Threads set structured `token_budget.enabled=true` and `use_history_notes_extension=true` when the server supports that extension.
- Read-only title, summary, suggestion, and metadata helper Threads explicitly disable combinations of `multi_agent`, `multi_agent_v2`, `enable_fanout`, `plugins`, `tool_suggest`, `hooks`, shell features, Apps, memories, image generation, and permission tools to keep helper execution narrow.
- App-aware metadata helpers set `apps` from the helper's allowlist instead of inheriting ordinary App availability.

## Features that require user configuration

For the analyzed Desktop build, a default-off feature stays off unless one of the process, execution-assignment, hard-coded Thread, or user-configuration paths above enables it. The most important user-controlled cases are:

- Computer History requires both `memories=true` and `chronicle=true` in saved Codex configuration. Desktop's Computer History toggle writes `features.chronicle`; it checks that both keys are true, while its process synchronizer otherwise requests `memories=false`. A user or managing client must therefore enable and protect `memories` as well.
- `network_proxy`, `worktrees`, and `prevent_idle_sleep` are beta/default-off in the bundled registry and are not enabled by Desktop's local App Server API paths. They require native feature configuration if their Codex-side behavior is desired. Desktop's own worktree UI is a separate product implementation and does not imply `features.worktrees=true`.
- `multi_agent_v2` is stable/default-off and has no normal Desktop enablement source in this build. It requires explicit configuration.
- `code_mode` is default-off. Starting the host with `code_mode_host=true` only makes the host capability available; it does not enable `code_mode` itself.
- Other default-off under-development features require explicit configuration unless they appear in the execution-assignment candidates or hard-coded cases above. They should not be exposed as ordinary user settings without a product decision.

`realtime_conversation` is a special case: Desktop supplies an account-gate boolean per Thread, including false. That Thread override can supersede a saved native value, so editing `config.toml` alone is not a reliable way to force voice on in this analyzed build.

## Client requirements

A Cypheria client should:

1. call `experimentalFeature/list` and paginate until `nextCursor` is absent;
2. pass `threadId` when it needs an existing Thread's effective feature state;
3. treat `defaultEnabled` as diagnostic metadata and `enabled` as effective state;
4. hide `Removed` entries and clearly separate `Beta` from `UnderDevelopment`;
5. send only the documented process-wide allowlist to `experimentalFeature/enablement/set` and tolerate version skew;
6. preserve explicit user and managed feature choices; and
7. never copy Desktop's private experiment IDs or assume its current account assignments are Codex protocol defaults.
