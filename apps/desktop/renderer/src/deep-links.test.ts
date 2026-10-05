import { describe, expect, it, vi } from "vitest"

import { parseCypheriaDeepLink } from "../../ipc/src/deep-link.js"
import { pullRequestNumber, routeDeepLink, samePullRequest } from "./deep-links.js"

const THREAD = "01984de2-8f74-7c91-a3b2-5c5e937cf400"

describe("parseCypheriaDeepLink", () => {
  it("reads a thread link with and without the review view", () => {
    expect(parseCypheriaDeepLink(`cypheria://threads/${THREAD}`)).toEqual({
      threadId: THREAD,
      type: "thread",
      view: null,
    })
    expect(parseCypheriaDeepLink(`cypheria://threads/${THREAD}?view=review`)).toMatchObject({
      view: "review",
    })
  })

  it("reads a review link with its location and defaults the side to right", () => {
    expect(
      parseCypheriaDeepLink(
        "cypheria://review?pr=https%3A%2F%2Fgithub.com%2Fo%2Fr%2Fpull%2F12&path=src%2Fa.ts&line=7&side=left"
      )
    ).toEqual({
      line: 7,
      path: "src/a.ts",
      pullRequest: "https://github.com/o/r/pull/12",
      side: "left",
      type: "review",
    })
    expect(
      parseCypheriaDeepLink("cypheria://review?pr=https%3A%2F%2Fgithub.com%2Fo%2Fr%2Fpull%2F12")
    ).toMatchObject({ line: null, path: null, side: "right" })
  })

  it.each([
    "https://github.com/o/r/pull/12",
    "cypheria://app/",
    "cypheria://threads/not-an-id",
    `cypheria://threads/${THREAD}?view=other`,
    `cypheria://threads/${THREAD}/extra`,
    "cypheria://review",
    "cypheria://review?pr=http%3A%2F%2Fgithub.com%2Fo%2Fr%2Fpull%2F1",
    "cypheria://review?pr=https%3A%2F%2Fuser%3Apw%40github.com%2Fo%2Fr%2Fpull%2F1",
    "cypheria://review?pr=https%3A%2F%2Fgithub.com%2Fo%2Fr%2Fpull%2F1&line=0",
    "cypheria://review?pr=https%3A%2F%2Fgithub.com%2Fo%2Fr%2Fpull%2F1&side=middle",
    `cypheria://user:pw@threads/${THREAD}`,
  ])("rejects %s", (raw) => {
    expect(parseCypheriaDeepLink(raw)).toBeNull()
  })
})

describe("pull request helpers", () => {
  it("extracts the number and compares pull requests by host and path", () => {
    expect(pullRequestNumber("https://github.com/o/r/pull/12")).toBe(12)
    expect(pullRequestNumber("https://github.com/o/r/issues/12")).toBeNull()
    expect(
      samePullRequest("https://github.com/O/R/pull/12/", "https://GITHUB.com/o/r/pull/12")
    ).toBe(true)
    expect(
      samePullRequest("https://github.com/o/r/pull/12", "https://github.com/o/r/pull/13")
    ).toBe(false)
  })
})

describe("routeDeepLink", () => {
  it("opens a thread with its view, or a review request for the thread on screen", () => {
    const actions = { openPluginApp: vi.fn(), openReview: vi.fn(), openThread: vi.fn() }
    expect(routeDeepLink(`cypheria://threads/${THREAD}?view=review`, actions)).toBe(true)
    expect(actions.openThread).toHaveBeenCalledWith(THREAD, "review")
    expect(
      routeDeepLink(
        "cypheria://review?pr=https%3A%2F%2Fgithub.com%2Fo%2Fr%2Fpull%2F12&path=a.ts&line=3&side=left",
        actions
      )
    ).toBe(true)
    expect(actions.openReview).toHaveBeenCalledWith(
      expect.objectContaining({
        line: 3,
        path: "a.ts",
        pullRequest: "https://github.com/o/r/pull/12",
        side: "deletions",
        threadId: null,
      })
    )
  })

  it("opens a plugin's global entry point at an App-relative path", () => {
    const actions = { openPluginApp: vi.fn(), openReview: vi.fn(), openThread: vi.fn() }
    expect(
      routeDeepLink(
        "cypheria://plugins/bits-and-bolts%40openai/app/cad.library?path=%2Fparts%3Ftag%3Dbolt",
        actions
      )
    ).toBe(true)
    expect(actions.openPluginApp).toHaveBeenCalledWith(
      "bits-and-bolts@openai",
      "cad.library",
      "/parts?tag=bolt"
    )
    expect(routeDeepLink("cypheria://plugins/bits/app/cad.library", actions)).toBe(true)
    expect(actions.openPluginApp).toHaveBeenLastCalledWith("bits", "cad.library", "/")
    expect(routeDeepLink("cypheria://plugins/bits/app/x?path=parts", actions)).toBe(false)
    expect(routeDeepLink("cypheria://plugins/bits/app/x?path=%2Fa%23b", actions)).toBe(false)
  })

  it("ignores text that is not a deep link", () => {
    const actions = { openPluginApp: vi.fn(), openReview: vi.fn(), openThread: vi.fn() }
    expect(routeDeepLink("https://example.com", actions)).toBe(false)
    expect(actions.openReview).not.toHaveBeenCalled()
  })
})
