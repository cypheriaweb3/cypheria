import type { BrowserBackend, CuaSurface } from "@cypheria/cua"
import type { CuaHost } from "@cypheria/cua/host"
import { cuaReplLaunch, cuaReplServerConfig, resolveCuaRoot } from "@cypheria/cua/plugin"
import type { Logger } from "pino"

import { NodeReplHostService } from "./host-service.js"
import { nodeReplFeatureEnv, resolveNodeRuntime } from "./node-runtime.js"
import { resolveNodeReplBinary } from "./resolve-binary.js"

export type NodeReplHostManagerOptions = {
  readonly cua: CuaHost
  /** The Computer Use surfaces settings enable; read when a Thread's servers are configured. */
  readonly surfaces: () => readonly CuaSurface[]
  /** The browser backends settings enable, which the `js` tool description names. */
  readonly backends: () => readonly BrowserBackend[]
  readonly resolveCodexPath?: () => Promise<string | undefined> | string | undefined
  /** Cypheria's managed Node.js, which runs the REPL kernels when it is installed. */
  readonly resolveNodePath?: () => string | undefined
  readonly logger?: Logger
}

export type NodeReplConfig = {
  command: string
  args: string[]
  env: Record<string, string>
}

/** The environment a Claude session's `cua` plugin reads to reach its Thread's host. */
export const CUA_HOST_PIPE_ENV = "CYPHERIA_CUA_HOST_PIPE"
export const CUA_SURFACES_ENV = "CYPHERIA_CUA_SURFACES"
export const CUA_BROWSER_BACKENDS_ENV = "CYPHERIA_CUA_BROWSER_BACKENDS"

/**
 * Owns each Thread's `cua_repl` host services socket and composes the Thread's REPL MCP servers:
 * `node_repl`, a plain JavaScript REPL, and `cua_repl`, the same runtime with the `cua` API and a
 * host connection scoped to that Thread.
 */
export class NodeReplHostManager {
  readonly #cua: CuaHost
  readonly #surfaces: () => readonly CuaSurface[]
  readonly #backends: () => readonly BrowserBackend[]
  readonly #resolveCodexPath?: () => Promise<string | undefined> | string | undefined
  readonly #resolveNodePath?: () => string | undefined
  readonly #logger?: Logger
  readonly #services = new Map<string, NodeReplHostService>()

  constructor(options: NodeReplHostManagerOptions) {
    this.#cua = options.cua
    this.#surfaces = options.surfaces
    this.#backends = options.backends
    this.#resolveCodexPath = options.resolveCodexPath
    this.#resolveNodePath = options.resolveNodePath
    this.#logger = options.logger
  }

  #service(threadId: string, cwd?: string | null): NodeReplHostService {
    let service = this.#services.get(threadId)
    if (!service) {
      service = new NodeReplHostService({
        cua: this.#cua,
        cwd: cwd ?? undefined,
        logger: this.#logger,
        threadId,
      })
      this.#services.set(threadId, service)
    }
    return service
  }

  /** The `mcp_servers` entries a Codex Thread starts with. */
  async ensureHostService(
    threadId: string,
    cwd?: string | null
  ): Promise<{ pipePath: string; config: NodeReplConfig; cuaReplConfig: Record<string, unknown> }> {
    const pipePath = await this.#service(threadId, cwd).start()
    const nodeReplPath = resolveNodeReplBinary()
    const codexPath = (await this.#resolveCodexPath?.()) ?? "codex"
    const node = resolveNodeRuntime(this.#resolveNodePath?.())
    const sandbox: Record<string, string> = {
      ...nodeReplFeatureEnv(),
      ...(process.env.CYPHERIA_NODE_REPL_DISABLE_SANDBOX === "1"
        ? {}
        : { CODEX_CLI_PATH: codexPath }),
    }
    const config: NodeReplConfig = {
      args: process.env.CYPHERIA_NODE_REPL_DISABLE_SANDBOX === "1" ? ["--disable-sandbox"] : [],
      command: nodeReplPath,
      env: {
        ...node.env,
        ...sandbox,
        NODE_REPL_NODE_PATH: node.path,
        NODE_REPL_SESSION_ID: threadId,
      },
    }
    const surfaces = this.#surfaces()
    const root = resolveCuaRoot()
    const cuaReplConfig = await cuaReplServerConfig(
      root,
      cuaReplLaunch({
        env: {
          ...node.env,
          ...sandbox,
          NODE_REPL_HOST_SERVICES_PIPE_PATH: pipePath,
          NODE_REPL_SESSION_ID: threadId,
        },
        nodePath: node.path,
        nodeReplPath,
        root,
        backends: this.#backends(),
        surfaces,
      }),
      surfaces.length > 0
    )
    return { config, cuaReplConfig, pipePath }
  }

  /**
   * The environment of a Claude session for `threadId`. Its `cua` plugin starts `cua_repl` with
   * these values; the socket starts listening before the REPL first connects.
   */
  sessionEnvironment(threadId: string, cwd?: string | null): Record<string, string> {
    const service = this.#service(threadId, cwd)
    void service.start().catch((error) => {
      this.#logger?.warn?.({ error, threadId }, "cua host services did not start")
    })
    return {
      [CUA_HOST_PIPE_ENV]: service.pipePath,
      [CUA_SURFACES_ENV]: this.#surfaces().join(","),
      [CUA_BROWSER_BACKENDS_ENV]: this.#backends().join(","),
    }
  }

  async closeHostService(threadId: string): Promise<void> {
    this.#cua.closeThread(threadId)
    const service = this.#services.get(threadId)
    if (!service) return
    this.#services.delete(threadId)
    await service.close()
  }

  async closeAll(): Promise<void> {
    const all = Array.from(this.#services.values())
    this.#services.clear()
    await Promise.all(all.map((service) => service.close()))
  }
}
