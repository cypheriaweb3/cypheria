import type {
  CODE_REVIEW_GITHUB_HOST_OPERATIONS,
  CODE_REVIEW_GITLAB_OPERATIONS,
  CodeReviewClientMessage,
  CodeReviewServerMessage,
  CodeReviewSetup,
  McpAppClientMessage,
  McpAppResourceContent,
  McpAppServerMessage,
  McpAppTool,
  McpAppToolResult,
} from "@cypheria/protocol"

import type { RequestOptions } from "./request-options.js"
import type { ServerClient } from "./server-client.js"

type ResultPayload<T> =
  | { ok: true; value: T }
  | {
      error: { code: string; message: string; kind?: string; retryAt?: number }
      ok: false
    }

/** A failed Code Review host request, with the read failure kind the App shows. */
export class CodeReviewRequestError extends Error {
  readonly kind: string | undefined
  readonly retryAt: number | undefined

  constructor(error: { code: string; message: string; kind?: string; retryAt?: number }) {
    super(error.message)
    this.name = error.code
    this.kind = error.kind
    this.retryAt = error.retryAt
  }
}

const unwrap = <T>(message: McpAppServerMessage | CodeReviewServerMessage): T => {
  const payload = message.payload as ResultPayload<T>
  if (payload.ok) return payload.value
  throw new CodeReviewRequestError(payload.error)
}

/** MCP Apps: read an App's resource and call its server's tools through the Server. */
export interface McpAppActions {
  listTools(server: string, threadId?: string, options?: RequestOptions): Promise<McpAppTool[]>
  readResource(
    server: string,
    uri: string,
    threadId?: string,
    options?: RequestOptions
  ): Promise<McpAppResourceContent[]>
  callTool(
    input: {
      server: string
      name: string
      arguments?: unknown
      threadId?: string
      _meta?: Record<string, unknown>
    },
    options?: RequestOptions
  ): Promise<McpAppToolResult>
}

export const createMcpAppActions = (client: ServerClient): McpAppActions => {
  const request = async <T>(
    type: McpAppClientMessage["type"],
    payload: unknown,
    options?: RequestOptions
  ): Promise<T> => unwrap<T>(await client.requestMcpApp(type, payload, options))
  return {
    callTool: (input, options) => request("mcpApp.tool.call.request", input, options),
    listTools: async (server, threadId, options) =>
      (
        await request<{ tools: McpAppTool[] }>(
          "mcpApp.tools.list.request",
          { server, ...(threadId ? { threadId } : {}) },
          options
        )
      ).tools,
    readResource: async (server, uri, threadId, options) =>
      (
        await request<{ contents: McpAppResourceContent[] }>(
          "mcpApp.resource.read.request",
          { server, uri, ...(threadId ? { threadId } : {}) },
          options
        )
      ).contents,
  }
}

type ProviderRequest =
  | {
      provider: "gitlab"
      operation: (typeof CODE_REVIEW_GITLAB_OPERATIONS)[number]
      body: Record<string, unknown>
    }
  | {
      provider: "github"
      operation: (typeof CODE_REVIEW_GITHUB_HOST_OPERATIONS)[number]
      body: Record<string, unknown>
    }

/** Code Review's host side: provider connections and the operations its host runs. */
export interface CodeReviewActions {
  getSetup(options?: RequestOptions): Promise<CodeReviewSetup>
  provider<T = unknown>(request: ProviderRequest, options?: RequestOptions): Promise<T>
}

export const createCodeReviewActions = (client: ServerClient): CodeReviewActions => {
  const request = async <T>(
    type: CodeReviewClientMessage["type"],
    payload: unknown,
    options?: RequestOptions
  ): Promise<T> => unwrap<T>(await client.requestCodeReview(type, payload, options))
  return {
    getSetup: (options) => request("codeReview.setup.get.request", {}, options),
    provider: async <T>(input: ProviderRequest, options?: RequestOptions) =>
      (await request<{ value: T }>("codeReview.provider.request", input, options)).value,
  }
}
