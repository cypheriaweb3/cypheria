import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { type ConnectionStatus, NativeConnection, type NativePortLike } from "../src/native-port.ts"
import { NATIVE_HOST_NAME, PROTOCOL_VERSION } from "../src/protocol.ts"

class FakePort implements NativePortLike {
  readonly sent: Record<string, unknown>[] = []
  readonly #message: ((message: unknown) => void)[] = []
  readonly #disconnect: (() => void)[] = []
  disconnected = false
  readonly onMessage = {
    addListener: (listener: (message: unknown) => void) => this.#message.push(listener),
  }
  readonly onDisconnect = { addListener: (listener: () => void) => this.#disconnect.push(listener) }
  postMessage(message: unknown): void {
    this.sent.push(message as Record<string, unknown>)
  }
  disconnect(): void {
    this.disconnected = true
  }
  deliver(message: unknown): void {
    for (const listener of this.#message) listener(message)
  }
  drop(): void {
    for (const listener of this.#disconnect) listener()
  }
}

describe("NativeConnection", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const setup = () => {
    const ports: FakePort[] = []
    const statuses: ConnectionStatus[] = []
    const connected = vi.fn()
    const connection = new NativeConnection({
      connectNative: (name) => {
        expect(name).toBe(NATIVE_HOST_NAME)
        const port = new FakePort()
        ports.push(port)
        return port
      },
      extensionId: "ext",
      extensionVersion: "1.0.0",
      lastError: () => "Native host has exited.",
      onDesktopConnected: connected,
      onRequest: async (method) => ({ handled: method }),
      onStatus: (status) => statuses.push(status),
    })
    return { connected, connection, ports, statuses }
  }

  it("says hello and serves Desktop's requests", async () => {
    const { connected, connection, ports } = setup()
    connection.connect()
    const port = ports[0] as FakePort
    expect(port.sent[0]).toMatchObject({
      method: "hello",
      params: { extensionId: "ext", extensionVersion: "1.0.0", protocolVersion: PROTOCOL_VERSION },
    })
    port.deliver({
      id: port.sent[0]?.id,
      result: { desktopVersion: "2.0.0", hostVersion: "0.1.0", protocolVersion: PROTOCOL_VERSION },
    })
    await vi.waitFor(() => expect(connection.status.state).toBe("connected"))
    expect(connected).toHaveBeenCalledOnce()
    port.deliver({ id: "d1", method: "listTabs", params: {} })
    await vi.waitFor(() =>
      expect(port.sent[1]).toEqual({ id: "d1", result: { handled: "listTabs" } })
    )
    connection.notify("cdpEvent", { tabId: 1 })
    expect(port.sent[2]).toEqual({ method: "cdpEvent", params: { tabId: 1 } })
  })

  it("keeps the port open while Desktop is not running", async () => {
    const { connected, connection, ports } = setup()
    connection.connect()
    const port = ports[0] as FakePort
    port.deliver({
      error: { code: "desktop_not_running", message: "Cypheria Desktop is not running." },
      id: port.sent[0]?.id,
    })
    await vi.waitFor(() => expect(connection.status.state).toBe("waiting_for_desktop"))
    expect(port.disconnected).toBe(false)
    connection.notify("cdpEvent", {})
    expect(port.sent).toHaveLength(1)
    port.deliver({
      method: "desktopStatus",
      params: { desktopVersion: "2.0.0", state: "connected" },
    })
    expect(connection.status.state).toBe("connected")
    expect(connected).toHaveBeenCalledOnce()
  })

  it("reconnects with backoff when the host goes away", async () => {
    const { connection, ports } = setup()
    connection.connect()
    ports[0]?.drop()
    expect(connection.status).toMatchObject({
      error: { message: "Native host has exited." },
      state: "disconnected",
    })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(ports).toHaveLength(2)
    ports[1]?.drop()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(ports).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(ports).toHaveLength(3)
  })

  it("disconnects when the versions do not match", async () => {
    const { connection, ports } = setup()
    connection.connect()
    const port = ports[0] as FakePort
    port.deliver({
      error: { code: "extension_update_required", message: "Update the Cypheria extension." },
      id: port.sent[0]?.id,
    })
    await vi.waitFor(() => expect(port.disconnected).toBe(true))
    expect(connection.status.error?.code).toBe("extension_update_required")
  })
})
