import { describe, expect, it } from "vitest"

import {
  CodexAppServerBusyError,
  type CodexWebSocketEvent,
  type CodexWebSocketLike,
  createCodexAppServerBridge,
  isCodexAppServerRetryableError,
} from "./index.js"

class FakeWebSocket implements CodexWebSocketLike {
  static readonly instances: FakeWebSocket[] = []

  readonly sent: string[] = []
  readyState = 0
  #listeners = new Map<string, Array<(event: CodexWebSocketEvent) => void>>()

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  addEventListener(
    type: "close" | "error" | "message" | "open",
    listener: (event: CodexWebSocketEvent) => void,
    options?: { readonly once?: boolean }
  ): void {
    const wrapped = options?.once
      ? (event: CodexWebSocketEvent) => {
          this.#listeners.set(
            type,
            (this.#listeners.get(type) ?? []).filter((candidate) => candidate !== wrapped)
          )
          listener(event)
        }
      : listener
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), wrapped])
  }

  close(): void {
    this.readyState = 3
    this.emit("close", {})
  }

  send(data: string): void {
    this.sent.push(data)
  }

  open(): void {
    this.readyState = 1
    this.emit("open", {})
  }

  serverSend(value: unknown): void {
    this.emit("message", { data: JSON.stringify(value) })
  }

  emit(type: "close" | "error" | "message" | "open", event: CodexWebSocketEvent): void {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(event)
    }
  }
}

const nextSocket = (): FakeWebSocket => {
  const socket = FakeWebSocket.instances.at(-1)
  if (!socket) {
    throw new Error("Expected fake WebSocket instance")
  }
  return socket
}

const waitForMicrotask = async (): Promise<void> => {
  await Promise.resolve()
}

const waitForTimer = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const waitUntil = async (predicate: () => boolean): Promise<void> => {
  for (let index = 0; index < 20; index++) {
    if (predicate()) {
      return
    }
    await waitForTimer()
  }
  throw new Error("Timed out waiting for condition")
}

describe("Codex app-server bridge", () => {
  it("initializes over WebSocket and sends initialized notification", async () => {
    const bridge = createCodexAppServerBridge({
      WebSocketImpl: FakeWebSocket,
      capabilities: { experimentalApi: true, requestAttestation: false },
      clientInfo: { name: "cypheria", title: "Cypheria", version: "0.0.0" },
      url: "ws://127.0.0.1:1234",
    })

    const connectPromise = bridge.connect()
    const socket = nextSocket()
    socket.open()
    await waitForMicrotask()
    socket.serverSend({
      id: "cypheria_1",
      result: {
        codexHome: "/tmp/cypheria/codex",
        platformFamily: "unix",
        platformOs: "macos",
        userAgent: "codex-test",
      },
    })

    await expect(connectPromise).resolves.toMatchObject({
      codexHome: "/tmp/cypheria/codex",
      userAgent: "codex-test",
    })
    expect(bridge.getState()).toBe("ready")
    expect(socket.sent.map((line) => JSON.parse(line))).toEqual([
      {
        id: "cypheria_1",
        method: "initialize",
        params: {
          capabilities: { experimentalApi: true, requestAttestation: false },
          clientInfo: { name: "cypheria", title: "Cypheria", version: "0.0.0" },
        },
      },
      { method: "initialized" },
    ])
  })

  it("correlates request responses by id", async () => {
    const bridge = createCodexAppServerBridge({
      WebSocketImpl: FakeWebSocket,
      clientInfo: { name: "cypheria", title: "Cypheria", version: "0.0.0" },
      url: "ws://127.0.0.1:1234",
    })
    const connectPromise = bridge.connect()
    const socket = nextSocket()
    socket.open()
    await waitForMicrotask()
    socket.serverSend({
      id: "cypheria_1",
      result: { codexHome: "/tmp", platformFamily: "unix", platformOs: "macos", userAgent: "x" },
    })
    await connectPromise

    const requestPromise = bridge.request("thread/list", {
      archived: false,
      limit: 20,
      sortDirection: "desc",
      sortKey: "updated_at",
    })
    socket.serverSend({
      id: "cypheria_2",
      result: { backwardsCursor: null, data: [], nextCursor: null },
    })

    await expect(requestPromise).resolves.toEqual({
      backwardsCursor: null,
      data: [],
      nextCursor: null,
    })
  })

  it("emits server notifications", async () => {
    const bridge = createCodexAppServerBridge({
      WebSocketImpl: FakeWebSocket,
      clientInfo: { name: "cypheria", title: "Cypheria", version: "0.0.0" },
      url: "ws://127.0.0.1:1234",
    })
    const notifications: string[] = []
    bridge.on("notification", (notification) => notifications.push(notification.method))

    const connectPromise = bridge.connect()
    const socket = nextSocket()
    socket.open()
    await waitForMicrotask()
    socket.serverSend({
      id: "cypheria_1",
      result: { codexHome: "/tmp", platformFamily: "unix", platformOs: "macos", userAgent: "x" },
    })
    await connectPromise

    socket.serverSend({ method: "skills/changed", params: { data: [] } })
    expect(notifications).toEqual(["skills/changed"])
  })

  it("routes server requests to typed handlers and replies", async () => {
    const bridge = createCodexAppServerBridge({
      WebSocketImpl: FakeWebSocket,
      clientInfo: { name: "cypheria", title: "Cypheria", version: "0.0.0" },
      url: "ws://127.0.0.1:1234",
    })
    bridge.onServerRequest("execCommandApproval", (request) => {
      expect(request.params.command).toEqual(["pnpm", "test"])
      return { decision: "approved" }
    })

    const connectPromise = bridge.connect()
    const socket = nextSocket()
    socket.open()
    await waitForMicrotask()
    socket.serverSend({
      id: "cypheria_1",
      result: { codexHome: "/tmp", platformFamily: "unix", platformOs: "macos", userAgent: "x" },
    })
    await connectPromise

    socket.serverSend({
      id: "server_1",
      method: "execCommandApproval",
      params: {
        approvalId: null,
        callId: "call-1",
        command: ["pnpm", "test"],
        conversationId: "thread-1",
        cwd: "/tmp",
        parsedCmd: [],
        reason: null,
      },
    })
    await waitForMicrotask()

    expect(socket.sent.map((line) => JSON.parse(line)).at(-1)).toEqual({
      id: "server_1",
      result: { decision: "approved" },
    })
  })

  it("rejects pending requests when the socket closes", async () => {
    const bridge = createCodexAppServerBridge({
      WebSocketImpl: FakeWebSocket,
      clientInfo: { name: "cypheria", title: "Cypheria", version: "0.0.0" },
      url: "ws://127.0.0.1:1234",
    })
    const connectPromise = bridge.connect()
    const socket = nextSocket()
    socket.open()
    await waitForMicrotask()
    socket.serverSend({
      id: "cypheria_1",
      result: { codexHome: "/tmp", platformFamily: "unix", platformOs: "macos", userAgent: "x" },
    })
    await connectPromise

    const requestPromise = bridge.request("thread/read", {
      includeTurns: false,
      threadId: "thread-1",
    })
    socket.close()

    await expect(requestPromise).rejects.toThrow("closed")
  })

  it("retries transient overload errors", async () => {
    const bridge = createCodexAppServerBridge({
      WebSocketImpl: FakeWebSocket,
      clientInfo: { name: "cypheria", title: "Cypheria", version: "0.0.0" },
      retry: { initialDelayMs: 0, jitterRatio: 0, maxAttempts: 2 },
      url: "ws://127.0.0.1:1234",
    })
    const connectPromise = bridge.connect()
    const socket = nextSocket()
    socket.open()
    await waitForMicrotask()
    socket.serverSend({
      id: "cypheria_1",
      result: { codexHome: "/tmp", platformFamily: "unix", platformOs: "macos", userAgent: "x" },
    })
    await connectPromise

    const requestPromise = bridge.request(
      "model/list",
      { includeHidden: false },
      { retryOnOverload: true }
    )
    socket.serverSend({
      error: { code: -32_000, data: "server_overloaded", message: "server busy" },
      id: "cypheria_2",
    })
    await waitUntil(() => socket.sent.some((line) => JSON.parse(line).id === "cypheria_3"))
    socket.serverSend({ id: "cypheria_3", result: { data: [], nextCursor: null } })

    await expect(requestPromise).resolves.toEqual({ data: [], nextCursor: null })
    expect(JSON.parse(socket.sent.at(-1) ?? "{}")).toMatchObject({
      id: "cypheria_3",
      method: "model/list",
    })
  })

  it("classifies overload errors as retryable", () => {
    const error = new CodexAppServerBusyError({
      code: -32_000,
      data: { codex_error_info: "server_overloaded" },
      message: "busy",
    })

    expect(isCodexAppServerRetryableError(error)).toBe(true)
  })
})
