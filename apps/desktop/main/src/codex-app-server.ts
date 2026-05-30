import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { createServer } from "node:net"

import {
  type CodexAppServerBridge,
  type CodexAppServerBridgeOptions,
  type CodexJsonValue,
  type CodexLifecycleState,
  createCodexAppServerBridge,
  type ServerNotification,
  type ServerRequest,
} from "@cypheria/codex-bridge"
import type { CypheriaRuntimePaths, RuntimeHomeEnv } from "@cypheria/runtime"
import type { BrowserWindow } from "electron"
import {
  type CodexEventEnvelope,
  CodexEventEnvelopeSchema,
  type CodexEventPayload,
  CYPHERIA_IPC_CHANNELS,
  IPC_PROTOCOL_VERSION,
} from "../../ipc/src/index.js"

export type CodexAppServerState = "ready" | "starting" | "stopped" | "stopping"

export type CodexAppServerContext = {
  readonly bridge: CodexAppServerBridge
  readonly child: ChildProcessWithoutNullStreams
  readonly listenUrl: string
  readonly port: number
  readonly state: CodexAppServerState
}

export type CodexAppServerProcessFactory = (
  command: string,
  args: readonly string[],
  options: {
    readonly env: NodeJS.ProcessEnv
  }
) => ChildProcessWithoutNullStreams

export type CodexAppServerBridgeFactory = (
  options: CodexAppServerBridgeOptions
) => CodexAppServerBridge

export type StartCodexAppServerOptions = {
  readonly bridgeFactory?: CodexAppServerBridgeFactory
  readonly clientVersion: string
  readonly codexCommand?: string
  readonly codexEnv: RuntimeHomeEnv
  readonly connectTimeoutMs?: number
  readonly paths: CypheriaRuntimePaths
  readonly port?: number
  readonly processFactory?: CodexAppServerProcessFactory
  readonly readyPollIntervalMs?: number
  readonly windows?: () => readonly BrowserWindow[]
}

const defaultConnectTimeoutMs = 10_000
const defaultReadyPollIntervalMs = 100

const toJsonValue = (value: unknown): CodexJsonValue | undefined => {
  if (value === undefined) {
    return undefined
  }

  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value)
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item) ?? null)
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, toJsonValue(item)] as const)
        .filter((entry): entry is readonly [string, CodexJsonValue] => entry[1] !== undefined)
    )
  }

  return String(value)
}

const selectLocalhostPort = async (): Promise<number> => {
  const server = createServer()

  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        if (!address || typeof address === "string") {
          reject(new Error("Failed to select a localhost port"))
          return
        }

        resolve(address.port)
      })
    })
  })
}

export const createCodexEventEnvelope = (
  event: CodexEventEnvelope["event"],
  payload: CodexEventPayload
): CodexEventEnvelope =>
  CodexEventEnvelopeSchema.parse({
    event,
    namespace: "codex",
    payload,
    timestamp: new Date().toISOString(),
    version: IPC_PROTOCOL_VERSION,
  })

export const mapCodexNotificationToEvent = (notification: ServerNotification): CodexEventEnvelope =>
  createCodexEventEnvelope("codex.notification", {
    method: notification.method,
    params: "params" in notification ? toJsonValue(notification.params) : undefined,
  })

export const mapCodexServerRequestToEvent = (request: ServerRequest): CodexEventEnvelope =>
  createCodexEventEnvelope("codex.serverRequest", {
    method: request.method,
    params: "params" in request ? toJsonValue(request.params) : undefined,
  })

const createLifecycleEvent = (
  state: CodexLifecycleState | CodexAppServerState
): CodexEventEnvelope => createCodexEventEnvelope("codex.lifecycle", { state })

const createErrorEvent = (code: string, message: string): CodexEventEnvelope =>
  createCodexEventEnvelope("codex.error", { code, message })

const createStderrEvent = (line: string): CodexEventEnvelope =>
  createCodexEventEnvelope("codex.stderr", { line })

export const broadcastCodexEvent = (
  windows: readonly BrowserWindow[],
  envelope: CodexEventEnvelope
): void => {
  for (const window of windows) {
    if (window.isDestroyed()) {
      continue
    }
    window.webContents.send(CYPHERIA_IPC_CHANNELS.codexEvent, envelope)
  }
}

const wireBridgeEvents = (
  bridge: CodexAppServerBridge,
  windows: () => readonly BrowserWindow[]
): void => {
  bridge.on("lifecycle", (state) => {
    broadcastCodexEvent(windows(), createLifecycleEvent(state))
  })
  bridge.on("notification", (notification) => {
    broadcastCodexEvent(windows(), mapCodexNotificationToEvent(notification))
  })
  bridge.on("server-request", (request) => {
    broadcastCodexEvent(windows(), mapCodexServerRequestToEvent(request))
  })
  bridge.on("error", (error) => {
    broadcastCodexEvent(windows(), createErrorEvent(error.code, error.message))
  })
}

const wireCodexStderr = (
  child: ChildProcessWithoutNullStreams,
  windows: () => readonly BrowserWindow[]
): void => {
  let buffered = ""
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk: string) => {
    buffered += chunk
    const lines = buffered.split(/\r?\n/)
    buffered = lines.pop() ?? ""

    for (const line of lines) {
      if (!line) {
        continue
      }
      console.error("[cypheria:codex]", line)
      broadcastCodexEvent(windows(), createStderrEvent(line))
    }
  })
}

const waitForExit = (child: ChildProcessWithoutNullStreams): Promise<void> =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve()
      return
    }

    child.once("exit", () => resolve())
  })

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const terminateCodexChild = async (child: ChildProcessWithoutNullStreams): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }

  child.kill("SIGTERM")
  await Promise.race([waitForExit(child), sleep(2000)])

  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL")
    await waitForExit(child)
  }
}

const connectBridgeWhenReady = async (
  bridgeFactory: CodexAppServerBridgeFactory,
  bridgeOptions: CodexAppServerBridgeOptions,
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
  pollIntervalMs: number,
  windows: () => readonly BrowserWindow[]
): Promise<CodexAppServerBridge> => {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown

  while (Date.now() <= deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("Codex app-server exited before it became ready")
    }

    const bridge = bridgeFactory(bridgeOptions)
    wireBridgeEvents(bridge, windows)

    try {
      await bridge.connect()
      return bridge
    } catch (error) {
      lastError = error
      await bridge.close().catch(() => undefined)
      await sleep(pollIntervalMs)
    }
  }

  throw new Error(
    `Timed out waiting for Codex app-server readiness: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  )
}

export const startCodexAppServer = async (
  options: StartCodexAppServerOptions
): Promise<CodexAppServerContext> => {
  const port = options.port ?? (await selectLocalhostPort())
  const listenUrl = `ws://127.0.0.1:${port}`
  const command = options.codexCommand ?? "codex"
  const processFactory = options.processFactory ?? spawn
  const bridgeFactory = options.bridgeFactory ?? createCodexAppServerBridge
  const windows = options.windows ?? (() => [])

  broadcastCodexEvent(windows(), createLifecycleEvent("starting"))

  const child = processFactory(command, ["app-server", "--listen", listenUrl], {
    env: {
      ...process.env,
      ...options.codexEnv,
      CODEX_HOME: options.paths.codexHome,
    },
  })

  wireCodexStderr(child, windows)

  child.once("error", (error) => {
    broadcastCodexEvent(windows(), createErrorEvent("PROCESS_ERROR", error.message))
  })
  child.once("exit", (code, signal) => {
    if (code !== 0 && signal !== "SIGTERM") {
      broadcastCodexEvent(
        windows(),
        createErrorEvent(
          "PROCESS_EXITED",
          `Codex app-server exited unexpectedly with code ${code ?? "null"} and signal ${
            signal ?? "null"
          }`
        )
      )
    }
    broadcastCodexEvent(windows(), createLifecycleEvent("stopped"))
  })

  let bridge: CodexAppServerBridge
  try {
    bridge = await connectBridgeWhenReady(
      bridgeFactory,
      {
        clientInfo: { name: "cypheria", title: "Cypheria", version: options.clientVersion },
        url: listenUrl,
      },
      child,
      options.connectTimeoutMs ?? defaultConnectTimeoutMs,
      options.readyPollIntervalMs ?? defaultReadyPollIntervalMs,
      windows
    )
  } catch (error) {
    await terminateCodexChild(child)
    throw error
  }

  broadcastCodexEvent(windows(), createLifecycleEvent("ready"))

  return {
    bridge,
    child,
    listenUrl,
    port,
    state: "ready",
  }
}

export const shutdownCodexAppServer = async (context: CodexAppServerContext): Promise<void> => {
  await context.bridge.close()
  await terminateCodexChild(context.child)
}
