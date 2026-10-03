import { describe, expect, it, vi } from "vitest"

import { GITHUB_CONNECTOR_ID, GITLAB_CONNECTOR_ID } from "../code-review/host-service.js"
import { GitHubCliError } from "./github-cli.js"
import {
  type CodexAppsConnectors,
  PullRequestCreateService,
  pullRequestBrowserUrl,
} from "./pull-request-create-service.js"

const connectorMeta = (connectorId: string, action: string) => ({
  _codex_apps: { resource_uri: `/${connectorId}/link-1/${action}` },
  connector_id: connectorId,
  connector_name: "GitHub",
})

const setup = (
  options: {
    host?: string
    branch?: string | null
    upstream?: string | null
    ahead?: number
    changes?: boolean
    gh?: boolean
    connectorTools?: Map<string, Record<string, unknown>>
  } = {}
) => {
  const state = {
    branch: options.branch === undefined ? "feature" : options.branch,
    upstream: options.upstream ?? null,
    ahead: options.ahead ?? 0,
    changes: options.changes ?? false,
  }
  const calls: string[] = []
  const git = {
    branchContext: vi.fn(async () => ({
      ahead: state.ahead,
      behind: 0,
      current: state.branch,
      defaultBranch: "origin/main",
      upstream: state.upstream,
    })),
    commit: vi.fn(async (_cwd: string, subject: string) => {
      calls.push(`commit:${subject}`)
      state.changes = false
      state.ahead += 1
      return "abcdef1234567890abcdef1234567890abcdef12"
    }),
    commitList: vi.fn(async () => [{ date: "", id: "a".repeat(40), subject: "Last subject" }]),
    discover: vi.fn(async () => ({ root: "/repo" })),
    generateText: vi.fn(async (_cwd: string, kind: "commit" | "pull-request") =>
      kind === "commit"
        ? { body: "", title: "Generated commit" }
        : { body: "Generated body", title: "Generated title" }
    ),
    push: vi.fn(async (_cwd: string, input: { setUpstream?: boolean }) => {
      calls.push(`push:${input.setUpstream ? "upstream" : "plain"}`)
      state.upstream = `origin/${state.branch}`
      state.ahead = 0
      return ""
    }),
    remotes: vi.fn(async () => [
      { host: options.host ?? "github.com", name: "origin", repository: "acme/widgets" },
    ]),
    status: vi.fn(async () => ({
      branch: state.branch,
      entries: state.changes ? [{ code: " M", path: "a.ts" }] : [],
      head: null,
      repository: { root: "/repo" },
      untrackedOmitted: 0,
    })),
    switchToNewBranch: vi.fn(async (_cwd: string, name: string) => {
      calls.push(`branch:${name}`)
      state.branch = name
      state.upstream = null
      return name
    }),
  }
  const gh = {
    available: vi.fn(async () => options.gh ?? true),
    createPullRequest: vi.fn(async () => ({
      number: 5,
      url: "https://github.com/acme/widgets/pull/5",
    })),
  }
  const connectors: CodexAppsConnectors = {
    call: vi.fn(async () => ({
      content: [],
      structuredContent: { number: 9, url: "https://github.com/acme/widgets/pull/9" },
    })),
    tools: vi.fn(async () => options.connectorTools ?? new Map()),
  }
  const attach = vi.fn(async () => undefined)
  const service = new PullRequestCreateService({
    attach,
    connectors,
    gh,
    git: git as never,
  })
  return { attach, calls, connectors, gh, git, service }
}

const base = {
  cwd: "/repo",
  draft: false,
  includeLocalChanges: true,
  openInBrowser: false,
} as const

describe("PullRequestCreateService", () => {
  it("branches, commits, pushes, creates with gh, and attaches the checkout", async () => {
    const { attach, calls, gh, service } = setup({ branch: "main", changes: true })
    const result = await service.create({ ...base, newBranch: "fix/bug", threadId: "thread-1" })

    expect(calls).toEqual(["branch:fix/bug", "commit:Generated commit", "push:upstream"])
    expect(gh.createPullRequest).toHaveBeenCalledWith("/repo", {
      base: "main",
      body: "Generated body",
      draft: false,
      head: "fix/bug",
      title: "Generated title",
    })
    expect(result).toEqual({
      branch: "fix/bug",
      commit: "abcdef1234567890abcdef1234567890abcdef12",
      number: 5,
      openedInBrowser: false,
      source: "github-cli",
      url: "https://github.com/acme/widgets/pull/5",
    })
    expect(attach).toHaveBeenCalledWith("thread-1", "https://github.com/acme/widgets/pull/5", {
      headBranch: "fix/bug",
      root: "/repo",
    })
  })

  it("keeps the user's text, skips a push with nothing to send, and adopts an existing PR", async () => {
    const { attach, calls, gh, git, service } = setup({ upstream: "origin/feature" })
    gh.createPullRequest.mockRejectedValueOnce(
      new GitHubCliError("already exists", "https://github.com/acme/widgets/pull/3")
    )
    const result = await service.create({
      ...base,
      body: "Mine",
      threadId: "thread-1",
      title: "My title",
    })
    expect(calls).toEqual([])
    expect(git.generateText).not.toHaveBeenCalled()
    expect(result).toMatchObject({ number: 3, url: "https://github.com/acme/widgets/pull/3" })
    expect(attach).toHaveBeenCalledOnce()
  })

  it("uses the linked GitHub account when gh is unavailable", async () => {
    const tools = new Map([
      [
        "github.create_pull_request",
        connectorMeta(GITHUB_CONNECTOR_ID, "create_pull_request") as Record<string, unknown>,
      ],
    ])
    const { connectors, service } = setup({ connectorTools: tools, gh: false })
    expect((await service.target("/repo"))?.sources).toEqual(["connector", "browser"])
    const result = await service.create({ ...base, draft: true, title: "T", body: "B" })
    expect(result).toMatchObject({ number: 9, source: "connector" })
    expect(connectors.call).toHaveBeenCalledWith({
      arguments: {
        base: "main",
        body: "B",
        draft: true,
        head: "feature",
        repository_full_name: "acme/widgets",
        title: "T",
      },
      meta: {
        _codex_apps: { resource_uri: `/${GITHUB_CONNECTOR_ID}/link-1/create_pull_request` },
        connector_name: "GitHub",
      },
      tool: "github.create_pull_request",
    })
  })

  it("never retries a connector request whose outcome is unknown", async () => {
    const tools = new Map([
      [
        "gitlab.create_merge_request",
        connectorMeta(GITLAB_CONNECTOR_ID, "create_merge_request") as Record<string, unknown>,
      ],
    ])
    const { connectors, service } = setup({ connectorTools: tools, host: "gitlab.com" })
    vi.mocked(connectors.call).mockRejectedValueOnce(new Error("socket hang up"))
    await expect(service.create({ ...base, title: "T", body: "B" })).rejects.toMatchObject({
      message: expect.stringContaining("Check GitLab in your browser"),
      step: "create",
    })
    expect(connectors.call).toHaveBeenCalledOnce()
  })

  it("opens a prefilled page in the browser and marks GitLab drafts", async () => {
    const { attach, service } = setup({ gh: false, host: "gitlab.com" })
    const result = await service.create({
      ...base,
      body: "B",
      draft: true,
      openInBrowser: true,
      threadId: "thread-1",
      title: "T",
    })
    expect(result.openedInBrowser).toBe(true)
    const url = new URL(result.url)
    expect(url.pathname).toBe("/acme/widgets/-/merge_requests/new")
    expect(url.searchParams.get("merge_request[title]")).toBe("Draft: T")
    expect(attach).not.toHaveBeenCalled()
  })

  it("builds GitHub compare pages for branches with slashes", () => {
    const url = new URL(
      pullRequestBrowserUrl(
        { host: "github.com", owner: "acme", provider: "github", repository: "widgets" },
        { base: "main", body: "B", head: "fix/a b", title: "T" }
      )
    )
    expect(url.pathname).toBe("/acme/widgets/compare/main...fix/a%20b")
    expect(url.searchParams.get("expand")).toBe("1")
  })

  it("refuses a pull request from the base branch and a second one at the same time", async () => {
    const { service } = setup({ branch: "main" })
    await expect(service.create(base)).rejects.toMatchObject({ step: "prepare" })

    const busy = setup()
    let release: () => void = () => undefined
    busy.gh.createPullRequest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ number: 1, url: "https://github.com/acme/widgets/pull/1" })
        })
    )
    const first = busy.service.create({ ...base, title: "T", body: "B" })
    await vi.waitFor(() => expect(busy.gh.createPullRequest).toHaveBeenCalled())
    await expect(busy.service.create({ ...base, title: "T", body: "B" })).rejects.toMatchObject({
      message: expect.stringContaining("already being created"),
    })
    release()
    await first
  })

  it("reports a push that fails after the commit was made", async () => {
    const { git, service } = setup({ changes: true })
    git.push.mockRejectedValueOnce(new Error("rejected"))
    await expect(service.create({ ...base, commitMessage: "Save" })).rejects.toMatchObject({
      message: "Committed abcdef1, but the push failed: rejected",
      step: "push",
    })
  })
})
