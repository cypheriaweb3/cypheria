import type { CodexPermissionsMode } from "@cypheria/protocol"
import type { v2 } from "@cypheria/protocol/codex-types"

/** The permission fields a Codex `thread/start`, `thread/resume`, `thread/fork`, or `turn/start` carries. */
export type CodexPermissionFields = {
  approvalPolicy?: v2.AskForApproval
  approvalsReviewer?: v2.ApprovalsReviewer
  permissions?: string
  sandboxPolicy?: v2.SandboxPolicy
}

/**
 * Permission fields for each composer mode, as the official Codex desktop sends them. A built-in
 * permission profile always travels together with its approval policy and reviewer, never with a
 * legacy `sandbox` or `sandboxPolicy`.
 *
 * `agent-config` (and an unset mode) sends nothing, so Codex applies `config.toml`.
 * `guardian_subagent` is the reviewer value Codex accepts as an alias of `auto_review`.
 */
export const codexPermissionWire = (
  mode: CodexPermissionsMode | null | undefined
): CodexPermissionFields | null => {
  switch (mode) {
    case "auto":
      return { approvalPolicy: "on-request", approvalsReviewer: "user", permissions: ":workspace" }
    case "guardian-approvals":
      return {
        approvalPolicy: "on-request",
        approvalsReviewer: "guardian_subagent",
        permissions: ":workspace",
      }
    case "full-access":
      return {
        approvalPolicy: "never",
        approvalsReviewer: "user",
        permissions: ":danger-full-access",
      }
    default:
      return null
  }
}

/**
 * Legacy fields derived from the effective `config.toml` of the working directory. They exist for
 * one case only: a Thread that was running under a preset switches to `agent-config`, and the
 * protocol has no way to clear a permission override other than stating the configured values.
 */
export const codexConfiguredPermissions = (native: v2.Config): CodexPermissionFields => {
  const workspace = native.sandbox_workspace_write
  const sandbox = native.sandbox_mode ?? undefined
  const sandboxPolicy: v2.SandboxPolicy | undefined =
    sandbox === "danger-full-access"
      ? { type: "dangerFullAccess" }
      : sandbox === "read-only"
        ? { networkAccess: false, type: "readOnly" }
        : sandbox === "workspace-write"
          ? {
              excludeSlashTmp: workspace?.exclude_slash_tmp ?? false,
              excludeTmpdirEnvVar: workspace?.exclude_tmpdir_env_var ?? false,
              networkAccess: workspace?.network_access ?? false,
              type: "workspaceWrite",
              writableRoots: [...(workspace?.writable_roots ?? [])],
            }
          : undefined
  return {
    ...(native.approval_policy ? { approvalPolicy: native.approval_policy } : {}),
    ...(native.approvals_reviewer ? { approvalsReviewer: native.approvals_reviewer } : {}),
    ...(sandboxPolicy ? { sandboxPolicy } : {}),
  }
}
