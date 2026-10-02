import type {
  CodeReviewClientMessage,
  CodeReviewGitLabInstance,
  CodeReviewServerMessage,
  CodeReviewSettings,
  CodeReviewSetup,
} from "@cypheria/protocol"

import {
  type CodeReviewBackend,
  CodeReviewError,
  type ConnectorInfo,
  type ConnectorLink,
} from "./backend.js"

/** The connector the OpenAI GitHub plugin links. */
export const GITHUB_CONNECTOR_ID = "connector_76869538009648d5b282a4bb21c3d157"
/** The connector the OpenAI GitLab plugin links for gitlab.com. */
export const GITLAB_CONNECTOR_ID = "connector_0c9786b2f41f41558056126bdb46c9bd"
/** Template self-managed GitLab instances are created from. */
const GITLAB_TEMPLATE_ID = "templated_apps_GitLab"

export type CodeReviewHostServiceOptions = {
  readonly backend: CodeReviewBackend
  readonly settings: () => CodeReviewSettings
  /** The Codex account Cypheria manages: ChatGPT sign-in and email. */
  readonly codexAccount: () => Promise<{ type: string | null; email: string | null }>
  /** Plugin names installed in Cypheria's Codex, such as `github` and `gitlab`. */
  readonly installedPlugins: () => Promise<ReadonlySet<string>>
  readonly hostId?: string
}

/** A connector link Code Review may act through. */
export const isUsableLink = (
  link: ConnectorLink | null | undefined,
  connectorId: string
): boolean =>
  link?.connector_id === connectorId &&
  Boolean(link.id) &&
  link.auth_status !== "REAUTH_REQUIRED" &&
  link.unavailable_reason == null &&
  link.connector_status !== "DISABLED_BY_ADMIN"

/** The host of a GitLab connector whose API base is `https://<host>/api/v4`. */
export const gitLabConnectorHostname = (connector: ConnectorInfo): string | null => {
  const isGitLabCom = connector.id === GITLAB_CONNECTOR_ID
  if (
    (connector.service !== "gitlab" &&
      (isGitLabCom || connector.service !== `${GITLAB_TEMPLATE_ID}:${connector.id}`)) ||
    connector.status === "DISABLED_BY_ADMIN" ||
    connector.labels?.admin_only_connector === "true" ||
    (!isGitLabCom && connector.template_id !== GITLAB_TEMPLATE_ID) ||
    connector.base_url == null
  ) {
    return null
  }
  try {
    const url = new URL(connector.base_url)
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/api\/v4\/?$/u.test(url.pathname)
    ) {
      return null
    }
    const host = url.hostname
    const expected = `https://${host}/api/v4`
    if (connector.base_url !== expected && connector.base_url !== `${expected}/`) return null
    const labels = host.split(".")
    if (
      host.length > 253 ||
      labels.length < 2 ||
      labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)) ||
      labels.every((label) => /^\d+$/u.test(label)) ||
      host.endsWith(".localhost")
    ) {
      return null
    }
    if (isGitLabCom) return host === "gitlab.com" ? host : null
    return host === "gitlab.com" || host.endsWith(".gitlab.com") ? null : host
  } catch {
    return null
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Code Review's host side: whether ChatGPT, GitHub, and GitLab are connected, and the provider
 * operations the App reaches through its host. GitHub and GitLab accounts come from the OpenAI
 * plugins the user installed and linked in ChatGPT; without them Code Review cannot list or open
 * pull requests.
 */
export class CodeReviewHostService {
  readonly #options: CodeReviewHostServiceOptions
  readonly #hostId: string

  constructor(options: CodeReviewHostServiceOptions) {
    this.#options = options
    this.#hostId = options.hostId ?? "local"
  }

  async handle(
    request: CodeReviewClientMessage,
    send: (message: CodeReviewServerMessage) => void
  ): Promise<boolean> {
    const type = request.type.replace(/\.request$/u, ".response") as CodeReviewServerMessage["type"]
    try {
      const value =
        request.type === "codeReview.setup.get.request"
          ? await this.setup()
          : { value: await this.provider(request.payload) }
      send({
        payload: { ok: true, value },
        requestId: request.requestId,
        type,
      } as CodeReviewServerMessage)
    } catch (error) {
      send({
        payload: {
          error: {
            code: error instanceof CodeReviewError ? "CODE_REVIEW_FAILED" : "CODE_REVIEW_ERROR",
            message: message(error),
            ...(error instanceof CodeReviewError
              ? { kind: error.kind, ...(error.retryAt ? { retryAt: error.retryAt } : {}) }
              : {}),
          },
          ok: false,
        },
        requestId: request.requestId,
        type,
      } as CodeReviewServerMessage)
    }
    return true
  }

  /** Runs one whitelisted provider operation for the App, as the official host bridge does. */
  async provider(
    request: Extract<CodeReviewClientMessage, { type: "codeReview.provider.request" }>["payload"]
  ): Promise<unknown> {
    const body = this.#withHost(request.body)
    return request.provider === "gitlab"
      ? this.#options.backend.gitlab(request.operation, body)
      : this.#options.backend.github(request.operation, body)
  }

  /** Accounts the backend expects tagged with the host that acts for them. */
  #withHost(body: Record<string, unknown>): Record<string, unknown> {
    const account = body.account
    return account && typeof account === "object" && !Array.isArray(account)
      ? { ...body, account: { ...(account as Record<string, unknown>), hostId: this.#hostId } }
      : body
  }

  async setup(): Promise<CodeReviewSetup> {
    const account = await this.#options.codexAccount().catch(() => ({ email: null, type: null }))
    const signedIn = account.type === "chatgpt"
    const plugins = await this.#options.installedPlugins().catch(() => new Set<string>())
    const empty: CodeReviewSetup = {
      chatgpt: { email: account.email, signedIn },
      github: {
        connections: [],
        error: null,
        pluginInstalled: plugins.has("github"),
        status: "required",
      },
      gitlab: {
        account: null,
        error: null,
        instances: [],
        pluginInstalled: plugins.has("gitlab"),
        status: "required",
      },
    }
    if (!signedIn) return empty
    const [github, gitlab] = await Promise.all([
      this.#github(empty.github),
      this.#gitlab(empty.gitlab),
    ])
    return { ...empty, github, gitlab }
  }

  async #github(base: CodeReviewSetup["github"]): Promise<CodeReviewSetup["github"]> {
    try {
      const [link, connections] = await Promise.all([
        this.#options.backend.connectorLink(GITHUB_CONNECTOR_ID),
        this.#options.backend.githubConnections().catch(() => []),
      ])
      const views = connections.map((entry) => ({
        accountLinkId: entry.connection.accountLinkId,
        connectorId: entry.connection.connectorId,
        hostname: entry.hostname,
        login: entry.login ?? null,
        name: entry.name ?? null,
      }))
      const selected = this.#options.settings().githubConnection
      const ready =
        isUsableLink(link, GITHUB_CONNECTOR_ID) ||
        (selected != null &&
          views.some(
            (view) =>
              view.hostname === selected.hostname &&
              view.connectorId === selected.connectorId &&
              view.accountLinkId === selected.accountLinkId
          ))
      return { ...base, connections: views, status: ready ? "ready" : "required" }
    } catch (error) {
      return { ...base, error: message(error), status: "error" }
    }
  }

  async #gitlab(base: CodeReviewSetup["gitlab"]): Promise<CodeReviewSetup["gitlab"]> {
    try {
      const [templated, links] = await Promise.all([
        this.#options.backend.connectorsByTemplate(GITLAB_TEMPLATE_ID).catch(() => []),
        this.#options.backend.accessibleLinks().catch(() => []),
      ])
      const instances: CodeReviewGitLabInstance[] = []
      for (const connector of templated) {
        if (
          connector.template_id !== GITLAB_TEMPLATE_ID ||
          connector.status === "DISABLED_BY_ADMIN"
        )
          continue
        const link = links.find((entry) => entry.connector_id === connector.id)
        if (!isUsableLink(link, connector.id)) continue
        const details = await this.#options.backend.connector(connector.id).catch(() => null)
        const hostname = details?.id === connector.id ? gitLabConnectorHostname(details) : null
        if (hostname) {
          instances.push({
            connected: true,
            connectorId: connector.id,
            hostname,
            name: details?.name ?? hostname,
          })
        }
      }
      instances.sort((left, right) => left.hostname.localeCompare(right.hostname))
      const connectorId = this.#options.settings().gitlabConnectorId ?? GITLAB_CONNECTOR_ID
      const link = await this.#options.backend.connectorLink(connectorId)
      let hostname: string | null = connectorId === GITLAB_CONNECTOR_ID ? "gitlab.com" : null
      if (connectorId !== GITLAB_CONNECTOR_ID) {
        const details = await this.#options.backend.connector(connectorId)
        hostname = details?.id === connectorId ? gitLabConnectorHostname(details) : null
      }
      const usable = hostname != null && isUsableLink(link, connectorId) && link?.id
      return {
        ...base,
        account: usable
          ? {
              accountLinkId: link.id as string,
              connectorId,
              hostId: this.#hostId,
              hostname: hostname as string,
              provider: "gitlab-connector",
            }
          : null,
        instances,
        status: usable ? "ready" : "required",
      }
    } catch (error) {
      return { ...base, error: message(error), status: "error" }
    }
  }
}
