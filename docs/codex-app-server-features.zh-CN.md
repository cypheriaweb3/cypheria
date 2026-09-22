---
title: Codex Feature 默认值与 Desktop Overrides
---

# Codex Feature 默认值与 Desktop Overrides

本文区分 Codex 自身默认值和客户端提供的 overrides。Feature key 与默认值都是带版本的实现细节，因此客户端必须从 App Server 发现有效状态，不能把本文快照当作永久协议契约。

## 版本范围

下方默认值清单来自 Cypheria 当前固定的 `@openai/codex` `0.155.1`。Desktop 行为来自对 ChatGPT Desktop `26.908.40834`、build `8881` 的本地静态分析；其随包 App Server 报告版本为 `0.154.0-alpha.6.2`。版本差异很重要：`0.155.1` 新增 `api_key_model_discovery` 和 `codex_apps_mcp_2026_07_28`，把 `realtime_conversation` 从 removed 兼容状态提升为 beta，并把 `remote_compaction_v2` 从 stable/default-on 改为 removed/default-off。

## Codex 0.155.1 Registry 默认值

全部 142 个已注册 `FeatureSpec` 都有 `defaultEnabled`。`Features::with_defaults` 会启用值为 true 的全部条目。App Server 的 `experimentalFeature/list` 同时返回 `enabled` 与 `defaultEnabled`；传入 `threadId` 时，`enabled` 根据该 Thread 刷新后的有效配置计算。

清单中有 47 个无条件默认开启项、94 个默认关闭项，以及 1 个按平台决定的条目。

### 默认开启

Stable，38 个：

`shell_tool`、`view_image`、`sleep_tool`、`unified_exec`、`unified_exec_tty`、`shell_snapshot`、`content_item_kinds`、`code_mode_host`、`hooks`、`enable_request_compression`、`unbounded_connection_retries`、`multi_agent`、`apps`、`tool_suggest`、`plugins`、`in_app_browser`、`in_app_chat`、`in_app_dictation`、`in_app_local_automation`、`in_app_updates`、`browser_use`、`browser_use_full_cdp_access`、`browser_use_external`、`computer_use`、`remote_plugin`、`plugin_sharing`、`image_generation`、`skill_mcp_dependency_install`、`skill_search`、`mentions_v2`、`guardian_approval`、`goals`、`tool_call_mcp_elicitation`、`auth_elicitation`、`personality`、`fast_mode`、`compaction_image_budget`、`workspace_dependencies`。

Removed 兼容条目，9 个：

`unified_exec_zsh_fork`、`terminal_resize_reflow`、`sqlite`、`tool_search_always_defer_mcp_tools`、`resize_all_images`、`item_ids`、`steer`、`collaboration_modes`、`tui_app_server`。

`secret_auth_storage` 是剩余的条件条目：默认值为 `cfg!(windows)`，因此 Windows build 默认开启，其他平台默认关闭。

### 默认关闭

Stable，3 个：

`memories`、`multi_agent_v2`、`recommended_plugins`。

Beta，4 个：

`network_proxy`、`worktrees`、`realtime_conversation`、`prevent_idle_sleep`。`prevent_idle_sleep` 只在 macOS、Linux 与 Windows 上属于 beta；其他 target 上为 under development，但默认值仍为关闭。

Under development，56 个：

`transcript_v2`、`shell_zsh_fork`、`powershell_shell_version`、`shell_snapshot_v2`、`deferred_executor`、`cwd_relative_turn_diffs`、`executed_tool_call_metadata`、`code_mode`、`code_mode_prewarm`、`code_mode_interrupt`、`code_mode_only`、`standalone_web_search`、`runtime_metrics`、`external_agent_memory_import`、`local_thread_store_compression`、`background_paginated_rollout_migration`、`chronicle`、`apply_patch_streaming_events`、`apply_patch_preserve_line_endings`、`exec_permission_approvals`、`write_stdin_approval`、`request_permissions_tool`、`windows_sandbox_service`、`api_key_model_discovery`、`respect_system_proxy`、`psp`、`enable_mcp_apps`、`mcp_2026_07_28`、`codex_apps_mcp_2026_07_28`、`mcp_oauth_refresh_coordination`、`deferred_tool_world_state`、`non_prefixed_mcp_tool_names`、`executor_capability_discovery`、`skip_host_skill_discovery`、`omit_app_server_notification_media`、`image_resize_notice`、`unified_image_budget`、`concurrent_reasoning_summaries`、`default_mode_request_user_input`、`terminal_visualization_instructions`、`guardianv2.thread_context`、`guardian_reuse_parent_compaction`、`guardian_enhanced_node_repl_transcripts`、`guardian_node_repl_transcript_images`、`guardianv2`、`guardian_ext`、`token_budget`、`context_management`、`rollout_budget`、`reasoning_effort_override`、`current_time_reminder`、`bedrock_setup_wizard`、`artifact`、`step_model_switching`、`retain_client_developer_messages`、`use_agent_identity`。

Deprecated，3 个：

`web_search_request`、`web_search_cached`、`use_legacy_landlock`。

Removed 兼容条目，28 个：

`undo`、`js_repl`、`code_mode_buffered_exec`、`js_repl_tools_only`、`search_tool`、`codex_git_commit`、`local_thread_store_shared_compression`、`apply_patch_freeform`、`use_linux_sandbox_bwrap`、`request_rule`、`experimental_windows_sandbox`、`elevated_windows_sandbox`、`remote_models`、`multi_agent_mode`、`enable_fanout`、`apps_mcp_path_override`、`tool_search`、`unavailable_dummy_tools`、`plugin_hooks`、`external_migration`、`skill_env_var_dependency_prompt`、`send_async_message`、`remote_control`、`image_detail_original`、`workspace_owner_usage_nudge`、`responses_websockets`、`responses_websockets_v2`、`remote_compaction_v2`。

Removed 条目只为兼容而公布，不应作为受支持的用户 toggle 展示。Codex 会明确忽略部分 removed key 的写入，其他兼容条目仍可能影响内部状态。客户端应使用返回的 `stage`，不能仅凭 key 存在就推断其可编辑。

## App Server Override 入口

存在两个不同的 override 入口：

1. `experimentalFeature/enablement/set` 在 process 范围修改受支持的 feature 子集。省略的 key 保持不变，空 map 是 no-op。`0.155.1` 接受的 canonical key 为 `api_key_model_discovery`、`auth_elicitation`、`background_paginated_rollout_migration`、`codex_apps_mcp_2026_07_28`、`mcp_2026_07_28`、`memories`、`mentions_v2`、`remote_control`、`remote_plugin`、`tool_suggest` 和 `windows_sandbox_service`。不支持的 key 会从 response 中移除并记录 warning。
2. `thread/start.config`、`thread/resume.config` 和其他 Thread config layer 可以包含 `features.<key>` override。这些属于 Thread 范围配置，不受 process-wide allowlist 限制。

Process-wide runtime enablement 不能替换有效 `[features]` table 或 managed feature requirements 中明确出现的 feature key。Thread config 是更晚的配置层，不受这条 runtime 保护规则约束。

## ChatGPT Desktop 本地 Codex 行为

以下结论只适用于已分析 build 的本地 Codex 模式，不描述 cloud Chat、ChatGPT Work 或远程 Codex execution。

### 启动与初始化

Desktop 使用 `-c features.code_mode_host=true app-server --analytics-default-enabled` 启动 App Server。随包 Codex 已默认开启 `code_mode_host`，所以这是显式确认，不会改变有效值。

`initialize` 请求设置 `capabilities.experimentalApi=true`。这会开放实验性 App Server methods，但本身不会启用任何 Codex feature。

### Process-wide Runtime Enablement

本地 App Server 建立连接后，以及 execution assignments 变化时，Desktop 会调用 `experimentalFeature/enablement/set`，并构造以下 map：

| Key | 值来源 | 随包 0.154 App Server 是否接受 |
| --- | --- | --- |
| `memories` | 永远为 `false` | 是 |
| `auth_elicitation` | 存在时取 boolean execution assignment | 是 |
| `tool_suggest` | 存在时取 boolean execution assignment | 是 |
| `mcp_2026_07_28` | 账户 feature gate，始终发送 boolean | 是 |
| `remote_plugin` | Curated remote marketplace gate，始终发送 boolean | 是 |
| `background_paginated_rollout_migration` | 只在 gate 为 true 时发送 | 是 |
| `windows_sandbox_service` | 只在 Nightly 与 Internal Alpha build 中强制为 true | 是 |
| `apps_mcp_path_override` | 存在时取 boolean execution assignment | 否；忽略并 warning |
| `local_thread_store_compression` | 账户 feature gate，始终发送 boolean | 否；忽略并 warning |

随包 `0.154.0-alpha.6.2` endpoint 还接受 `mentions_v2` 与 `remote_control`，但 Desktop synchronizer 不会发送它们。Desktop 另行从用户配置删除旧的 `remote_control` 与 `features.remote_control`。

由于显式用户配置或 managed feature 配置会保护 process-wide key，`[features] memories = true` 不会被 Desktop runtime 的 `memories = false` 改写。这种保护不适用于更晚的 Thread config override。

### Per-Thread Execution Assignments

Desktop 读取账户范围 Statsig execution assignments，把选定 key 转为 `features.<key>` 并合并进 `thread/start.config`；调用方显式 request config 优先于这些默认值。Thread creation 会等到 execution configuration ready。Resume 路径只应用相关 default override keys。

以下单向 feature gate 只在值为 true 时添加 key：

`apply_patch_preserve_line_endings`、`unified_exec`、`unified_image_budget`、`code_mode_buffered_exec`、`code_mode_interrupt`、`executed_tool_call_metadata`、`shell_snapshot`、`shell_snapshot_v2`、`remote_models`、`responses_websockets_v2`、`standalone_web_search`、`collaboration_modes`、`default_mode_request_user_input`、`request_rule`、`image_generation`、`item_ids`、`image_detail_original`、`image_resize_notice`、`codex_git_commit`、`workspace_dependencies`、`guardian_approval`、`write_stdin_approval`、`guardian_reuse_parent_compaction`、`apps_mcp_path_override`、`mcp_oauth_refresh_coordination`、`tool_search_always_defer_mcp_tools`、`deferred_tool_world_state`、`thread_tools`、`settings_tools`、`writing_blocks`、`concurrent_reasoning_summaries`。

动态 `feature_overrides` config 可对以下 allowlist 发送 true 或 false：

`powershell_shell_version`、`shell_snapshot`、`shell_snapshot_v2`、`unified_exec`、`write_stdin_approval`、`code_mode_buffered_exec`、`code_mode_interrupt`、`responses_websockets_v2`、`default_mode_request_user_input`、`tool_search_always_defer_mcp_tools`、`deferred_tool_world_state`、`image_generation_sse`、`compaction_image_budget`。

产品 layer 可以设置 `enable_mcp_apps`；`apps`、`plugins` 与 `recommended_plugins`；`tool_suggest`；`auth_elicitation`；以及 `tool_call_mcp_elicitation`。另一个动态 config 提供结构化 `guardianv2`，realtime gate 则始终提供 boolean `realtime_conversation` override。

发送 Thread config 前，Desktop 会从通用 `features.<key>` 转换中主动排除 `auth_elicitation`、`plugins`、`apps`、`tool_suggest`、`tool_call_mcp_elicitation` 和 `writing_blocks`。`auth_elicitation` 与 `tool_suggest` 改走 process-wide synchronizer；`apps` 与 `plugins` 由各自 product/plugin 路径控制；`writing_blocks` 仍是 Desktop 行为 flag。`thread_tools`、`settings_tools` 与 `image_generation_sse` 不是随包 App Server 的 registry key，因此不会在那里启用 Codex feature。

Desktop 会对 `apply_patch_preserve_line_endings`、`compaction_image_budget`、`deferred_tool_world_state`、`mcp_oauth_refresh_coordination` 和 `recommended_plugins` 做 App Server 版本检查。对于更旧 server，它还会把结构化 `guardianv2` 降级成 boolean。

静态 bundle 定义的是可能被评估的 key，不包含某个账户的实际值。客户端不能通过硬编码该清单复刻当前 Desktop 行为；还必须取得经过认证的 execution-assignment payload。

### 硬编码 Thread 情形

- 普通 local/projectless start 在 approval policy 缺省或 granular 时启用 `request_permissions_tool`；Desktop 必须管理权限时，相关 resume 路径也会启用它。
- Token-budget side Thread 会在 server 支持对应 extension 时设置结构化 `token_budget.enabled=true` 与 `use_history_notes_extension=true`。
- Read-only title、summary、suggestion 与 metadata helper Thread 会明确关闭 `multi_agent`、`multi_agent_v2`、`enable_fanout`、`plugins`、`tool_suggest`、`hooks`、shell features、Apps、memories、image generation 与 permission tools 的不同组合，以缩窄 helper execution。
- App-aware metadata helper 根据自己的 allowlist 设置 `apps`，而不是继承普通 App availability。

## 需要用户配置的 Features

对于已分析 Desktop build，default-off feature 只有被上述 process、execution-assignment、硬编码 Thread 或用户配置路径之一启用时才会开启。最重要的用户控制情形是：

- Computer History 要求 Codex saved configuration 中 `memories=true` 与 `chronicle=true` 同时成立。Desktop 的 Computer History toggle 会写 `features.chronicle`，并检查两者都为 true；而 process synchronizer 在其他情况下会请求 `memories=false`。因此用户或管理客户端还必须启用并保护 `memories`。
- `network_proxy`、`worktrees` 与 `prevent_idle_sleep` 在随包 registry 中属于 beta/default-off，Desktop 的本地 App Server API 路径不会启用它们。如需其 Codex 侧行为，必须通过原生 feature 配置开启。Desktop 自身的 worktree UI 是独立产品实现，并不表示 `features.worktrees=true`。
- `multi_agent_v2` 是 stable/default-off，在这个 build 中没有普通 Desktop enablement source，需要显式配置。
- `code_mode` 默认关闭。使用 `code_mode_host=true` 启动 host 只表示 host capability 可用，不会启用 `code_mode` 本身。
- 其他 default-off under-development feature，除非出现在上述 execution-assignment candidate 或硬编码情形中，否则需要显式配置。没有产品决策时，不应把它们暴露为普通用户 setting。

`realtime_conversation` 是特殊情形：Desktop 会在每个 Thread 上提供账户 gate 的 boolean 值，包括 false。该 Thread override 可以覆盖 saved native value，因此在已分析 build 中，仅编辑 `config.toml` 不能可靠地强制开启 voice。

## 客户端要求

Cypheria 客户端应当：

1. 调用 `experimentalFeature/list`，并持续翻页直到没有 `nextCursor`；
2. 查询已有 Thread 的有效 feature 状态时传入 `threadId`；
3. 把 `defaultEnabled` 视为诊断元数据，把 `enabled` 视为有效状态；
4. 隐藏 `Removed` 条目，并明确区分 `Beta` 与 `UnderDevelopment`；
5. 只向 `experimentalFeature/enablement/set` 发送目标版本记录的 process-wide allowlist，并容忍版本偏差；
6. 保留显式用户与 managed feature 选择；
7. 不复制 Desktop 的私有 experiment ID，也不假设其当前账户 assignment 属于 Codex 协议默认值。
