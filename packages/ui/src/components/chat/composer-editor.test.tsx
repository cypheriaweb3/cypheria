// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  ChatComposerAttachmentList,
  ChatComposerEditor,
  createChatComposerDocument,
  serializeChatComposerDocument,
} from "./index.js"

beforeEach(() => {
  window.scrollBy = vi.fn()
  document.elementFromPoint = () => document.querySelector("[contenteditable]") ?? document.body
  Range.prototype.getClientRects = () => [new DOMRect(0, 0, 1, 1)] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 1, 1)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("composer editor", () => {
  it("serializes ordinary text, marks and semantic mentions", () => {
    expect(serializeChatComposerDocument(createChatComposerDocument("first\nsecond"))).toBe(
      "first\nsecond"
    )
    expect(
      createChatComposerDocument("Review [$review](skill://review) and [docs](https://example.com)")
        .content?.[0]?.content?.[1]?.type
    ).toBe("skillMention")
    expect(
      serializeChatComposerDocument({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "fileMention",
                attrs: { id: "a", label: "src/app.ts", target: "/src/app.ts" },
              },
              { type: "text", text: " and " },
              {
                type: "skillMention",
                attrs: { id: "b", label: "review", target: "skill://review" },
              },
            ],
          },
        ],
      })
    ).toBe("[@src/app.ts](/src/app.ts) and [$review](skill://review)")
  })

  it("mounts an accessible rich editor without submitting on mount", async () => {
    const onChange = vi.fn()
    render(
      <ChatComposerEditor
        aria-label="Message Cypheria"
        onChange={onChange}
        placeholder="Ask anything"
        value="Hello"
      />
    )
    expect(await screen.findByRole("textbox", { name: "Message Cypheria" })).toHaveTextContent(
      "Hello"
    )
    expect(onChange).not.toHaveBeenCalled()
  })

  it("offers @ references and / commands from caller data", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onCommand = vi.fn()
    render(
      <ChatComposerEditor
        aria-label="Message Cypheria"
        onChange={onChange}
        onCommand={onCommand}
        suggestions={[
          { id: "file", kind: "file", label: "readme.md", target: "README.md" },
          { id: "clear", kind: "command", label: "Clear draft" },
        ]}
        value=""
      />
    )
    const editor = await screen.findByRole("textbox", { name: "Message Cypheria" })
    await user.click(editor)
    await user.type(editor, "@read")
    expect(screen.getByRole("option", { name: "readme.md" })).toBeInTheDocument()
    await user.keyboard("{Enter}")
    expect(onChange.mock.lastCall?.[0]).toContain("[@readme.md](README.md)")
    await user.type(editor, " /cl")
    expect(screen.getByRole("option", { name: "Clear draft" })).toBeInTheDocument()
    await user.keyboard("{Enter}")
    expect(onCommand).toHaveBeenCalledWith("clear")
  })
})

describe("composer attachment list", () => {
  const items = [
    { id: "a", kind: "image" as const, name: "image.png", status: "uploading" as const },
    { id: "b", kind: "file" as const, name: "notes.md", status: "error" as const },
  ]

  it("shows status text and supports remove and keyboard reorder", () => {
    const onRemove = vi.fn()
    const onReorder = vi.fn()
    render(
      <ChatComposerAttachmentList
        aria-label="Attachments"
        errorLabel="Upload failed"
        items={items}
        onRemove={onRemove}
        onReorder={onReorder}
        removeLabel={(item) => `Remove ${item.name}`}
        uploadingLabel="Uploading"
      />
    )
    expect(screen.getByText("Uploading")).toBeInTheDocument()
    expect(screen.getByText("Upload failed")).toBeInTheDocument()
    const firstItem = screen.getAllByRole("listitem")[0]
    if (!firstItem) throw new Error("Missing attachment")
    fireEvent.keyDown(firstItem, { altKey: true, key: "ArrowRight" })
    expect(onReorder).toHaveBeenCalledWith(["b", "a"])
    fireEvent.click(screen.getByRole("button", { name: "Remove notes.md" }))
    expect(onRemove).toHaveBeenCalledWith("b")
  })
})
