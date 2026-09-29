---
title: Codex Permissions in Cypheria
---

# Codex Permissions in Cypheria

Cypheria presents Codex permissions through the common Thread interaction lifecycle while preserving Codex's native sandbox and approval semantics. These permissions govern Codex code and tool execution; they do not replace Web3 signing policy.

## Configuration surface

Codex-native approval, reviewer, sandbox, network, web-search, verbosity, and reasoning-summary settings remain in the isolated Codex configuration; see [Codex Configuration](codex-app-server-config.md#unset-values-in-settings). The Agent settings page reads and writes that native configuration.

Cypheria separately stores the new-Thread permission selection at `agents.codex.permissionsMode` in `$CYPHERIA_HOME/config/config.json`. Its default is `approve-for-me`. Each Thread then persists one authoritative configuration object containing `model`, `thinking`, `speed`, and `permissionsMode`; later composer changes update that Thread object instead of the Agent defaults.

## Composer choices

The composer always presents exactly four choices:

| UI choice | Description | Codex turn settings |
| --- | --- | --- |
| Ask for approval | Always ask to edit external files and use the internet | `workspace-write`, `on-request`, reviewer `user` |
| Approve for me | Only ask for actions detected as potentially unsafe | `workspace-write`, `on-request`, reviewer `auto_review` |
| Full access | Unrestricted access to the internet and any file on your computer | `danger-full-access`, `never` |
| Agent defaults | Use the permissions configured for the Codex agent | The cwd-aware result of Codex `config/read` |

For a new chat, the selection reads and updates the Server default. For an existing Thread, it reads and updates only the persisted Thread configuration. The composer never rewrites Codex permission defaults. Every Codex create, resume, fork, and turn resolves `config/read` with the current Thread working directory, so `Agent defaults` honors project and worktree configuration layers. Network access is not independently editable in the composer: workspace modes retain the native `sandbox_workspace_write.network_access` value, while `Agent defaults` uses the native sandbox policy.

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
