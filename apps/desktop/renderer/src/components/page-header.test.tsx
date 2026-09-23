// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { PageHeader } from "./page-header.js"

describe("PageHeader", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("provides optional route chrome with a customizable content region", () => {
    act(() =>
      root.render(
        <PageHeader aria-label="Project header" className="test-header">
          <span>Project</span>
          <button type="button">Create</button>
        </PageHeader>
      )
    )

    const header = container.querySelector<HTMLElement>('[data-slot="page-header"]')
    expect(header).not.toBeNull()
    expect(header?.classList.contains("desktop-titlebar")).toBe(true)
    expect(header?.classList.contains("test-header")).toBe(true)
    expect(header?.getAttribute("aria-label")).toBe("Project header")
    expect(header?.firstElementChild?.textContent).toContain("Project")
    expect(header?.querySelector("button")?.textContent).toBe("Create")
  })
})
