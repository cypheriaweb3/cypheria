import type {
  CodexHarnessClientMessage,
  CodexHarnessServerMessage,
  CodexModelSettings,
  CodexPermissionDefaults,
  CodexPermissionDefaultsWrite,
  CodexPermissionsCatalog,
} from "@cypheria/protocol"
import type { v2 } from "@cypheria/protocol/codex-types"

import type { AgentManager } from "./agent/agent-manager.js"
import type { ServerConfigStore } from "./server-config-store.js"
import type { ThreadManager } from "./thread/thread-manager.js"

const builtInProfiles = new Set([":read-only", ":workspace", ":danger-full-access"])

export class CodexHarnessService {
  readonly #agents: AgentManager
  readonly #config: ServerConfigStore
  readonly #threads: ThreadManager

  constructor(agents: AgentManager, config: ServerConfigStore, threads: ThreadManager) {
    this.#agents = agents
    this.#config = config
    this.#threads = threads
  }

  async handle(
    message: CodexHarnessClientMessage,
    send: (message: CodexHarnessServerMessage) => void
  ): Promise<boolean> {
    const respond = (value: unknown): void => {
      send({
        payload: { ok: true, value },
        requestId: message.requestId,
        type: message.type.replace(/\.request$/u, ".response"),
      } as CodexHarnessServerMessage)
    }
    try {
      switch (message.type) {
        case "harness.codex.account.get.request":
          respond(await this.account(message.payload.refresh ?? false))
          break
        case "harness.codex.account.login.request":
          respond(await this.login(message.payload))
          break
        case "harness.codex.account.login.cancel.request": {
          const result = await this.call<v2.CancelLoginAccountResponse>("account/login/cancel", {
            loginId: message.payload.loginId,
          })
          respond({ cancelled: result.status === "canceled" })
          break
        }
        case "harness.codex.account.logout.request":
          await this.call("account/logout")
          respond({ succeeded: true })
          break
        case "harness.codex.model.list.request":
          respond({ models: await this.models(message.payload.includeHidden ?? false) })
          break
        case "harness.codex.model-settings.get.request":
          respond(this.settings())
          break
        case "harness.codex.model-settings.set.request":
          respond(await this.setSettings(message.payload))
          break
        case "harness.codex.permissions.defaults.get.request":
          respond(await this.permissionDefaults())
          break
        case "harness.codex.permissions.defaults.set.request":
          respond(await this.setPermissionDefaults(message.payload))
          break
        case "harness.codex.permissions.catalog.get.request":
          respond(await this.permissionsCatalog(message.payload.cwd))
          break
        case "harness.codex.permissions.show-full-access.set.request":
          respond(await this.setShowFullAccess(message.payload.enabled))
          break
        case "harness.codex.guardian.retry.request":
          await this.callThread("thread/approveGuardianDeniedAction", message.payload)
          respond({ succeeded: true })
          break
        case "harness.codex.account.rate-limits.get.request":
          respond(await this.call("account/rateLimits/read", message.payload))
          break
        case "harness.codex.thread.goal.get.request":
          respond(await this.callThread("thread/goal/get", message.payload))
          break
        case "harness.codex.thread.goal.set.request":
          respond(await this.callThread("thread/goal/set", message.payload))
          break
        case "harness.codex.thread.goal.clear.request":
          respond(await this.callThread("thread/goal/clear", message.payload))
          break
        case "harness.codex.thread.queue.list.request":
          respond(await this.callThread("thread/queue/list", message.payload))
          break
        case "harness.codex.thread.queue.add.request":
          respond(await this.callThread("thread/queue/add", message.payload))
          break
        case "harness.codex.thread.queue.update.request":
          respond(await this.callThread("thread/queue/update", message.payload))
          break
        case "harness.codex.thread.queue.delete.request":
          respond(await this.callThread("thread/queue/delete", message.payload))
          break
        case "harness.codex.thread.queue.reorder.request":
          respond(await this.callThread("thread/queue/reorder", message.payload))
          break
        case "harness.codex.thread.queue.start.request":
          respond(await this.callThread("thread/queue/start", message.payload))
          break
        case "harness.codex.thread.usage.get.request":
          respond(await this.callThread("account/usage/read", message.payload))
          break
        case "harness.codex.thread.background-terminals.list.request":
          respond(await this.callThread("thread/backgroundTerminals/list", message.payload))
          break
        case "harness.codex.thread.background-terminals.terminate.request":
          respond(await this.callThread("thread/backgroundTerminals/terminate", message.payload))
          break
        case "harness.codex.thread.background-terminals.clean.request":
          respond(await this.callThread("thread/backgroundTerminals/clean", message.payload))
          break
        case "harness.codex.thread.compact.request":
          respond(await this.callThread("thread/compact/start", message.payload))
          break
        case "harness.codex.thread.revert.request": {
          const value = await this.callThread("thread/revert", message.payload)
          await this.#threads.resume(String(message.payload.threadId))
          respond(value)
          break
        }
        case "harness.codex.thread.review.start.request":
          respond(await this.callThread("review/start", message.payload))
          break
      }
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      send({
        payload: {
          error: { code: failure.name || "CODEX_HARNESS_ERROR", message: failure.message },
          ok: false,
        },
        requestId: message.requestId,
        type: message.type.replace(/\.request$/u, ".response"),
      } as CodexHarnessServerMessage)
    }
    return true
  }

  async call<Result>(
    method: Parameters<AgentManager["callCodex"]>[0],
    params?: Record<string, unknown>
  ): Promise<Result> {
    return (await this.#agents.callCodex(method, params)) as Result
  }

  async callThread<Result>(
    method: Parameters<AgentManager["callCodex"]>[0],
    input: Record<string, unknown>
  ): Promise<Result> {
    const cypheriaThreadId = String(input.threadId ?? "")
    const thread = await this.#threads.get(cypheriaThreadId)
    if (thread.agentId !== "codex") throw new Error("The requested thread is not a Codex thread")
    if (!thread.agentSessionId) throw new Error("The Codex thread is not bound to App Server")
    const { threadId: _threadId, ...params } = input
    return this.call<Result>(method, { ...params, threadId: thread.agentSessionId })
  }

  async account(refresh: boolean) {
    const response = await this.call<v2.GetAccountResponse>("account/read", {
      refreshToken: refresh,
    })
    return {
      email: response.account?.type === "chatgpt" ? response.account.email : null,
      planType: response.account?.type === "chatgpt" ? String(response.account.planType) : null,
      requiresOpenaiAuth: response.requiresOpenaiAuth,
      type: response.account?.type ?? null,
    }
  }

  async login(input: { apiKey?: string; type: "apiKey" | "chatgpt" | "chatgptDeviceCode" }) {
    const params: v2.LoginAccountParams =
      input.type === "chatgptDeviceCode"
        ? { type: "chatgptDeviceCode" }
        : input.type === "chatgpt"
          ? {
              appBrand: "codex",
              codexStreamlinedLogin: true,
              type: "chatgpt",
              useHostedLoginSuccessPage: true,
            }
          : { apiKey: input.apiKey as string, type: "apiKey" }
    const response = await this.call<v2.LoginAccountResponse>("account/login/start", params)
    if (
      response.type !== "apiKey" &&
      response.type !== "chatgpt" &&
      response.type !== "chatgptDeviceCode"
    ) {
      throw new Error(`Unsupported Codex login response: ${response.type}`)
    }
    return response
  }

  async models(includeHidden: boolean) {
    const models: v2.Model[] = []
    let cursor: string | null = null
    do {
      const response: v2.ModelListResponse = await this.call<v2.ModelListResponse>("model/list", {
        cursor,
        includeHidden,
        limit: 100,
      })
      models.push(...response.data)
      cursor = response.nextCursor
    } while (cursor)
    return models.map((model) => ({
      defaultReasoningEffort: model.defaultReasoningEffort,
      defaultServiceTier: model.defaultServiceTier,
      description: model.description,
      displayName: model.displayName,
      hidden: model.hidden,
      id: model.id,
      inputModalities: model.inputModalities.map(String),
      isDefault: model.isDefault,
      model: model.model,
      reasoningEfforts: model.supportedReasoningEfforts.map((effort) => ({
        description: effort.description,
        value: effort.reasoningEffort,
      })),
      serviceTiers: model.serviceTiers,
    }))
  }

  settings(): CodexModelSettings {
    const { model, provider, reasoningEffort, serviceTier } =
      this.#config.getSnapshot().config.agents.codex
    return { model, provider, reasoningEffort, serviceTier }
  }

  async setSettings(settings: CodexModelSettings): Promise<CodexModelSettings> {
    await this.#config.patch({ agents: { codex: settings } })
    await this.call("config/batchWrite", {
      edits: [
        { keyPath: "model_provider", mergeStrategy: "replace", value: settings.provider },
        { keyPath: "model", mergeStrategy: "replace", value: settings.model },
        {
          keyPath: "model_reasoning_effort",
          mergeStrategy: "replace",
          value: settings.reasoningEffort,
        },
        { keyPath: "service_tier", mergeStrategy: "replace", value: settings.serviceTier },
      ],
      reloadUserConfig: true,
    })
    return this.settings()
  }

  async requirements(): Promise<v2.ConfigRequirements | null> {
    const response = await this.call<v2.ConfigRequirementsReadResponse>("configRequirements/read")
    return response.requirements
  }

  async permissionDefaults(): Promise<CodexPermissionDefaults> {
    const requirements = await this.requirements()
    const snapshot = this.#config.getSnapshot()
    const settings = snapshot.config.agents.codex
    const allowedApprovalPolicies =
      requirements?.allowedApprovalPolicies?.filter(
        (policy): policy is CodexPermissionDefaults["approvalPolicy"] => typeof policy === "string"
      ) ?? null
    return {
      allowedApprovalPolicies,
      allowedSandboxModes: requirements?.allowedSandboxModes ?? null,
      allowedWebSearchModes: requirements?.allowedWebSearchModes ?? null,
      approvalPolicy: settings.approvalPolicy,
      approvalsReviewer: settings.approvalsReviewer,
      configPath: snapshot.path,
      modelReasoningSummary: settings.modelReasoningSummary,
      modelVerbosity: settings.modelVerbosity,
      networkAccess: settings.networkAccess,
      sandboxMode: settings.sandboxMode,
      webSearch: settings.webSearch,
    }
  }

  async setPermissionDefaults(
    settings: CodexPermissionDefaultsWrite
  ): Promise<CodexPermissionDefaults> {
    await this.#config.patch({ agents: { codex: settings } })
    await this.call("config/batchWrite", {
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
    return this.permissionDefaults()
  }

  async permissionsCatalog(cwd?: string): Promise<CodexPermissionsCatalog> {
    const requirements = await this.requirements()
    const profiles: v2.PermissionProfileSummary[] = []
    let cursor: string | null = null
    do {
      const page: v2.PermissionProfileListResponse =
        await this.call<v2.PermissionProfileListResponse>("permissionProfile/list", {
          cursor,
          ...(cwd ? { cwd } : {}),
          limit: 100,
        })
      profiles.push(...page.data)
      cursor = page.nextCursor
    } while (cursor)

    const snapshot = this.#config.getSnapshot()
    const settings = snapshot.config.agents.codex
    const allowedProfile = (id: string): boolean =>
      profiles.find((profile) => profile.id === id)?.allowed ??
      requirements?.allowedPermissionProfiles?.[id] ??
      true
    const defaultProfile = requirements?.defaultPermissions ?? null
    const selected: CodexPermissionsCatalog["selected"] = defaultProfile
      ? { kind: "profile", profileId: defaultProfile }
      : settings.sandboxMode === "read-only"
        ? { agentMode: "read-only", kind: "agent-mode" }
        : settings.sandboxMode === "danger-full-access"
          ? { agentMode: "full-access", kind: "agent-mode" }
          : settings.approvalsReviewer === "auto_review" ||
              settings.approvalsReviewer === "guardian_subagent"
            ? { agentMode: "guardian-approvals", kind: "agent-mode" }
            : { agentMode: "auto", kind: "agent-mode" }
    const allowedReviewers = requirements?.allowedApprovalsReviewers
    const autoReviewAvailable =
      allowedReviewers === null ||
      allowedReviewers === undefined ||
      allowedReviewers.includes("auto_review") ||
      allowedReviewers.includes("guardian_subagent")
    const allowedApproval = (policy: v2.AskForApproval): boolean =>
      requirements?.allowedApprovalPolicies?.some(
        (allowed) => JSON.stringify(allowed) === JSON.stringify(policy)
      ) ?? true
    const userReviewAllowed = requirements?.allowedApprovalsReviewers?.includes("user") ?? true
    const fullAccessAllowed =
      allowedProfile(":danger-full-access") &&
      (requirements?.allowedSandboxModes?.includes("danger-full-access") ?? true) &&
      (requirements?.allowedApprovalPolicies?.includes("never") ?? true)
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
      configPath: snapshot.path,
      fullAccessCanBeShown: fullAccessAllowed,
      profiles: profiles.filter((profile) => !builtInProfiles.has(profile.id)),
      selected,
      showFullAccess: settings.showFullAccessInComposer,
      source: requirements?.defaultPermissions ? "managed" : "config",
    }
  }

  async setShowFullAccess(enabled: boolean): Promise<CodexPermissionsCatalog> {
    await this.#config.patch({ agents: { codex: { showFullAccessInComposer: enabled } } })
    await this.call("config/value/write", {
      keyPath: "desktop.showFullAccessInComposer",
      mergeStrategy: "replace",
      value: enabled,
    })
    return this.permissionsCatalog()
  }
}
