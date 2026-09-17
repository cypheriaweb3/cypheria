# Codex App Server 配置运行时语义

本文说明 Codex App Server 如何使用一份已经完成合并、合法且有效的 `config.toml`。本文刻意不讨论配置层的发现与合并优先级，目标是定义 Codex 已经得到最终配置后，Cypheria 客户端可以依赖的行为。

Cypheria 当前将 `@openai/codex` 及 generated protocol 固定在 `0.153.4`。本文背后的深入运行时追踪于 2026-09-16 对照了上游 Codex commit `657a993cbee87acf52d14b758ce49dbd46d1b8eb`。两者是不同的兼容基线：

- 随 Cypheria 捆绑的 binary 与 `packages/protocol/src/generated/codex` 中的生成产物是 wire protocol 的 source of truth；
- 上游源码追踪用于解释运行时模型以及可能的升级行为；
- 除非固定 binary 的 generated schema 接受，否则不能因为较新上游源码出现了某个字段就把它发送给 `0.153.4`。

Generated method 清单见 [Codex App Server API 参考](codex-app-server-api.zh-CN.md)，面向用户的权限模型见 [Cypheria Desktop 中的 Codex 权限](codex-permissions.zh-CN.md)。

## 核心模型

App Server 不会把最终 TOML 永久保留为一个由所有子系统随时查询的 immutable dictionary。它先解析 TOML 形状的 `ConfigToml`，完成校验和派生，再把选定字段复制到生命周期不同的运行时对象中：

```txt
最终有效 ConfigToml
├── App Server 进程状态
│   ├── 认证与 ChatGPT backend
│   ├── model catalog 与 model manager
│   ├── SQLite 与 thread store
│   └── analytics 与 OpenTelemetry
├── thread Config
│   ├── model 与 provider
│   ├── instructions 与上下文策略
│   ├── permissions 与 sandbox
│   └── MCP、apps、plugins、skills、hooks 与 features
├── 每轮 TurnContext
│   ├── cwd 与 runtime roots
│   ├── model request settings
│   ├── active permission/reviewer settings
│   └── output schema 与 request metadata
└── 每个 inference step 的 tool/prompt plan
    ├── 刷新后的 project instructions 与 skills
    ├── 已连接的 MCP/app/plugin/dynamic/host tools
    └── 经过 model、feature、platform 与 permission 筛选的内置工具
```

因此，“存在于有效配置”“进入 runtime `Config`”“已应用到当前 thread”“已应用到当前 turn”和“出现在当前 tool catalog”是不同状态。

## 生命周期与生效范围

| 阶段 | App Server 行为 | 客户端含义 |
| --- | --- | --- |
| 进程启动 | 加载配置并构造认证、model catalog、state store、thread manager、telemetry 与进程服务。 | 修改进程持有的字段通常需要重启 App Server。 |
| `thread/start`、`thread/resume`、`thread/fork` | 加载当前配置，应用 request/session override，派生 thread `Config`，初始化 thread 与 extension catalogs。 | 修改后的默认值主要在这个边界生效。 |
| `turn/start` 或 `thread/settings/update` | 从 thread settings 出发应用受支持的 typed override。普通 turn 不会重新加载整份 TOML。 | 不能期待任意配置文件修改自动影响现有 thread。 |
| Inference step | 从 TurnContext、模型能力、实时 MCP/plugin/app 状态、dynamic tools、host tools 和 features 重建 instructions 与 tool router。 | 绝不能从 `config/read` 推断最终 tool list。 |
| Config reload | 只刷新明确支持的 thread-owned catalogs/settings。 | Reload 不等于替换完整 thread `Config`，也不等于重启进程。 |

在 turn 中选择命名 permission profile 是一个重要例外：Codex 可能重新读取配置以解析该 profile，但这不会让其他字段自动变成 hot-reloadable。

## Request config 与文件配置

`thread/start.config`、`thread/resume.config` 和 `thread/fork.config` 在 wire boundary 上是无类型 JSON map。App Server 将它们按 TOML 风格路径解释为 session config layer。它们不是独立的 tool injection protocol，也不会作为用户配置持久化。

存在 typed request field 时应由该字段负责设置，例如 `model`、`modelProvider`、`cwd`、`permissions`、`sandbox`、`approvalPolicy`、`approvalsReviewer`、`personality`、runtime workspace roots 与 service tier。客户端应优先使用这些 typed fields，只把 `config` 留给没有一等 request field 的设置。

App Server 会先移除 `bypass_hook_trust` 等 host-only 特殊值，再把其余 map 反序列化为普通配置。

多数 turn settings 修改是 sticky thread setting，会成为后续 turn 的默认值。Output schema、additional turn context 与 turn-specific Responses metadata 只属于当前 turn。Provider replacement 属于新建 thread 操作；客户端不能假设在现有 thread 中换 model 就会换 provider。

## 字段分组

### Models、providers 与 Responses request

- `model`、`review_model`、`model_provider` 分别选择普通模型、review 模型和 provider。`model` 可以通过受支持的 thread/turn settings 修改，provider 切换应发生在 thread 创建时。
- `model_providers.<id>` 定义 Responses provider：endpoint、环境变量 credential key、command/AWS credential helper、静态与环境派生 headers、query parameters、request/stream retry、stream idle timeout、WebSocket timeout、OpenAI auth 要求和 capability flags。当前 wire API 是 Responses。不同认证机制受到互斥约束，保留的 built-in provider ID 通常不能覆盖。
- `openai_base_url` 修改内置 OpenAI provider endpoint；`chatgpt_base_url` 修改认证及 ChatGPT-owned 产品服务使用的 ChatGPT backend，两者不是同一个 endpoint。
- `model_context_window`、`model_auto_compact_token_limit`、`model_auto_compact_token_limit_scope` 配置上下文和 compaction 计数。
- `model_reasoning_effort`、`model_reasoning_summary`、`model_verbosity`、`personality`、`service_tier` 进入模型请求。`plan_mode_reasoning_effort` 主要是产品 UI 默认值，不是 App Server 自动切换 turn effort 的机制。
- `tool_output_token_limit` 限制保留在模型上下文中的工具输出；每个 MCP tool 可以进一步覆盖。
- `responses_api_metadata` 是附加到 Responses request 的有界 product metadata，与 per-turn client metadata 不同。
- `model_catalog_json` 在进程启动时应用到共享 model catalog。把它作为 per-thread override 传入不会重建共享 catalog。
- `apps_mcp_product_sku` 转发给 host-owned Apps MCP request。
- `oss_provider` 是 CLI local-model 偏好，对普通 standalone App Server thread 没有效果。

### Instructions、project context 与 compaction

- `instructions`、`developer_instructions`、`model_instructions_file` 进入不同 prompt layer。非空 model-instructions file 会替换所选模型的 base instructions。
- `compact_prompt` 与 `experimental_compact_prompt_file` 自定义 compaction；inline value 优先，空内容视为未设置。
- `include_permissions_instructions`、`include_apps_instructions`、`include_collaboration_mode_instructions`、`include_environment_context` 只控制 prompt block，不会关闭 enforcement 或 capability。
- `project_doc_max_bytes`、`project_doc_fallback_filenames`、`project_root_markers` 控制 project-root discovery 与 AGENTS/project-instruction budget。
- `orchestrator.skills.enabled` 和 `orchestrator.mcp.enabled` 只控制 orchestrator-owned 来源，不会关闭所有用户或 plugin 来源。
- `auto_review.policy` 向固定 Guardian prompt 增加 policy 文本，不会替换整个 reviewer prompt。

### Permissions、sandbox 与 shell environment

- `approval_policy` 控制哪些类别可以向用户请求升级；granular `false` 表示自动拒绝，不是隐式批准。
- `approvals_reviewer` 把升级请求路由到用户或 Auto-review，不会扩大 sandbox。
- `sandbox_mode` 与 `sandbox_workspace_write` 是 legacy sandbox 路径；命名 `permissions` profile 是新路径，客户端不得静默合并两套模型。
- `default_permissions` 选择 built-in profile（`:read-only`、`:workspace`、`:danger-full-access`）或命名 profile。`[permissions.<id>]` 可以定义继承、workspace roots、filesystem read/write/deny、glob scanning、sandbox network 与 managed proxy policy。循环继承、未知 parent 和越权配置会校验失败。
- `[projects.<path>].trust_level` 参与默认 sandbox/approval 推导和 project config discovery，但 trust 不能代替具体 permission profile。
- `shell_environment_policy` 过滤和注入环境变量；规范化 filters 与 legacy include/exclude arrays 互斥。
- `allow_login_shell = false` 会拒绝显式 login shell，且省略选择时使用 non-login shell。
- `windows` 配置 Windows-specific sandbox/private desktop。
- `browser_use` 与 `computer_use` 是通过配置 API 暴露给 host/product 的访问控制描述，不是本地 shell filesystem sandbox。

完整的 Cypheria UI 和 wire mapping 仍以 [codex-permissions.zh-CN.md](codex-permissions.zh-CN.md) 为准。

### MCP

`mcp_servers.<name>` 定义 stdio transport（`command`、`args`、环境变量、`cwd`）或 streamable HTTP transport（`url`、bearer-token 环境变量、headers、environment headers、header helper）。非法混用会校验失败；当前源码会拒绝 literal bearer-token 配置。

公共 server policy 包括 `environment_id`、认证模式、启停、startup 是否 required、startup/tool timeout、parallel call、是否从 code/deferred/direct mode 省略、默认 approval mode、enabled/disabled tools、OAuth scopes/resource/callback，以及 per-tool approval 与 output-token limit。Required server 启动失败会使 thread start/resume 失败；optional server 失败只会减少 available catalog。

全局 MCP 字段选择 OAuth credential storage 与 callback 行为。`mcp_optional_startup_grace_ms` 限制 optional server 的共享启动 grace；设为 0 会取消共享 grace 并使用每个 server 的 timeout。

MCP 配置会在 thread 初始化及显式 MCP refresh 时读取，但有效的 MCP/app/plugin/tool router 仍会在每个 inference step 根据实时状态重建。

### Apps、plugins、marketplaces、skills 与 hooks

- `[apps]` 定义全局和 per-app enablement、destructive/open-world policy、reviewer、默认 approval mode、默认 tool enablement、per-tool 与 per-link policy。Managed policy 优先于 tool、link、app 与 default。
- `[plugins.<name>]` 启用 plugin，并覆盖其 manifest 提供的 MCP server/tool policy。Plugin 可以贡献 MCP、skills、hooks 和 apps。
- `[marketplaces.<name>]` 记录 Git/local source、ref、sparse paths 与最近同步 revision。它驱动 marketplace operation，不直接进入模型请求。
- `[tool_suggest]` 提供 discoverable connector/plugin ID 与 disabled suggestions；相关 feature 决定是否暴露推荐/安装工具。
- `[skills]` 控制 bundled skills、prompt inclusion、context budget 及 path/name enable rule。Turn 会重建 skill snapshot，并可包含 plugin roots。
- `[hooks]` 配置 pre/post tool use、permission、compaction、session、user prompt、subagent、stop、interrupt 等 lifecycle event。Handler 可以是 command、MCP tool、prompt 或 agent。Hook trust state 与 enablement 相互独立。
- `notify` 是 legacy completed-turn command hook，与 lifecycle hooks 不同。

### Agents、goals 与 memories

- `[agents]` 控制 legacy multi-agent enablement、concurrency/depth、默认 child model/effort、interrupt 行为及命名 role file。Child role 可以专门化或收窄父代理能力，但不能扩大父代理权限。
- `features.multi_agent_v2` 管理新并发 backend、wait timeout、tool namespace、metadata visibility、subagent instructions、可选 model override 与 wait-tool exposure。
- `[goals].max_goal_token_budget` 在 goals feature 开启时限制 goal creation。
- `[memories]` 控制 extraction、consolidation、use、model selection、retention、rollout sampling、idle/rate-limit threshold 与 dedicated tools；没有开启 memories feature 时不生效。

### Web、内置工具与 terminal

- `web_search` 选择 `disabled`、`cached`、`indexed` 或 `live`；最终模式还受 provider capability、permissions 与 features 约束。
- `[tools.web_search]` 提供 allowed domains、context size 和 location。其 legacy boolean 形态不负责开启或关闭 search；启停应使用顶层 `web_search`。
- `tools.experimental_request_user_input.enabled` 与 `tools.update_plan.enabled` 影响 tool registration，并继续受 model/mode/feature gate 约束。
- `background_terminal_max_timeout` 限制空 `write_stdin` polling，不是 command execution timeout。
- Shell、unified exec、patch、image、web、permission request、collaboration、goals、sleep、time、code mode、hosted、extension 与 dynamic tools 由 step tool planner 选择；任何 config response 都不是完整 tool catalog。

### Authentication、storage、telemetry 与 realtime

- `forced_chatgpt_workspace_id`、`forced_login_method`、`cli_auth_credentials_store` 约束进程认证。Per-thread override 不会重建进程 AuthManager。
- `sqlite_home` 与 `experimental_thread_store` 配置进程持久化；`history` 控制 CLI input history，不控制 App Server thread/rollout persistence。
- `log_dir`、`file_opener`、`tui`、`disable_paste_burst`、`notice` 和多数 audio-device settings 是产品/TUI preference，不是 App Server agent semantics。
- `analytics`、`feedback`、`otel` 控制进程 telemetry 与 feedback；普通 thread reload 不会重建 telemetry pipeline。
- `realtime` 及 experimental realtime endpoint/model/prompt 字段在 feature 开启时配置 realtime conversation。`audio.microphone` 和 `audio.speaker` 是 machine-local UI preference，不是 core 打开设备的指令。

### Compatibility、opaque 与 no-op 字段

- `desktop` 是 config API round-trip 的 opaque product data。
- `show_raw_agent_reasoning` 影响 raw reasoning event 暴露；`hide_agent_reasoning` 主要是 output/UI preference。
- Legacy `profiles` 数据仍可读取，但当前上游会拒绝顶层 `profile` selection，并要求在进程启动时选择命名 config file。
- `js_repl_node_path`、`js_repl_node_module_dirs`、`ghost_snapshot` 仅为兼容保留。
- `experimental_thread_store_endpoint` 已移除，设置后 fail fast，不会静默回退到 local。
- `check_for_update_on_startup` 是 CLI/TUI product behavior，不是 App Server client contract。
- `suppress_unstable_features_warning` 只隐藏警告，不会让 feature 变稳定。

## Feature registry

Feature key 是版本化 implementation switch，不是 protocol capability negotiation。客户端必须使用匹配版本的 generated schema，也不应围绕 experimental key 建立永久产品行为。下面列出上游分析中出现的 key，并保留 alias 与 no-op 项，避免 config editor 错误解释。

### 有效或实验性的 capability switch

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

带结构的 feature table 包括 `code_mode`、`code_mode_host`、`non_prefixed_mcp_tool_names`、`guardianv2`、`multi_agent_v2`、`token_budget`、`rollout_budget`、`current_time_reminder`、`sleep_tool`、`network_proxy` 与 `context_management`。`features.tool_registry` 是控制 collision 与 turn metadata 的 settings table，不是普通 `enabled` gate。

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

顶层 `experimental_use_unified_exec_tool` 也是 legacy alias。

### 已移除、兼容保留或当前无效的 switch

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

具体分类可能随 Codex release 改变。Schema 是否接受、默认是否开启、运行时是否有效是三个不同问题，每次升级都必须分别验证。

## `config/read` 不是 runtime-state dump

`config/read` 返回 TOML-shaped effective API view。一部分字段是显式 protocol field，其余 flattened 到 `additional`；config object 内仍使用 `snake_case` key。

它不保证包含：

- 所有派生 runtime default；
- 当前 thread 的完整 `Config`；
- 当前 `TurnContext`；
- 最终 provider capability set；
- 当前 tool catalog；
- packaged defaults 或 exact managed requirements 的完整 provenance。

Resolved catalog 应使用专用 model、permission-profile、skill、hook、MCP-status、app 与 plugin method；effective thread state 应使用 thread start/resume response 与 thread settings API。

## Reload 行为

当前上游 reload path 会刷新 user layer、active project、tool suggestions、MCP server definitions 与 grace/OAuth settings、部分 security feature state、hooks、plugin/skill caches，并能为现有 thread 重建这些 catalog。

它不会重建进程 authentication、model catalog、SQLite/thread store、telemetry，也不会替换 thread 的完整 settings snapshot。不能因为配置文件写入成功就假设 model/provider/base instructions 或 permission state 已经改变。

`config/mcpServer/reload` 只刷新 MCP。`config/batchWrite` 可以请求更广的 user-config reload，但如果只写 model、reasoning、plan effort、service tier 或 personality default，App Server 可以跳过昂贵的 existing-thread refresh，因为这些主要用于未来 thread。

## Cypheria 客户端要求

1. 必须从完全相同的 bundled Codex binary 生成 protocol types、JSON Schemas、response mappings 和 validators；binary 与 generated artifacts 是一个兼容单元。
2. 使用 experimental method 前，在 `initialize` 中协商 experimental API support；TOML feature flag 不能替代 protocol capability negotiation。
3. 优先使用一等 request field，不要把所有设置都塞进 generic `config` map。
4. 明确把配置生效划分为 process restart、next thread、thread reload 或 next turn；文件写入成功不代表 active turn 已改变。
5. 不得从配置合成最终 tool list；应读取 live catalog/status API 与实际 turn tool event。
6. Generated validator 允许时，应把未知 enum string 和 flattened additional config 当作 forward-compatible data，不得静默重解释。
7. 始终使用 `CODEX_HOME="$CYPHERIA_HOME/codex"`；没有显式 import/migration flow 时不得读取或修改用户默认 Codex home。
8. 每次升级 Codex 时都要重新生成产物、diff config schema 与 feature registry，并测试 startup、thread、turn、reload，以及哪些设置需要重启进程。

## 参考

- [OpenAI 官方配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)
- [OpenAI 官方 App Server 文档](https://learn.chatgpt.com/docs/app-server)
- [Codex App Server API 参考](codex-app-server-api.zh-CN.md)
- [Codex 权限](codex-permissions.zh-CN.md)
