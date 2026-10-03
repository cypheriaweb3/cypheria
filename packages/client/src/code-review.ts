import type {
  CODE_REVIEW_GITHUB_HOST_OPERATIONS,
  CODE_REVIEW_GITLAB_OPERATIONS,
  CodeReviewClientMessage,
  CodeReviewPullRequest,
  CodeReviewPullRequestList,
  CodeReviewSetup,
  CodeReviewSidebarItem,
} from "@cypheria/protocol"

import type { RequestOptions } from "./request-options.js"
import type { ServerClient } from "./server-client.js"

type ResultPayload<T> =
  | { ok: true; value: T }
  | {
      error: { code: string; message: string; kind?: string; retryAt?: number }
      ok: false
    }

/** A failed Code Review or extension request, with the failure kind an App shows. */
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

export const unwrapResult = <T>(message: { payload: unknown }): T => {
  const payload = message.payload as ResultPayload<T>
  if (payload.ok) return payload.value
  throw new CodeReviewRequestError(payload.error)
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
  /** Calls a `pull_requests.*` tool without an App, such as finding a Thread's pull request. */
  callTool(
    name: string,
    args: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<{ content: unknown[]; isError: boolean; structuredContent?: Record<string, unknown> }>
  provider<T = unknown>(request: ProviderRequest, options?: RequestOptions): Promise<T>
  /** Pinned and recently opened pull requests, which the Server keeps for every client. */
  readonly pullRequests: CodeReviewPullRequestActions
}

export interface CodeReviewPullRequestActions {
  list(
    list: CodeReviewPullRequestList,
    accountKey: string,
    options?: RequestOptions
  ): Promise<CodeReviewPullRequest[]>
  /** Saves at the top of the list; `updateOnly` refreshes a kept one in place and adds nothing. */
  save(
    list: CodeReviewPullRequestList,
    accountKey: string,
    item: CodeReviewSidebarItem,
    input?: { updateOnly?: boolean },
    options?: RequestOptions
  ): Promise<CodeReviewPullRequest | null>
  remove(
    list: CodeReviewPullRequestList,
    accountKey: string,
    url: string,
    options?: RequestOptions
  ): Promise<boolean>
  subscribe(
    handler: (change: { list: CodeReviewPullRequestList; accountKey: string }) => void
  ): () => void
}

export const createCodeReviewActions = (client: ServerClient): CodeReviewActions => {
  const request = async <T>(
    type: CodeReviewClientMessage["type"],
    payload: unknown,
    options?: RequestOptions
  ): Promise<T> => unwrapResult<T>(await client.requestCodeReview(type, payload, options))
  return {
    callTool: (name, args, options) =>
      request("codeReview.tool.call.request", { arguments: args, name }, options),
    getSetup: (options) => request("codeReview.setup.get.request", {}, options),
    provider: async <T>(input: ProviderRequest, options?: RequestOptions) =>
      (await request<{ value: T }>("codeReview.provider.request", input, options)).value,
    pullRequests: {
      list: async (list, accountKey, options) =>
        (
          await request<{ items: CodeReviewPullRequest[] }>(
            "codeReview.pullRequests.list.request",
            { accountKey, list },
            options
          )
        ).items,
      remove: async (list, accountKey, url, options) =>
        (
          await request<{ removed: boolean }>(
            "codeReview.pullRequests.remove.request",
            { accountKey, list, url },
            options
          )
        ).removed,
      save: async (list, accountKey, item, input = {}, options) =>
        (
          await request<{ item: CodeReviewPullRequest | null }>(
            "codeReview.pullRequests.save.request",
            { accountKey, item, list, ...(input.updateOnly ? { updateOnly: true } : {}) },
            options
          )
        ).item,
      subscribe: (handler) =>
        client.on("codeReview.pullRequests.changed.notification", (message) =>
          handler(message.payload)
        ),
    },
  }
}
