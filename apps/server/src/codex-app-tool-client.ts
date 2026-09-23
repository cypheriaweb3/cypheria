import type { v2 } from "@cypheria/protocol/codex-types"
import type { AgentManager } from "./agent/agent-manager.js"
import { type CodexAppToolScope, codexAppToolScope } from "./codex-app-tool-scope.js"

type Caller = Pick<AgentManager, "callCodex">

export type CodexAppSelection = {
  connectorId: string
  accountLinkId: string
  server: "codex_apps"
}

/** Invokes only tools bound to the selected connector and account link. */
export class CodexAppToolClient {
  readonly #caller: Caller

  constructor(caller: Caller) {
    this.#caller = caller
  }

  async select(
    connectorId: string,
    namespace: string,
    actions: readonly string[]
  ): Promise<CodexAppSelection> {
    if (actions.length === 0) throw new Error("At least one connector action is required")
    const scopes = await this.#scopes(connectorId, namespace, actions)
    const link = scopes[0]?.accountLinkId
    if (!link || scopes.some((scope) => scope.accountLinkId !== link)) {
      throw new Error("The selected connector account does not provide all required actions")
    }
    return { connectorId, accountLinkId: link, server: "codex_apps" }
  }

  async call(
    selection: CodexAppSelection,
    threadId: string,
    namespace: string,
    action: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    if (!threadId) throw new Error("A Codex thread is required for connector calls")
    const scope = (await this.#scopes(selection.connectorId, namespace, [action]))[0]
    if (!scope || scope.accountLinkId !== selection.accountLinkId) {
      throw new Error("The selected connector account no longer provides this action")
    }
    const result = (await this.#caller.callCodex("mcpServer/tool/call", {
      threadId,
      server: selection.server,
      tool: `${namespace}.${action}`,
      arguments: args,
      _meta: { _codex_apps: { resource_uri: scope.resourceUri } },
    })) as v2.McpServerToolCallResponse
    if (result.isError || result.structuredContent === undefined) {
      throw new Error("The selected connector request failed")
    }
    const after = (await this.#scopes(selection.connectorId, namespace, [action]))[0]
    if (after?.resourceUri !== scope.resourceUri) {
      throw new Error("The selected connector account changed during the request")
    }
    return result.structuredContent
  }

  async #scopes(
    connectorId: string,
    namespace: string,
    actions: readonly string[]
  ): Promise<CodexAppToolScope[]> {
    const names = new Set(actions.map((action) => `${namespace}.${action}`))
    const found = new Map<string, CodexAppToolScope>()
    let cursor: string | null = null
    const seen = new Set<string>()
    let completed = false
    for (let page = 0; page < 100; page += 1) {
      const response = (await this.#caller.callCodex("mcpServerStatus/list", {
        cursor,
        detail: "full",
        limit: 100,
      })) as v2.ListMcpServerStatusResponse
      for (const server of response.data) {
        if (server.name !== "codex_apps") continue
        for (const name of names) {
          const scope = codexAppToolScope(name, server.tools[name]?._meta)
          if (scope?.connectorId === connectorId) found.set(name, scope)
        }
      }
      if (!response.nextCursor) {
        completed = true
        break
      }
      if (seen.has(response.nextCursor))
        throw new Error("MCP server catalog returned a repeated cursor")
      seen.add(response.nextCursor)
      cursor = response.nextCursor
    }
    if (!completed) throw new Error("MCP server catalog exceeded the page limit")
    return actions.map((action) => {
      const scope = found.get(`${namespace}.${action}`)
      if (!scope) throw new Error(`The selected connector does not provide ${namespace}.${action}`)
      return scope
    })
  }
}
