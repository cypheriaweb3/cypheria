import type { CodexProviderServerMessage, PersistedServerConfig } from "@cypheria/protocol"
import { describe, expect, it, vi } from "vitest"

import type { AgentManager } from "./agent/agent-manager.js"
import { CodexProviderService } from "./codex-provider-service.js"
import type { ServerConfigStore } from "./server-config-store.js"

const config: PersistedServerConfig = {
  agents: {
    codex: { model: null, provider: "openai", reasoningEffort: null, serviceTier: null },
  },
  server: {
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

describe("CodexProviderService", () => {
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
      async (value: { agents: { codex: PersistedServerConfig["agents"]["codex"] } }) => {
        config.agents.codex = value.agents.codex
        return {} as never
      }
    )
    const store = {
      getSnapshot: () => ({ config }),
      patch,
    } as unknown as ServerConfigStore
    const service = new CodexProviderService({ callCodex } as unknown as AgentManager, store)
    const messages: CodexProviderServerMessage[] = []
    await service.handle(
      {
        payload: { refresh: true },
        requestId: "account-1",
        type: "provider.codex.account.get.request",
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
        type: "provider.codex.model-settings.set.request",
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
})
