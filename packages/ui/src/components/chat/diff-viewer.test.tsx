// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const scrollTo = vi.fn()
const setSelectedLines = vi.fn()
let captured: {
  items: Array<{ annotations: unknown[]; id: string }>
  renderAnnotation: (annotation: unknown) => ReactNode
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

import { ChatDiffViewer, parseChatDiffFiles } from "./diff-viewer.js"

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
