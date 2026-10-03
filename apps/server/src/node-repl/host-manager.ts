import type { Logger } from "pino"

import type { BrowserToolsService } from "../browser-tools/service.js"
import { NodeReplHostService } from "./host-service.js"
import { resolveNodeReplBinary } from "./resolve-binary.js"

export type NodeReplHostManagerOptions = {
  readonly browserTools: BrowserToolsService
  readonly resolveCodexPath?: () => Promise<string | undefined> | string | undefined
  readonly logger?: Logger
}

export type NodeReplConfig = {
  command: string
  args: string[]
  env: Record<string, string>
}

/**
 * Manages NodeReplHostService instances and supplies the node_repl MCP server
 * configuration for Codex threads.
 */
export class NodeReplHostManager {
  readonly #browserTools: BrowserToolsService
  readonly #resolveCodexPath?: () => Promise<string | undefined> | string | undefined
  readonly #logger?: Logger
  readonly #services = new Map<string, NodeReplHostService>()

  constructor(options: NodeReplHostManagerOptions) {
    this.#browserTools = options.browserTools
    this.#resolveCodexPath = options.resolveCodexPath
    this.#logger = options.logger
  }

  async ensureHostService(
    threadId: string,
    cwd?: string | null
  ): Promise<{
    pipePath: string
    config: NodeReplConfig
  }> {
    let service = this.#services.get(threadId)
    if (!service) {
      service = new NodeReplHostService({
        browserTools: this.#browserTools,
        cwd: cwd ?? undefined,
        logger: this.#logger,
        threadId,
      })
      this.#services.set(threadId, service)
    }

    const pipePath = await service.start()
    const nodeReplBin = resolveNodeReplBinary()
    const codexPath = (await this.#resolveCodexPath?.()) ?? "codex"
    const disableSandbox = process.env.CYPHERIA_NODE_REPL_DISABLE_SANDBOX === "1"

    const config: NodeReplConfig = {
      command: nodeReplBin,
      args: disableSandbox ? ["--disable-sandbox"] : [],
      env: {
        CODEX_CLI_PATH: codexPath,
        NODE_REPL_HOST_SERVICES_PIPE_PATH: pipePath,
        NODE_REPL_NODE_PATH: process.execPath,
        NODE_REPL_SESSION_ID: threadId,
        NODE_REPL_TRUSTED_RPC_ENABLED: "1",
      },
    }

    return { config, pipePath }
  }

  async closeHostService(threadId: string): Promise<void> {
    const service = this.#services.get(threadId)
    if (!service) return
    this.#services.delete(threadId)
    await service.close()
  }

  async closeAll(): Promise<void> {
    const all = Array.from(this.#services.values())
    this.#services.clear()
    await Promise.all(all.map((s) => s.close()))
  }
}
