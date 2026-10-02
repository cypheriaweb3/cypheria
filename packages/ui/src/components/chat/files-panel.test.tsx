// @vitest-environment jsdom

import { describe, expect, it } from "vitest"

import { decorateBlameGutter } from "./files-panel.js"

const gutter = (count: number) => {
  const host = document.createElement("div")
  const shadow = host.attachShadow({ mode: "open" })
  for (let line = 1; line <= count; line += 1) {
    const cell = document.createElement("div")
    cell.dataset.columnNumber = String(line)
    shadow.append(cell)
  }
  return { cells: [...shadow.querySelectorAll<HTMLElement>("[data-column-number]")], host }
}

describe("decorateBlameGutter", () => {
  it("labels the first line of each commit run and gives every line its details", () => {
    const { cells, host } = gutter(3)
    const first = { details: "Author: a\nCommit: 1", label: "a · Jan 1" }
    const second = { details: "Author: b\nCommit: 2", label: "b · Feb 2" }
    decorateBlameGutter(
      host,
      new Map([
        [1, first],
        [2, first],
        [3, second],
      ])
    )
    expect(cells.map((cell) => cell.dataset.blame)).toEqual(["a · Jan 1", "", "b · Feb 2"])
    expect(cells.map((cell) => "blameStart" in cell.dataset)).toEqual([true, false, true])
    expect(cells[1]?.title).toBe(first.details)
  })

  it("clears the gutter when blame is off", () => {
    const { cells, host } = gutter(1)
    decorateBlameGutter(host, new Map([[1, { details: "d", label: "l" }]]))
    decorateBlameGutter(host, null)
    expect(cells[0]?.dataset.blame).toBeUndefined()
    expect(cells[0]?.hasAttribute("title")).toBe(false)
  })
})
