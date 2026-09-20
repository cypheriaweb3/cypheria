import { spawn } from "node:child_process"
import { createInterface } from "node:readline"

import type { AgentInstallReceipt } from "./agent-installer.js"
import type { ToolchainManager } from "./toolchain-manager.js"

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

export type AcpProbeResult = {
  authMethods: Array<{
    args: string[]
    description: string | null
    env: Record<string, string>
    id: string
    name: string
    type: "agent" | "terminal"
  }>
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
  logoutSupported: boolean
  sessionId: string
}

export async function probeAcpCatalog(options: {
  authenticateMethodId?: string
  logout?: boolean
  receipt: AgentInstallReceipt
  signal: AbortSignal
  toolchains: ToolchainManager
}): Promise<AcpProbeResult> {
  let releaseEnvironment: (() => void) | undefined
  if (options.receipt.environmentFingerprint) {
    releaseEnvironment = options.toolchains.acquireEnvironment(
      options.receipt.environmentFingerprint
    )
  }
  const child = spawn(options.receipt.command, options.receipt.args, {
    env: options.toolchains.environment(options.receipt.environment),
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
  const lines = createInterface({ input: child.stdout })
  let nextId = 0
  const pending = new Map<
    number,
    { reject: (error: Error) => void; resolve: (value: unknown) => void }
  >()
  const onAbort = () => child.kill("SIGTERM")
  options.signal.addEventListener("abort", onAbort, { once: true })
  child.once("exit", () => {
    for (const request of pending.values()) {
      request.reject(new Error("ACP catalog runtime exited"))
    }
    pending.clear()
  })
  lines.on("line", (line) => {
    try {
      const messages = JSON.parse(line) as JsonRpcMessage | JsonRpcMessage[]
      for (const message of Array.isArray(messages) ? messages : [messages]) {
        if (typeof message.id === "number" && !message.method) {
          const request = pending.get(message.id)
          if (!request) continue
          pending.delete(message.id)
          if (message.error) request.reject(new Error(message.error.message))
          else request.resolve(message.result)
        } else if (message.method && message.id !== undefined) {
          child.stdin.write(
            `${JSON.stringify({ error: { code: -32_601, message: "Not available during catalog discovery" }, id: message.id, jsonrpc: "2.0" })}\n`
          )
        }
      }
    } catch {
      // ACP stdout must be JSONL. Non-protocol diagnostics are ignored.
    }
  })
  const request = async <T>(method: string, params: unknown): Promise<T> => {
    if (options.signal.aborted) throw options.signal.reason
    const id = nextId++
    const response = new Promise<unknown>((resolve, reject) => pending.set(id, { reject, resolve }))
    child.stdin.write(`${JSON.stringify({ id, jsonrpc: "2.0", method, params })}\n`)
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`ACP catalog request timed out: ${method}`)),
        15_000
      ).unref()
    )
    return (await Promise.race([response, timeout])) as T
  }

  let sessionId: string | undefined
  try {
    const initialized = await request<{
      agentCapabilities?: { auth?: { logout?: unknown } | null }
      authMethods?: Array<{
        args?: string[]
        description?: string | null
        env?: Record<string, string>
        id: string
        name: string
        type?: "agent" | "terminal"
      }>
    }>("initialize", {
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: true,
      },
      clientInfo: { name: "cypheria", title: "Cypheria", version: "1" },
      protocolVersion: 1,
    })
    if (options.logout) {
      await request("logout", {})
      return {
        authMethods: [],
        configOptions: [],
        logoutSupported: true,
        modes: [],
        sessionId: "",
      }
    }
    if (options.authenticateMethodId) {
      const method = initialized.authMethods?.find(
        (candidate) => candidate.id === options.authenticateMethodId
      )
      if (!method) throw new Error("ACP authentication method is no longer available")
      if (method.type === "terminal") {
        throw new Error("Terminal authentication must run in an interactive terminal")
      }
      await request("authenticate", { methodId: options.authenticateMethodId })
    }
    const created = await request<{
      configOptions?: RawConfigOption[] | null
      modes?: {
        availableModes: Array<{ description?: string | null; id: string; name: string }>
      } | null
      sessionId: string
    }>("session/new", { cwd: process.cwd(), mcpServers: [] })
    sessionId = created.sessionId
    return {
      authMethods: (initialized.authMethods ?? []).map((method) => ({
        args: method.args ?? [],
        description: method.description ?? null,
        env: method.env ?? {},
        id: method.id,
        name: method.name,
        type: method.type ?? "agent",
      })),
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
      logoutSupported: initialized.agentCapabilities?.auth?.logout != null,
      sessionId: created.sessionId,
    }
  } finally {
    if (sessionId) await request("session/delete", { sessionId }).catch(() => undefined)
    options.signal.removeEventListener("abort", onAbort)
    lines.close()
    if (child.exitCode === null) child.kill("SIGTERM")
    for (const request of pending.values()) request.reject(new Error("ACP catalog probe closed"))
    pending.clear()
    releaseEnvironment?.()
  }
}
