// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import ChatDemo from "./chat-demo.js"

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
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    act(() => root.render(<ChatDemo />))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it("composes the complete chat shell and controlled panels", () => {
    expect(required(container, '[data-slot="chat-header-title"]').textContent).toBe("Chat Demo")
    expect(container.textContent).toContain(
      "Building a reusable Codex-style conversation shell for Cypheria Desktop."
    )
    expect(requiredText(container, '[role="tab"]', "Sources")).toBeTruthy()
    expect(requiredText(container, '[role="tab"]', "Terminal")).toBeTruthy()

    act(() => required<HTMLButtonElement>(container, '[aria-label="Toggle right panel"]').click())
    expect(
      required(container, '[data-slot="chat-right-panel-surface"]').hasAttribute("hidden")
    ).toBe(true)

    act(() => required<HTMLButtonElement>(container, '[aria-label="Toggle right panel"]').click())
    expect(
      required(container, '[data-slot="chat-right-panel-surface"]').hasAttribute("hidden")
    ).toBe(false)

    act(() => required<HTMLButtonElement>(container, '[aria-label="Hide composer"]').click())
    expect(required(container, '[aria-label="Show composer"]')).toBeTruthy()
    act(() => required<HTMLButtonElement>(container, '[aria-label="Show composer"]').click())
    expect(required(container, '[aria-label="Message Chat Demo"]')).toBeTruthy()
  })

  it("adds a local user turn and exposes the stop state", async () => {
    const textarea = required<HTMLTextAreaElement>(container, '[aria-label="Message Chat Demo"]')
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
    act(() => {
      valueSetter?.call(textarea, "Show the streaming state")
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => {
      required<HTMLButtonElement>(container, '[aria-label="Send message"]').click()
      await Promise.resolve()
    })

    expect(container.textContent).toContain("Show the streaming state")
    expect(required(container, '[aria-label="Stop generating"]')).toBeTruthy()
    expect(container.textContent).toContain("Preparing a response…")

    act(() => required<HTMLButtonElement>(container, '[aria-label="Stop generating"]').click())
    expect(required<HTMLButtonElement>(container, '[aria-label="Send message"]').disabled).toBe(
      true
    )
  })
})
