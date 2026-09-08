import type { CodexAppServerBridge, v2 } from "@cypheria/codex-bridge"
import type {
  CodexPermissionDefaults,
  CodexPermissionDefaultsWrite,
  CodexPermissionsCatalog,
} from "../../ipc/src/index.js"
import { getCodexConfigPath } from "./appearance-config.js"

const builtInProfiles = new Set([":read-only", ":workspace", ":danger-full-access"])

const stringApprovalPolicy = (
  value: v2.AskForApproval | null
): CodexPermissionDefaults["approvalPolicy"] => (typeof value === "string" ? value : "on-request")

const desktopBoolean = (desktop: v2.Config["desktop"], key: string, fallback: boolean): boolean =>
  typeof desktop?.[key] === "boolean" ? desktop[key] : fallback

export const readCodexPermissionDefaults = async (
  bridge: CodexAppServerBridge,
  codexHome: string
): Promise<CodexPermissionDefaults> => {
  const [{ config }, { requirements }] = await Promise.all([
    bridge.request<"config/read", v2.ConfigReadResponse>("config/read", { includeLayers: false }),
    bridge.request<"configRequirements/read", v2.ConfigRequirementsReadResponse>(
      "configRequirements/read",
      undefined
    ),
  ])
  const allowedApprovalPolicies =
    requirements?.allowedApprovalPolicies?.filter(
      (policy): policy is CodexPermissionDefaults["approvalPolicy"] => typeof policy === "string"
    ) ?? null
  return {
    allowedApprovalPolicies,
    allowedSandboxModes: requirements?.allowedSandboxModes ?? null,
    allowedWebSearchModes: requirements?.allowedWebSearchModes ?? null,
    approvalPolicy: stringApprovalPolicy(config.approval_policy),
    approvalsReviewer: config.approvals_reviewer ?? "user",
    configPath: getCodexConfigPath(codexHome),
    modelReasoningSummary: config.model_reasoning_summary,
    modelVerbosity: config.model_verbosity,
    networkAccess: config.sandbox_workspace_write?.network_access ?? true,
    sandboxMode: config.sandbox_mode ?? "workspace-write",
    webSearch: config.web_search,
  }
}

export const writeCodexPermissionDefaults = async (
  bridge: CodexAppServerBridge,
  codexHome: string,
  settings: CodexPermissionDefaultsWrite
): Promise<CodexPermissionDefaults> => {
  await bridge.request<"config/batchWrite", v2.ConfigWriteResponse>("config/batchWrite", {
    edits: [
      { keyPath: "approval_policy", mergeStrategy: "replace", value: settings.approvalPolicy },
      {
        keyPath: "approvals_reviewer",
        mergeStrategy: "replace",
        value: settings.approvalsReviewer,
      },
      { keyPath: "sandbox_mode", mergeStrategy: "replace", value: settings.sandboxMode },
      {
        keyPath: "sandbox_workspace_write.network_access",
        mergeStrategy: "replace",
        value: settings.networkAccess,
      },
      { keyPath: "web_search", mergeStrategy: "replace", value: settings.webSearch },
      {
        keyPath: "model_verbosity",
        mergeStrategy: "replace",
        value: settings.modelVerbosity,
      },
      {
        keyPath: "model_reasoning_summary",
        mergeStrategy: "replace",
        value: settings.modelReasoningSummary,
      },
    ],
    reloadUserConfig: true,
  })
  return readCodexPermissionDefaults(bridge, codexHome)
}

export const writeShowFullAccess = async (
  bridge: CodexAppServerBridge,
  enabled: boolean
): Promise<void> => {
  await bridge.request<"config/value/write", v2.ConfigWriteResponse>("config/value/write", {
    keyPath: "desktop.showFullAccessInComposer",
    mergeStrategy: "replace",
    value: enabled,
  })
}

export const listCodexPermissions = async (
  bridge: CodexAppServerBridge,
  codexHome: string,
  cwd?: string
): Promise<CodexPermissionsCatalog> => {
  const [configResponse, requirementsResponse] = await Promise.all([
    bridge.request<"config/read", v2.ConfigReadResponse>("config/read", { includeLayers: false }),
    bridge.request<"configRequirements/read", v2.ConfigRequirementsReadResponse>(
      "configRequirements/read",
      undefined
    ),
  ])
  const profiles: v2.PermissionProfileSummary[] = []
  let cursor: string | null = null
  do {
    const page: v2.PermissionProfileListResponse = await bridge.request<
      "permissionProfile/list",
      v2.PermissionProfileListResponse
    >("permissionProfile/list", { cursor, cwd, limit: 100 })
    profiles.push(...page.data)
    cursor = page.nextCursor
  } while (cursor)

  const config = configResponse.config
  const requirements = requirementsResponse.requirements
  const showFullAccess = desktopBoolean(config.desktop, "showFullAccessInComposer", false)
  const allowedProfile = (id: string) =>
    profiles.find((profile) => profile.id === id)?.allowed ??
    requirements?.allowedPermissionProfiles?.[id] ??
    true
  const configuredDefault = config.default_permissions
  const defaultProfile =
    requirements?.defaultPermissions ??
    (typeof configuredDefault === "string" ? configuredDefault : null)
  const sandboxMode = config.sandbox_mode ?? "workspace-write"
  const selected: CodexPermissionsCatalog["selected"] = defaultProfile
    ? { kind: "profile", profileId: defaultProfile }
    : sandboxMode === "read-only"
      ? { agentMode: "read-only", kind: "agent-mode" }
      : sandboxMode === "danger-full-access"
        ? { agentMode: "full-access", kind: "agent-mode" }
        : config.approvals_reviewer === "auto_review" ||
            config.approvals_reviewer === "guardian_subagent"
          ? { agentMode: "guardian-approvals", kind: "agent-mode" }
          : { agentMode: "auto", kind: "agent-mode" }

  const allowedReviewers = requirements?.allowedApprovalsReviewers
  const autoReviewAvailable =
    allowedReviewers === null ||
    allowedReviewers === undefined ||
    allowedReviewers.includes("auto_review") ||
    allowedReviewers.includes("guardian_subagent")
  const fullAccessAllowed =
    allowedProfile(":danger-full-access") &&
    (requirements?.allowedSandboxModes?.includes("danger-full-access") ?? true) &&
    (requirements?.allowedApprovalPolicies?.includes("never") ?? true)
  const allowedApproval = (policy: v2.AskForApproval) =>
    requirements?.allowedApprovalPolicies?.some(
      (allowed) => JSON.stringify(allowed) === JSON.stringify(policy)
    ) ?? true
  const userReviewAllowed = requirements?.allowedApprovalsReviewers?.includes("user") ?? true
  const availableAgentModes: CodexPermissionsCatalog["availableAgentModes"] = []
  if (allowedProfile(":read-only") && allowedApproval("on-request") && userReviewAllowed) {
    availableAgentModes.push("read-only")
  }
  if (allowedProfile(":workspace") && allowedApproval("on-request") && userReviewAllowed) {
    availableAgentModes.push("auto")
  }
  if (allowedProfile(":workspace") && allowedApproval("on-request") && autoReviewAvailable) {
    availableAgentModes.push("guardian-approvals")
  }
  if (fullAccessAllowed) availableAgentModes.push("full-access")

  return {
    autoReviewAvailable,
    availableAgentModes,
    configPath: getCodexConfigPath(codexHome),
    fullAccessCanBeShown: fullAccessAllowed,
    profiles: profiles.filter((profile) => !builtInProfiles.has(profile.id)),
    selected,
    showFullAccess,
    source: requirements?.defaultPermissions ? "managed" : "config",
  }
}
