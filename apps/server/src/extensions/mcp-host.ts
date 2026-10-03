import type { AgentId, ExtensionToolResult } from "@cypheria/protocol"

/** One tool as an MCP server lists it. */
export type McpToolDescriptor = {
  readonly _meta?: Record<string, unknown>
  readonly annotations?: Record<string, unknown>
  readonly description?: string
  readonly icons?: readonly unknown[]
  readonly inputSchema?: unknown
  readonly name: string
  readonly outputSchema?: unknown
  readonly title?: string
}

/** One MCP server as its host reports it. */
export type McpServerInventory = {
  /** Server capabilities from `initialize` or `server/discover`; `null` when unknown. */
  readonly capabilities: Record<string, unknown> | null
  /** Why the tool list is missing. */
  readonly error: string | null
  readonly name: string
  /** `<plugin>@<marketplace>`, or `null` for a server outside a plugin. */
  readonly pluginId: string | null
  readonly serverInfo: {
    readonly icons: readonly unknown[] | null
    readonly name: string
    readonly title: string | null
  } | null
  readonly tools: readonly McpToolDescriptor[]
}

/** An MCP resource content item. */
export type McpResourceContent = {
  readonly _meta?: Record<string, unknown>
  readonly blob?: string
  readonly mimeType?: string
  readonly text?: string
  readonly uri: string
}

/** Where a call runs: a Cypheria Thread's own session, or the host's hidden session. */
export type McpSession = { readonly kind: "host" } | { readonly kind: "thread"; threadId: string }

/** What a host can do; surfaces that need more are not offered through it. */
export type McpHostSupport = {
  /** Whether listed tools carry their complete `_meta` and the server capabilities. */
  readonly fullMetadata: boolean
  /** Whether `readResource` reads any URI rather than only `ui://` ones. */
  readonly serverResources: boolean
  readonly toolCalls: boolean
}

/** An elicitation a server raised during a call the host made for an extension. */
export type McpHostElicitation = {
  readonly message: string
  readonly mode: "form" | "url"
  readonly openai: boolean
  readonly requestedSchema: Record<string, unknown> | null
  readonly server: string
  readonly url: string | null
}

export type McpHostElicitationResult = {
  readonly action: "accept" | "decline" | "cancel"
  readonly content?: Record<string, unknown>
}

/**
 * An Agent, or the Server for bundled plugins, that runs MCP servers and makes MCP calls for
 * extensions. Agents keep the connections; hosts only ask them.
 */
export interface McpHost {
  /** The Agent behind the host; `null` for the Server's bundled plugins. */
  readonly agentId: AgentId | null
  readonly support: McpHostSupport
  /**
   * Whether the host's servers contribute catalog surfaces. Bundled plugins have their own
   * Desktop surfaces, so their servers are only reachable by name.
   */
  readonly catalog?: boolean
  /** Servers the host runs, or none when the Agent is unavailable. */
  listServers(): Promise<readonly McpServerInventory[]>
  readResource(input: {
    meta?: Record<string, unknown>
    server: string
    session: McpSession
    uri: string
  }): Promise<readonly McpResourceContent[]>
  callTool(input: {
    arguments: Record<string, unknown>
    meta?: Record<string, unknown>
    server: string
    session: McpSession
    signal?: AbortSignal
    tool: string
  }): Promise<ExtensionToolResult>
  /** Whether a Thread's own session can make calls now. */
  threadSession?(threadId: string): Promise<boolean>
  dispose?(): Promise<void>
}

/** A request that no host can serve. */
export class ExtensionUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EXTENSION_UNSUPPORTED"
  }
}
