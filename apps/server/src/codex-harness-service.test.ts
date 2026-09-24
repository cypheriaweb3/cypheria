import type { CodexHarnessServerMessage } from "@cypheria/protocol"
import { describe, expect, it, vi } from "vitest"

import type { AgentManager } from "./agent/agent-manager.js"
import { CodexHarnessService } from "./codex-harness-service.js"
import type { ServerConfigStore } from "./server-config-store.js"
import type { ThreadManager } from "./thread/thread-manager.js"

const store = {
  getSnapshot: () => ({ path: "/tmp/cypheria/config/config.json" }),
  patch: vi.fn(),
} as unknown as ServerConfigStore

describe("CodexHarnessService", () => {
  it("translates Cypheria thread ids before calling native Codex thread methods", async () => {
    const callCodex = vi.fn(async () => ({ goal: null }))
    const get = vi.fn(async () => ({ agentId: "codex", agentSessionId: "native-thread" }))
    const service = new CodexHarnessService({ callCodex } as unknown as AgentManager, store, {
      get,
    } as unknown as ThreadManager)
    const messages: CodexHarnessServerMessage[] = []
    await service.handle(
      {
        payload: { threadId: "cypheria-thread" },
        requestId: "goal-1",
        type: "harness.codex.thread.goal.get.request",
      },
      (message) => messages.push(message)
    )
    expect(callCodex).toHaveBeenCalledWith("thread/goal/get", { threadId: "native-thread" })
    expect(messages[0]).toMatchObject({ payload: { ok: true, value: { goal: null } } })
  })

  it("reads native Codex defaults and writes model settings without changing Server config", async () => {
    const native = {
      approval_policy: "on-request",
      approvals_reviewer: "user",
      model: "gpt-6-sol",
      model_provider: "openai",
      model_reasoning_effort: "medium",
      model_reasoning_summary: null,
      model_verbosity: null,
      sandbox_mode: "workspace-write",
      sandbox_workspace_write: { network_access: false },
      service_tier: "default",
      web_search: "cached",
    }
    const callCodex = vi.fn(
      async (method: string, params?: { edits?: Array<{ keyPath: string; value: unknown }> }) => {
        if (method === "config/read") return { config: native }
        if (method === "experimentalFeature/list")
          return { data: [{ name: "plugins", enabled: true }], nextCursor: null }
        if (method === "config/batchWrite") {
          for (const edit of params?.edits ?? []) {
            if (edit.keyPath === "model") native.model = String(edit.value)
            if (edit.keyPath === "model_reasoning_effort")
              native.model_reasoning_effort = String(edit.value)
          }
        }
        return {}
      }
    )
    const service = new CodexHarnessService(
      { callCodex } as unknown as AgentManager,
      store,
      {} as ThreadManager
    )
    expect(await service.settings()).toMatchObject({
      model: "gpt-6-sol",
      reasoningEffort: "medium",
    })
    native.service_tier = "fast"
    expect(await service.settings()).toMatchObject({ serviceTier: "priority" })
    await service.setSettings({
      model: "gpt-6-astra",
      provider: "openai",
      reasoningEffort: "high",
      serviceTier: "default",
    })
    expect(callCodex).toHaveBeenCalledWith(
      "config/batchWrite",
      expect.objectContaining({
        edits: expect.arrayContaining([
          { keyPath: "model", mergeStrategy: "replace", value: "gpt-6-astra" },
        ]),
        reloadUserConfig: true,
      })
    )
    expect(store.patch).not.toHaveBeenCalled()
    expect(await service.settings()).toMatchObject({
      model: "gpt-6-astra",
      reasoningEffort: "high",
    })

    callCodex.mockClear()
    await service.updateNativeSettings({ pluginsEnabled: false, personality: "pragmatic" })
    expect(callCodex).toHaveBeenCalledWith("config/batchWrite", {
      edits: [
        { keyPath: "features.plugins", mergeStrategy: "replace", value: false },
        { keyPath: "personality", mergeStrategy: "replace", value: "pragmatic" },
      ],
      reloadUserConfig: true,
    })
    expect(callCodex).toHaveBeenCalledWith("experimentalFeature/enablement/set", {
      enablement: { plugins: false },
    })
    callCodex.mockClear()
    await service.updateNativeSettings({ serviceTier: "priority" })
    expect(callCodex).toHaveBeenCalledWith("config/batchWrite", {
      edits: [{ keyPath: "service_tier", mergeStrategy: "replace", value: "priority" }],
      reloadUserConfig: true,
    })
    expect(store.patch).not.toHaveBeenCalled()
  })

  it("uses the Auto preset when native global config keys are unset", async () => {
    const callCodex = vi.fn(async (method: string) => {
      if (method === "config/read")
        return {
          config: {
            approval_policy: null,
            approvals_reviewer: null,
            model: null,
            model_provider: null,
            model_reasoning_effort: null,
            model_reasoning_summary: null,
            model_verbosity: null,
            personality: null,
            sandbox_mode: null,
            sandbox_workspace_write: null,
            service_tier: null,
            web_search: null,
          },
        }
      if (method === "experimentalFeature/list")
        return {
          data: [
            { name: "personality", enabled: true },
            { name: "plugins", enabled: true },
          ],
          nextCursor: null,
        }
      return {}
    })
    const service = new CodexHarnessService(
      { callCodex } as unknown as AgentManager,
      store,
      {} as ThreadManager
    )

    expect(await service.agentSettings()).toMatchObject({
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      networkAccess: false,
      personality: "pragmatic",
      pluginsEnabled: true,
      sandboxMode: "workspace-write",
      serviceTier: null,
      webSearch: null,
    })
    expect(callCodex).not.toHaveBeenCalledWith("config/batchWrite", expect.anything())
  })

  it("derives the permissions menu from Codex config and managed requirements", async () => {
    const callCodex = vi.fn(async (method: string) => {
      if (method === "config/read")
        return {
          config: {
            model: null,
            model_provider: "openai",
            model_reasoning_effort: null,
            service_tier: null,
            approval_policy: "never",
            approvals_reviewer: "user",
            sandbox_mode: "danger-full-access",
            sandbox_workspace_write: { network_access: false },
            web_search: "cached",
            model_verbosity: null,
            model_reasoning_summary: null,
          },
        }
      if (method === "experimentalFeature/list")
        return { data: [{ name: "plugins", enabled: false }], nextCursor: null }
      if (method === "configRequirements/read")
        return {
          requirements: {
            allowedApprovalPolicies: ["on-request", "never"],
            allowedApprovalsReviewers: ["user", "auto_review"],
            allowedPermissionProfiles: null,
            allowedSandboxModes: ["workspace-write", "danger-full-access"],
            allowedWebSearchModes: ["cached", "live"],
            defaultPermissions: null,
          },
        }
      if (method === "permissionProfile/list")
        return {
          data: [
            { allowed: true, description: "Workspace", id: ":workspace" },
            { allowed: true, description: "Team policy", id: "team" },
          ],
          nextCursor: null,
        }
      return {}
    })
    const service = new CodexHarnessService(
      { callCodex } as unknown as AgentManager,
      store,
      {} as ThreadManager
    )
    expect(await service.agentSettings()).toMatchObject({
      pluginsEnabled: false,
      sandboxMode: "danger-full-access",
    })
    expect(await service.permissionsCatalog()).toMatchObject({
      profiles: [{ allowed: true, description: "Team policy", id: "team" }],
      selected: { agentMode: "full-access", kind: "agent-mode" },
    })
    await service.permissionsCatalog("/tmp/project")
    expect(callCodex).toHaveBeenCalledWith("config/read", {
      cwd: "/tmp/project",
      includeLayers: false,
    })
  })
})
