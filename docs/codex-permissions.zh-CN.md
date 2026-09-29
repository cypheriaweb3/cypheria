---
title: Cypheria 中的 Codex Permissions
---

# Cypheria 中的 Codex Permissions

Cypheria 通过通用 Thread interaction 生命周期展示 Codex permissions，同时保留 Codex 原生 sandbox 与 approval 语义。这些权限控制 Codex 代码和 tool 执行；不会替代 Web3 signing policy。

## 配置界面

Codex 原生 approval、reviewer、sandbox、network、web search、verbosity 和 reasoning summary 设置仍保存在隔离的 Codex 配置中，见 [Codex 配置](codex-app-server-config.zh-CN.md#settings-中未设置的值)。Agent 设置页负责读写这份原生配置。

Cypheria 另在 `$CYPHERIA_HOME/config/config.json` 的 `agents.codex.permissionsMode` 保存新 Thread 的权限选择，默认值为 `approve-for-me`。每个 Thread 随后持久化唯一的权威配置对象，其中包含 `model`、`thinking`、`speed` 和 `permissionsMode`；composer 后续修改只更新该 Thread 对象，不更新 Agent 默认值。

## Composer 选项

Composer 始终只展示四个选项：

| UI 选项 | 描述 | Codex turn 设置 |
| --- | --- | --- |
| Ask for approval | Always ask to edit external files and use the internet | `workspace-write`、`on-request`、reviewer `user` |
| Approve for me | Only ask for actions detected as potentially unsafe | `workspace-write`、`on-request`、reviewer `auto_review` |
| Full access | Unrestricted access to the internet and any file on your computer | `danger-full-access`、`never` |
| Agent defaults | 使用为 Codex Agent 配置的权限 | Codex `config/read` 针对当前 cwd 的结果 |

新 chat 的选择读取并更新 Server 默认值；已有 Thread 则只读取并更新持久化的 Thread 配置。Composer 不会重写 Codex permission defaults。每次 Codex create、resume、fork 和 turn 都使用 Thread 当前工作目录调用 `config/read`，因此 `Agent defaults` 会尊重 project 与 worktree 配置层。Composer 不允许单独修改 network access：workspace 模式保留原生 `sandbox_workspace_write.network_access`，`Agent defaults` 使用原生 sandbox policy。

## Approval 生命周期

Codex 对 command execution、file changes、additional permissions、structured user input 和 MCP elicitation 的 reverse request 会被归一化为 `ThreadInteraction` record。Server 向附着于该 Thread 的所有客户端发布 interaction。

只有一个 response 会胜出。客户端发送 allow once、allow for session、deny、selection、answers、elicitation action 或 cancel 等类型化 outcome。Server 把结果返回待处理原生 request，持久化对应 Timeline state，并发布 resolution。一个客户端断开不会代表其他客户端静默批准或拒绝。

## 自动审核

App Server 和 managed requirements 允许时，`auto_review` 或 `guardian_subagent` 可以审核提权 request。Reviewer 可以 allow 或 deny，但不能授予 active sandbox 或 managed permission catalog 之外的权限。

Reviewer progress 与 decision 会显示在会话中。受支持的 Guardian denial 可以通过 `client.harnesses.codex.guardian` 在原 Thread context 中重试。用户可见状态必须区分自动审核与明确用户授权。

## Full access

Full access 可以读取和修改 workspace 外的文件，并在没有普通 approval gate 的情况下执行带网络访问的命令。它始终作为显式 composer 选项存在，但绝不是内置默认值。

## 与 Web3 policy 分离

Codex filesystem、command、network、web-search 和 tool permission 不授权 wallet signing。Codex turn 只能提交 Web3 signing intent。Server 随后独立执行 wallet mode、Web3 policy、payload hashing、approval、signing 和 audit。

同样，Web3 approval 不会扩大 Codex sandbox authority。

## 安全规则

- 不得把缺少 approval response 视为批准。
- 自动 reviewer 不得扩大 sandbox 或 Web3 authority。
- 记录 requester、reviewer、selected scope、decision 和 resulting action 的来源。
- 原生 request ID 与 callback 留在 Server。
- Pending interaction 跨客户端导航保留，且只解决一次。
- 展示 harness detail 时不要求客户端消费原始 Codex message。
