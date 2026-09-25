// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import ChatDemo from "./chat-demo.js"

class ResizeObserverStub implements ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}

class IntersectionObserverStub implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = "0px"
  readonly scrollMargin = "0px"
  readonly thresholds = [0]
  disconnect() {}
  observe() {}
  takeRecords() {
    return []
  }
  unobserve() {}
}

const required = <T extends Element>(container: ParentNode, selector: string): T => {
  const element = container.querySelector<T>(selector)
  if (!element) throw new Error(`Missing demo element: ${selector}`)
  return element
}

const requiredText = <T extends Element>(
  container: ParentNode,
  selector: string,
  text: string
): T => {
  const element = [...container.querySelectorAll<T>(selector)].find(
    (candidate) => candidate.textContent === text
  )
  if (!element) throw new Error(`Missing demo element: ${selector} containing ${text}`)
  return element
}

describe("ChatDemo", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    HTMLElement.prototype.scrollTo = vi.fn()
    Element.prototype.scrollIntoView = vi.fn()
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub)
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    act(() => root.render(<ChatDemo />))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("composes the complete chat shell and controlled panels", async () => {
    expect(required(container, '[data-slot="chat-header-title"]').textContent).toBe(
      "Chat UI component audit"
    )
    const virtualizer = required(container, '[data-chat-demo-virtualizer="true"]')
    expect(virtualizer.getAttribute("data-total-count")).toBe("128")
    expect(container.textContent).toContain("128 messages · virtualized")
    expect(container.querySelectorAll("[data-demo-message]").length).toBeLessThan(128)
    expect(container.querySelectorAll('[data-slot="chat-turn-marker"]')).toHaveLength(18)
    expect(requiredText(container, '[role="tab"]', "Files")).toBeTruthy()
    expect(required(container, '[data-slot="chat-files-panel"]')).toBeTruthy()
    expect(requiredText(container, '[role="tab"]', "Sources")).toBeTruthy()
    expect(requiredText(container, '[role="tab"]', "Terminal")).toBeTruthy()
    expect(container.querySelectorAll('[data-slot="chat-panel-tab"]')).toHaveLength(6)

    await act(async () => {
      required<HTMLButtonElement>(container, '[aria-label="Choose visible demo elements"]').click()
      await Promise.resolve()
    })
    await act(async () => {
      requiredText<HTMLButtonElement>(document, "button", "Show all").click()
      await Promise.resolve()
    })

    expect(required(container, '[data-slot="chat-fixed-turn-summary"]')).toBeTruthy()
    expect(required(container, '[data-slot="chat-composer-top-tray"]')).toBeTruthy()
    expect(required(container, '[data-slot="chat-queued-input-list"]')).toBeTruthy()
    expect(required(container, '[data-slot="chat-composer-banner"]')).toBeTruthy()
    expect(required(container, '[data-slot="chat-desktop-notification-preview"]')).toBeTruthy()
    expect(
      required(document, '[aria-label="Show Turn render groups"]').getAttribute("aria-checked")
    ).toBe("true")

    for (const title of [
      "Artifact",
      "Automation",
      "Browser",
      "Document",
      "Entity",
      "File",
      "Goal",
      "Image",
      "MCP App",
      "Notebook",
      "PDF",
      "Plan",
      "Presentation",
      "Pull request",
      "Files",
      "Review",
      "Sources",
      "Subagents",
      "Summary",
      "Terminal",
      "Workbook",
      "Side chat",
      "MCP thread",
      "MCP file",
      "Sandbox",
      "Timeline",
    ]) {
      expect(requiredText(container, '[role="tab"]', title)).toBeTruthy()
    }
    expect(container.querySelectorAll('[data-slot="chat-panel-resize-handle"]')).toHaveLength(2)

    expect(
      required(container, '[data-slot="chat-workspace-main-stack"]').contains(
        required(container, '[data-slot="chat-header"]')
      )
    ).toBe(true)
    expect(
      required(container, '[data-slot="chat-header"]').classList.contains("desktop-titlebar")
    ).toBe(true)
    expect(required(container, '[data-slot="chat-header"]').classList.contains("z-20")).toBe(false)
    expect(required(container, '[aria-label="Open side panel tab"]')).toBeTruthy()
    expect(required(container, '[aria-label="Open bottom panel tab"]')).toBeTruthy()
    const sideHeader = required(
      required(container, '[data-slot="chat-right-panel-surface"]'),
      '[data-slot="chat-panel-header"]'
    )
    expect(sideHeader.classList.contains("border-b-0")).toBe(true)
    expect(sideHeader.getAttribute("data-workspace-header")).toBe("true")
    const sideActionLabels = [
      ...required(
        sideHeader,
        '[data-slot="chat-panel-header-actions"]'
      ).querySelectorAll<HTMLButtonElement>("button"),
    ]
      .map((button) => button.getAttribute("aria-label"))
      .filter((label): label is string => label !== null)
    expect(sideActionLabels).toEqual(["Enter full screen"])
    const fixedHeaderActions = required(
      container,
      '[data-slot="chat-workspace-fixed-header-actions"]'
    )
    expect(
      [...fixedHeaderActions.querySelectorAll<HTMLButtonElement>("button")].map((button) =>
        button.getAttribute("aria-label")
      )
    ).toEqual(["Toggle bottom panel", "Toggle side panel"])
    expect(fixedHeaderActions.classList.contains("gap-1")).toBe(true)
    expect(fixedHeaderActions.classList.contains("border-b")).toBe(false)
    const bottomHeaderActions = required(
      required(container, '[data-slot="chat-bottom-panel-surface"]'),
      '[data-slot="chat-panel-header-actions"]'
    )
    expect(
      [...bottomHeaderActions.querySelectorAll<HTMLButtonElement>("button")].map((button) =>
        button.getAttribute("aria-label")
      )
    ).toEqual(["Close bottom panel"])

    act(() => required<HTMLButtonElement>(container, '[aria-label="Enter full screen"]').click())
    expect(
      required(container, '[data-slot="chat-workspace-shell"]').getAttribute(
        "data-right-panel-fullscreen"
      )
    ).toBe("true")

    act(() => required<HTMLButtonElement>(container, '[aria-label="Toggle side panel"]').click())
    expect(
      required(container, '[data-slot="chat-right-panel-surface"]').hasAttribute("hidden")
    ).toBe(true)
    expect(
      required(container, '[data-slot="chat-workspace-fixed-header-actions"]').classList.contains(
        "border-b"
      )
    ).toBe(true)
    expect(
      required(container, '[data-slot="chat-header"]').getAttribute("data-fixed-actions-inset")
    ).toBe("true")

    act(() => required<HTMLButtonElement>(container, '[aria-label="Toggle side panel"]').click())
    expect(
      required(container, '[data-slot="chat-right-panel-surface"]').hasAttribute("hidden")
    ).toBe(false)

    act(() => required<HTMLButtonElement>(container, '[aria-label="Hide composer"]').click())
    expect(required(container, '[aria-label="Show composer"]')).toBeTruthy()
    act(() => required<HTMLButtonElement>(container, '[aria-label="Show composer"]').click())
    expect(required(container, '[aria-label="Message Chat Demo"]')).toBeTruthy()
  })

  it("adds a local user turn and exposes the stop state", async () => {
    const editor = required<HTMLDivElement>(container, '[aria-label="Message Chat Demo"]')
    await act(async () => {
      const paragraph = required<HTMLParagraphElement>(editor, "p")
      paragraph.textContent = "Show the streaming state"
      editor.dispatchEvent(new Event("input", { bubbles: true }))
      await Promise.resolve()
    })
    await act(async () => {
      required<HTMLButtonElement>(container, '[aria-label="Send message"]').click()
      await Promise.resolve()
    })

    expect(
      required(container, '[data-chat-demo-virtualizer="true"]').getAttribute("data-total-count")
    ).toBe("129")
    expect(required(container, '[aria-label="Stop generating"]')).toBeTruthy()
    expect(container.textContent).toContain("Preparing a response…")
    expect(required(container, '[aria-label="Message Chat Demo"]').textContent).toBe("")

    act(() => required<HTMLButtonElement>(container, '[aria-label="Stop generating"]').click())
    expect(required<HTMLButtonElement>(container, '[aria-label="Send message"]').disabled).toBe(
      true
    )
  })
})
