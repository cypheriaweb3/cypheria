import type {
  ExtensionToolResult,
  GitPullRequestSource,
  GitPullRequestTarget,
} from "@cypheria/protocol"
import { z } from "zod"
import { GITHUB_CONNECTOR_ID, GITLAB_CONNECTOR_ID } from "../code-review/host-service.js"
import { codexAppToolScope } from "../codex-app-tool-scope.js"
import type { PullRequestCheckout } from "../thread/thread-attachment-service.js"
import type { GitService } from "./git-service.js"
import { type GitHubCli, GitHubCliError, pullRequestNumber } from "./github-cli.js"

/** The ChatGPT connector tools that create a GitHub pull request and a GitLab merge request. */
const CONNECTOR_TOOLS = {
  github: { connectorId: GITHUB_CONNECTOR_ID, tool: "github.create_pull_request" },
  gitlab: { connectorId: GITLAB_CONNECTOR_ID, tool: "gitlab.create_merge_request" },
} as const

const GitHubCreatedSchema = z.object({ number: z.number().int().positive(), url: z.string().url() })
const GitLabCreatedSchema = z.object({
  data: z.object({ iid: z.number().int().positive(), web_url: z.string().url() }),
})

/** Codex's `codex_apps` server, which hosts the connectors the user linked in ChatGPT. */
export type CodexAppsConnectors = {
  /** The server's tools, by name, with their `_meta`. */
  tools(): Promise<ReadonlyMap<string, Record<string, unknown> | undefined>>
  call(input: {
    tool: string
    arguments: Record<string, unknown>
    meta: Record<string, unknown>
    threadId?: string
  }): Promise<ExtensionToolResult>
}

export type PullRequestCreateInput = {
  readonly cwd: string
  readonly threadId?: string
  readonly base?: string
  readonly newBranch?: string
  readonly includeLocalChanges: boolean
  readonly commitMessage?: string
  readonly title?: string
  readonly body?: string
  readonly draft: boolean
  readonly openInBrowser: boolean
}

export type PullRequestCreateResult = {
  readonly url: string
  readonly number: number | null
  readonly source: GitPullRequestSource
  readonly openedInBrowser: boolean
  readonly branch: string
  readonly commit: string | null
}

/** A failed step of creating a pull request, saying what already happened. */
export class PullRequestCreateError extends Error {
  readonly step: "prepare" | "branch" | "commit" | "push" | "create"

  constructor(step: PullRequestCreateError["step"], message: string) {
    super(message)
    this.name = "PullRequestCreateError"
    this.step = step
  }
}

type Git = Pick<
  GitService,
  | "branchContext"
  | "commit"
  | "commitList"
  | "discover"
  | "generateText"
  | "push"
  | "remotes"
  | "status"
  | "switchToNewBranch"
>

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** A branch name with its remote prefix removed, such as `origin/main` to `main`. */
const localBranch = (name: string | null, remote = "origin"): string | null =>
  name?.startsWith(`${remote}/`) ? name.slice(remote.length + 1) : name

const pathSegments = (value: string): string => value.split("/").map(encodeURIComponent).join("/")

/** The provider page that opens a prefilled pull request or merge request. */
export const pullRequestBrowserUrl = (
  target: Pick<GitPullRequestTarget, "host" | "owner" | "provider" | "repository">,
  input: { base: string; head: string; title: string; body: string }
): string => {
  const project = `https://${target.host}/${pathSegments(target.owner)}/${pathSegments(target.repository)}`
  if (target.provider === "gitlab") {
    const url = new URL(`${project}/-/merge_requests/new`)
    url.searchParams.set("merge_request[source_branch]", input.head)
    url.searchParams.set("merge_request[target_branch]", input.base)
    url.searchParams.set("merge_request[title]", input.title)
    url.searchParams.set("merge_request[description]", input.body)
    return url.href
  }
  const url = new URL(
    `${project}/compare/${pathSegments(input.base)}...${pathSegments(input.head)}`
  )
  url.searchParams.set("expand", "1")
  url.searchParams.set("title", input.title)
  url.searchParams.set("body", input.body)
  return url.href
}

/**
 * Creates a checkout's pull request the way ChatGPT Desktop's Create PR dialog does: an optional
 * new branch, a commit of local changes, a push, then the pull request through `gh`, the account
 * linked in ChatGPT, or a prefilled page in the browser. The created pull request is attached to
 * the Thread with the checkout it came from. A step that fails stops the workflow and is never
 * retried, so a request that may have created a pull request is not sent twice.
 */
export class PullRequestCreateService {
  readonly #git: Git
  readonly #gh: Pick<GitHubCli, "available" | "createPullRequest">
  readonly #connectors: CodexAppsConnectors | null
  readonly #attach: (
    threadId: string,
    url: string,
    checkout: PullRequestCheckout
  ) => Promise<unknown>
  readonly #running = new Set<string>()

  constructor(options: {
    git: Git
    gh: Pick<GitHubCli, "available" | "createPullRequest">
    connectors?: CodexAppsConnectors | null
    attach: (threadId: string, url: string, checkout: PullRequestCheckout) => Promise<unknown>
  }) {
    this.#git = options.git
    this.#gh = options.gh
    this.#connectors = options.connectors ?? null
    this.#attach = options.attach
  }

  /** The connector tool that creates pull requests for a provider, when the user linked one. */
  async #connectorTool(provider: "github" | "gitlab") {
    if (!this.#connectors) return null
    const wanted = CONNECTOR_TOOLS[provider]
    const tools = await this.#connectors.tools().catch(() => null)
    const meta = tools?.get(wanted.tool)
    const scope = codexAppToolScope(wanted.tool, meta)
    if (!meta || scope?.connectorId !== wanted.connectorId) return null
    return {
      meta: {
        ...(typeof meta.connector_name === "string" ? { connector_name: meta.connector_name } : {}),
        _codex_apps: meta._codex_apps,
      },
      tool: wanted.tool,
    }
  }

  /** Where the checkout's pull request would go; null without a github.com or gitlab.com origin. */
  async target(cwd: string): Promise<GitPullRequestTarget | null> {
    const [repository, remotes] = await Promise.all([
      this.#git.discover(cwd),
      this.#git.remotes(cwd),
    ])
    const origin = remotes.find((remote) => remote.name === "origin")
    const provider =
      origin?.host === "github.com" ? "github" : origin?.host === "gitlab.com" ? "gitlab" : null
    if (!origin || !provider) return null
    const parts = origin.repository.split("/").filter(Boolean)
    const name = parts.at(-1)
    if (parts.length < 2 || !name) return null
    const [context, status] = await Promise.all([
      this.#git.branchContext(cwd),
      this.#git.status(cwd),
    ])
    const sources: GitPullRequestSource[] = []
    if (provider === "github" && (await this.#gh.available(origin.host, repository.root))) {
      sources.push("github-cli")
    }
    if (await this.#connectorTool(provider)) sources.push("connector")
    sources.push("browser")
    return {
      ahead: context.ahead,
      branch: context.current,
      defaultBranch: localBranch(context.defaultBranch),
      hasChanges: status.entries.length > 0,
      host: origin.host,
      owner: parts.slice(0, -1).join("/"),
      provider,
      repository: name,
      root: repository.root,
      sources,
      upstream: context.upstream,
    }
  }

  async create(input: PullRequestCreateInput): Promise<PullRequestCreateResult> {
    const target = await this.target(input.cwd)
    if (!target) {
      throw new PullRequestCreateError(
        "prepare",
        "Pull requests need an origin remote on github.com or gitlab.com"
      )
    }
    if (this.#running.has(target.root)) {
      throw new PullRequestCreateError(
        "prepare",
        "A pull request is already being created for this repository"
      )
    }
    this.#running.add(target.root)
    try {
      return await this.#create(input, target)
    } finally {
      this.#running.delete(target.root)
    }
  }

  async #create(
    input: PullRequestCreateInput,
    target: GitPullRequestTarget
  ): Promise<PullRequestCreateResult> {
    const { cwd } = input
    const source: GitPullRequestSource = input.openInBrowser
      ? "browser"
      : (target.sources[0] ?? "browser")
    const base = input.base?.trim() || target.defaultBranch
    if (!base) {
      throw new PullRequestCreateError(
        "prepare",
        "Choose the branch to merge the pull request into"
      )
    }
    let branch = target.branch
    const newBranch = input.newBranch?.trim()
    if (newBranch) {
      try {
        await this.#git.switchToNewBranch(cwd, newBranch)
      } catch (error) {
        throw new PullRequestCreateError("branch", message(error))
      }
      branch = newBranch
    }
    if (!branch) {
      throw new PullRequestCreateError("prepare", "Create a branch for the pull request first")
    }
    if (branch === base) {
      throw new PullRequestCreateError(
        "prepare",
        `Create a branch for the pull request; it cannot merge ${base} into itself`
      )
    }

    let commit: string | null = null
    if (input.includeLocalChanges && (await this.#git.status(cwd)).entries.length > 0) {
      try {
        const subject =
          input.commitMessage?.trim() || (await this.#git.generateText(cwd, "commit")).title
        commit = await this.#git.commit(cwd, subject, { includeUnstaged: true })
      } catch (error) {
        throw new PullRequestCreateError("commit", message(error))
      }
    }

    const context = await this.#git.branchContext(cwd)
    if (!context.upstream || context.ahead > 0) {
      try {
        await this.#git.push(cwd, { branch, remote: "origin", setUpstream: !context.upstream })
      } catch (error) {
        throw new PullRequestCreateError(
          "push",
          commit
            ? `Committed ${commit.slice(0, 7)}, but the push failed: ${message(error)}`
            : message(error)
        )
      }
    }

    let title = input.title?.trim() ?? ""
    let body = input.body?.trim() ?? ""
    if (!title || !body) {
      const written = await this.#git.generateText(cwd, "pull-request", base).catch(() => null)
      title ||= written?.title ?? ""
      body ||= written?.body ?? ""
    }
    if (!title) {
      title = (await this.#git.commitList(cwd, 1).catch(() => []))[0]?.subject.trim() || branch
    }
    if (
      target.provider === "gitlab" &&
      input.draft &&
      !/^(?:draft:|\[draft\]|\(draft\))/iu.test(title)
    ) {
      title = `Draft: ${title}`
    }

    const done = async (url: string, number: number | null): Promise<PullRequestCreateResult> => {
      if (input.threadId) {
        // The pull request exists; failing to record it on the Thread must not hide that.
        await this.#attach(input.threadId, url, { headBranch: branch, root: target.root }).catch(
          () => undefined
        )
      }
      return { branch, commit, number, openedInBrowser: false, source, url }
    }

    if (source === "browser") {
      return {
        branch,
        commit,
        number: null,
        openedInBrowser: true,
        source,
        url: pullRequestBrowserUrl(target, { base, body, head: branch, title }),
      }
    }
    if (source === "github-cli") {
      try {
        const created = await this.#gh.createPullRequest(target.root, {
          base,
          body,
          draft: input.draft,
          head: branch,
          title,
        })
        return done(created.url, created.number)
      } catch (error) {
        if (error instanceof GitHubCliError && error.existingUrl) {
          return done(error.existingUrl, pullRequestNumber(error.existingUrl))
        }
        throw new PullRequestCreateError("create", message(error))
      }
    }
    return this.#createWithConnector(input, target, { base, body, branch, title }, done)
  }

  async #createWithConnector(
    input: PullRequestCreateInput,
    target: GitPullRequestTarget,
    text: { base: string; body: string; branch: string; title: string },
    done: (url: string, number: number | null) => Promise<PullRequestCreateResult>
  ): Promise<PullRequestCreateResult> {
    const connector = this.#connectors
    const tool = await this.#connectorTool(target.provider)
    if (!connector || !tool) {
      throw new PullRequestCreateError(
        "create",
        `Link your ${target.provider === "gitlab" ? "GitLab" : "GitHub"} account in ChatGPT first`
      )
    }
    const project = `${target.owner}/${target.repository}`
    let result: ExtensionToolResult
    try {
      result = await connector.call({
        arguments:
          target.provider === "gitlab"
            ? {
                description: text.body,
                project_id: project,
                source_branch: text.branch,
                target_branch: text.base,
                title: text.title,
              }
            : {
                base: text.base,
                body: text.body,
                draft: input.draft,
                head: text.branch,
                repository_full_name: project,
                title: text.title,
              },
        meta: tool.meta,
        tool: tool.tool,
        ...(input.threadId ? { threadId: input.threadId } : {}),
      })
    } catch {
      // The request may have reached the provider; trying again could open a second one.
      throw new PullRequestCreateError(
        "create",
        `Could not confirm the ${target.provider === "gitlab" ? "merge request" : "pull request"}. Check ${target.provider === "gitlab" ? "GitLab" : "GitHub"} in your browser before trying again`
      )
    }
    if (result.isError) {
      const text = result.content.find(
        (item): item is { type: "text"; text: string } =>
          typeof item === "object" && item !== null && (item as { type?: unknown }).type === "text"
      )
      throw new PullRequestCreateError(
        "create",
        text?.text ?? "The linked account could not create the pull request"
      )
    }
    if (target.provider === "gitlab") {
      const created = GitLabCreatedSchema.safeParse(result.structuredContent)
      if (!created.success) {
        throw new PullRequestCreateError("create", "GitLab did not report the merge request")
      }
      return done(created.data.data.web_url, created.data.data.iid)
    }
    const created = GitHubCreatedSchema.safeParse(result.structuredContent)
    if (!created.success) {
      throw new PullRequestCreateError("create", "GitHub did not report the pull request")
    }
    return done(created.data.url, created.data.number)
  }
}
