import { describe, expect, it, vi } from "vitest"

import type { CodeReviewBackend } from "./backend.js"
import { GITLAB_CONNECTOR_ID, gitLabConnectorHostname, isUsableLink } from "./host-service.js"
import type { PrivateReviews } from "./private-reviews.js"
import { isFindingAnchored, readDiffHunks } from "./private-reviews.js"
import { CodeReviewTools, markdownMedia, parseReviewMetadata } from "./tools.js"

const octo = { hostname: "github.com", login: "octo" }
const pr = { hostname: "github.com", number: 7, owner: "cypheria", repository: "app" }

const setup = (account = octo) => {
  const github = vi.fn(async (operation: string, body: unknown) => ({ body, operation }))
  const backend = {
    clearAccounts: vi.fn(),
    github,
    githubAccount: vi.fn(async () => ({ currentUser: { account, status: "success" } })),
  } as unknown as CodeReviewBackend
  const reviews = { invalidateDetails: vi.fn() } as unknown as PrivateReviews
  const tools = new CodeReviewTools({
    backend,
    reviews,
    settings: () => ({ githubConnection: null }),
  })
  return { backend, github, reviews, tools }
}

describe("Code Review tools", () => {
  it("lists thirty-one tools and gives the model only pull_requests.checks", () => {
    const { tools } = setup()
    const names = tools.list().map((tool) => tool.name)
    expect(names).toHaveLength(31)
    expect(new Set(names).size).toBe(31)
    expect(names.every((name) => name.startsWith("pull_requests."))).toBe(true)
    expect(tools.listForModel().map((tool) => tool.name)).toEqual(["pull_requests.checks"])
    const open = tools.list().find((tool) => tool.name === "pull_requests.open")
    expect(open?._meta).toMatchObject({
      "openai/ui": { entrypoints: [{ type: "global" }, { type: "thread" }] },
      ui: { resourceUri: "ui://pull-requests/app", visibility: ["app"] },
    })
  })

  it("opens the inbox or one pull request", async () => {
    const { tools } = setup()
    expect((await tools.call("pull_requests.open", {})).structuredContent).toMatchObject({
      initialView: { type: "inbox" },
      usesService: true,
    })
    expect(
      (await tools.call("pull_requests.open", { initialView: "pull_request", pullRequest: pr }))
        .structuredContent
    ).toMatchObject({ initialView: { pullRequest: pr, type: "pull_request" } })
  })

  it("reads through the service with the current account", async () => {
    const { github, tools } = setup()
    const result = await tools.call("pull_requests.body", { account: octo, pullRequest: pr })
    expect(result.isError).toBe(false)
    expect(github).toHaveBeenCalledWith("gh-pr-body", { account: octo, pullRequest: pr })
  })

  it("rejects a caller whose account is no longer signed in", async () => {
    const { tools } = setup({ hostname: "github.com", login: "someone-else" })
    const result = await tools.call("pull_requests.body", { account: octo, pullRequest: pr })
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toEqual({ readFailure: { kind: "access" } })
  })

  it("builds a guarded merge and invalidates the inbox details", async () => {
    const { github, reviews, tools } = setup()
    await tools.call("pull_requests.merge", {
      account: octo,
      expectedHeadRevision: "a".repeat(40),
      mergeMethod: "squash",
      pullRequest: pr,
    })
    expect(github).toHaveBeenCalledWith("gh-pr-merge", {
      account: octo,
      expectedHeadRevision: "a".repeat(40),
      mergeMethod: "squash",
      pullRequest: pr,
    })
    expect(reviews.invalidateDetails).toHaveBeenCalledWith(octo, [pr])
  })

  it("requires the displayed head for inline comments", async () => {
    const { tools } = setup()
    const result = await tools.call("pull_requests.comment", {
      body: "Looks off",
      inlineComment: { line: 3, path: "a.ts", side: "right" },
      pullRequest: pr,
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({
      text: "Inline comments require the displayed head revision",
    })
  })

  it("adds provider guidance to checks and reads GitLab diagnostics", async () => {
    const { tools, backend } = setup()
    const checks = await tools.call("pull_requests.checks", { pullRequest: pr })
    expect(checks.structuredContent?.providerGuidance).toMatch(/^GitHub guidance/u)
    const gitlab = vi.fn(async () => ({
      annotationsSupported: false,
      headRevision: "b".repeat(40),
      job: null,
      jobs: [
        {
          allowFailure: false,
          id: 9,
          kind: "job",
          link: "https://gitlab.com/j/9",
          name: "test",
          stage: "test",
          status: "failed",
        },
      ],
      log: null,
      nextPage: null,
      paginationTruncated: false,
      pipelineId: 4,
      projectId: 5,
      status: "success",
      unavailable: null,
    }))
    Object.assign(backend, { gitlab })
    const account = {
      accountLinkId: "link",
      connectorId: GITLAB_CONNECTOR_ID,
      hostId: "local",
      hostname: "gitlab.com",
      provider: "gitlab-connector",
    }
    const result = await tools.call("pull_requests.checks", {
      account,
      pullRequest: { ...pr, hostname: "gitlab.com" },
    })
    expect(result.structuredContent).toMatchObject({
      nextRequests: [{ arguments: { jobId: 9, pipelineId: 4, projectId: 5 }, kind: "log" }],
      providerGuidance: expect.stringMatching(/^GitLab guidance/u),
    })
  })
})

describe("Code Review helpers", () => {
  it("parses review metadata into inbox details", () => {
    const [detail] = parseReviewMetadata(
      {
        data: {
          p0: {
            pullRequest: {
              additions: 3,
              baseRefName: "main",
              baseRefOid: "a".repeat(40),
              deletions: 1,
              headRefOid: "b".repeat(40),
              isDraft: false,
              mergeStateStatus: "CLEAN",
              mergeable: "MERGEABLE",
              reviewDecision: "APPROVED",
              reviews: { nodes: [{ commit: { oid: "c".repeat(40) }, state: "COMMENTED" }] },
              state: "OPEN",
              totalCommentsCount: 2,
              viewerOpinion: { nodes: [] },
            },
          },
        },
      },
      [pr],
      5
    )
    expect(detail).toMatchObject({
      canMerge: true,
      fetchedAt: 5,
      lastReviewedRevision: "c".repeat(40),
      reviewStatus: "approved",
      viewerReviewState: "COMMENTED",
    })
  })

  it("anchors findings to changed hunks only", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -10,2 +10,3 @@",
      " keep",
      "-old",
      "+new",
      "+more",
    ].join("\n")
    const hunks = readDiffHunks(diff)
    expect(hunks).toMatchObject({ additions: 2, deletions: 1, fileCount: 1 })
    const lines = Object.fromEntries(hunks.lines)
    expect(isFindingAnchored(lines, { line: 11, path: "src/a.ts", side: "right" })).toBe(true)
    expect(isFindingAnchored(lines, { line: 30, path: "src/a.ts", side: "right" })).toBe(false)
    expect(isFindingAnchored(lines, { line: 11, path: "../a.ts", side: "right" })).toBe(false)
  })

  it("accepts only GitHub media hosts from rendered Markdown", () => {
    expect(
      markdownMedia('<p><img src="https://camo.githubusercontent.com/x?a=1&amp;b=2"></p>')
    ).toEqual({
      expiresAt: null,
      src: "https://camo.githubusercontent.com/x?a=1&b=2",
      status: "success",
    })
    expect(markdownMedia('<img src="https://evil.example/x.png">').status).toBe("error")
  })

  it("resolves GitLab connector hosts and usable links", () => {
    expect(
      gitLabConnectorHostname({
        base_url: "https://gitlab.example.org/api/v4",
        id: "connector_x",
        service: "templated_apps_GitLab:connector_x",
        template_id: "templated_apps_GitLab",
      })
    ).toBe("gitlab.example.org")
    expect(
      gitLabConnectorHostname({
        base_url: "http://gitlab.example.org/api/v4",
        id: "c",
        template_id: "templated_apps_GitLab",
      })
    ).toBeNull()
    expect(isUsableLink({ connector_id: "c", id: "l" }, "c")).toBe(true)
    expect(isUsableLink({ auth_status: "REAUTH_REQUIRED", connector_id: "c", id: "l" }, "c")).toBe(
      false
    )
  })
})
