import type { ServerMessage } from "@cypheria/protocol"
import { describe, expect, it, vi } from "vitest"

import { createComputerHostActions } from "./computer-host.js"
import type { ConnectionState, ServerClient } from "./server-client.js"

const threadId = "01984de2-8f74-7c91-a3b2-5c5e937cf318"

const createFakeClient = () => {
  const messageHandlers = new Set<(message: ServerMessage) => void>()
  const statusHandlers = new Set<(state: ConnectionState) => void>()
  let state: ConnectionState = { status: "idle" }
  const requestComputerHost = vi.fn(async (type: string, _payload?: unknown) => ({
    payload: {
      ok: true as const,
      value:
        type === "computer.host.result.request"
          ? { accepted: true }
          : type === "computer.host.approval.request"
            ? { decision: "session" }
            : { succeeded: true },
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
    requestComputerHost,
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
    requestComputerHost,
    setState: (next: ConnectionState) => {
      state = next
      for (const handler of statusHandlers) handler(next)
    },
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("computer host actions", () => {
  it("registers after each reconnect and refresh and unregisters on release", async () => {
    const fake = createFakeClient()
    const host = createComputerHostActions(fake.client).register({
      onCommand: vi.fn(),
      registration: () => ({ name: "Studio Mac", capabilities: ["computer"] }),
    })
    fake.setState({ status: "connected" })
    fake.setState({ status: "connected" })
    fake.setState({ reason: "lost", status: "disconnected" })
    fake.setState({ status: "connected" })
    await flush()
    host.refresh()
    await flush()
    await host.release()

    expect(fake.requestComputerHost.mock.calls.map(([type]) => type)).toEqual([
      "computer.host.register.request",
      "computer.host.register.request",
      "computer.host.register.request",
      "computer.host.unregister.request",
    ])
    expect(fake.requestComputerHost.mock.calls[0]?.[1]).toEqual({
      name: "Studio Mac",
      capabilities: ["computer"],
    })
  })

  it("answers with the request's value or its error", async () => {
    const fake = createFakeClient()
    const failure = Object.assign(new Error("No driver."), { name: "unavailable" })
    const onCommand = vi
      .fn()
      .mockResolvedValueOnce([{ name: "Notes" }])
      .mockRejectedValueOnce(failure)
    createComputerHostActions(fake.client).register({
      onCommand,
      registration: () => ({ name: "Studio Mac", capabilities: ["computer"] }),
    })
    for (const commandId of ["c-1", "c-2"]) {
      fake.emit({
        payload: { commandId, request: { op: "apps.list" }, threadId },
        type: "computer.host.command.notification",
      })
    }
    await flush()

    expect(fake.requestComputerHost.mock.calls.map(([, payload]) => payload)).toEqual([
      { commandId: "c-1", ok: true, value: [{ name: "Notes" }] },
      { commandId: "c-2", error: { code: "unavailable", message: "No driver." }, ok: false },
    ])
  })

  it("asks for app approvals and waits for a person to answer", async () => {
    const fake = createFakeClient()
    const approval = {
      allowAlways: false,
      app: "com.apple.calculator",
      commandId: "device-1",
      displayName: "Calculator",
      risk: "low" as const,
      threadId,
    }
    await expect(createComputerHostActions(fake.client).requestApproval(approval)).resolves.toBe(
      "session"
    )
    expect(fake.requestComputerHost).toHaveBeenCalledWith(
      "computer.host.approval.request",
      approval,
      { timeoutMs: 30 * 60_000 }
    )
  })
})
