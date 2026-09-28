import type { ProjectThreadPersistenceService } from "@cypheria/db"
import {
  type CypheriaBinaryFrame,
  decodeTerminalBinaryFrame,
  encodeTerminalInputFrame,
  type TerminalServerMessage,
} from "@cypheria/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SessionTransport } from "../session/client-session.js"
import { TerminalManager } from "./terminal-manager.js"

const threadId = "01995bc5-c4ee-7e9c-8d7f-5f112db567e9"
const managers: TerminalManager[] = []
const transport = (): SessionTransport => ({
  bufferedAmount: () => 0,
  close: vi.fn(),
  send: vi.fn(),
})
const environment = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  )

afterEach(() => {
  for (const manager of managers.splice(0)) manager.stop()
})

describe("TerminalManager", () => {
  it("publishes one shared Thread directory to independent clients", async () => {
    const persistence = {
      getThread: vi.fn(async () => ({
        archivedAt: null,
        roots: [process.cwd()],
        deletedAt: null,
        id: threadId,
      })),
    } as unknown as ProjectThreadPersistenceService
    const manager = new TerminalManager(persistence)
    managers.push(manager)
    const firstMessages: TerminalServerMessage[] = []
    const secondMessages: TerminalServerMessage[] = []
    const first = transport()
    const second = transport()

    await manager.handle(
      {
        payload: { threadId },
        requestId: "watch-1",
        type: "terminal.directory.subscribe.request",
      },
      {
        send: (message) => firstMessages.push(message),
        sendBinary: vi.fn(),
        sessionId: "one",
        source: first,
      }
    )
    await manager.handle(
      {
        payload: { threadId },
        requestId: "watch-2",
        type: "terminal.directory.subscribe.request",
      },
      {
        send: (message) => secondMessages.push(message),
        sendBinary: vi.fn(),
        sessionId: "two",
        source: second,
      }
    )
    await manager.handle(
      {
        payload: { size: { cols: 80, rows: 24 }, threadId },
        requestId: "create",
        type: "terminal.create.request",
      },
      {
        send: (message) => firstMessages.push(message),
        sendBinary: vi.fn(),
        sessionId: "one",
        source: first,
      }
    )

    const created = firstMessages.find((message) => message.type === "terminal.create.response")
    expect(created?.payload).toMatchObject({ ok: true })
    expect(
      firstMessages.find((message) => message.type === "terminal.directory.changed.notification")
    ).toMatchObject({
      payload: { terminals: [expect.objectContaining({ threadId })], threadId },
      type: "terminal.directory.changed.notification",
    })
    expect(
      secondMessages.find((message) => message.type === "terminal.directory.changed.notification")
    ).toMatchObject({
      payload: { terminals: [expect.objectContaining({ threadId })], threadId },
      type: "terminal.directory.changed.notification",
    })
  }, 15_000)

  it("keeps authentication terminals private while using the binary stream", async () => {
    const manager = new TerminalManager({} as ProjectThreadPersistenceService)
    managers.push(manager)
    const exited = vi.fn()
    const auth = await manager.createAuthTerminal(
      {
        args: [
          "-e",
          "process.stdin.setEncoding('utf8');process.stdin.on('data',data=>process.stdout.write(data));setTimeout(()=>process.exit(0),2000)",
        ],
        command: process.execPath,
        cwd: process.cwd(),
        env: environment(),
        flowId: "auth-flow",
        title: "Authentication",
      },
      "owner-session",
      exited
    )
    const denied: TerminalServerMessage[] = []
    await manager.handle(
      {
        payload: { restore: "visible", terminalId: auth.terminalId },
        requestId: "denied",
        type: "terminal.stream.subscribe.request",
      },
      {
        send: (message) => denied.push(message),
        sendBinary: vi.fn(),
        sessionId: "other-session",
        source: transport(),
      }
    )
    expect(denied[0]?.payload).toMatchObject({
      error: { code: "TERMINAL_FORBIDDEN" },
      ok: false,
    })

    const source = transport()
    const messages: TerminalServerMessage[] = []
    const frames: CypheriaBinaryFrame[] = []
    await manager.handle(
      {
        payload: { restore: "visible", terminalId: auth.terminalId },
        requestId: "observe",
        type: "terminal.stream.subscribe.request",
      },
      {
        send: (message) => messages.push(message),
        sendBinary: (frame) => frames.push(frame),
        sessionId: "owner-session",
        source,
      }
    )
    const response = messages[0]
    if (response?.type !== "terminal.stream.subscribe.response" || !response.payload.ok) {
      throw new Error("Expected terminal stream subscription")
    }
    await manager.handleBinaryFrame(
      encodeTerminalInputFrame(response.payload.value.slot, new TextEncoder().encode("ping\n")),
      "owner-session",
      source
    )
    await vi.waitFor(() => {
      const output = frames
        .map(decodeTerminalBinaryFrame)
        .filter((frame) => frame?.type === "output")
        .map((frame) => new TextDecoder().decode(frame.data))
        .join("")
      expect(output).toContain("ping")
    })
    await manager.closeAuthTerminal(auth.terminalId, "owner-session")
  }, 15_000)
})
