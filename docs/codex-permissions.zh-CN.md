---
title: Cypheria 中的 Codex Permissions
---

# Cypheria 中的 Codex Permissions

Cypheria 通过通用 Thread interaction 生命周期展示 Codex permissions，同时保留 Codex 原生 sandbox 与 approval 语义。这些权限控制 Codex 代码和 tool 执行；不会替代 Web3 signing policy。

## 配置界面

`client.harnesses.codex.permissions` 暴露：

- approval policy、reviewer、sandbox、network、web search、verbosity 和 reasoning summary 的共享默认值；
- 可针对 working directory 查询的有效 permission catalog；
- 原生 permission profiles 与管理员限制；
- 控制 composer 是否显示 Full access 的偏好。

Server 读取 App Server configuration requirements，并在返回 catalog 前移除不可用 choice。Managed default 会显示为 managed，而不是被重写为本地偏好。

## Composer 选项

Cypheria 把有效 catalog 映射为简洁模式：

| UI 选项 | 含义 |
| --- | --- |
| Read only | 以读取为主的 sandbox；提权时由用户审批 |
| Ask for approval | Workspace sandbox；操作需要更多权限时 Codex 请求用户审批 |
| Approve for me | Workspace sandbox 加可用自动 reviewer；不会扩大 sandbox |
| Full access | Danger-full-access 且无普通 approval gate；只在允许且显式启用时显示 |
| Named profile | App Server 返回的原生 Codex permission profile |
| Managed | 管理员选择的 Server default |
| Custom | 无法用更简洁 Cypheria 标签表示的有效原生组合 |

对于已有 Thread，不改变 selection 会保留 harness-owned state。显式 selection 通过 adapter 支持的类型化 Thread/harness options 发送。

## Approval 生命周期

Codex 对 command execution、file changes、additional permissions、structured user input 和 MCP elicitation 的 reverse request 会被归一化为 `ThreadInteraction` record。Server 向附着于该 Thread 的所有客户端发布 interaction。

只有一个 response 会胜出。客户端发送 allow once、allow for session、deny、selection、answers、elicitation action 或 cancel 等类型化 outcome。Server 把结果返回待处理原生 request，持久化对应 Timeline state，并发布 resolution。一个客户端断开不会代表其他客户端静默批准或拒绝。

## 自动审核

App Server 和 managed requirements 允许时，`auto_review` 或 `guardian_subagent` 可以审核提权 request。Reviewer 可以 allow 或 deny，但不能授予 active sandbox 或 managed permission catalog 之外的权限。

Reviewer progress 与 decision 会显示在会话中。受支持的 Guardian denial 可以通过 `client.harnesses.codex.guardian` 在原 Thread context 中重试。用户可见状态必须区分自动审核与明确用户授权。

## Full access

Full access 可以读取和修改 workspace 外的文件，并在没有普通 approval 的情况下执行带网络访问的命令。只有以下条件全部成立时才会显示：

- App Server requirements 允许内置 danger-full-access profile；
- 允许 danger-full-access sandbox 与 `never` approval policy；
- 用户共享 Cypheria 设置允许在 composer 中显示。

Desktop 在启用显示或选择它之前要求清晰确认。UI 不得为新 Thread 预选 Full access。

## 与 Web3 policy 分离

Codex filesystem、command、network、web-search 和 tool permission 不授权 wallet signing。Codex turn 只能提交 Web3 signing intent。Server 随后独立执行 wallet mode、Web3 policy、payload hashing、approval、signing 和 audit。

同样，Web3 approval 不会扩大 Codex sandbox authority。

## 安全规则

- 不得把缺少 approval response 视为批准。
- 不得提供被 App Server requirements 排除的 choice。
- 自动 reviewer 不得扩大 sandbox 或 Web3 authority。
- 记录 requester、reviewer、selected scope、decision 和 resulting action 的来源。
- 原生 request ID 与 callback 留在 Server。
- Pending interaction 跨客户端导航保留，且只解决一次。
- 展示 harness detail 时不要求客户端消费原始 Codex message。
