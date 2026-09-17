import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { createInterface } from "node:readline"

import {
  AGENT_ACP_V1_CLIENT_NOTIFICATIONS,
  AGENT_ACP_V1_CLIENT_RPC,
  AGENT_ACP_V1_SERVER_NOTIFICATIONS,
  AGENT_ACP_V1_SERVER_RPC,
  AGENT_ACP_V2_CLIENT_NOTIFICATIONS,
  AGENT_ACP_V2_CLIENT_RPC,
  AGENT_ACP_V2_SERVER_NOTIFICATIONS,
  AGENT_ACP_V2_SERVER_RPC,
  type AgentAcpClientMessage,
  type AgentAcpServerMessage,
  AgentAcpServerMessageSchema,
  type RegistryAgentId,
} from "@cypheria/protocol"

import type { AgentInstallReceipt } from "./agent-installer.js"
import type { ToolchainManager } from "./toolchain-manager.js"

type RawMessage = {
  error?: unknown
  id?: string | number | null
  jsonrpc: "2.0"
  method?: string
  params?: unknown
  result?: unknown
}

const invert = (record: Readonly<Record<string, unknown>>, key: string): Record<string, string> =>
  Object.fromEntries(
    Object.entries(record).flatMap(([method, raw]) => {
      const value = (raw as Record<string, unknown>)[key]
      return typeof value === "string" ? [[value, method]] : []
    })
  )

const definitions = {
  1: {
    clientNotificationByType: invert(AGENT_ACP_V1_CLIENT_NOTIFICATIONS, "notification"),
    clientRequestByType: invert(AGENT_ACP_V1_CLIENT_RPC, "request"),
    clientRpc: AGENT_ACP_V1_CLIENT_RPC,
    serverNotificationByMethod: Object.fromEntries(
      Object.entries(AGENT_ACP_V1_SERVER_NOTIFICATIONS).map(([method, value]) => [
        method,
        value.notification,
      ])
    ),
    serverResponseByType: invert(AGENT_ACP_V1_SERVER_RPC, "response"),
    serverRpc: AGENT_ACP_V1_SERVER_RPC,
  },
  2: {
    clientNotificationByType: invert(AGENT_ACP_V2_CLIENT_NOTIFICATIONS, "notification"),
    clientRequestByType: invert(AGENT_ACP_V2_CLIENT_RPC, "request"),
    clientRpc: AGENT_ACP_V2_CLIENT_RPC,
    serverNotificationByMethod: Object.fromEntries(
      Object.entries(AGENT_ACP_V2_SERVER_NOTIFICATIONS).map(([method, value]) => [
        method,
        value.notification,
      ])
    ),
    serverResponseByType: invert(AGENT_ACP_V2_SERVER_RPC, "response"),
    serverRpc: AGENT_ACP_V2_SERVER_RPC,
  },
} as const

const responsePayload = (message: RawMessage) =>
  Object.hasOwn(message, "error")
    ? { error: message.error, requestId: message.id }
    : { requestId: message.id, result: message.result }

export class AcpSessionRuntime {
  readonly #agent: RegistryAgentId
  readonly #receipt: AgentInstallReceipt
  readonly #send: (message: AgentAcpServerMessage) => void
  readonly #toolchains: ToolchainManager
  readonly #pending = new Map<string, { responseType: string; version: 1 | 2 }>()
  #process: ChildProcessWithoutNullStreams | undefined
  #releaseEnvironment: (() => void) | undefined
  #version: 1 | 2 = 1

  constructor(options: {
    agent: RegistryAgentId
    receipt: AgentInstallReceipt
    send: (message: AgentAcpServerMessage) => void
    toolchains: ToolchainManager
  }) {
    this.#agent = options.agent
    this.#receipt = options.receipt
    this.#send = options.send
    this.#toolchains = options.toolchains
  }

  get running(): boolean {
    return Boolean(this.#process)
  }

  start(): void {
    if (this.#process) return
    if (this.#receipt.environmentFingerprint) {
      this.#releaseEnvironment = this.#toolchains.acquireEnvironment(
        this.#receipt.environmentFingerprint
      )
    }
    const child = spawn(this.#receipt.command, this.#receipt.args, {
      env: this.#toolchains.environment(this.#receipt.environment),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    this.#process = child
    const lines = createInterface({ input: child.stdout })
    lines.on("line", (line) => {
      try {
        const raw = JSON.parse(line) as RawMessage | RawMessage[]
        const message = this.#decode(raw)
        this.#send(message)
      } catch {
        // Invalid stdout is ignored; ACP agents must emit one valid JSON value per line.
      }
    })
    child.once("exit", () => {
      if (this.#process === child) this.#process = undefined
      this.#releaseEnvironment?.()
      this.#releaseEnvironment = undefined
      this.#pending.clear()
      lines.close()
    })
  }

  send(message: AgentAcpClientMessage): void {
    this.start()
    const child = this.#process
    if (!child) throw new Error("ACP agent is not running")
    child.stdin.write(`${JSON.stringify(this.#encode(message))}\n`)
  }

  async stop(): Promise<void> {
    const child = this.#process
    this.#process = undefined
    this.#pending.clear()
    if (!child || child.exitCode !== null) {
      this.#releaseEnvironment?.()
      this.#releaseEnvironment = undefined
      return
    }
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL")
        resolve()
      }, 5_000).unref()
      child.once("exit", () => {
        clearTimeout(timeout)
        resolve()
      })
      child.kill("SIGTERM")
    })
    this.#releaseEnvironment?.()
    this.#releaseEnvironment = undefined
  }

  #encode(message: AgentAcpClientMessage): RawMessage | RawMessage[] {
    if (message.type === "agent.acp.batch")
      return message.payload.messages.map((entry) => this.#encodeSingle(entry))
    return this.#encodeSingle(message)
  }

  #encodeSingle(message: Exclude<AgentAcpClientMessage, { type: "agent.acp.batch" }>): RawMessage {
    const version = message.protocolVersion
    const definition = definitions[version]
    if (message.type === "agent.acp.cancel_request.notification")
      return { jsonrpc: "2.0", method: "$/cancel_request", params: message.payload }
    if (
      message.type === "agent.acp.extension.request" ||
      message.type === "agent.acp.extension.notification"
    ) {
      const extension = message as {
        payload: { method: string; params?: unknown }
        requestId?: string | number | null
        type: string
      }
      return {
        ...(extension.type.endsWith(".request") ? { id: extension.requestId } : {}),
        jsonrpc: "2.0",
        method: extension.payload.method,
        ...(extension.payload.params === undefined ? {} : { params: extension.payload.params }),
      }
    }
    if (
      message.type === "agent.acp.extension.response" ||
      definition.serverResponseByType[message.type]
    ) {
      const { requestId, ...payload } = (
        message as { payload: { requestId: string | number | null } & Record<string, unknown> }
      ).payload
      return { jsonrpc: "2.0", id: requestId, ...payload } as RawMessage
    }
    const method = definition.clientRequestByType[message.type]
    if (method) {
      const {
        agent: _agent,
        protocolVersion,
        requestId,
        type: _type,
        ...params
      } = message as typeof message & { requestId: string | number | null }
      const responseType =
        definition.clientRpc[method as keyof typeof definition.clientRpc].response
      if (method === "initialize") this.#version = version
      this.#pending.set(`${typeof requestId}:${String(requestId)}`, { responseType, version })
      return {
        id: requestId,
        jsonrpc: "2.0",
        method,
        params: method === "initialize" ? { ...params, protocolVersion } : params,
      }
    }
    const notificationMethod = definition.clientNotificationByType[message.type]
    if (notificationMethod)
      return {
        jsonrpc: "2.0",
        method: notificationMethod,
        params: (message as { payload: unknown }).payload,
      }
    throw new Error(`Unsupported ACP client message: ${message.type}`)
  }

  #decode(raw: RawMessage | RawMessage[]): AgentAcpServerMessage {
    if (Array.isArray(raw)) {
      const messages = raw.map((message) => this.#decodeSingle(message))
      const first = messages[0]
      if (!first || first.protocolVersion !== 2) throw new Error("ACP v1 does not support batches")
      return AgentAcpServerMessageSchema.parse({
        agent: this.#agent,
        payload: { messages },
        protocolVersion: 2,
        type: "agent.acp.batch",
      })
    }
    return this.#decodeSingle(raw)
  }

  #decodeSingle(raw: RawMessage): Exclude<AgentAcpServerMessage, { type: "agent.acp.batch" }> {
    if (raw.method) {
      const version = this.#detectVersion(raw)
      const definition = definitions[version]
      if (raw.method === "$/cancel_request")
        return AgentAcpServerMessageSchema.parse({
          agent: this.#agent,
          payload: raw.params,
          protocolVersion: version,
          type: "agent.acp.cancel_request.notification",
        }) as Exclude<AgentAcpServerMessage, { type: "agent.acp.batch" }>
      const rpc = definition.serverRpc[raw.method as keyof typeof definition.serverRpc]
      if (rpc && Object.hasOwn(raw, "id")) {
        return AgentAcpServerMessageSchema.parse({
          ...(raw.params as object),
          agent: this.#agent,
          protocolVersion: version,
          requestId: raw.id,
          type: rpc.request,
        }) as Exclude<AgentAcpServerMessage, { type: "agent.acp.batch" }>
      }
      const notificationType = definition.serverNotificationByMethod[raw.method]
      if (notificationType)
        return AgentAcpServerMessageSchema.parse({
          agent: this.#agent,
          payload: raw.params,
          protocolVersion: version,
          type: notificationType,
        }) as Exclude<AgentAcpServerMessage, { type: "agent.acp.batch" }>
      return AgentAcpServerMessageSchema.parse({
        agent: this.#agent,
        payload: {
          method: raw.method,
          ...(raw.params === undefined ? {} : { params: raw.params }),
        },
        protocolVersion: version,
        ...(Object.hasOwn(raw, "id")
          ? { requestId: raw.id, type: "agent.acp.extension.request" }
          : { type: "agent.acp.extension.notification" }),
      }) as Exclude<AgentAcpServerMessage, { type: "agent.acp.batch" }>
    }
    const key = `${typeof raw.id}:${String(raw.id)}`
    const pending = this.#pending.get(key)
    if (!pending) throw new Error(`Unexpected ACP response id: ${String(raw.id)}`)
    this.#pending.delete(key)
    return AgentAcpServerMessageSchema.parse({
      agent: this.#agent,
      payload: responsePayload(raw),
      protocolVersion: pending.version,
      type: pending.responseType,
    }) as Exclude<AgentAcpServerMessage, { type: "agent.acp.batch" }>
  }

  #detectVersion(raw: RawMessage): 1 | 2 {
    if (
      raw.method === "initialize" &&
      raw.params &&
      typeof raw.params === "object" &&
      "protocolVersion" in raw.params
    ) {
      return (raw.params as { protocolVersion: number }).protocolVersion === 2 ? 2 : 1
    }
    return this.#version
  }
}
