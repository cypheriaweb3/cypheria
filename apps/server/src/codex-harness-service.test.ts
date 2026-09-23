import {
  type CodexHarnessServerMessage,
  DEFAULT_GIT_SETTINGS,
  type PersistedServerConfig,
} from "@cypheria/protocol"
import { describe, expect, it, vi } from "vitest"

import type { AgentManager } from "./agent/agent-manager.js"
import { CodexHarnessService } from "./codex-harness-service.js"
import type { ServerConfigStore } from "./server-config-store.js"
import type { ThreadManager } from "./thread/thread-manager.js"

const threads = {} as ThreadManager

const config: PersistedServerConfig = {
  git: DEFAULT_GIT_SETTINGS,
  agents: {
    codex: {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      model: null,
      modelReasoningSummary: null,
      modelVerbosity: null,
      networkAccess: true,
      provider: "openai",
      reasoningEffort: null,
      sandboxMode: "workspace-write",
      serviceTier: null,
      showFullAccessInComposer: false,
      webSearch: null,
    },
    defaults: {},
  },
  server: {
    logging: { level: "info", file: { level: "info", rotate: { maxSizeMb: 10, maxFiles: 3 } } },
    cors: { allowedOrigins: [] },
    limits: { maxMessageBytes: 1024 },
    listen: { host: "127.0.0.1", port: 6768 },
    relay: { enabled: false, publicUseTls: true, useTls: true },
    sessions: { helloTimeoutMs: 1000, reconnectGraceMs: 1000 },
    shutdownTimeoutMs: 1000,
    webApp: { enabled: false },
  },
  version: 1,
}

describe("CodexHarnessService", () => {
  it("translates Cypheria thread ids before calling native Codex thread methods", async () => {
    const callCodex = vi.fn(async () => ({ goal: null }))
    const get = vi.fn(async () => ({
      agentId: "codex",
      agentSessionId: "native-codex-thread",
    }))
    const store = { getSnapshot: () => ({ config }) } as unknown as ServerConfigStore
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

    expect(get).toHaveBeenCalledWith("cypheria-thread")
    expect(callCodex).toHaveBeenCalledWith("thread/goal/get", {
      threadId: "native-codex-thread",
    })
    expect(messages[0]).toMatchObject({ payload: { ok: true, value: { goal: null } } })
  })

  it("projects account state and persists model settings in Cypheria config", async () => {
    const callCodex = vi.fn(async (method: string) => {
      if (method === "account/read") {
        return {
          account: { email: "me@example.com", planType: "pro", type: "chatgpt" },
          requiresOpenaiAuth: true,
        }
      }
      return {}
    })
    const patch = vi.fn(
      async (value: { agents: { codex: Partial<PersistedServerConfig["agents"]["codex"]> } }) => {
        config.agents.codex = { ...config.agents.codex, ...value.agents.codex }
        return {} as never
      }
    )
    const store = {
      getSnapshot: () => ({ config }),
      patch,
    } as unknown as ServerConfigStore
    const service = new CodexHarnessService(
      { callCodex } as unknown as AgentManager,
      store,
      threads
    )
    const messages: CodexHarnessServerMessage[] = []
    await service.handle(
      {
        payload: { refresh: true },
        requestId: "account-1",
        type: "harness.codex.account.get.request",
      },
      (message) => messages.push(message)
    )
    expect(messages[0]).toMatchObject({
      payload: { ok: true, value: { email: "me@example.com", type: "chatgpt" } },
    })

    await service.handle(
      {
        payload: {
          model: "gpt-6-codex",
          provider: "openai",
          reasoningEffort: "high",
          serviceTier: null,
        },
        requestId: "settings-1",
        type: "harness.codex.model-settings.set.request",
      },
      (message) => messages.push(message)
    )
    expect(patch).toHaveBeenCalledWith({
      agents: {
        codex: {
          model: "gpt-6-codex",
          provider: "openai",
          reasoningEffort: "high",
          serviceTier: null,
        },
      },
    })
    expect(callCodex).toHaveBeenCalledWith("config/batchWrite", expect.any(Object))
  })

  it("persists permission defaults and projects the permissions catalog", async () => {
    const callCodex = vi.fn(async (method: string) => {
      if (method === "configRequirements/read") {
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
      }
      if (method === "permissionProfile/list") {
        return {
          data: [
            { allowed: true, description: "Workspace", id: ":workspace" },
            { allowed: true, description: "Team policy", id: "team" },
          ],
          nextCursor: null,
        }
      }
      return {}
    })
    const patch = vi.fn(
      async (value: { agents: { codex: Partial<typeof config.agents.codex> } }) => {
        config.agents.codex = { ...config.agents.codex, ...value.agents.codex }
        return {} as never
      }
    )
    const store = {
      getSnapshot: () => ({ config, path: "/tmp/cypheria/config/config.json" }),
      patch,
    } as unknown as ServerConfigStore
    const service = new CodexHarnessService(
      { callCodex } as unknown as AgentManager,
      store,
      threads
    )
    const messages: CodexHarnessServerMessage[] = []
    await service.handle(
      {
        payload: {
          approvalPolicy: "never",
          approvalsReviewer: "auto_review",
          modelReasoningSummary: "concise",
          modelVerbosity: "high",
          networkAccess: false,
          sandboxMode: "danger-full-access",
          webSearch: "live",
        },
        requestId: "permissions-1",
        type: "harness.codex.permissions.defaults.set.request",
      },
      (message) => messages.push(message)
    )
    await service.handle(
      {
        payload: {},
        requestId: "catalog-1",
        type: "harness.codex.permissions.catalog.get.request",
      },
      (message) => messages.push(message)
    )
    expect(patch).toHaveBeenCalledWith(
      expect.objectContaining({
        agents: { codex: expect.objectContaining({ sandboxMode: "danger-full-access" }) },
      })
    )
    expect(messages.at(-1)).toMatchObject({
      payload: {
        ok: true,
        value: {
          profiles: [{ allowed: true, description: "Team policy", id: "team" }],
          selected: { agentMode: "full-access", kind: "agent-mode" },
        },
      },
    })
  })
})
