import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"

import type {
  CodexAppServerBridge,
  CodexAppServerBridgeEventMap,
  CodexAppServerBridgeHandler,
  CodexAppServerBridgeOptions,
  InitializeResponse,
} from "@cypheria/codex-bridge"
import { buildRuntimePaths } from "@cypheria/runtime"
import type { BrowserWindow } from "electron"
import { describe, expect, it } from "vitest"

import {
  type CodexAppServerProcessFactory,
  mapCodexNotificationToEvent,
  shutdownCodexAppServer,
  startCodexAppServer,
} from "./codex-app-server.js"

class FakeBridge {
  readonly listeners = new Map<keyof CodexAppServerBridgeEventMap, Set<(event: unknown) => void>>()
  closed = false
  connected = false

  async close(): Promise<void> {
    this.closed = true
  }

  async connect(): Promise<InitializeResponse> {
    this.connected = true
    return {
      codexHome: "/tmp/cypheria/codex",
      platformFamily: "unix",
      platformOs: "macos",
      userAgent: "codex-test",
    }
  }

  on<K extends keyof CodexAppServerBridgeEventMap>(
    type: K,
    handler: CodexAppServerBridgeHandler<K>
  ): () => void {
    const listeners = this.listeners.get(type) ?? new Set<(event: unknown) => void>()
    listeners.add(handler as (event: unknown) => void)
    this.listeners.set(type, listeners)
    return () => listeners.delete(handler as (event: unknown) => void)
  }

  emit<K extends keyof CodexAppServerBridgeEventMap>(
    type: K,
    event: CodexAppServerBridgeEventMap[K]
  ): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }
}

class FailingBridge extends FakeBridge {
  override async connect(): Promise<InitializeResponse> {
    throw new Error("connection refused")
  }
}

class FakeChildProcess extends EventEmitter {
  readonly stderr = new PassThrough()
  readonly stdout = new PassThrough()
  exitCode: number | null = null
  killedWith: NodeJS.Signals | undefined
  signalCode: NodeJS.Signals | null = null

  kill(signal?: NodeJS.Signals): boolean {
    this.killedWith = signal
    this.signalCode = signal ?? "SIGTERM"
    this.emit("exit", null, this.signalCode)
    return true
  }
}

const createWindow = () => {
  const sent: Array<{ channel: string; payload: unknown }> = []
  const window = {
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, payload: unknown) => {
        sent.push({ channel, payload })
      },
    },
  } as unknown as BrowserWindow

  return { sent, window }
}

describe("Codex app-server lifecycle", () => {
  it("starts codex app-server with the Cypheria Codex home and connects the bridge", async () => {
    const paths = buildRuntimePaths({ homeDir: "/tmp/cypheria-test" })
    const fakeChild = new FakeChildProcess()
    const fakeBridge = new FakeBridge()
    const spawns: Array<{
      args: readonly string[]
      command: string
      env: NodeJS.ProcessEnv
    }> = []

    const processFactory: CodexAppServerProcessFactory = (command, args, options) => {
      spawns.push({ args, command, env: options.env })
      return fakeChild as never
    }

    const context = await startCodexAppServer({
      bridgeFactory: (_options: CodexAppServerBridgeOptions) =>
        fakeBridge as unknown as CodexAppServerBridge,
      clientVersion: "1.2.3",
      codexEnv: { CODEX_HOME: paths.codexHome },
      connectTimeoutMs: 100,
      paths,
      port: 4567,
      processFactory,
      readyPollIntervalMs: 1,
    })

    expect(spawns).toEqual([
      {
        args: ["app-server", "--listen", "ws://127.0.0.1:4567"],
        command: "codex",
        env: expect.objectContaining({ CODEX_HOME: paths.codexHome }),
      },
    ])
    expect(fakeBridge.connected).toBe(true)
    expect(context.listenUrl).toBe("ws://127.0.0.1:4567")

    await shutdownCodexAppServer(context)
    expect(fakeBridge.closed).toBe(true)
    expect(fakeChild.killedWith).toBe("SIGTERM")
  })

  it("forwards bridge notifications through renderer-safe IPC events", async () => {
    const { sent, window } = createWindow()
    const paths = buildRuntimePaths({ homeDir: "/tmp/cypheria-test" })
    const fakeChild = new FakeChildProcess()
    const fakeBridge = new FakeBridge()

    await startCodexAppServer({
      bridgeFactory: () => fakeBridge as unknown as CodexAppServerBridge,
      clientVersion: "1.2.3",
      codexEnv: { CODEX_HOME: paths.codexHome },
      paths,
      port: 4567,
      processFactory: () => fakeChild as never,
      windows: () => [window],
    })

    fakeBridge.emit("notification", {
      method: "skills/changed",
      params: { data: [] },
    } as never)

    expect(sent.at(-1)?.payload).toMatchObject({
      event: "codex.notification",
      namespace: "codex",
      payload: { method: "skills/changed", params: { data: [] } },
      version: 1,
    })
  })

  it("terminates the child process when bridge readiness fails", async () => {
    const paths = buildRuntimePaths({ homeDir: "/tmp/cypheria-test" })
    const fakeChild = new FakeChildProcess()
    const failingBridge = new FailingBridge()

    await expect(
      startCodexAppServer({
        bridgeFactory: () => failingBridge as unknown as CodexAppServerBridge,
        clientVersion: "1.2.3",
        codexEnv: { CODEX_HOME: paths.codexHome },
        connectTimeoutMs: 1,
        paths,
        port: 4567,
        processFactory: () => fakeChild as never,
        readyPollIntervalMs: 1,
      })
    ).rejects.toThrow("Timed out waiting for Codex app-server readiness")

    expect(fakeChild.killedWith).toBe("SIGTERM")
  })

  it("maps generated Codex notifications without leaking non-JSON values", () => {
    const event = mapCodexNotificationToEvent({
      method: "warning",
      params: { message: "heads up", nonJson: undefined },
    } as never)

    expect(event).toMatchObject({
      event: "codex.notification",
      namespace: "codex",
      payload: {
        method: "warning",
        params: { message: "heads up" },
      },
    })
  })
})
