import type { MagpieServerMessage } from "@cypheria/protocol"
import { describe, expect, it, vi } from "vitest"

import { createMagpieActions } from "./magpie.ts"
import type { ServerClient } from "./server-client.js"

const view = {
  config: { apiPort: 3446, enabled: true, gatewayPort: 3445 },
  error: null,
  gatewayUrl: "http://127.0.0.1:3445",
  installedVersion: "0.1.571-cypheria",
  startedAt: "2026-10-01T00:00:00.000Z",
  status: "ready",
  version: "0.1.571-cypheria",
}

const replying = (value: unknown) =>
  vi.fn(
    async (type: string): Promise<MagpieServerMessage> =>
      ({
        payload: { ok: true, value },
        requestId: "r1",
        type: type.replace(/\.request$/, ".response"),
      }) as MagpieServerMessage
  )

describe("Magpie client", () => {
  it("asks the Server for magpie's status", async () => {
    const requestMagpie = replying(view)
    const actions = createMagpieActions({ requestMagpie } as unknown as ServerClient)
    expect((await actions.getStatus()).gatewayUrl).toBe("http://127.0.0.1:3445")
    expect(requestMagpie).toHaveBeenCalledWith("magpie.status.get.request", {}, undefined)
  })

  it("turns magpie on through its config", async () => {
    const requestMagpie = replying(view)
    const actions = createMagpieActions({ requestMagpie } as unknown as ServerClient)
    await actions.setConfig({ enabled: true })
    expect(requestMagpie).toHaveBeenCalledWith(
      "magpie.config.set.request",
      { patch: { enabled: true } },
      undefined
    )
  })

  it("sets an Agent's field by its Cypheria id", async () => {
    const requestMagpie = replying({ agents: [] })
    const actions = createMagpieActions({ requestMagpie } as unknown as ServerClient)
    await actions.setAgentField("grok-build", "model", "group/fast")
    expect(requestMagpie).toHaveBeenCalledWith(
      "magpie.agent.set.request",
      { agentId: "grok-build", field: "model", value: "group/fast" },
      undefined
    )
  })

  it("throws the Server's error", async () => {
    const requestMagpie = vi.fn(async () => ({
      payload: {
        error: { code: "MAGPIE_NOT_RUNNING", message: "magpie is not running" },
        ok: false,
      },
      requestId: "r1",
      type: "magpie.providers.list.response",
    }))
    const actions = createMagpieActions({ requestMagpie } as unknown as ServerClient)
    await expect(actions.listProviders()).rejects.toMatchObject({
      message: "magpie is not running",
      name: "MAGPIE_NOT_RUNNING",
    })
  })
})
