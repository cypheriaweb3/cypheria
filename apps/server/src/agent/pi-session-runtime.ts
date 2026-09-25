import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { createInterface } from "node:readline"
import {
  type AgentPiClientMessage,
  type AgentPiClientRequest,
  type AgentPiServerMessage,
  type PiServerEvent,
  unwrapPiExtensionUIResponse,
  unwrapPiRpcCommand,
  wrapPiRpcResponse,
  wrapPiServerEvent,
} from "@cypheria/protocol"
import type { RpcResponse } from "@earendil-works/pi-coding-agent"
import type { Logger } from "pino"

import type { AgentInstallReceipt } from "./agent-installer.js"
import { monitorAgentProcess } from "./agent-process-log.js"
import type { ToolchainManager } from "./toolchain-manager.js"

type PiOutput = PiServerEvent | RpcResponse

export class PiSessionRuntime {
  readonly #cwd: string | undefined
  readonly #home: string
  readonly #receipt: AgentInstallReceipt
  readonly #send: (message: AgentPiServerMessage) => void
  readonly #toolchains: ToolchainManager
  readonly #logger: Logger | undefined
  #process: ChildProcessWithoutNullStreams | undefined
  #startPromise: Promise<void> | undefined

  constructor(options: {
    cwd?: string
    home: string
    receipt: AgentInstallReceipt
    send: (message: AgentPiServerMessage) => void
    toolchains: ToolchainManager
    logger?: Logger
  }) {
    this.#cwd = options.cwd
    this.#home = options.home
    this.#receipt = options.receipt
    this.#send = options.send
    this.#toolchains = options.toolchains
    this.#logger = options.logger
  }

  get running(): boolean {
    return Boolean(this.#process)
  }

  async start(): Promise<void> {
    if (this.#startPromise) return this.#startPromise
    if (this.#process) return
    const pending = this.#start()
    this.#startPromise = pending
    try {
      await pending
    } finally {
      if (this.#startPromise === pending) this.#startPromise = undefined
    }
  }

  async #start(): Promise<void> {
    await mkdir(this.#home, { recursive: true })
    const child = spawn(this.#receipt.command, [...this.#receipt.args, "--mode", "rpc"], {
      ...(this.#cwd ? { cwd: this.#cwd } : {}),
      env: { ...this.#toolchains.environment(), PI_CODING_AGENT_DIR: this.#home },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    this.#process = child
    monitorAgentProcess(child, this.#logger)
    const lines = createInterface({ input: child.stdout })
    lines.on("line", (line) => {
      try {
        const output = JSON.parse(line) as PiOutput
        this.#send(
          "command" in output
            ? wrapPiRpcResponse(output as RpcResponse)
            : wrapPiServerEvent(output as PiServerEvent)
        )
      } catch {
        // Pi owns stderr diagnostics; only valid JSONL records are protocol messages.
      }
    })
    child.once("exit", () => {
      if (this.#process === child) this.#process = undefined
      lines.close()
    })
  }

  async send(message: AgentPiClientMessage): Promise<void> {
    await this.start()
    const child = this.#process
    if (!child) throw new Error("Pi agent is not running")
    const output = message.type.endsWith(".response")
      ? unwrapPiExtensionUIResponse(message as Exclude<AgentPiClientMessage, AgentPiClientRequest>)
      : unwrapPiRpcCommand(message as AgentPiClientRequest)
    child.stdin.write(`${JSON.stringify(output)}\n`)
  }

  async stop(): Promise<void> {
    await this.#startPromise?.catch(() => undefined)
    const child = this.#process
    this.#process = undefined
    if (!child || child.exitCode !== null) return
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
  }
}
