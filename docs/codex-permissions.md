---
title: Codex Permissions in Cypheria
---

# Codex Permissions in Cypheria

Cypheria presents Codex permissions through the common Thread interaction lifecycle while preserving Codex's native sandbox and approval semantics. These permissions govern Codex code and tool execution; they do not replace Web3 signing policy.

## Configuration surface

Codex-native approval, reviewer, sandbox, network, web-search, verbosity, and reasoning-summary settings remain in the isolated Codex configuration; see [Codex Configuration](codex-app-server-config.md#unset-values-in-settings). The Agent settings page reads and writes that native configuration.

Cypheria separately stores the new-Thread permission selection at `agents.codex.permissionsMode` in `$CYPHERIA_HOME/config/config.json`. Its values are `auto`, `guardian-approvals`, `full-access`, and `agent-config`; the default is `auto`. Each Thread then persists one authoritative configuration object containing `model`, `thinking`, `speed`, and `permissionsMode`; later composer changes update that Thread object instead of the Agent defaults.

## Composer choices

The composer always presents exactly four choices:

| UI choice | `permissionsMode` | Description | Sent to Codex |
| --- | --- | --- | --- |
| Ask for approval | `auto` | Always ask to edit external files and use the internet | `permissions: ":workspace"`, `approvalPolicy: "on-request"`, `approvalsReviewer: "user"` |
| Approve for me | `guardian-approvals` | Only ask for actions detected as potentially unsafe | `permissions: ":workspace"`, `approvalPolicy: "on-request"`, `approvalsReviewer: "guardian_subagent"` |
| Full access | `full-access` | Unrestricted access to the internet and any file on your computer | `permissions: ":danger-full-access"`, `approvalPolicy: "never"`, `approvalsReviewer: "user"` |
| Agent defaults | `agent-config` | Use the permissions configured for the Codex agent | Nothing: Codex applies its own configuration |

The first three values and their wire fields are the ones the official Codex desktop uses; `guardian_subagent` is the reviewer value Codex accepts as an alias of `auto_review`. A built-in profile always travels with its approval settings and the Thread's `runtimeWorkspaceRoots`, and never together with a legacy `sandbox` or `sandboxPolicy`.

For a new chat, the selection reads and updates the Server default. For an existing Thread, it reads and updates only the persisted Thread configuration. The composer never rewrites Codex permission defaults. Every Codex create, resume, fork, and turn states the Thread's `cwd` and `runtimeWorkspaceRoots`, so a Thread that moved to a Git worktree keeps running in the workspace the Server stores.

`Agent defaults` sends no permission field, so project and worktree configuration layers apply as Codex resolves them. Codex has no request that clears a permission override. When a Thread that ran under one of the first three choices switches to `Agent defaults`, the first request after the switch states the values of the Thread's effective `config/read` once; later requests send nothing again. The built-in `:workspace` profile ignores the legacy `[sandbox_workspace_write]` table, so its `network_access` and `writable_roots` apply to `Agent defaults` only. Every mode sets `features.request_permissions_tool`, which lets Codex ask for additional permissions during a turn.

## Approval lifecycle

Codex reverse requests for command execution, file changes, additional permissions, structured user input, and MCP elicitation are normalized into `ThreadInteraction` records. The Server publishes the interaction to all clients attached to the Thread.

Only one response wins. Clients send a typed outcome such as allow once, allow for the session, deny, selection, answers, elicitation action, or cancel. The Server returns it to the pending native request, persists the resulting Timeline state, and publishes resolution. Disconnecting one client does not silently approve or deny on behalf of another.

## Automatic review

When App Server and managed requirements allow it, `auto_review` or `guardian_subagent` can review escalated requests. The reviewer may allow or deny but cannot grant authority outside the active sandbox or managed permission catalog.

Reviewer progress and decisions appear in the conversation. A supported Guardian denial can be retried through `client.harnesses.codex.guardian` with its original Thread context. User-visible status must distinguish an automatic review from explicit user authorization.

## Full access

Full access can read and modify files outside the workspace and execute commands with network access without a normal approval gate. It remains an explicit composer choice and is never the built-in default.

## Separation from Web3 policy

Codex filesystem, command, network, web-search, and tool permissions do not authorize wallet signing. A Codex turn can only submit a Web3 signing intent. The Server then applies wallet mode, Web3 policy, payload hashing, approval, signing, and audit independently.

Likewise, a Web3 approval does not expand Codex sandbox authority.

## Security rules

- Never treat an absent approval response as approval.
- Never let an automatic reviewer widen sandbox or Web3 authority.
- Attribute the requester, reviewer, selected scope, decision, and resulting action.
- Keep native request IDs and callbacks in the Server.
- Preserve pending interactions across client navigation and resolve them exactly once.
- Render harness detail without requiring the client to consume raw Codex messages.
