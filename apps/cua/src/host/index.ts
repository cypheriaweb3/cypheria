import type {
  CuaImage,
  CuaState,
  IabCommand,
  IabTabInfo,
  McpAppAction,
  McpAppInfo,
  ParsedCuaRequest,
} from "../protocol.ts"
import { CuaRequestSchema } from "../protocol.ts"
import type { CuaSurface } from "../surfaces.ts"
import type { ComputerBackend } from "./computer/backend.ts"
import { CuaHostError } from "./errors.ts"
import type { ExternalBrowsersBackend } from "./external/backend.ts"

export { ComputerBackend, type ToolCaller } from "./computer/backend.ts"
export {
  CUA_DRIVER_QUIET_ENV,
  CuaDriverClient,
  type CuaDriverConnection,
  resolveCuaDriverBinary,
} from "./computer/cua-driver.ts"
export { CuaHostError } from "./errors.ts"
export {
  type AgentBrowserRunner,
  createAgentBrowserRunner,
  resolveAgentBrowserBinary,
} from "./external/agent-browser.ts"
export { ExternalBrowsersBackend } from "./external/backend.ts"
export { browserInstallations, readDevToolsActivePort } from "./external/discovery.ts"

/** What a Thread's request is scoped to. */
export type CuaHostContext = { readonly threadId: string; readonly cwd?: string }

/**
 * The surfaces Cypheria Desktop hosts: built-in browser tabs and MCP Apps. The Server implements
 * it over its browser host broker.
 */
export interface DesktopSurfaces {
  listTabs(context: CuaHostContext): Promise<IabTabInfo[]>
  newTab(
    context: CuaHostContext,
    options: { url?: string; kind: "web" | "dapp" }
  ): Promise<IabTabInfo>
  command(
    context: CuaHostContext,
    tabId: string,
    command: IabCommand,
    args: Record<string, unknown>
  ): Promise<{ result: Record<string, unknown>; notice?: string }>
  listMcpApps(context: CuaHostContext): Promise<McpAppInfo[]>
  mcpApp(
    context: CuaHostContext,
    appId: string,
    action: McpAppAction
  ): Promise<{ text?: string; image?: CuaImage; notice?: string }>
}

export type CuaAuditEvent = {
  readonly threadId: string
  readonly op: string
  readonly target?: string
  readonly ok: boolean
  readonly error?: string
}

export type CuaHostOptions = {
  /** The surfaces settings allow right now; read on every request. */
  readonly surfaces: () => ReadonlySet<CuaSurface>
  readonly desktop?: DesktopSurfaces
  readonly browsers?: ExternalBrowsersBackend
  readonly computer?: ComputerBackend
  /** Records mutations, never page or app content. */
  readonly audit?: (event: CuaAuditEvent) => void
}

const SURFACE_OF: Record<string, CuaSurface | null> = {
  apps: "computer",
  browsers: "browsers",
  iab: "iab",
  mcpapps: "mcpapps",
  state: null,
}

const SURFACE_LABELS: Record<CuaSurface, string> = {
  browsers: "External browser control",
  computer: "Native app control",
  iab: "The built-in browser",
  mcpapps: "MCP App control",
}

const READ_ONLY = new Set([
  "state",
  "apps.list",
  "apps.windows",
  "apps.observe",
  "iab.tabs",
  "browsers.list",
  "browsers.tabs",
  "mcpapps.list",
])

const READ_ONLY_ACTIONS = new Set([
  "snapshot",
  "screenshot",
  "get",
  "wait",
  "logs",
  "scan_qr",
  "extract_assets",
])

/**
 * The privileged side of `cua_repl`. It validates each request from model code, enforces the
 * enabled surfaces, scopes everything to the calling Thread, and dispatches to the backends.
 */
export class CuaHost {
  readonly #options: CuaHostOptions

  constructor(options: CuaHostOptions) {
    this.#options = options
  }

  async handle(input: unknown, context: CuaHostContext): Promise<unknown> {
    const parsed = CuaRequestSchema.safeParse(input)
    if (!parsed.success) {
      throw new CuaHostError(
        "invalid",
        `Invalid cua request: ${parsed.error.issues[0]?.message ?? "malformed"}`
      )
    }
    const request = parsed.data
    const surface = SURFACE_OF[request.op.split(".")[0] as string] ?? null
    if (surface && !this.#options.surfaces().has(surface)) {
      throw new CuaHostError(
        "disabled",
        `${SURFACE_LABELS[surface]} is disabled in Cypheria's Computer Use settings.`
      )
    }
    const mutation = !READ_ONLY.has(request.op) && !this.#readOnlyAction(request)
    try {
      const result = await this.#dispatch(request, context)
      if (mutation) this.#audit(request, context, true)
      return result
    } catch (error) {
      if (mutation) this.#audit(request, context, false, error)
      throw error
    }
  }

  /** Applies end-of-turn tab rules for a Thread. */
  async turnEnded(context: CuaHostContext): Promise<void> {
    await this.#options.browsers?.turnEnded(context.threadId)
  }

  closeThread(threadId: string): void {
    this.#options.browsers?.closeThread(threadId)
    this.#options.computer?.closeThread(threadId)
  }

  #readOnlyAction(request: ParsedCuaRequest): boolean {
    if (request.op === "iab.command") return READ_ONLY_ACTIONS.has(request.command)
    if (request.op === "browsers.act" || request.op === "mcpapps.act") {
      return READ_ONLY_ACTIONS.has(request.action.type)
    }
    return false
  }

  #audit(request: ParsedCuaRequest, context: CuaHostContext, ok: boolean, error?: unknown): void {
    const target =
      "tabId" in request
        ? request.tabId
        : "appId" in request
          ? request.appId
          : "handle" in request
            ? `${request.handle.pid}:${request.handle.windowId}`
            : undefined
    const action =
      "action" in request
        ? `${request.op}:${request.action.type}`
        : "command" in request
          ? `${request.op}:${request.command}`
          : request.op
    this.#options.audit?.({
      ok,
      op: action,
      threadId: context.threadId,
      ...(target ? { target } : {}),
      ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
    })
  }

  #desktop(): DesktopSurfaces {
    if (!this.#options.desktop) {
      throw new CuaHostError("unavailable", "Cypheria Desktop is not connected.")
    }
    return this.#options.desktop
  }

  #browsers(): ExternalBrowsersBackend {
    if (!this.#options.browsers)
      throw new CuaHostError("unavailable", "External browsers are unavailable.")
    return this.#options.browsers
  }

  #computer(): ComputerBackend {
    if (!this.#options.computer)
      throw new CuaHostError("unavailable", "Native app control is unavailable.")
    return this.#options.computer
  }

  async #dispatch(request: ParsedCuaRequest, context: CuaHostContext): Promise<unknown> {
    const { threadId } = context
    switch (request.op) {
      case "state":
        return this.#state(context)
      case "apps.list":
        return this.#computer().listApps(threadId)
      case "apps.windows":
        return this.#computer().listWindows(threadId, request.pid)
      case "apps.get":
        return this.#computer().getApp(threadId, request.app)
      case "apps.observe":
        return this.#computer().observe(threadId, request.handle, request)
      case "apps.act":
        return this.#computer().act(threadId, request.handle, request.action)
      case "iab.tabs":
        return this.#desktop().listTabs(context)
      case "iab.new":
        return this.#desktop().newTab(context, { kind: request.kind ?? "web", url: request.url })
      case "iab.command":
        return this.#desktop().command(context, request.tabId, request.command, request.args)
      case "browsers.list":
        return this.#browsers().list()
      case "browsers.tabs":
        return this.#browsers().tabs(threadId, request.browserId)
      case "browsers.new":
        return this.#browsers().newTab(threadId, request.browserId, request.url)
      case "browsers.claim":
        return this.#browsers().claim(threadId, request.browserId, request.tabId)
      case "browsers.act":
        return this.#browsers().act(
          threadId,
          request.browserId,
          request.tabId,
          request.action,
          context.cwd
        )
      case "mcpapps.list":
        return this.#desktop().listMcpApps(context)
      case "mcpapps.act":
        return this.#desktop().mcpApp(context, request.appId, request.action)
    }
  }

  async #state(context: CuaHostContext): Promise<CuaState> {
    const surfaces = this.#options.surfaces()
    const errors: string[] = []
    const attempt = async <T>(label: string, run: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await run()
      } catch (error) {
        errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
        return undefined
      }
    }
    const [apps, iab, browsers, mcpApps] = await Promise.all([
      surfaces.has("computer")
        ? attempt("Native apps", async () =>
            (await this.#computer().listApps(context.threadId)).filter((app) => app.running)
          )
        : undefined,
      surfaces.has("iab")
        ? attempt("Built-in browser", () => this.#desktop().listTabs(context))
        : undefined,
      surfaces.has("browsers")
        ? attempt("External browsers", async () => {
            const backend = this.#browsers()
            return Promise.all(
              (await backend.list()).map(async (browser) =>
                browser.connectable
                  ? {
                      ...browser,
                      tabs: await backend.tabs(context.threadId, browser.id).catch(() => []),
                    }
                  : browser
              )
            )
          })
        : undefined,
      surfaces.has("mcpapps")
        ? attempt("MCP Apps", () => this.#desktop().listMcpApps(context))
        : undefined,
    ])
    return {
      ...(apps ? { apps } : {}),
      ...(iab ? { iab } : {}),
      ...(browsers ? { browsers } : {}),
      ...(mcpApps ? { mcpApps } : {}),
      ...(errors.length > 0 ? { errors } : {}),
    }
  }
}
