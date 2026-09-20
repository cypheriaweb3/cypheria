---
title: Cypheria 中的 Codex 配置
---

# Cypheria 中的 Codex 配置

本文只描述 Cypheria 当前实际依赖的 Codex 配置语义，不是完整 Codex 配置百科。准确 App Server 字段仍以生成协议和固定版本的 `@openai/codex` 为准。

## 事实来源

共享 Cypheria 默认值保存在 `$CYPHERIA_HOME/config/config.json` 的 `agents.codex` 下。Cypheria 管理的 Codex 使用 `CODEX_HOME=$CYPHERIA_HOME/codex`，与用户默认 Codex home 隔离。

用户通过 `client.harnesses.codex` 修改受支持设置时，Server 会：

1. 校验并原子更新 Cypheria 配置；
2. 通过 App Server configuration operation 写入对应原生 Codex keys；
3. 在支持时要求 App Server reload user configuration；
4. 返回有效 Cypheria view 与 managed restrictions。

Cypheria 仍是共享产品事实来源。原生 Codex 配置是执行投影，不用于保存 Desktop 外观或其他客户端本地偏好。

## 受支持的共享设置

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
| `showFullAccessInComposer` | `desktop.showFullAccessInComposer` | 是否可以显示高风险 full-access 选项 |

协议允许时，null 表示使用 model 或 provider 默认值。

## 托管要求

Server 在展示 permission choice 前读取 App Server configuration requirements。Allowed approval policies、sandbox modes、web-search modes、reviewers 和 permission profiles 会限制有效 catalog。Managed default permission profile 优先于本地默认值。

客户端必须渲染返回的 catalog，不得展示被禁止的 choice、从原始文件推断 policy，或声称成功写入 Cypheria 即可覆盖管理员托管 requirement。

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

Custom provider、permission profile、MCP transport、plugin policy、Apps、Skills、hooks、project trust、shell environment、telemetry 和 experimental features 等高级原生配置继续由 Server 所有，可通过 harness 支持的流程编辑。除非产品明确依赖，否则不会复制进精简的 Cypheria 共享设置 Schema。

Harness-native Skills、MCP、plugins、marketplaces 和 Apps 通过 Cypheria [Integrations](integrations.zh-CN.md) facade 暴露。Codex permission 展示见 [Codex Permissions](codex-permissions.zh-CN.md)。

## 客户端本地排除项

以下内容绝不属于 Codex 配置：

- theme、font、language、density 和 layout；
- window、tray、browser、update 和 OS integration state；
- Sidebar expansion、draft、cache 和 scroll position；
- Server executable 和 auto-start preference。

Desktop 将这些值保存在 Electron 的 `desktop-settings.json`。
