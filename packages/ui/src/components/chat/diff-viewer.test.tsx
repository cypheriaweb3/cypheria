// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const scrollTo = vi.fn()
const setSelectedLines = vi.fn()
let captured: {
  items: Array<{ annotations: unknown[]; collapsed: boolean; id: string }>
  options: {
    diffStyle: string
    expandUnchanged: boolean
    lineDiffType: string
    loadDiffFiles?: (file: unknown) => Promise<unknown>
    onGutterUtilityClick: (range: unknown, context: { item: { id: string } }) => void
  }
  renderAnnotation: (annotation: unknown) => ReactNode
  renderHeaderMetadata?: (item: { id: string }) => ReactNode
  renderHeaderPrefix?: (item: { id: string }) => ReactNode
}

vi.mock("@pierre/diffs/react", async () => {
  const React = await import("react")
  return {
    CodeView: React.forwardRef((props: typeof captured, ref) => {
      captured = props
      React.useImperativeHandle(ref, () => ({ scrollTo, setSelectedLines }))
      return React.createElement("div", { "data-testid": "code-view" })
    }),
  }
})

import { chatGitApplyCommand } from "./diff-controls.js"
import {
  ChatDiffViewer,
  chatDiffFingerprints,
  chatDiffTargetFromRange,
  parseChatDiffFiles,
  resolveChatDiffStyle,
} from "./diff-viewer.js"

afterEach(() => {
  cleanup()
  scrollTo.mockReset()
  setSelectedLines.mockReset()
})

const file = (name: string, line: string) =>
  `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1,2 +1,3 @@\n one\n+${line}\n two\n`

describe("parseChatDiffFiles", () => {
  it("lists the files of a multi-file patch in order", () => {
    const files = parseChatDiffFiles(file("a.ts", "x") + file("src/b.ts", "y"))
    expect(files.map(({ id }) => id)).toEqual(["a.ts", "src/b.ts"])
    expect(files[0]?.file.hunks[0]?.additionLines).toBe(1)
  })

  it("gives a repeated path a distinct id and returns nothing for text that is not a patch", () => {
    expect(parseChatDiffFiles(file("a.ts", "x") + file("a.ts", "y")).map(({ id }) => id)).toEqual([
      "a.ts",
      "a.ts#1",
    ])
    expect(parseChatDiffFiles("  \n")).toEqual([])
  })
})

describe("ChatDiffViewer", () => {
  it("attaches an annotation to the file that holds its path", () => {
    render(
      <ChatDiffViewer
        annotations={[
          { content: <b>thread</b>, key: "t1", lineNumber: 2, path: "src/b.ts", side: "additions" },
        ]}
        patch={file("a.ts", "x") + file("src/b.ts", "y")}
      />
    )
    expect(captured.items.map((item) => item.annotations.length)).toEqual([0, 1])
    const annotation = captured.items[1]?.annotations[0] as { metadata: unknown }
    render(<div>{captured.renderAnnotation(annotation)}</div>)
    expect(screen.getByText("thread")).toBeInTheDocument()
  })

  it("scrolls to the focused line and selects it", async () => {
    render(
      <ChatDiffViewer
        focus={{ lineNumber: 2, path: "src/b.ts", side: "additions" }}
        patch={file("a.ts", "x") + file("src/b.ts", "y")}
      />
    )
    await vi.waitFor(() => expect(scrollTo).toHaveBeenCalled())
    expect(scrollTo).toHaveBeenCalledWith({
      align: "center",
      id: "src/b.ts",
      lineNumber: 2,
      side: "additions",
      type: "line",
    })
    expect(setSelectedLines).toHaveBeenCalledWith({
      id: "src/b.ts",
      range: { end: 2, side: "additions", start: 2 },
    })
  })

  it("renders the fallback when the patch holds no file", () => {
    render(<ChatDiffViewer fallback={<p>No text diff</p>} patch="" />)
    expect(screen.getByText("No text diff")).toBeInTheDocument()
  })
})

const modified = (name: string) =>
  `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1,2 +1,2 @@\n one\n-two\n+three\n`

describe("resolveChatDiffStyle", () => {
  const files = (patch: string) => parseChatDiffFiles(patch).map(({ file }) => file)

  it("keeps an explicit layout", () => {
    expect(resolveChatDiffStyle("split", 100, [])).toBe("split")
    expect(resolveChatDiffStyle("unified", 2000, files(modified("a.ts")))).toBe("unified")
  })

  it("splits a wide view only when some file both removes and adds lines", () => {
    expect(resolveChatDiffStyle("auto", 1200, files(modified("a.ts")))).toBe("split")
    expect(resolveChatDiffStyle("auto", 1200, files(file("a.ts", "x")))).toBe("unified")
    expect(resolveChatDiffStyle("auto", 500, files(modified("a.ts")))).toBe("unified")
  })
})

describe("chatDiffTargetFromRange", () => {
  it("keeps a single line and turns a same-side selection into a range", () => {
    expect(chatDiffTargetFromRange("a.ts", { end: 4, side: "additions", start: 4 })).toEqual({
      lineNumber: 4,
      path: "a.ts",
      side: "additions",
    })
    expect(chatDiffTargetFromRange("a.ts", { end: 3, side: "deletions", start: 7 })).toEqual({
      lineNumber: 7,
      path: "a.ts",
      side: "deletions",
      startLineNumber: 3,
    })
  })

  it("comments on the last line when the selection crosses sides", () => {
    expect(
      chatDiffTargetFromRange("a.ts", { end: 5, endSide: "additions", side: "deletions", start: 2 })
    ).toEqual({ lineNumber: 5, path: "a.ts", side: "additions" })
  })
})

describe("chatDiffFingerprints", () => {
  it("changes only for the file whose diff changed", () => {
    const before = chatDiffFingerprints(file("a.ts", "x") + file("b.ts", "y"))
    const after = chatDiffFingerprints(file("a.ts", "x") + file("b.ts", "z"))
    expect(before.get("a.ts")).toBe(after.get("a.ts"))
    expect(before.get("b.ts")).not.toBe(after.get("b.ts"))
    expect(before.get("a.ts")).toMatch(/^[0-9a-f]{16}$/u)
  })
})

describe("chatGitApplyCommand", () => {
  it("wraps the patch in a heredoc whose delimiter is not a patch line", () => {
    expect(chatGitApplyCommand("a\nb")).toBe(
      "git apply --3way <<'CYPHERIA_PATCH'\na\nb\nCYPHERIA_PATCH\n"
    )
    expect(chatGitApplyCommand("CYPHERIA_PATCH\n")).toBe(
      "git apply --3way <<'CYPHERIA_PATCH_1'\nCYPHERIA_PATCH\nCYPHERIA_PATCH_1\n"
    )
  })
})

describe("ChatDiffViewer options", () => {
  it("passes word diffs, collapsed files, and range comments to the viewer", () => {
    const onRequestComment = vi.fn()
    render(
      <ChatDiffViewer
        collapsedPaths={new Set(["a.ts"])}
        onRequestComment={onRequestComment}
        patch={file("a.ts", "x") + file("src/b.ts", "y")}
        wordDiffs={false}
      />
    )
    expect(captured.options.lineDiffType).toBe("none")
    expect(captured.items.map((item) => item.collapsed)).toEqual([true, false])
    captured.options.onGutterUtilityClick(
      { end: 3, side: "additions", start: 1 },
      { item: { id: "src/b.ts" } }
    )
    expect(onRequestComment).toHaveBeenCalledWith({
      lineNumber: 3,
      path: "src/b.ts",
      side: "additions",
      startLineNumber: 1,
    })
  })

  it("offers collapse and viewed controls in each file header", () => {
    const onToggleCollapsed = vi.fn()
    const onToggleViewed = vi.fn()
    render(
      <ChatDiffViewer
        onToggleCollapsed={onToggleCollapsed}
        onToggleViewed={onToggleViewed}
        patch={file("a.ts", "x")}
        renderFileActions={(entry) => <span>actions for {entry.path}</span>}
        viewedPaths={new Set(["a.ts"])}
      />
    )
    render(
      <div>
        {captured.renderHeaderPrefix?.({ id: "a.ts" })}
        {captured.renderHeaderMetadata?.({ id: "a.ts" })}
      </div>
    )
    fireEvent.click(screen.getByRole("button", { name: "Collapse file" }))
    expect(onToggleCollapsed).toHaveBeenCalledWith("a.ts")
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "true")
    fireEvent.click(screen.getByRole("checkbox"))
    expect(onToggleViewed).toHaveBeenCalledWith("a.ts", false)
    expect(screen.getByText("actions for a.ts")).toBeInTheDocument()
  })

  it("loads both versions of a file for expandable context", async () => {
    const loadFiles = vi.fn(async () => ({
      newContents: "one\nthree\n",
      oldContents: "one\ntwo\n",
    }))
    render(<ChatDiffViewer expandUnchanged loadFiles={loadFiles} patch={modified("a.ts")} />)
    expect(captured.options.expandUnchanged).toBe(true)
    const [entry] = parseChatDiffFiles(modified("a.ts"))
    await expect(captured.options.loadDiffFiles?.(entry?.file)).resolves.toEqual({
      newFile: { contents: "one\nthree\n", name: "a.ts" },
      oldFile: { contents: "one\ntwo\n", name: "a.ts" },
    })
    expect(loadFiles).toHaveBeenCalledWith({ path: "a.ts" })
  })
})
