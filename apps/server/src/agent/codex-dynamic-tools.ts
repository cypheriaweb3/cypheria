import type { v2 } from "@cypheria/protocol/codex-types"

/** Cypheria identity of the calling thread. Codex's own `threadId` is a harness session id. */
export type CodexDynamicToolCallContext = {
  readonly cwd?: string
  readonly threadId?: string
}

export type CodexDynamicToolHandler = (
  request: v2.DynamicToolCallParams,
  context: CodexDynamicToolCallContext
) => Promise<v2.DynamicToolCallResponse> | v2.DynamicToolCallResponse

/** Rewrites specs when a Thread starts, for example to list the models the Server can offer. */
export type CodexDynamicToolSpecDecorator = (
  specs: readonly v2.DynamicToolSpec[]
) => Promise<readonly v2.DynamicToolSpec[]> | readonly v2.DynamicToolSpec[]

type Registration = {
  readonly decorate?: CodexDynamicToolSpecDecorator
  readonly handler: CodexDynamicToolHandler
  readonly specs: readonly v2.DynamicToolSpec[]
}

const keysFor = (spec: v2.DynamicToolSpec): string[] =>
  spec.type === "function" ? [spec.name] : spec.tools.map((tool) => `${spec.name}.${tool.name}`)

const requestKey = (request: v2.DynamicToolCallParams): string =>
  request.namespace ? `${request.namespace}.${request.tool}` : request.tool

/** Server-only registry. Trusted integrations register executable handlers here. */
export class CodexDynamicToolRegistry {
  readonly #handlers = new Map<string, { handler: CodexDynamicToolHandler; owner: symbol }>()
  readonly #registrations = new Map<symbol, Registration>()

  clear(): void {
    this.#handlers.clear()
    this.#registrations.clear()
  }

  getSpecs(): v2.DynamicToolSpec[] {
    return [...this.#registrations.values()].flatMap(({ specs }) => [...specs])
  }

  /**
   * The specs to send at thread start. A decorator that throws leaves its own specs unchanged, so
   * a failing lookup never keeps a Thread from starting.
   */
  async resolveSpecs(): Promise<v2.DynamicToolSpec[]> {
    const resolved = await Promise.all(
      [...this.#registrations.values()].map(async ({ decorate, specs }) => {
        if (!decorate) return [...specs]
        try {
          return [...(await decorate(specs))]
        } catch {
          return [...specs]
        }
      })
    )
    return resolved.flat()
  }

  register(
    specs: readonly v2.DynamicToolSpec[],
    handler: CodexDynamicToolHandler,
    options: { decorate?: CodexDynamicToolSpecDecorator } = {}
  ): () => void {
    const owner = Symbol("codex-dynamic-tools")
    const keys = specs.flatMap(keysFor)
    for (const key of keys) {
      if (this.#handlers.has(key)) throw new Error(`Dynamic tool ${key} is already registered.`)
    }
    this.#registrations.set(owner, {
      ...(options.decorate ? { decorate: options.decorate } : {}),
      handler,
      specs: [...specs],
    })
    for (const key of keys) this.#handlers.set(key, { handler, owner })
    return () => {
      this.#registrations.delete(owner)
      for (const key of keys) {
        if (this.#handlers.get(key)?.owner === owner) this.#handlers.delete(key)
      }
    }
  }

  async call(
    request: v2.DynamicToolCallParams,
    context: CodexDynamicToolCallContext = {}
  ): Promise<v2.DynamicToolCallResponse> {
    const registration = this.#handlers.get(requestKey(request))
    if (!registration) {
      return {
        contentItems: [
          {
            text: `No Cypheria dynamic tool handler is registered for ${requestKey(request)}.`,
            type: "inputText",
          },
        ],
        success: false,
      }
    }
    try {
      return await registration.handler(request, context)
    } catch (error) {
      return {
        contentItems: [
          {
            text: error instanceof Error ? error.message : String(error),
            type: "inputText",
          },
        ],
        success: false,
      }
    }
  }
}
