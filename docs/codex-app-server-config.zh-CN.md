---
title: Cypheria 中的 Codex 配置
---

# Cypheria 中的 Codex 配置

本文只描述 Cypheria 当前实际依赖的 Codex 配置语义，不是完整 Codex 配置百科。准确 App Server 字段仍以生成协议和固定版本的 `@openai/codex` 为准。

## 事实来源

Cypheria 管理的 Codex 使用 `CODEX_HOME=$CYPHERIA_HOME/codex`，其原生 `config.toml` 与用户默认 Codex home 隔离。Codex 全局设置由这份原生配置保存，不再镜像到 Server 配置。

用户通过 `client.harnesses.codex` 修改受支持设置时，Server 会：

1. 通过 App Server `config/read` 读取当前值，并通过 `experimentalFeature/list` 读取功能状态；
2. 通过 `config/batchWrite` 写入原生 Codex keys 并重新加载用户配置；
3. 返回有效原生值与 managed restrictions。

Desktop 外观和 composer 权限菜单的可见性仍是 Desktop 本地偏好。

Codex Settings 中每项选择都会立即通过 App Server 写入，不需要另行保存。普通选项只写入一个原生 key；切换默认模型时，如果新模型不支持已明确设置的 reasoning effort，还会清除该值。

## 受支持的 Codex 设置

| Cypheria 字段 | Codex key | 含义 |
| --- | --- | --- |
| `model` | `model` | 新 Codex Thread 的默认 model |
| `provider` | `model_provider` | `openai`、`amazon-bedrock`、`ollama` 或 `lmstudio` |
| `reasoningEffort` | `model_reasoning_effort` | 默认 reasoning effort |
| `serviceTier` | `service_tier` | 默认 service tier |
| `approvalPolicy` | `approval_policy` | Codex 何时可以请求 approval |
| `approvalsReviewer` | `approvals_reviewer` | 用户或受支持自动 reviewer |
| `sandboxMode` | `sandbox_mode` | 文件系统与进程 sandbox 基线 |
| `networkAccess` | `sandbox_workspace_write.network_access` | workspace-write 模式的网络访问 |
| `webSearch` | `web_search` | 禁用、缓存、索引或实时搜索 |
| `modelVerbosity` | `model_verbosity` | 默认响应详细度 |
| `modelReasoningSummary` | `model_reasoning_summary` | Reasoning summary 展示方式 |
| `personality` | `personality` | 默认交流风格 |
| `pluginsEnabled` | `features.plugins` | 插件可用性 |

仅仅打开 Settings 不会写入未设置的原生 key。每项设置的界面回退值与运行时行为如下。

## Settings 中未设置的值

Codex 首次启动时加载空的用户配置层和打包默认值，不会创建 `config.toml`。打开 Cypheria Settings 只读取 App Server 状态。首次编辑原生配置会创建文件；之后的 `thread/start` 如果有效权限允许编辑工作区，也可能写入项目信任状态。Cypheria 不会把界面默认值批量写入文件。

| 设置 | 原生 key 未设置时的界面显示 | 来源或运行时含义 |
| --- | --- | --- |
| Approval policy | On request | Codex 的 Auto 权限预设在需要提权时请求审批。 |
| Approvals reviewer | User | 符合条件的审批请求交给用户；仅在 On request 时显示。 |
| Sandbox | Workspace write | 对应 Auto 预设。没有版本控制或尚未受信任的目录，可能先以 Read only 启动，直到项目信任状态确定。 |
| Allow network access | 关闭 | 仅适用于 Workspace write，也只在该 sandbox 下显示。 |
| Web search | Cached | 独立的配置偏好；执行时的有效搜索模式可能变化。 |
| Model | `model/list` 中 `isDefault` 的条目 | Cypheria 不硬编码模型 ID。 |
| Reasoning effort | 所选模型的 `defaultReasoningEffort` | 仅当模型元数据不可用时，界面用 Medium 作为显示回退值。 |
| Speed | Standard | 选择 Standard 写入 `service_tier = "default"`；Fast 写入 `"priority"`。读取旧的原生值 `"fast"` 时显示 Fast。 |
| Communication style | personality 功能启用时为 Pragmatic，否则为 None | 功能状态来自 `experimentalFeature/list`；明确设置的 `personality` 优先。 |
| Output detail | Model default | 未设置 `model_verbosity` 时由模型决定详细度。 |
| Reasoning summary | Model default | 未设置 `model_reasoning_summary` 时由 Codex 模型元数据决定，而 `model/list` 不暴露该元数据。明确选择 Auto 才写入 `"auto"`。 |
| Plugins | 当前固定版本的 Codex runtime 默认启用 | 实际功能状态来自 `experimentalFeature/list`；明确修改时写入 `features.plugins`。 |

当前固定版本的 runtime 也默认启用 personality 功能。Settings 页面读取两项功能的实际状态，而非假设它们一直启用。[Codex 的 Auto 预设](https://learn.chatgpt.com/docs/agent-approvals-security#common-sandbox-and-approval-combinations)提供 Workspace write 和 On request 基线；有效权限 catalog 与项目信任状态可能进一步限制它。

`web_search` 与 `sandbox_mode` 是独立设置。配置偏好为 Cached 时，Codex 可在 Full access turn 中选用 Live，但仍受 provider 能力和托管限制约束；Settings 页面继续显示配置偏好。明确设置的 Disabled 和 Indexed 在被允许时维持原模式。对于 reasoning summary，[OpenAI 将 `auto` 记为明确的模式](https://developers.openai.com/api/docs/guides/reasoning)，它不等于未设置。

## 托管要求

Server 在展示 permission choice 前读取 App Server configuration requirements。Allowed approval policies、sandbox modes、web-search modes、reviewers 和 permission profiles 会限制有效 catalog。Managed default permission profile 优先于本地默认值。

客户端必须渲染返回的 catalog，不得展示被禁止的 choice、从原始文件推断 policy，或声称成功写入原生配置即可覆盖管理员托管 requirement。

## Thread 与 turn scope

共享设置是新 Thread 的默认值。Thread 会捕获 harness session 状态，并可接收支持的 model、reasoning、service-tier、working-directory 和 permission selection。启动普通 turn 不会重建 Codex 进程，也不会重新加载所有原生配置字段。

更换 provider 是新建 Thread 的事项。每 turn response format 与临时 context 不会保存为全局默认。存在类型化 App Server request field 时，Server 会优先使用它，而不是依赖无类型 config map。

## Reload 行为

App Server 包含多种生命周期：

- authentication 与共享 catalog 等 process-owned state 可能需要进程重启；
- Thread-owned setting 在 start、resume、fork 或受支持 settings update 时生效；
- MCP、Skill、plugin、App 和 tool catalog 通过各自 integration operation 刷新；
- inference step 的 tool availability 还取决于实时 capability、permission 和 provider state。

因此 configuration reload 不等于替换已有 Thread 的全部状态。客户端使用返回的 capability 与 catalog 数据，而不是预测 hot-reload 行为。

## 原生扩展

Custom provider、permission profile、MCP transport、plugin policy、Apps、Skills、hooks、project trust、shell environment、telemetry 和 experimental features 等高级原生配置继续由 Codex 所有，可通过 harness 支持的流程编辑。

Harness-native Skills、MCP、plugins、marketplaces 和 Apps 通过 Cypheria [Integrations](integrations.zh-CN.md) facade 暴露。Codex permission 展示见 [Codex Permissions](codex-permissions.zh-CN.md)。

带版本的 feature registry、有效状态 API，以及官方 Desktop 客户端实际发送的 feature overrides，见 [Codex feature 默认值与 Desktop overrides](codex-app-server-features.zh-CN.md)。

## 客户端本地排除项

以下内容绝不属于 Codex 配置：

- theme、font、language、density 和 layout；
- window、tray、browser、update 和 OS integration state；
- Sidebar expansion、draft、cache 和 scroll position；
- Server executable 和 auto-start preference。
- `composer.permissionModeVisibility`，它只控制 composer 权限菜单是否显示 Full access。

Desktop 将这些值保存在 Electron 的 `config.json`。
