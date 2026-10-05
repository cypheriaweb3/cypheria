// @vitest-environment jsdom

import {
  type ChatMarkdownHost,
  ChatMarkdownHostContext,
  type ChatResolvedFile,
} from "@cypheria/ui/components/chat"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ThreadGeneratedImage } from "./thread-generated-image.js"

const host = (overrides: Partial<ChatMarkdownHost>): ChatMarkdownHost =>
  ({
    labels: { mediaUnavailable: "Cannot be shown" },
    loadFile: vi.fn(async () => null),
    resolvePath: vi.fn(async () => ({ kind: "outside" })),
    ...overrides,
  }) as unknown as ChatMarkdownHost

describe("ThreadGeneratedImage", () => {
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

  const render = async (value: ChatMarkdownHost, uri: string) => {
    await act(async () => {
      root.render(
        <ChatMarkdownHostContext.Provider value={value}>
          <ThreadGeneratedImage alt="A cat" uri={uri} />
        </ChatMarkdownHostContext.Provider>
      )
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  it("reads a saved image through the Server's file API", async () => {
    const release = vi.fn()
    const file: ChatResolvedFile = {
      kind: "file" as const,
      mimeType: "image/png",
      path: "call_1.png",
      root: "/home/.cypheria/agents/codex/home/generated_images/019a",
      sizeBytes: 3,
    }
    const value = host({
      loadFile: vi.fn(async () => ({ release, url: "blob:image" })),
      resolvePath: vi.fn(async () => file),
    })
    await render(value, "/home/.cypheria/agents/codex/home/generated_images/019a/call_1.png")
    expect(value.resolvePath).toHaveBeenCalledWith(
      "/home/.cypheria/agents/codex/home/generated_images/019a/call_1.png",
      expect.any(AbortSignal)
    )
    expect(value.loadFile).toHaveBeenCalledWith(file, expect.any(AbortSignal))
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:image")
    act(() => root.unmount())
    expect(release).toHaveBeenCalledOnce()
    root = createRoot(container)
  })

  it("shows data URIs directly and marks images it cannot read", async () => {
    const value = host({})
    await render(value, "data:image/png;base64,AAAA")
    expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA")
    expect(value.resolvePath).not.toHaveBeenCalled()
    await render(value, "/elsewhere/x.png")
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector("figure")?.getAttribute("title")).toBe("Cannot be shown")
  })
})
