import { describe, expect, it } from "vitest"
import type { ComposerDraft } from "../../ipc/src/index.js"

import { isOwnedDraftAttachment, referencedAttachmentKeys } from "./composer-draft-storage.js"

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
})
