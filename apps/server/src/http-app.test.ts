import pino from "pino"
import { describe, expect, it, vi } from "vitest"

import { AppToolGrants } from "./app-tools/grants.js"
import { loadServerConfig } from "./config.js"
import { createHttpApp, type HttpAppHost } from "./http-app.js"
import type { ConnectionRegistry } from "./session/connection-registry.js"

const SERVER_TOKEN = "server-token-0123456789"

const setup = () => {
  const grants = new AppToolGrants()
  const callAppTool = vi.fn(async () => ({
    content: [{ text: "done", type: "text" as const }],
    isError: false,
  }))
  const host = {
    callAppTool,
    listAppTools: async (_grant: unknown, server: string) =>
      server !== "cypheria_app_tools"
        ? undefined
        : [
            {
              description: "List threads.",
              direct: false,
              inputSchema: { type: "object" },
              name: "list_threads",
            },
          ],
    verifyAppToolToken: (token: string | undefined) => grants.verify(token),
  } as unknown as HttpAppHost
  const app = createHttpApp({
    config: loadServerConfig({ CYPHERIA_SERVER_TOKEN: SERVER_TOKEN }),
    host,
    logger: pino({ enabled: false }),
    registry: {} as ConnectionRegistry,
  })
  return { app, callAppTool, grants }
}

describe("app tools routes", () => {
  it("accept only an app tools token, not the Server token", async () => {
    const { app } = setup()
    for (const authorization of [undefined, `Bearer ${SERVER_TOKEN}`]) {
      const response = await app.request("/api/v1/app-tools/tools", {
        headers: authorization ? { authorization } : {},
      })
      expect(response.status).toBe(401)
    }
  })

  it("list the tools of one plugin server", async () => {
    const { app, grants } = setup()
    const headers = { authorization: `Bearer ${grants.forCodex()}` }
    const response = await app.request("/api/v1/app-tools/tools?server=cypheria_app_tools", {
      headers,
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { tools: { name: string }[] }
    expect(body.tools.map((tool) => tool.name)).toEqual(["list_threads"])
    expect((await app.request("/api/v1/app-tools/tools?server=other", { headers })).status).toBe(
      404
    )
  })

  it("call a tool for the caller the token speaks for", async () => {
    const { app, callAppTool, grants } = setup()
    const response = await app.request("/api/v1/app-tools/call", {
      body: JSON.stringify({
        arguments: { limit: 1 },
        name: "list_threads",
        server: "cypheria_app_tools",
      }),
      headers: {
        authorization: `Bearer ${grants.forThread("thread-1")}`,
        "content-type": "application/json",
      },
      method: "POST",
    })
    expect(await response.json()).toEqual({
      content: [{ text: "done", type: "text" }],
      isError: false,
    })
    expect(callAppTool).toHaveBeenCalledWith(
      { kind: "thread", threadId: "thread-1" },
      { arguments: { limit: 1 }, name: "list_threads", server: "cypheria_app_tools" },
      expect.any(AbortSignal)
    )
  })
})
