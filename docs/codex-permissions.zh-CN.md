# Cypheria Desktop 中的 Codex Permissions

本文定义 Cypheria Desktop 如何通过 Codex App Server 暴露 Codex permissions。它不定义 Cypheria 自己的权限模型，也不向 Codex permissions 添加任何 Web3 语义。

本设计依据当前 OpenAI 官方文档，并于 2026-09-08 对照了本机 ChatGPT Desktop 应用包及其内置 `codex-cli 0.153.4`。除仓库中额外存在一个生成的 `ProfileV2` 文件外，`packages/codex-bridge/src/generated` 与该 binary 生成的协议一致。

参考资料：[permission profiles](https://learn.chatgpt.com/docs/permissions)、[sandboxing](https://learn.chatgpt.com/docs/sandboxing?surface=app)、[Auto-review](https://learn.chatgpt.com/docs/sandboxing/auto-review)、[approvals and security](https://learn.chatgpt.com/docs/agent-approvals-security)、[cloud internet access](https://learn.chatgpt.com/docs/cloud/internet-access) 与 [App Server](https://learn.chatgpt.com/docs/app-server)。

## 决策与范围

Codex App Server 是 permission capabilities、有效组织要求、profiles、sandbox enforcement 与 approval execution 的事实来源。Cypheria 只负责 Desktop 展示、typed IPC projection、用户选择持久化与 response routing。

实现状态：Cypheria Desktop 现已提供“常规”页 permission 可见性开关、没有用户/管理员范围选择器的用户级 `config.toml` 默认设置、Composer 中按 cwd 发现的 permission profiles、支持部分权限授予的方法特定 approvals，以及 Auto-review 生命周期状态。

Composer 应暴露与 Codex Desktop 相同的概念：

- Ask for approval。
- Auto-review 可用时的 Approve for me。
- 用户已允许展示且 managed requirements 允许时的 Full access。
- App Server 返回的 named permission profiles。
- Legacy sandbox configuration 生效时的 Custom (`config.toml`)。
- 因 trust、configuration 或 managed policy 而需要的 Read only。

这不是三个 sandbox mode 的 selector。每个展示 choice 都会解析为 permission profile 或 legacy sandbox policy、approval policy、reviewer 与 runtime workspace roots，并受 config requirements 约束。

Codex permission profiles 只管理本机 sandboxed command execution。它们不管理 Cypheria 钱包或签名、web search、connector/MCP configuration、browser/Computer Use controls、Codex cloud environments 或 Electron filesystem APIs。Cloud agent internet access 使用独立的 environment-level domain 与 HTTP-method controls。这些边界不能并入本机 permissions menu。

## Codex 模型

Codex 有三个内置 permission profile ID：

- `:read-only`
- `:workspace`
- `:danger-full-access`

用户和组织可以定义包含 filesystem 与 network rules 的 `[permissions.<id>]` named profiles。Cypheria 必须把 profile 当作 opaque Codex profile：通过 `permissionProfile/list` 列出，展示 ID 与 description，再通过 `permissions` 原样传回所选 ID。

Legacy sandbox modes 仍是 `read-only`、`workspace-write` 与 `danger-full-access`，用于 custom legacy configuration。Permission profiles 与 legacy `sandbox_mode` settings 不会组合。Cypheria 绝不能同时发送 `permissions` 与 `sandbox` 或 `sandboxPolicy`。

生成的 `AskForApproval` 类型为：

```ts
type AskForApproval =
  | "untrusted"
  | "on-request"
  | "never"
  | {
      granular: {
        sandbox_approval: boolean
        rules: boolean
        skill_approval: boolean
        request_permissions: boolean
        mcp_elicitations: boolean
      }
    }
```

Granular 中的 `false` 表示自动拒绝该 prompt category，并非隐式授权。

Automatic reviewer 的公开值是 `auto_review`。生成协议还接受 `guardian_subagent`，本机 Desktop 当前把它作为 internal alias 使用。Cypheria 应优先发送 `auto_review`，接受 effective state 中的两个值，并根据 `allowedApprovalsReviewers`、Auto-review requirements、feature state 与 model capability 判断可用性。Auto-review 只替换 reviewer，不扩大 sandbox。

## Composer selection 与 wire mapping

使用与 Codex 一致的 internal union：

```ts
type CodexPermissionSelection =
  | {
      kind: "agent-mode"
      agentMode:
        | "read-only"
        | "auto"
        | "granular"
        | "guardian-approvals"
        | "full-access"
    }
  | { kind: "profile"; profileId: string }
  | { kind: "custom" }
  | { kind: "server-default" }
```

| UI choice | `permissions` | approval policy | reviewer |
| --- | --- | --- | --- |
| Read only | `:read-only` | `on-request` | `user` |
| Ask for approval | `:workspace` | `on-request` | `user` |
| Approve for me | `:workspace` | `on-request` | `auto_review` |
| Full access | `:danger-full-access` | `never` | `user` |
| Named profile | 返回的 profile ID | 省略/继承 | 省略/继承 |
| Custom (`config.toml`) | 不发送 `permissions` | resolved legacy value | resolved value |
| Server default / Managed | 不发送 override | 不发送 override | 不发送 override |

本机 Desktop 当前把 `guardian-approvals` 映射为 `guardian_subagent`；这是 protocol compatibility，不是另一个 product mode。其 internal granular preset 也显示为 Ask for approval variant，而不是新的用户权限概念。

Named profiles 定义 sandbox boundary。选择 named profile 时不能静默覆盖 approval 或 reviewer configuration；应在需要 App Server 解析时省略这些 overrides。

Menu 应展示 effective selection，然后依次展示 standard modes 与 eligible named profiles，并把 profile description 用作 secondary text。有效 legacy config 不等于标准模式时展示 Custom；没有 client-selectable choice 时展示 Managed/server default。选择 Full access 必须弹出 confirmation。可以用本地 preference 控制是否显示 Full access，但该 preference 本身不授权任何能力。

保留 Codex Desktop 文案：

- Ask for approval：“Always ask to edit external files and use the internet.”
- Approve for me：“Only ask for actions detected as potentially unsafe.”
- Full access：“Unrestricted access to the internet and any file on your computer.”
- Custom：“Uses permissions defined in config.toml.”

## Discovery 与解析

Desktop 必须在 `initialize` 时声明 `capabilities.experimentalApi`。针对每个 host 与 selected project `cwd`，Electron main 加载：

1. `config/read`，获得 resolved configuration 与可选 layer provenance。
2. `configRequirements/read`，获得 managed restrictions。
3. `permissionProfile/list({ cwd })` 的全部分页。
4. 判断 Auto-review availability 或 requirements 所需的 model metadata。
5. Native Windows 下的 sandbox readiness 与 allowed implementations。

Renderer 接收 narrow typed catalog，而不是 raw config：

```ts
type CodexPermissionsCatalog = {
  available: CodexPermissionSelection[]
  selected: CodexPermissionSelection
  required: CodexPermissionSelection | null
  profiles: Array<{ id: string; description: string | null; allowed: boolean }>
  fullAccessCanBeShown: boolean
  autoReviewAvailable: boolean
  source: "selection" | "config" | "managed" | "server-default"
}
```

解析顺序为：model/organization required selection；current thread effective selection；仍有效的 host-local user selection；允许的 `defaultPermissions`/`default_permissions`；normal workspace mode；第一个 eligible named profile；Read only；server default。

每个结果都必须经过 `allowedPermissionProfiles`、`defaultPermissions`、`allowedSandboxModes`、`allowedApprovalPolicies`、`allowedApprovalsReviewers`、`autoReview` 及相关 feature/Windows requirements 过滤。Managed requirements 永远优先。当 cwd、project、host、account/workspace policy、model requirements 或相关 config 改变时重新加载 catalog。Profiles 对 cwd 敏感，因为 project config layers 可以修改它们。

## Thread 与 turn 接入

对 `thread/start`：

- Profile 或 agent mode 发送 `permissions`；该 mode 明确定义时，同时发送 approval policy 与 reviewer。
- Custom legacy mode 发送 `sandbox`、resolved approval policy 与 reviewer。
- Server default 省略全部 permission overrides。
- `runtimeWorkspaceRoots` 只能来自 Electron-main project resolution。

对 `turn/start`，profile-backed selection 使用 `permissions`，custom legacy state 使用 `sandboxPolicy`，绝不同时发送。用户未改变 selector 时，resumed thread 继承 App Server settings，不能被 composer default 重置。

使用 `thread/settings/update` 修改 subsequent turns 的 profile/sandbox、approval policy 或 reviewer，并消费 `thread/settings/updated` 作为有效 `ThreadSettings` state。`turn/settings/update` 只改变 running turn 的 reviewer，不能迁移已经 pending 的 approval。不能把 requested update 当作 effective state。

### 其他 App Server execution APIs

App Server 支持 permissions，不代表每个 process API 都继承 task permissions：

- `turn/start` 内的 agent commands 使用 task 的 effective profile 或 sandbox policy。
- `command/exec` 单独受 sandbox 保护，必须针对该 client operation 传入合适的 `permissionProfile` 或 `sandboxPolicy`。
- `thread/shellCommand` 在 task sandbox 外以完整 host access 运行，只能用于用户显式发起的命令。
- Experimental `process/*` 同样运行在 Codex sandbox 外，不能用作 agent 或 approval bypass。
- `fs/*` 是 direct client filesystem API，不是受 selected permission profile 管理的 agent command。

Cypheria 必须把任何 host terminal 明确标记为 full host access，并禁止 automatic agent execution 使用它。正常 agent terminal 与 sandboxed utility execution 应分别走 turn execution 或 `command/exec`。

## Typed approval lifecycle

Cypheria 实现 method-specific Codex approvals，而不是通用 accept/decline dialog。

处理 `item/commandExecution/requestApproval` 时，展示 command kind、command、cwd、parsed actions、additional permissions；存在 `networkApprovalContext` 时使用 network-specific prompt。Server 提供 `availableDecisions` 时只能展示这些 decisions。Exec-policy 与 network-policy amendments 是独立 decision，不能与 accept-once 混淆。

处理 `item/fileChange/requestApproval` 时，展示关联 changes 与 `grantRoot`，并只返回生成的 `FileChangeApprovalDecision`。

处理 `item/permissions/requestApproval` 时：

- 分开展示 filesystem 与 network requests。
- 允许批准 subset，而不只是全选或全拒。
- 只返回请求过的 capabilities。
- 支持 `turn` 与 `session` scopes。
- 需要时保留 `strictAutoReview`。

Broker 接受 filesystem/network subset，并在 typed IPC boundary 校验后再返回 App Server。

Auto-review active 时：

- 消费 `item/autoApprovalReview/started`、`item/autoApprovalReview/completed` 与 `autoApprovalReview/strictReviewRequired` notifications；当前生成的 TypeScript names 仍包含 `Guardian`。
- 展示 Reviewing、Approved、Denied、Aborted 或 Timed out，以及存在时的 risk、user-authorization assessment 与 rationale。
- 不为 Auto-review 正在处理的 request 重复展示 manual card。
- 支持 `thread/approveGuardianDeniedAction`，只重试一条 exact denial。
- Review error、abort、disconnect 与 timeout 一律视为未批准。

在 `serverRequest/resolved`、turn completion/interruption、thread closure、App Server disconnect/restart 或 local timeout 时清理 pending UI。Pending approvals 绑定当前 connection，reconnect 后不得重放。

## Settings

Codex settings surface 修改 Codex configuration，而不是创造平行格式。Desktop 暴露此流程所需的 Codex Desktop 字段：

- Approval policy。
- Sandbox mode。
- Legacy workspace-write network access。
- Codex Desktop 在 permission defaults 旁展示的 Web search、output detail 与 reasoning summary defaults。
- Composer 中的 named-profile discovery，以及供 Codex 以 TOML 表示、而非基础控件表示的设置使用的 Open `config.toml` action。

通过 `config/value/write` 或 `config/batchWrite` 写入，然后重新加载 config、requirements 与 profiles。绝不能尝试修改 managed requirements。

## 已交付行为

Cypheria Desktop 现在通过 App Server 读取用户级 Codex configuration 与 managed requirements，发现对 cwd 敏感的 named profiles，解析 Codex Desktop modes，并在用户未改变 composer selection 时保留 resumed-task inheritance。Profile-backed execution 使用 `permissions`；provider 不会在同一 request 中再发送 legacy `sandbox`/`sandboxPolicy`。

General 页面控制 Full access 是否可见，并要求显式确认。Configuration 页面写入对应的用户 `config.toml` 字段，并且按产品要求不提供 user/administrator scope selector。Approval broker fail closed、遵守 decision constraints、支持 permission subsets 与 scopes、协调 resolved requests，并展示 Auto-review state 与 exact-denial retry API。

Protocol mapping、config/profile pagination 与 restrictions、resume inheritance、field mutual exclusion、partial permission grants、broker timeout/close behavior、live stream、localization 与 production builds 均有自动化验证。没有加入任何 Cypheria Web3 permission 语义。
