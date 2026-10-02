import { z } from "zod"

import type { ChatGptSession } from "./chatgpt-session.js"

/** Why a Code Review read failed, so the App can tell access, rate limits, and retries apart. */
export type CodeReviewFailureKind = "access" | "rate-limit" | "transient"

export class CodeReviewError extends Error {
  readonly kind: CodeReviewFailureKind
  readonly retryAt: number | undefined
  readonly status: number | undefined

  constructor(
    message: string,
    kind: CodeReviewFailureKind,
    options: { retryAt?: number; status?: number; cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = "CodeReviewError"
    this.kind = kind
    this.retryAt = options.retryAt
    this.status = options.status
  }
}

/** The connection of a GitHub account linked in ChatGPT. */
export type GitHubConnection = { readonly connectorId: string; readonly accountLinkId: string }

const DEFAULT_BASE_URL = "https://chatgpt.com/backend-api"
const DEFAULT_TIMEOUT_MS = 60_000
const ACCOUNT_TTL_MS = 15 * 60_000

/**
 * The ChatGPT backend Code Review reads and writes through. Only ChatGPT over HTTPS, or loopback
 * HTTP for local development, may receive the user's token.
 */
export const codeReviewBackendUrl = (value = process.env.CODEX_API_BASE_URL): URL => {
  const base = new URL(value?.trim().replace(/\/+$/u, "") || DEFAULT_BASE_URL)
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)
  const chatgpt =
    base.hostname === "chatgpt.com" ||
    base.hostname === "chatgpt-staging.com" ||
    base.hostname.endsWith(".chatgpt-staging.com")
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !((loopback && base.protocol === "http:") || (chatgpt && base.protocol === "https:"))
  ) {
    throw new Error("Code Review credentials require ChatGPT HTTPS or loopback HTTP")
  }
  return base
}

const FailureBodySchema = z.object({
  detail: z.string().optional().catch(undefined),
  error: z.object({ message: z.string() }).optional().catch(undefined),
})

const ConnectionsSchema = z.array(
  z.object({
    hostname: z.string().min(1),
    connection: z.object({ connectorId: z.string().min(1), accountLinkId: z.string().min(1) }),
    login: z.string().optional(),
    name: z.string().optional(),
  })
)
export type GitHubConnectionEntry = z.infer<typeof ConnectionsSchema>[number]

const LinkSchema = z.object({
  link: z
    .object({
      id: z.string().nullish(),
      connector_id: z.string().nullish(),
      auth_status: z.string().nullish(),
      unavailable_reason: z.string().nullish(),
      connector_status: z.string().nullish(),
    })
    .passthrough()
    .nullish(),
})
export type ConnectorLink = NonNullable<z.infer<typeof LinkSchema>["link"]>

const ConnectorSchema = z
  .object({
    id: z.string(),
    name: z.string().nullish(),
    service: z.string().nullish(),
    status: z.string().nullish(),
    template_id: z.string().nullish(),
    base_url: z.string().nullish(),
    labels: z.record(z.string(), z.unknown()).nullish(),
  })
  .passthrough()
export type ConnectorInfo = z.infer<typeof ConnectorSchema>

const AccountLinksSchema = z.object({
  links: z.array(
    z
      .object({
        id: z.string().nullish(),
        connector_id: z.string().nullish(),
        auth_status: z.string().nullish(),
        unavailable_reason: z.string().nullish(),
        connector_status: z.string().nullish(),
      })
      .passthrough()
  ),
})

type RequestOptions = { readonly signal?: AbortSignal; readonly timeoutMs?: number }

/**
 * The OpenAI backend behind Code Review: `wham/github` and `wham/gitlab` operations act through the
 * GitHub and GitLab accounts the user linked in ChatGPT, and the connector endpoints report which
 * accounts are linked. Requests carry the ChatGPT session of Cypheria's Codex sign-in.
 */
export class CodeReviewBackend {
  readonly #session: ChatGptSession
  readonly #fetch: typeof fetch
  readonly #base: URL
  readonly #now: () => number
  readonly #retryAt = new Map<string, number>()
  readonly #accounts = new Map<string, { expiresAt: number; value: Promise<unknown> }>()

  constructor(
    session: ChatGptSession,
    options: { fetch?: typeof fetch; baseUrl?: string; now?: () => number } = {}
  ) {
    this.#session = session
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#base = codeReviewBackendUrl(options.baseUrl)
    this.#now = options.now ?? Date.now
  }

  get session(): ChatGptSession {
    return this.#session
  }

  /** Runs a `wham/github/operations/<operation>` request. */
  github<T = unknown>(operation: string, body: unknown, options: RequestOptions = {}): Promise<T> {
    return this.#operation<T>("github", operation, body, options)
  }

  /** Runs a `wham/gitlab/operations/<operation>` request. */
  gitlab<T = unknown>(operation: string, body: unknown, options: RequestOptions = {}): Promise<T> {
    return this.#operation<T>("gitlab", operation, body, options)
  }

  /**
   * The GitHub `account` operation, cached for fifteen minutes per host and connection. A signed
   * out or failed result is not cached, and `fresh` always reads again.
   */
  async githubAccount(
    hostname: string,
    connection: GitHubConnection | undefined,
    fresh = false
  ): Promise<unknown> {
    const principal = await this.#session.principal()
    const key = JSON.stringify([
      principal?.accountId,
      principal?.userId,
      hostname.toLowerCase(),
      connection?.connectorId,
      connection?.accountLinkId,
    ])
    const now = this.#now()
    for (const [entryKey, entry] of this.#accounts) {
      if (entry.expiresAt <= now) this.#accounts.delete(entryKey)
    }
    const cached = this.#accounts.get(key)
    if (!fresh && cached && cached.expiresAt > now) return cached.value
    const entry = {
      expiresAt: now + ACCOUNT_TTL_MS,
      value: this.github("account", { connection, hostname }),
    }
    this.#accounts.set(key, entry)
    try {
      const value = await entry.value
      const status = (value as { currentUser?: { status?: string } })?.currentUser?.status
      if (status !== "success" && this.#accounts.get(key) === entry) this.#accounts.delete(key)
      return value
    } catch (error) {
      if (this.#accounts.get(key) === entry) this.#accounts.delete(key)
      throw error
    }
  }

  /** Forgets cached account reads, after an access failure or a connection change. */
  clearAccounts(): void {
    this.#accounts.clear()
  }

  /** The GitHub accounts the user linked in ChatGPT, one entry per host and connection. */
  async githubConnections(options: RequestOptions = {}): Promise<GitHubConnectionEntry[]> {
    const value = await this.#send("GET", "wham/github/connections", undefined, {
      ...options,
      timeoutMs: options.timeoutMs ?? 15_000,
    })
    return ConnectionsSchema.parse(value)
  }

  /** The current user's link to one connector, or null when none exists. */
  async connectorLink(
    connectorId: string,
    options: RequestOptions = {}
  ): Promise<ConnectorLink | null> {
    const value = await this.#send(
      "GET",
      `aip/connectors/${encodeURIComponent(connectorId)}/link`,
      undefined,
      { ...options, timeoutMs: options.timeoutMs ?? 15_000 },
      [404]
    )
    return value === null ? null : (LinkSchema.parse(value).link ?? null)
  }

  /** One connector's details, or null when it is unavailable to the user. */
  async connector(
    connectorId: string,
    options: RequestOptions = {}
  ): Promise<ConnectorInfo | null> {
    const value = await this.#send(
      "GET",
      `aip/connectors/${encodeURIComponent(connectorId)}?include_actions=false`,
      undefined,
      { ...options, timeoutMs: options.timeoutMs ?? 15_000 },
      [403, 404],
      { "OAI-Product-Sku": "CODEX" }
    )
    return value === null ? null : ConnectorSchema.parse(value)
  }

  /** The connectors made from one template, such as self-managed GitLab instances. */
  async connectorsByTemplate(
    templateId: string,
    options: RequestOptions = {}
  ): Promise<ConnectorInfo[]> {
    const value = await this.#send(
      "GET",
      `ps/connectors/by-template?template_id=${encodeURIComponent(templateId)}`,
      undefined,
      { ...options, timeoutMs: options.timeoutMs ?? 15_000 },
      [],
      { "OAI-Product-Sku": "CODEX" }
    )
    return z.object({ connectors: z.array(ConnectorSchema) }).parse(value).connectors
  }

  /** The connector links the user can use. */
  async accessibleLinks(options: RequestOptions = {}): Promise<ConnectorLink[]> {
    const value = await this.#send(
      "POST",
      "aip/connectors/links/list_accessible",
      { link_refresh_strategy: "BLOCKING", principals: [] },
      { ...options, timeoutMs: options.timeoutMs ?? 15_000 },
      [],
      { "OAI-Product-Sku": "CODEX" }
    )
    return AccountLinksSchema.parse(value).links
  }

  async #operation<T>(
    provider: "github" | "gitlab",
    operation: string,
    body: unknown,
    options: RequestOptions
  ): Promise<T> {
    if (!/^[a-z][a-z-]*$/u.test(operation)) throw new Error("Unsupported Code Review operation")
    const account = (body as { account?: Record<string, unknown> } | null)?.account
    const hostname =
      (account?.hostname as string | undefined) ??
      (body as { hostname?: string } | null)?.hostname ??
      `${provider}.com`
    const connection = account?.connection as GitHubConnection | undefined
    const scope = JSON.stringify([
      provider,
      hostname.toLowerCase(),
      connection?.connectorId ?? account?.connectorId,
      connection?.accountLinkId ?? account?.accountLinkId,
    ])
    return (await this.#send(
      "POST",
      `wham/${provider}/operations/${operation}`,
      body,
      options,
      [],
      {},
      scope,
      provider
    )) as T
  }

  async #send(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    options: RequestOptions,
    nullStatuses: readonly number[] = [],
    extraHeaders: Record<string, string> = {},
    scope = path,
    provider: "github" | "gitlab" = "github"
  ): Promise<unknown> {
    const label = provider === "gitlab" ? "GitLab" : "GitHub"
    const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    const url = new URL(this.#base)
    const [pathname, search] = path.split("?", 2)
    url.pathname = `${url.pathname.replace(/\/+$/u, "")}/${pathname}`
    if (search) url.search = search
    const principal = await this.#session.principal()
    const retryKey = JSON.stringify([principal?.accountId, principal?.userId, scope])
    const retryAt = this.#retryAt.get(retryKey) ?? 0
    if (retryAt > this.#now()) {
      throw new CodeReviewError(
        `${label} asked Code Review to wait before trying again.`,
        "rate-limit",
        { retryAt }
      )
    }
    let response: Response
    try {
      response = await this.#session.request(
        (headers) =>
          this.#fetch(url, {
            body: body === undefined ? undefined : JSON.stringify(body),
            headers: {
              ...headers,
              ...extraHeaders,
              Accept: "application/json",
              ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            },
            method,
            redirect: "error",
            signal,
          }),
        signal
      )
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof Error && error.name === "ChatGptSignInError") {
        throw new CodeReviewError(error.message, "access", { cause: error })
      }
      throw new CodeReviewError(`Can't connect to ${label}. Try again.`, "transient", {
        cause: error,
      })
    }
    if ([401, 403, 409].includes(response.status)) this.#accounts.clear()
    if (nullStatuses.includes(response.status)) {
      await response.body?.cancel().catch(() => undefined)
      return null
    }
    if (!response.ok) {
      const failure = FailureBodySchema.safeParse(await response.json().catch(() => null))
      if (response.status === 429 || response.headers.get("x-ratelimit-remaining") === "0") {
        const until = Math.max(
          this.#now() + Number(response.headers.get("retry-after") ?? 60) * 1000,
          Number(response.headers.get("x-ratelimit-reset") ?? 0) * 1000
        )
        for (const [key, deadline] of this.#retryAt) {
          if (deadline <= this.#now()) this.#retryAt.delete(key)
        }
        this.#retryAt.set(retryKey, until)
        throw new CodeReviewError(
          `${label} asked Code Review to wait before trying again.`,
          "rate-limit",
          { retryAt: until, status: response.status }
        )
      }
      if (response.status === 401) {
        throw new CodeReviewError(`Sign in to Codex to connect ${label}`, "access", {
          status: 401,
        })
      }
      if (response.status === 403) {
        throw new CodeReviewError(`${label} access is denied for this workspace`, "access", {
          status: 403,
        })
      }
      const detail = failure.success
        ? (failure.data.error?.message ?? failure.data.detail)
        : undefined
      throw new CodeReviewError(
        `${label} provider request failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`,
        response.status === 404 || response.status === 409 ? "access" : "transient",
        { status: response.status }
      )
    }
    return response.json()
  }
}
