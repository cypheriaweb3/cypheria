import { afterEach, describe, expect, it, vi } from "vitest"
import type { ComposerDraft } from "../../ipc/src/index.js"

import {
  draftAttachmentToInputBlock,
  inputBlocksToComposerDraft,
  isOwnedDraftAttachment,
  referencedAttachmentKeys,
} from "./composer-draft-storage.js"
import { desktopClientStorage } from "./storage.js"

afterEach(() => {
  vi.restoreAllMocks()
})

const draft = (storageKey: string): ComposerDraft => ({
  attachments: [
    {
      attachment: {
        byteSize: 3,
        createdAt: 1,
        fileName: "image.png",
        id: `id-${storageKey}`,
        mimeType: "image/png",
        storageKey,
        storageType: "desktop-file",
      },
      id: `id-${storageKey}`,
      kind: "image",
      name: "image.png",
      status: "ready",
    },
  ],
  status: "editing",
  text: "hello",
  updatedAt: 1,
})

describe("composer draft attachments", () => {
  it("keeps binary metadata separate and exposes referenced keys for GC", () => {
    const first = draft("att_first")
    const second = draft("att_second")
    expect(first.attachments[0] && isOwnedDraftAttachment(first.attachments[0])).toBe(true)
    expect([...referencedAttachmentKeys([first, second])]).toEqual(["att_first", "att_second"])
    expect(JSON.stringify(first)).not.toContain("base64")
  })

  it("restores returned text and resource links into a composer draft", async () => {
    await expect(
      inputBlocksToComposerDraft([
        { text: "first", type: "text" },
        { text: "second", type: "text" },
        {
          name: "Specification",
          type: "resource-link",
          uri: "https://example.com/specification",
        },
      ])
    ).resolves.toMatchObject({
      attachments: [
        {
          kind: "resource-link",
          name: "Specification",
          status: "ready",
          uri: "https://example.com/specification",
        },
      ],
      status: "editing",
      text: "first\nsecond",
    })
  })

  it("preserves an embedded resource URI through draft attachment storage", async () => {
    const bytes = new TextEncoder().encode("resource")
    vi.spyOn(desktopClientStorage.attachments, "save").mockResolvedValue({
      byteSize: bytes.byteLength,
      createdAt: 1,
      fileName: "context.json",
      id: "attachment-1",
      mimeType: "application/json",
      storageKey: "attachment-1",
      storageType: "desktop-file",
    })
    vi.spyOn(desktopClientStorage.attachments, "read").mockResolvedValue(bytes)

    const input = {
      data: btoa("resource"),
      mimeType: "application/json",
      name: "context.json",
      type: "embedded-resource" as const,
      uri: "mcp://server/context/1",
    }
    const restoredDraft = await inputBlocksToComposerDraft([input])
    const attachment = restoredDraft.attachments[0]
    if (!attachment) throw new Error("Embedded resource draft attachment was not restored")

    expect(attachment).toMatchObject({
      kind: "embedded-resource",
      uri: input.uri,
    })
    await expect(draftAttachmentToInputBlock(attachment)).resolves.toEqual(input)
  })
})
