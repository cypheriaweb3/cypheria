# Codex Permissions in Cypheria Desktop

This document specifies how Cypheria Desktop exposes Codex permissions through Codex App Server. It does not define a Cypheria permission model and does not add Web3 meaning to Codex permissions.

The design follows the current OpenAI documentation and was checked on 2026-09-08 against the installed ChatGPT Desktop bundle and its bundled `codex-cli 0.153.4`. The generated protocol in `packages/codex-bridge/src/generated` matches that bundled binary except for one repository-only generated `ProfileV2` file.

References: [profiles](https://learn.chatgpt.com/docs/permissions), [sandboxing](https://learn.chatgpt.com/docs/sandboxing?surface=app), [Auto-review](https://learn.chatgpt.com/docs/sandboxing/auto-review), [approvals and security](https://learn.chatgpt.com/docs/agent-approvals-security), [cloud internet access](https://learn.chatgpt.com/docs/cloud/internet-access), and [App Server](https://learn.chatgpt.com/docs/app-server).

## Decision and scope

Codex App Server is the source of truth for permission capabilities, effective organization requirements, profiles, sandbox enforcement, and approval execution. Cypheria owns only the desktop presentation, typed IPC projection, user-choice persistence, and response routing.

Implementation status: Cypheria Desktop now exposes the General permission-visibility controls, user-level `config.toml` defaults without a user/administrator scope selector, cwd-sensitive permission profiles in the composer, method-specific approvals with partial permission grants, and Auto-review lifecycle status.

The composer should expose the same concepts as Codex Desktop:

- Ask for approval.
- Approve for me when Auto-review is available.
- Full access when the user has made it visible and managed requirements permit it.
- Named permission profiles returned by App Server.
- Custom (`config.toml`) when legacy sandbox configuration is active.
- Read only when required by trust, configuration, or managed policy.

This is not a selector for three sandbox modes. A displayed choice resolves to a permission profile or legacy sandbox policy, an approval policy, a reviewer, and runtime workspace roots, all constrained by config requirements.

Codex permission profiles govern local sandboxed command execution. They do not govern Cypheria wallets or signing, web search, connector/MCP configuration, browser or Computer Use controls, Codex cloud environments, or Electron filesystem APIs. Cloud agent internet access has separate environment-level domain and HTTP-method controls. These boundaries must not be merged into the local permissions menu.

## Codex model

Codex has three built-in permission profile IDs:

- `:read-only`
- `:workspace`
- `:danger-full-access`

Users and organizations may define named `[permissions.<id>]` profiles containing filesystem and network rules. Cypheria must treat a profile as an opaque Codex profile: list it with `permissionProfile/list`, display its ID and description, and send the selected ID through `permissions`.

The legacy sandbox modes remain `read-only`, `workspace-write`, and `danger-full-access`. They are needed for custom legacy configuration. Permission profiles and legacy `sandbox_mode` settings do not compose. Cypheria must never send `permissions` together with `sandbox` or `sandboxPolicy`.

The generated `AskForApproval` type is:

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

A granular `false` automatically rejects that prompt category; it is not an implicit grant.

The public automatic reviewer value is `auto_review`. The generated protocol also accepts `guardian_subagent`, which the installed Desktop currently uses as an internal alias. Cypheria should prefer `auto_review`, accept both values from effective state, and derive availability from `allowedApprovalsReviewers`, Auto-review requirements, feature state, and model capability. Auto-review swaps the reviewer; it does not expand the sandbox.

## Composer selection and wire mapping

Use a Codex-shaped internal union:

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
| Named profile | returned profile ID | omitted/inherited | omitted/inherited |
| Custom (`config.toml`) | no `permissions` | resolved legacy value | resolved value |
| Server default / Managed | no override | no override | no override |

The installed Desktop currently maps `guardian-approvals` to `guardian_subagent`; this is protocol compatibility, not a different product mode. Its internal granular preset is also rendered as an Ask for approval variant rather than as a new user-facing permission concept.

Named profiles define the sandbox boundary. Selecting one must not silently overwrite approval or reviewer configuration; omit those overrides when App Server should resolve them.

The menu should show the effective selection, then standard modes, followed by eligible named profiles. Use profile descriptions as secondary text. Show Custom when valid legacy config does not resolve to a standard mode, and Managed/server default when no client-selectable choice remains. Full access requires a confirmation dialog. A local preference may control whether Full access appears, but grants nothing itself.

Codex Desktop wording should be retained:

- Ask for approval: “Always ask to edit external files and use the internet.”
- Approve for me: “Only ask for actions detected as potentially unsafe.”
- Full access: “Unrestricted access to the internet and any file on your computer.”
- Custom: “Uses permissions defined in config.toml.”

## Discovery and resolution

Desktop must advertise `capabilities.experimentalApi` during `initialize`. For every host and selected project `cwd`, Electron main loads:

1. `config/read` for resolved configuration and optional layer provenance.
2. `configRequirements/read` for managed restrictions.
3. Every page of `permissionProfile/list({ cwd })`.
4. Model metadata needed for Auto-review availability or requirements.
5. On native Windows, sandbox readiness and allowed implementations.

The renderer receives a narrow typed catalog, not raw config:

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

Resolution order is: required model/organization selection; current thread effective selection; valid host-local user selection; allowed `defaultPermissions`/`default_permissions`; normal workspace mode; first eligible named profile; read only; server default.

Every result is filtered through `allowedPermissionProfiles`, `defaultPermissions`, `allowedSandboxModes`, `allowedApprovalPolicies`, `allowedApprovalsReviewers`, `autoReview`, and relevant feature/Windows requirements. Managed requirements always win. Invalidate the catalog when cwd, project, host, account/workspace policy, model requirements, or relevant config changes. Profiles are cwd-sensitive because project config layers can alter them.

## Thread and turn integration

For `thread/start`:

- Profile or agent mode sends `permissions`, plus explicit approval policy and reviewer when that mode defines them.
- Custom legacy mode sends `sandbox`, resolved approval policy, and reviewer.
- Server default omits all permission overrides.
- `runtimeWorkspaceRoots` comes only from Electron-main project resolution.

For `turn/start`, use `permissions` for a profile-backed selection or `sandboxPolicy` for custom legacy state, never both. A resumed thread inherits App Server settings when the user has not changed the selector; do not reset it to a composer default.

Use `thread/settings/update` to change the profile/sandbox, approval policy, or reviewer for subsequent turns, then consume `thread/settings/updated` as the effective `ThreadSettings` state. `turn/settings/update` changes only the reviewer of a running turn and cannot move an already pending approval. Do not assume a requested update is the effective state.

### Other App Server execution APIs

App Server permission support does not mean every process API inherits a task's permissions:

- Agent commands inside `turn/start` use the task's effective profile or sandbox policy.
- `command/exec` is separately sandboxed and must receive an explicit `permissionProfile` or `sandboxPolicy` appropriate to that client operation.
- `thread/shellCommand` runs with full host access outside the task sandbox and is only for explicit user-initiated commands.
- Experimental `process/*` also runs outside Codex's sandbox and must not be used as an agent or approval bypass.
- `fs/*` is a direct client filesystem API, not an agent command governed by the selected permission profile.

Cypheria must label any host terminal as full host access and keep it out of automatic agent execution. The normal agent terminal and any sandboxed utility execution should use turn execution or `command/exec`, respectively.

## Typed approval lifecycle

Cypheria implements method-specific Codex approvals rather than a generic accept/decline dialog.

For `item/commandExecution/requestApproval`, render command kind, command, cwd, parsed actions, additional permissions, and a network-specific prompt when `networkApprovalContext` exists. Show only `availableDecisions` when supplied. Exec-policy and network-policy amendments are explicit decisions and must never be confused with accept-once.

For `item/fileChange/requestApproval`, show the associated changes and `grantRoot`, then return only a generated `FileChangeApprovalDecision`.

For `item/permissions/requestApproval`:

- Present filesystem and network requests separately.
- Allow a granted subset, not only all or nothing.
- Return only requested capabilities.
- Support `turn` and `session` scopes.
- Preserve `strictAutoReview` when required.

The broker accepts a filesystem/network subset and validates it at the typed IPC boundary before returning it to App Server.

When Auto-review is active:

- Consume `item/autoApprovalReview/started`, `item/autoApprovalReview/completed`, and `autoApprovalReview/strictReviewRequired` notifications. Current generated TypeScript names still contain `Guardian`.
- Render Reviewing, Approved, Denied, Aborted, or Timed out, plus risk, user-authorization assessment, and rationale when available.
- Do not show a duplicate manual card for a request owned by Auto-review.
- Support `thread/approveGuardianDeniedAction` as a narrow retry for one exact denial.
- Treat review errors, aborts, disconnects, and timeouts as non-approval.

Clear pending UI on `serverRequest/resolved`, turn completion/interruption, thread closure, App Server disconnect/restart, or local timeout. Pending approvals are connection-bound and must not be replayed after reconnect.

## Settings

The Codex settings surface edits Codex configuration rather than creating a parallel format. The Desktop surface exposes the Codex Desktop fields needed for this flow:

- Approval policy.
- Sandbox mode.
- Legacy workspace-write network access.
- Web search, output detail, and reasoning summary defaults shown beside the permission defaults in Codex Desktop.
- Named-profile discovery in the composer and an Open `config.toml` action for settings that Codex represents as TOML rather than a basic control.

Write through `config/value/write` or `config/batchWrite`, then reload config, requirements, and profiles. Never attempt to mutate managed requirements.

## Delivered behavior

Cypheria Desktop now reads the user-level Codex configuration and managed requirements through App Server, discovers cwd-sensitive named profiles, resolves the Codex Desktop modes, and preserves resumed-task inheritance when the user does not change the composer selection. Profile-backed execution uses `permissions`; the provider omits legacy `sandbox`/`sandboxPolicy` in the same request.

The General page controls whether Full access is visible and requires explicit confirmation. The Configuration page writes the corresponding user `config.toml` fields and deliberately has no user/administrator scope selector. The approval broker fails closed, honors decision constraints, supports permission subsets and scopes, reconciles resolved requests, and displays Auto-review state with the exact-denial retry API.

Protocol mapping, config/profile pagination and restrictions, resume inheritance, field mutual exclusion, partial permission grants, broker timeout/close behavior, the live stream, localization, and production builds are covered by automated verification. No Cypheria Web3 permission semantics are added.
