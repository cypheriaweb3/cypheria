# Codex Permissions in Cypheria

Cypheria presents Codex permissions through the common Thread interaction lifecycle while preserving Codex's native sandbox and approval semantics. These permissions govern Codex code and tool execution; they do not replace Web3 signing policy.

## Configuration surface

`client.harnesses.codex.permissions` exposes:

- shared defaults for approval policy, reviewer, sandbox, network, web search, verbosity, and reasoning summary;
- the effective permission catalog for an optional working directory;
- native permission profiles and administrator restrictions;
- the preference controlling whether Full access is visible in the composer.

The Server reads App Server configuration requirements and removes unavailable choices before returning the catalog. A managed default is shown as managed rather than rewritten as a local preference.

## Composer choices

Cypheria maps the effective catalog into concise modes:

| UI choice | Meaning |
| --- | --- |
| Read only | Read-oriented sandbox with user approval for escalation |
| Ask for approval | Workspace sandbox; Codex asks the user when an operation needs more authority |
| Approve for me | Workspace sandbox with an available automatic reviewer; it does not widen the sandbox |
| Full access | Danger-full-access with no approval gate; shown only when allowed and explicitly enabled |
| Named profile | A native Codex permission profile returned by App Server |
| Managed | An administrator-selected Server default |
| Custom | A valid native combination without a simpler Cypheria label |

For an existing Thread, leaving the selection unchanged preserves its harness-owned state. A deliberate selection is sent through the typed Thread/harness options supported by the adapter.

## Approval lifecycle

Codex reverse requests for command execution, file changes, additional permissions, structured user input, and MCP elicitation are normalized into `ThreadInteraction` records. The Server publishes the interaction to all clients attached to the Thread.

Only one response wins. Clients send a typed outcome such as allow once, allow for the session, deny, selection, answers, elicitation action, or cancel. The Server returns it to the pending native request, persists the resulting Timeline state, and publishes resolution. Disconnecting one client does not silently approve or deny on behalf of another.

## Automatic review

When App Server and managed requirements allow it, `auto_review` or `guardian_subagent` can review escalated requests. The reviewer may allow or deny but cannot grant authority outside the active sandbox or managed permission catalog.

Reviewer progress and decisions appear in the conversation. A supported Guardian denial can be retried through `client.harnesses.codex.guardian` with its original Thread context. User-visible status must distinguish an automatic review from explicit user authorization.

## Full access

Full access can read and modify files outside the workspace and execute commands with network access without normal approval. It is hidden unless all of these are true:

- App Server requirements allow the built-in danger-full-access profile;
- danger-full-access sandbox and `never` approval policy are allowed;
- the user's shared Cypheria setting permits showing it in the composer.

Desktop requires a clear confirmation before enabling its visibility or selecting it. The UI must not preselect Full access for a new Thread.

## Separation from Web3 policy

Codex filesystem, command, network, web-search, and tool permissions do not authorize wallet signing. A Codex turn can only submit a Web3 signing intent. The Server then applies wallet mode, Web3 policy, payload hashing, approval, signing, and audit independently.

Likewise, a Web3 approval does not expand Codex sandbox authority.

## Security rules

- Never treat an absent approval response as approval.
- Never offer choices excluded by App Server requirements.
- Never let an automatic reviewer widen sandbox or Web3 authority.
- Attribute the requester, reviewer, selected scope, decision, and resulting action.
- Keep native request IDs and callbacks in the Server.
- Preserve pending interactions across client navigation and resolve them exactly once.
- Render harness detail without requiring the client to consume raw Codex messages.
