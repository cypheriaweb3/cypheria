// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { parseReviewLink } from "./markdown-components.js"
import { chatMediaKindFor, classifyChatLink } from "./markdown-extensions.js"
import {
  type ChatMarkdownHost,
  ChatMarkdownHostContext,
  type ChatResolvedPath,
} from "./markdown-host.js"
import { ChatMessageContent } from "./message-content.js"

afterEach(cleanup)

const host = (overrides: Partial<ChatMarkdownHost> = {}): ChatMarkdownHost => ({
  labels: {
    codeCommentPriority: (priority) => `P${priority}`,
    createdThread: "Open created thread",
    fileOutside: "Outside the workspace",
    fileUnavailable: "File unavailable",
    mediaUnavailable: "Media unavailable",
    openFile: "Open file",
  },
  loadFile: vi.fn(async () => ({ release: vi.fn(), url: "blob:cypheria/test" })),
  openPath: vi.fn(),
  resolvePath: vi.fn(
    async (path: string): Promise<ChatResolvedPath> => ({
      kind: "file",
      mimeType: path.endsWith(".mp3") ? "audio/mpeg" : "image/png",
      path: path.replace(/^\/srv\/w\//u, ""),
      root: "/srv/w",
      sizeBytes: 3,
    })
  ),
  ...overrides,
})

const renderWith = (markdown: string, value: ChatMarkdownHost | null) =>
  render(
    <ChatMarkdownHostContext.Provider value={value}>
      <ChatMessageContent isAnimating={false}>{markdown}</ChatMessageContent>
    </ChatMarkdownHostContext.Provider>
  )

describe("classifyChatLink", () => {
  it("separates file references from web links and fragments", () => {
    expect(classifyChatLink("/Users/me/a.ts")).toBe("path")
    expect(classifyChatLink("~/notes.md")).toBe("path")
    expect(classifyChatLink("src/app.ts#L10")).toBe("path")
    expect(classifyChatLink("C:\\work\\a.ts")).toBe("path")
    expect(classifyChatLink("c:/work/a.ts")).toBe("path")
    expect(classifyChatLink("file:///tmp/a.png")).toBe("path")
    expect(classifyChatLink("cypheria://review?pr=x")).toBe("deep-link")
    expect(classifyChatLink("https://example.com")).toBe("external")
    expect(classifyChatLink("mailto:a@b.c")).toBe("external")
    expect(classifyChatLink("#section")).toBe("external")
    expect(classifyChatLink("//cdn.example.com/a.js")).toBe("external")
  })

  it("names the media element a file suggests", () => {
    expect(chatMediaKindFor("/a/b.PNG")).toBe("image")
    expect(chatMediaKindFor("/a/b.mp3")).toBe("audio")
    expect(chatMediaKindFor("/a/b.mov?x=1")).toBe("video")
    expect(chatMediaKindFor("/a/b.ts")).toBeNull()
  })
})

describe("parseReviewLink", () => {
  it("reads the pull request, file, line, and side", () => {
    expect(
      parseReviewLink(
        "cypheria://review?pr=https%3A%2F%2Fgithub.com%2Fo%2Fr%2Fpull%2F7&path=src%2Fa.ts&line=12&side=left"
      )
    ).toEqual({ line: 12, path: "src/a.ts", pr: "https://github.com/o/r/pull/7", side: "left" })
    expect(parseReviewLink("cypheria://review")).toBeNull()
    expect(parseReviewLink("cypheria://other?pr=x")).toBeNull()
  })
})

describe("Markdown file references", () => {
  it("opens a path link through the Server resolution", async () => {
    const value = host()
    renderWith("See [the app](/srv/w/src/app.ts#L10) now.", value)
    await userEvent.click(await screen.findByRole("button", { name: "the app" }))
    expect(value.resolvePath).toHaveBeenCalledWith("/srv/w/src/app.ts#L10")
    expect(value.openPath).toHaveBeenCalledWith(expect.objectContaining({ kind: "file" }))
  })

  it("marks a path outside the workspace instead of opening it", async () => {
    const value = host({ resolvePath: vi.fn(async () => ({ kind: "outside" as const })) })
    renderWith("[secret](/etc/passwd)", value)
    await userEvent.click(await screen.findByRole("button", { name: "secret" }))
    expect(value.openPath).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "secret" })).toHaveAttribute(
      "title",
      "Outside the workspace"
    )
  })

  it("leaves web links to the default link handling", async () => {
    const { container } = renderWith("[docs](https://example.com/docs)", host())
    expect(await screen.findByText("docs")).toBeInTheDocument()
    expect(container.querySelector('[data-slot="chat-path-link"]')).toBeNull()
    expect(container.querySelector("cypheria-path-link")).toBeNull()
  })

  it("shows an image from the Server host", async () => {
    const value = host()
    const { container } = renderWith("![chart](/srv/w/outputs/chart.png)", value)
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull())
    expect(container.querySelector("img")).toHaveAttribute("src", "blob:cypheria/test")
    expect(container.querySelector("img")).toHaveAttribute("alt", "chart")
  })

  it("plays audio when the Server says the file is audio", async () => {
    const { container } = renderWith("![take](/srv/w/outputs/take.mp3)", host())
    await waitFor(() => expect(container.querySelector("audio")).not.toBeNull())
  })

  it("says so when media cannot be shown", async () => {
    const value = host({ loadFile: vi.fn(async () => null) })
    renderWith("![chart](/srv/w/outputs/chart.png)", value)
    expect(await screen.findByText(/Media unavailable/u)).toBeInTheDocument()
  })

  it("degrades to text without a host", async () => {
    const { container } = renderWith("[the app](/srv/w/src/app.ts) ![chart](/srv/w/c.png)", null)
    expect(await screen.findByText("the app")).toBeInTheDocument()
    expect(screen.getByText("chart")).toBeInTheDocument()
    expect(container.querySelector("img")).toBeNull()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("routes a review deep link to the host", async () => {
    const openReview = vi.fn()
    renderWith(
      "[diff](cypheria://review?pr=https%3A%2F%2Fgithub.com%2Fo%2Fr%2Fpull%2F7&path=a.ts&line=3&side=right)",
      host({ openReview })
    )
    await userEvent.click(await screen.findByRole("button", { name: "diff" }))
    expect(openReview).toHaveBeenCalledWith({
      line: 3,
      path: "a.ts",
      pr: "https://github.com/o/r/pull/7",
      side: "right",
    })
  })
})

describe("Markdown directives", () => {
  it("renders a code comment and opens its file at the line", async () => {
    const value = host()
    renderWith(
      '::code-comment{title="[P2] Off-by-one" body="Loop runs past the end." file="/srv/w/a.ts" start=10 end=11 priority=2}',
      value
    )
    expect(await screen.findByText("[P2] Off-by-one")).toBeInTheDocument()
    expect(screen.getByText("Loop runs past the end.")).toBeInTheDocument()
    expect(screen.getByText("P2")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "/srv/w/a.ts:10-11" }))
    expect(value.resolvePath).toHaveBeenCalledWith("/srv/w/a.ts#L10")
    expect(value.openPath).toHaveBeenCalled()
  })

  it("sends a follow-up when it is chosen", async () => {
    const sendFollowUp = vi.fn()
    renderWith(
      '- :codex-followup[Add tests]{prompt="Add unit tests for the parser"}',
      host({ sendFollowUp })
    )
    await userEvent.click(await screen.findByRole("button", { name: "Add tests" }))
    expect(sendFollowUp).toHaveBeenCalledWith("Add unit tests for the parser")
  })

  it("links a created thread", async () => {
    const openThread = vi.fn()
    renderWith('::created-thread{threadId="0198-abc"}', host({ openThread }))
    await userEvent.click(await screen.findByRole("button", { name: "Open created thread" }))
    expect(openThread).toHaveBeenCalledWith("0198-abc")
  })

  it("leaves prose that only looks like a directive untouched", async () => {
    const { container } = renderWith("Note :smile: and ratio a:b, then :wave[hi] ok.", host())
    await waitFor(() => expect(container.textContent).toContain("Note :smile: and ratio a:b"))
    expect(container.textContent).toContain(":wave[hi]")
  })

  it("shows a follow-up as plain text when the client cannot send one", async () => {
    renderWith('- :codex-followup[Add tests]{prompt="x"}', null)
    expect(await screen.findByText("Add tests")).toBeInTheDocument()
    expect(screen.queryByRole("button")).toBeNull()
  })
})
