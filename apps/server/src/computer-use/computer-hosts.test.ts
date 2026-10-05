import type { ComputerHostServerMessage } from "@cypheria/protocol"
import { describe, expect, it } from "vitest"

import { ComputerHostService } from "./computer-hosts.js"

const threadId = "01984de2-8f74-7c91-a3b2-5c5e937cf318"

/** A window of the `cid_desktop` client that answers every device request with its own name. */
const window = (service: ComputerHostService, name: string, answer = true) => {
  const received: string[] = []
  const session = {
    clientId: "cid_desktop",
    id: "ses_desktop",
    kind: "desktop" as const,
    notify: (message: ComputerHostServerMessage) => {
      if (message.type !== "computer.host.command.notification") return
      received.push(message.payload.commandId)
      if (!answer) return
      queueMicrotask(() => {
        void service.handle(
          {
            payload: { commandId: message.payload.commandId, ok: true, value: name },
            requestId: "r",
            type: "computer.host.result.request",
          },
          session,
          () => undefined
        )
      })
    },
    transport: {},
  }
  const register = () =>
    service.handle(
      {
        payload: { name: "Studio Mac", capabilities: ["computer"] },
        requestId: "host",
        type: "computer.host.register.request",
      },
      session,
      () => undefined
    )
  return { received, register, session }
}

describe("ComputerHostService", () => {
  it("knows every window of a client as one host and uses the newest window", async () => {
    const service = new ComputerHostService()
    const main = window(service, "main")
    const popout = window(service, "popout")
    await main.register()
    await popout.register()
    expect(service.hosts()).toEqual([
      { id: "cid_desktop", name: "Studio Mac", capabilities: ["computer"] },
    ])
    await expect(service.request("cid_desktop", { threadId }, { op: "apps.list" })).resolves.toBe(
      "popout"
    )

    service.transportClosed(popout.session.transport)
    await expect(service.request("cid_desktop", { threadId }, { op: "apps.list" })).resolves.toBe(
      "main"
    )
    service.transportClosed(main.session.transport)
    expect(service.hosts()).toEqual([])
  })

  it("fails a request whose window closed before answering", async () => {
    const service = new ComputerHostService()
    const silent = window(service, "main", false)
    await silent.register()
    const pending = service.request("cid_desktop", { threadId }, { op: "apps.list" })
    service.transportClosed(silent.session.transport)
    await expect(pending).rejects.toThrow(/disconnected before answering/u)
  })

  it("only lets Desktop host Computer Use", async () => {
    const service = new ComputerHostService()
    const replies: ComputerHostServerMessage[] = []
    await service.handle(
      {
        payload: { name: "cli", capabilities: ["computer"] },
        requestId: "host",
        type: "computer.host.register.request",
      },
      { ...window(service, "cli").session, kind: "cli" },
      (message) => replies.push(message)
    )
    expect(replies[0]).toMatchObject({ payload: { ok: false } })
    expect(service.hosts()).toEqual([])
  })

  it("asks the Thread for app approvals of a running command and holds its deadline", async () => {
    const asked: string[] = []
    let answer: (decision: "session") => void = () => undefined
    const service = new ComputerHostService({
      approve: (thread, approval) => {
        asked.push(`${thread}:${"app" in approval ? approval.app : approval.kind}`)
        return new Promise((resolve) => {
          answer = resolve
        })
      },
      timeoutMs: 50,
    })
    const silent = window(service, "main", false)
    await silent.register()
    const pending = service.request("cid_desktop", { threadId }, { op: "apps.list" })
    const commandId = silent.received[0] ?? ""
    const replies: ComputerHostServerMessage[] = []
    const approval = {
      allowAlways: true,
      app: "com.apple.calculator",
      commandId,
      displayName: "Calculator",
      risk: "low" as const,
      threadId,
    }
    await service.handle(
      {
        payload: { ...approval, commandId: "other" },
        requestId: "a0",
        type: "computer.host.approval.request",
      },
      silent.session,
      (message) => replies.push(message)
    )
    await service.handle(
      { payload: approval, requestId: "a1", type: "computer.host.approval.request" },
      silent.session,
      (message) => replies.push(message)
    )
    // The person takes longer than the device deadline to decide.
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(asked).toEqual([`${threadId}:com.apple.calculator`])
    answer("session")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(replies.map((reply) => reply.payload)).toEqual([
      {
        error: {
          code: "COMPUTER_HOST_UNKNOWN_COMMAND",
          message: "No such command is running on this device.",
        },
        ok: false,
      },
      { ok: true, value: { decision: "session" } },
    ])
    await service.handle(
      {
        payload: { commandId, ok: true, value: "done" },
        requestId: "r",
        type: "computer.host.result.request",
      },
      silent.session,
      () => undefined
    )
    await expect(pending).resolves.toBe("done")
  })
})
