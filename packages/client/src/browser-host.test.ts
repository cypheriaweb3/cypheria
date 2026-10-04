import type { BrowserAutomationRequest, ServerMessage } from "@cypheria/protocol"
import { describe, expect, it, vi } from "vitest"

import { createBrowserHostActions } from "./browser-host.js"
import type { ConnectionState, ServerClient } from "./server-client.js"

const browserId = "5b8f7b43-86a4-4c65-9f79-3a3a3d35f0c1"

const createFakeClient = () => {
  const messageHandlers = new Set<(message: ServerMessage) => void>()
  const statusHandlers = new Set<(state: ConnectionState) => void>()
  let state: ConnectionState = { status: "idle" }
  const requestBrowser = vi.fn(async (type: string, _payload?: unknown) => ({
    payload: {
      ok: true as const,
      value:
        type === "browser.automation.result.request" ? { accepted: true } : { succeeded: true },
    },
    requestId: "test",
    type: type.replace(/\.request$/u, ".response"),
  }))
  const client = {
    getConnectionState: () => state,
    on: (_type: string, handler: (message: ServerMessage) => void) => {
      messageHandlers.add(handler)
      return () => messageHandlers.delete(handler)
    },
    requestBrowser,
    subscribeConnectionStatus: (handler: (state: ConnectionState) => void) => {
      statusHandlers.add(handler)
      handler(state)
      return () => statusHandlers.delete(handler)
    },
    supports: () => true,
  } as unknown as ServerClient
  return {
    client,
    emit: (message: ServerMessage) => {
      for (const handler of messageHandlers) handler(message)
    },
    requestBrowser,
    setState: (next: ConnectionState) => {
      state = next
      for (const handler of statusHandlers) handler(next)
    },
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("browser host actions", () => {
  it("registers after each reconnect and unregisters on release", async () => {
    const fake = createFakeClient()
    const host = createBrowserHostActions(fake.client).register({
      onCommand: vi.fn(),
      registration: () => ({ hostKind: "desktop app", supportedCommands: ["snapshot"] }),
    })
    fake.setState({ status: "connected" })
    fake.setState({ status: "connected" })
    fake.setState({ reason: "lost", status: "disconnected" })
    fake.setState({ status: "connected" })
    await flush()
    await host.release()

    expect(fake.requestBrowser.mock.calls.map(([type]) => type)).toEqual([
      "browser.host.register.request",
      "browser.host.register.request",
      "browser.host.unregister.request",
    ])
    expect(fake.requestBrowser.mock.calls[0]?.[1]).toEqual({
      hostKind: "desktop app",
      supportedCommands: ["snapshot"],
    })
  })

  it("executes commands and reports thrown errors as failures", async () => {
    const fake = createFakeClient()
    const onCommand = vi
      .fn<(request: BrowserAutomationRequest) => Promise<never>>()
      .mockRejectedValueOnce(new Error("guest crashed"))
    createBrowserHostActions(fake.client).register({
      onCommand,
      registration: () => ({ hostKind: "desktop app", supportedCommands: ["snapshot"] }),
    })
    fake.emit({
      payload: { automationId: "a-1", command: { args: { browserId }, command: "snapshot" } },
      type: "browser.automation.command.notification",
    })
    await flush()

    expect(onCommand).toHaveBeenCalledOnce()
    expect(fake.requestBrowser).toHaveBeenCalledWith(
      "browser.automation.result.request",
      {
        automationId: "a-1",
        error: { code: "browser_unknown_error", message: "guest crashed" },
        ok: false,
      },
      undefined
    )
  })
})
