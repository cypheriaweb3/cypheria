import { createServer } from "node:net"
import { join } from "node:path"
import type { AgentOpenCodeCallRequest } from "@cypheria/protocol"
import { OpenCode, type OpenCodeClient } from "@opencode/client"
import { Service } from "@opencode/client/service"

import type { AgentInstallReceipt } from "./agent-installer.js"
import { readJsonFile, writeJsonAtomic } from "./fs-utils.js"
import type { ToolchainManager } from "./toolchain-manager.js"

const reservePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close()
        reject(new Error("Unable to allocate an OpenCode port"))
        return
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)))
    })
  })

export class OpenCodeRuntime {
  readonly #cypheriaHome: string
  readonly #toolchains: ToolchainManager
  #baseUrl: string | undefined
  #client: OpenCodeClient | undefined
  #serviceFile: string | undefined

  constructor(options: { cypheriaHome: string; toolchains: ToolchainManager }) {
    this.#cypheriaHome = options.cypheriaHome
    this.#toolchains = options.toolchains
  }

  get running(): boolean {
    return Boolean(this.#serviceFile && this.#baseUrl)
  }

  async start(receipt: AgentInstallReceipt): Promise<void> {
    if (this.running) return
    const port = await reservePort()
    const home = join(this.#cypheriaHome, "agents", "opencode", "home")
    const serviceFile = join(home, "state", "opencode", "service.json")
    const configPath = join(home, "config", "opencode", "opencode.json")
    const existingConfig = await readJsonFile<Record<string, unknown>>(configPath)
    await writeJsonAtomic(configPath, { ...existingConfig, update: "disable" })
    const env = this.#toolchains.environment({
      ...receipt.environment,
      XDG_CACHE_HOME: join(home, "cache"),
      XDG_CONFIG_HOME: join(home, "config"),
      XDG_DATA_HOME: join(home, "data"),
      XDG_STATE_HOME: join(home, "state"),
    })
    try {
      const endpoint = await Service.ensure({
        command: [
          receipt.command,
          ...receipt.args,
          "serve",
          "--service",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(port),
        ],
        env: Object.fromEntries(
          Object.entries(env).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string"
          )
        ),
        file: serviceFile,
        version: receipt.version,
      })
      this.#serviceFile = serviceFile
      this.#baseUrl = endpoint.url
      this.#client = OpenCode.make({
        baseUrl: endpoint.url,
        headers: Service.headers(endpoint),
      })
      await this.#client.server.info()
    } catch (error) {
      await Service.stop({ file: serviceFile }).catch(() => undefined)
      this.#serviceFile = undefined
      this.#baseUrl = undefined
      this.#client = undefined
      throw error
    }
  }

  async stop(): Promise<void> {
    const serviceFile = this.#serviceFile
    this.#serviceFile = undefined
    this.#baseUrl = undefined
    this.#client = undefined
    if (serviceFile) await Service.stop({ file: serviceFile })
  }

  async call(payload: AgentOpenCodeCallRequest["payload"]): Promise<{
    data?: unknown
    error?: unknown
    headers: Record<string, string>
    ok: boolean
    status: number
  }> {
    const client = this.#client
    if (!client || !this.#baseUrl) throw new Error("OpenCode is not running")
    const input = (payload.body ?? {}) as Record<string, unknown>
    try {
      const data = await (() => {
        switch (payload.operation) {
          case "server.info":
            return client.server.info()
          case "session.create":
            return client.session.create(input as never)
          case "session.fork":
            return client.session.fork(input as never)
          case "session.remove":
            return client.session.remove(input as never)
          case "session.switch_agent":
            return client.session.switchAgent(input as never)
          case "session.switch_model":
            return client.session.switchModel(input as never)
          case "session.prompt":
            return client.session.prompt(input as never)
          case "session.interrupt":
            return client.session.interrupt(input as never)
          case "message.list":
            return client.message.list(input as never)
          case "model.list":
            return client.model.list(input as never)
          case "model.default":
            return client.model.default(input as never)
          case "provider.list":
            return client.provider.list(input as never)
          case "agent.list":
            return client.agent.list(input as never)
          case "integration.list":
            return client.integration.list(input as never)
          case "integration.connect.key":
            return client.integration.connect.key(input as never)
          case "integration.oauth.connect":
            return client.integration.oauth.connect(input as never)
          case "integration.oauth.complete":
            return client.integration.oauth.complete(input as never)
          case "integration.oauth.cancel":
            return client.integration.oauth.cancel(input as never)
          case "credential.remove":
            return client.credential.remove(input as never)
          case "permission.reply":
            return client.permission.reply(input as never)
          case "session.form.reply":
            return client.session.form.reply(input as never)
          case "session.form.cancel":
            return client.session.form.cancel(input as never)
          default:
            throw new Error(`Unsupported OpenCode v2 operation: ${payload.operation}`)
        }
      })()
      return { data: await data, headers: {}, ok: true, status: data === undefined ? 204 : 200 }
    } catch (error) {
      return {
        error:
          error instanceof Error ? { message: error.message, name: error.name } : String(error),
        headers: {},
        ok: false,
        status: 500,
      }
    }
  }

  async *events(stream: "event"): AsyncGenerator<unknown> {
    if (!this.#client) throw new Error("OpenCode is not running")
    if (stream !== "event") throw new Error(`Unsupported OpenCode v2 event stream: ${stream}`)
    for await (const event of this.#client.event.subscribe()) yield event
  }
}
