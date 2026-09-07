import type { CodexAppServerBridge } from "./index.js"
import type { CodexJsonValue } from "./index.js"
import type { v2 } from "./generated/index.js"

export type CodexDynamicToolHandler = (
  request: v2.DynamicToolCallParams
) => Promise<v2.DynamicToolCallResponse> | v2.DynamicToolCallResponse

export type CodexDynamicToolRegistry = {
  readonly close: () => void
  readonly getSpecs: () => readonly v2.DynamicToolSpec[]
  readonly register: (
    specs: readonly v2.DynamicToolSpec[],
    handler: CodexDynamicToolHandler
  ) => () => void
}

const toolKeys = (spec: v2.DynamicToolSpec): string[] =>
  spec.type === "function" ? [spec.name] : spec.tools.map((tool) => `${spec.name}.${tool.name}`)

const requestKey = (request: v2.DynamicToolCallParams): string =>
  request.namespace ? `${request.namespace}.${request.tool}` : request.tool

export const createCodexDynamicToolRegistry = (
  bridge: CodexAppServerBridge
): CodexDynamicToolRegistry => {
  const registrations = new Map<
    symbol,
    { handler: CodexDynamicToolHandler; specs: readonly v2.DynamicToolSpec[] }
  >()
  const handlers = new Map<string, { handler: CodexDynamicToolHandler; owner: symbol }>()
  const unregisterBridge = bridge.onServerRequest("item/tool/call", async (request) => {
    const registration = handlers.get(requestKey(request.params))
    if (!registration) {
      throw new Error(
        `No Cypheria dynamic tool handler is registered for ${requestKey(request.params)}.`
      )
    }
    return (await registration.handler(request.params)) as unknown as CodexJsonValue
  })

  return {
    close: () => {
      unregisterBridge()
      registrations.clear()
      handlers.clear()
    },
    getSpecs: () => [...registrations.values()].flatMap(({ specs }) => [...specs]),
    register: (specs, handler) => {
      const owner = Symbol("codex-dynamic-tools")
      const keys = specs.flatMap(toolKeys)
      for (const key of keys) {
        if (handlers.has(key)) throw new Error(`Dynamic tool ${key} is already registered.`)
      }
      registrations.set(owner, { handler, specs: [...specs] })
      for (const key of keys) handlers.set(key, { handler, owner })
      return () => {
        registrations.delete(owner)
        for (const key of keys) {
          if (handlers.get(key)?.owner === owner) handlers.delete(key)
        }
      }
    },
  }
}
