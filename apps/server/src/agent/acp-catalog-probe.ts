import { spawn } from "node:child_process"
import { createInterface } from "node:readline"

import {
  ACP_PREFERRED_PROTOCOL_VERSION,
  type AcpNegotiatedInitializeResult,
  type AcpProtocolVersion,
  parseAcpNegotiatedInitializeResult,
} from "@cypheria/protocol/acp-adapter"
import {
  AcpV1FallbackRequiredError,
  acpInitializeParams,
  isMisreportedAcpV1InitializeResult,
} from "./acp-negotiation.js"
import type { AgentInstallReceipt } from "./agent-installer.js"
import type { ToolchainManager } from "./toolchain-manager.js"

const ACP_AUTHENTICATION_REQUIRED = -32_000
// Some installed ACP agents perform cold-start setup before answering initialize.
// Keep this above the observed Crow/Kimi startup time so a valid v1 downgrade is
// not misreported as an authentication discovery failure.
const ACP_REQUEST_TIMEOUT_MS = 30_000

type JsonRpcMessage = {
  error?: { code: number; message: string }
  id?: number | string | null
  jsonrpc: "2.0"
  method?: string
  params?: unknown
  result?: unknown
}

type RawConfigOption = {
  category?: string | null
  currentValue: boolean | string
  description?: string | null
  id: string
  name: string
  options?: Array<
    | { description?: string | null; name: string; value: string }
    | {
        group: string
        name: string
        options: Array<{ description?: string | null; name: string; value: string }>
      }
  >
  type: "boolean" | "select"
}

type AcpConnection = {
  initialized: AcpNegotiatedInitializeResult
  protocolVersion: AcpProtocolVersion
  request: <T>(method: string, params: unknown) => Promise<T>
}

type AcpConnectionOptions = {
  receipt: AgentInstallReceipt
  signal: AbortSignal
  toolchains: ToolchainManager
}

export type AcpAuthDiscovery = {
  authMethods: Array<{
    args: string[]
    description: string | null
    env: Record<string, string>
    id: string
    name: string
    type: "agent" | "terminal"
  }>
  logoutSupported: boolean
  protocolVersion: AcpProtocolVersion
}

export type AcpProbeResult = AcpAuthDiscovery & {
  configOptions: Array<{
    category: string | null
    currentValue: boolean | string
    description: string | null
    id: string
    name: string
    options: Array<{ description: string | null; name: string; value: string }>
    type: "boolean" | "select"
  }>
  modes: Array<{ description: string | null; id: string; name: string }>
  sessionId: string | null
  status: "authentication-required" | "ready"
}

class AcpRpcError extends Error {
  readonly code: number

  constructor(code: number, message: string) {
    super(message)
    this.name = "AcpRpcError"
    this.code = code
  }
}

const authDiscovery = (initialized: AcpNegotiatedInitializeResult): AcpAuthDiscovery => {
  const { protocolVersion } = initialized
  const authMethods: AcpAuthDiscovery["authMethods"] =
    initialized.protocolVersion === 2
      ? (initialized.result.authMethods ?? []).flatMap((method) =>
          method.type === "agent" || method.type === "terminal"
            ? [
                {
                  args: "args" in method ? (method.args ?? []) : [],
                  description: method.description ?? null,
                  env:
                    "env" in method
                      ? Object.fromEntries(
                          (method.env ?? []).map((entry) => [entry.name, entry.value])
                        )
                      : {},
                  id: method.methodId,
                  name: method.name,
                  type: method.type,
                },
              ]
            : []
        )
      : (initialized.result.authMethods ?? []).map((method) => ({
          args: "type" in method && method.type === "terminal" ? (method.args ?? []) : [],
          description: method.description ?? null,
          env: "type" in method && method.type === "terminal" ? (method.env ?? {}) : {},
          id: method.id,
          name: method.name,
          type: "type" in method ? method.type : ("agent" as const),
        }))
  return {
    authMethods,
    logoutSupported:
      protocolVersion === 2
        ? authMethods.length > 0
        : initialized.result.agentCapabilities?.auth?.logout != null,
    protocolVersion,
  }
}

async function withAcpConnectionVersion<T>(
  options: AcpConnectionOptions,
  requestedVersion: AcpProtocolVersion,
  use: (connection: AcpConnection) => Promise<T>
): Promise<T> {
  const child = spawn(options.receipt.command, options.receipt.args, {
    cwd: options.receipt.workingDirectory,
    env: options.toolchains.environment(options.receipt.environment),
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
  child.stderr.resume()
  const lines = createInterface({ input: child.stdout })
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
  let nextId = 0
  const pending = new Map<
    number,
    { reject: (error: Error) => void; resolve: (value: unknown) => void }
  >()
  const rejectPending = (error: Error) => {
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }
  const onAbort = () => child.kill("SIGTERM")
  options.signal.addEventListener("abort", onAbort, { once: true })
  child.once("error", (error) => rejectPending(error))
  child.once("exit", () => rejectPending(new Error("ACP runtime exited")))
  lines.on("line", (line) => {
    try {
      const messages = JSON.parse(line) as JsonRpcMessage | JsonRpcMessage[]
      for (const message of Array.isArray(messages) ? messages : [messages]) {
        if (typeof message.id === "number" && !message.method) {
          const request = pending.get(message.id)
          if (!request) continue
          pending.delete(message.id)
          if (message.error) {
            request.reject(new AcpRpcError(message.error.code, message.error.message))
          } else {
            request.resolve(message.result)
          }
        } else if (message.method && message.id !== undefined) {
          child.stdin.write(
            `${JSON.stringify({ error: { code: -32_601, message: "Not available during ACP discovery" }, id: message.id, jsonrpc: "2.0" })}\n`
          )
        }
      }
    } catch {
      // ACP stdout must be JSONL. Non-protocol diagnostics are ignored.
    }
  })
  const request = <T>(method: string, params: unknown): Promise<T> => {
    if (options.signal.aborted) return Promise.reject(options.signal.reason)
    const id = nextId++
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`ACP request timed out: ${method}`))
      }, ACP_REQUEST_TIMEOUT_MS)
      timeout.unref()
      pending.set(id, {
        reject: (error) => {
          clearTimeout(timeout)
          reject(error)
        },
        resolve: (value) => {
          clearTimeout(timeout)
          resolve(value as T)
        },
      })
      child.stdin.write(`${JSON.stringify({ id, jsonrpc: "2.0", method, params })}\n`)
    })
  }

  try {
    const initializeResult = await request("initialize", acpInitializeParams(requestedVersion))
    let initialized: AcpNegotiatedInitializeResult
    try {
      initialized = parseAcpNegotiatedInitializeResult(initializeResult)
    } catch (error) {
      if (
        requestedVersion === ACP_PREFERRED_PROTOCOL_VERSION &&
        isMisreportedAcpV1InitializeResult(initializeResult)
      ) {
        throw new AcpV1FallbackRequiredError()
      }
      throw error
    }
    return await use({
      initialized,
      protocolVersion: initialized.protocolVersion,
      request,
    })
  } finally {
    options.signal.removeEventListener("abort", onAbort)
    lines.close()
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM")
      await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 500))])
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL")
      await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 500))])
    }
    rejectPending(new Error("ACP connection closed"))
  }
}

async function withAcpConnection<T>(
  options: AcpConnectionOptions,
  use: (connection: AcpConnection) => Promise<T>
): Promise<T> {
  try {
    return await withAcpConnectionVersion(options, ACP_PREFERRED_PROTOCOL_VERSION, use)
  } catch (error) {
    if (!(error instanceof AcpV1FallbackRequiredError)) throw error
    // Google Antigravity's invalid hybrid response is retried on a new process;
    // reusing the v2 connection as v1 would violate ACP version negotiation.
    return withAcpConnectionVersion(options, 1, use)
  }
}

export async function discoverAcpAuth(options: AcpConnectionOptions): Promise<AcpAuthDiscovery> {
  return withAcpConnection(options, async ({ initialized }) => authDiscovery(initialized))
}

export async function authenticateAcp(
  options: AcpConnectionOptions & { methodId: string }
): Promise<AcpAuthDiscovery> {
  return withAcpConnection(options, async ({ initialized, protocolVersion, request }) => {
    const discovery = authDiscovery(initialized)
    const method = discovery.authMethods.find((candidate) => candidate.id === options.methodId)
    if (!method) throw new Error("ACP authentication method is no longer available")
    if (method.type === "terminal") {
      throw new Error("Terminal authentication must run in an interactive terminal")
    }
    await request(protocolVersion === 2 ? "auth/login" : "authenticate", {
      methodId: options.methodId,
    })
    return discovery
  })
}

export async function logoutAcp(options: AcpConnectionOptions): Promise<AcpAuthDiscovery> {
  return withAcpConnection(options, async ({ initialized, protocolVersion, request }) => {
    const discovery = authDiscovery(initialized)
    if (!discovery.logoutSupported) throw new Error("ACP agent does not support logout")
    await request(protocolVersion === 2 ? "auth/logout" : "logout", {})
    return discovery
  })
}

export async function probeAcpCatalog(options: AcpConnectionOptions): Promise<AcpProbeResult> {
  return withAcpConnection(options, async ({ initialized, protocolVersion, request }) => {
    const discovery = authDiscovery(initialized)
    const sessionSupported =
      protocolVersion === 1 ||
      (initialized.protocolVersion === 2 && initialized.result.capabilities?.session != null)
    if (!sessionSupported) throw new Error("ACP agent does not advertise session support")
    let sessionId: string | undefined
    try {
      const created = await request<{
        configOptions?: RawConfigOption[] | null
        modes?: {
          availableModes: Array<{ description?: string | null; id: string; name: string }>
        } | null
        sessionId: string
      }>("session/new", { cwd: process.cwd(), mcpServers: [] })
      sessionId = created.sessionId
      return {
        ...discovery,
        configOptions: (created.configOptions ?? []).map((entry) => ({
          category: entry.category ?? null,
          currentValue: entry.currentValue,
          description: entry.description ?? null,
          id: entry.id,
          name: entry.name,
          options:
            entry.type === "select"
              ? (entry.options ?? []).flatMap((item) =>
                  "group" in item
                    ? item.options.map((nested) => ({
                        description: nested.description ?? null,
                        name: nested.name,
                        value: nested.value,
                      }))
                    : [
                        {
                          description: item.description ?? null,
                          name: item.name,
                          value: item.value,
                        },
                      ]
                )
              : [],
          type: entry.type,
        })),
        modes: (created.modes?.availableModes ?? []).map((mode) => ({
          description: mode.description ?? null,
          id: mode.id,
          name: mode.name,
        })),
        sessionId: created.sessionId,
        status: "ready" as const,
      }
    } catch (error) {
      if (!(error instanceof AcpRpcError) || error.code !== ACP_AUTHENTICATION_REQUIRED) throw error
      return {
        ...discovery,
        configOptions: [],
        modes: [],
        sessionId: null,
        status: "authentication-required" as const,
      }
    } finally {
      const deleteSupported =
        initialized.protocolVersion === 2
          ? initialized.result.capabilities?.session?.delete != null
          : initialized.result.agentCapabilities?.sessionCapabilities?.delete != null
      if (sessionId && deleteSupported) {
        await request("session/delete", { sessionId }).catch(() => undefined)
      }
    }
  })
}
