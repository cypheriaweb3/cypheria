import type { ThreadInputBlock } from "@cypheria/protocol"
import { decodeValidatedValue } from "@cypheria/storage"
import type { ComposerDraft, ComposerDraftAttachment } from "../../ipc/src/index.js"
import { ComposerDraftSchema, composerDraftKey } from "../../ipc/src/index.js"
import { desktopClientStorage } from "./storage.js"

export const COMPOSER_DRAFT_WRITE_DELAY_MS = 250
export const MAX_PERSISTED_COMPOSER_DRAFTS = 100

const ownedKinds = new Set(["image", "audio", "file", "pasted-text", "appshot"])

export const isOwnedDraftAttachment = (
  attachment: ComposerDraftAttachment
): attachment is Extract<
  ComposerDraftAttachment,
  { kind: "image" | "audio" | "file" | "pasted-text" | "appshot" }
> => ownedKinds.has(attachment.kind)

const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

const embeddedTextBlock = (name: string, text: string, uri: string): ThreadInputBlock => ({
  data: encodeBase64(new TextEncoder().encode(text)),
  mimeType: "text/plain;charset=utf-8",
  name,
  type: "embedded-resource",
  uri,
})

export const draftAttachmentToInputBlock = async (
  attachment: ComposerDraftAttachment
): Promise<ThreadInputBlock> => {
  if (isOwnedDraftAttachment(attachment)) {
    if (attachment.status !== "ready") {
      throw new Error(attachment.error ?? `Attachment '${attachment.name}' is unavailable.`)
    }
    const bytes = await desktopClientStorage.attachments.read(attachment.attachment)
    const data = encodeBase64(bytes)
    if (attachment.kind === "image") {
      return { data, mimeType: attachment.attachment.mimeType, type: "image" }
    }
    if (attachment.kind === "audio") {
      return { data, mimeType: attachment.attachment.mimeType, type: "audio" }
    }
    return {
      data,
      mimeType: attachment.attachment.mimeType,
      name: attachment.name,
      type: "embedded-resource",
      uri: attachment.name,
    }
  }
  if (attachment.kind === "resource-link") {
    if (attachment.status === "unavailable")
      throw new Error(`Resource '${attachment.name}' is unavailable.`)
    return { name: attachment.name, type: "resource-link", uri: attachment.uri }
  }
  if (attachment.kind === "workspace-file") {
    return { name: attachment.name, type: "resource-link", uri: attachment.path }
  }
  if (attachment.kind === "browser-tab") {
    if (!attachment.url || attachment.status === "unavailable") {
      throw new Error(`Browser tab '${attachment.title}' is unavailable.`)
    }
    return { name: attachment.title, type: "resource-link", uri: attachment.url }
  }
  if (attachment.kind === "mcp-resource") {
    if (attachment.status === "unavailable") {
      throw new Error(`MCP resource '${attachment.name}' is unavailable.`)
    }
    return { name: attachment.name, type: "resource-link", uri: attachment.uri }
  }
  if (attachment.kind === "selected-text") {
    return embeddedTextBlock("Selected text", attachment.text, attachment.source ?? "selection")
  }
  return embeddedTextBlock(attachment.name, attachment.content, `app-context:${attachment.id}`)
}

export const saveFileDraftAttachment = async (file: File): Promise<ComposerDraftAttachment> => {
  const mimeType = file.type || "application/octet-stream"
  const bridge = window.cypheria
  if (!bridge) throw new Error("Desktop attachment storage is unavailable.")
  const path = bridge.storage.attachments.getPathForFile(file)
  const metadata = await desktopClientStorage.attachments.save({
    fileName: file.name,
    mimeType,
    source: path ? { kind: "file_uri", uri: path } : { kind: "blob", blob: file },
  })
  return {
    attachment: metadata,
    id: metadata.id,
    kind: mimeType.startsWith("image/")
      ? "image"
      : mimeType.startsWith("audio/")
        ? "audio"
        : "file",
    name: file.name,
    status: "ready",
  }
}

export const verifyDraftAttachments = async (draft: ComposerDraft): Promise<ComposerDraft> => {
  const attachments = await Promise.all(
    draft.attachments.map(async (attachment): Promise<ComposerDraftAttachment> => {
      if (!isOwnedDraftAttachment(attachment)) return attachment
      const stat = await desktopClientStorage.attachments.stat(attachment.attachment)
      if (stat.exists && stat.byteSize === attachment.attachment.byteSize) {
        return { ...attachment, error: undefined, status: "ready" }
      }
      return {
        ...attachment,
        error: stat.exists ? "Attachment size no longer matches." : "Attachment data is missing.",
        status: "unavailable",
      }
    })
  )
  return { ...draft, attachments }
}

export const deleteDraftAttachments = async (
  attachments: readonly ComposerDraftAttachment[]
): Promise<void> => {
  await Promise.all(
    attachments.flatMap((item) => {
      const stored = isOwnedDraftAttachment(item)
        ? [item.attachment]
        : item.kind === "app-context"
          ? item.imageAttachments
          : []
      return stored.map((attachment) =>
        desktopClientStorage.attachments.delete(attachment).catch(() => undefined)
      )
    })
  )
}

export const deletePersistedComposerDraft = async (scopeId: string): Promise<void> => {
  const key = composerDraftKey(scopeId)
  const raw = await desktopClientStorage.keyValue.getItem(key)
  const draft = decodeValidatedValue(raw, ComposerDraftSchema, { version: 1 })
  if (draft) await deleteDraftAttachments(draft.attachments)
  await desktopClientStorage.keyValue.removeItem(key)
}

export const referencedAttachmentKeys = (drafts: readonly ComposerDraft[]): ReadonlySet<string> =>
  new Set(
    drafts.flatMap((draft) =>
      draft.attachments.flatMap((attachment) => {
        if (isOwnedDraftAttachment(attachment)) return [attachment.attachment.storageKey]
        if (attachment.kind === "app-context") {
          return attachment.imageAttachments.map((item) => item.storageKey)
        }
        return []
      })
    )
  )

export const garbageCollectComposerDrafts = async (): Promise<void> => {
  const entries: Array<{ draft: ComposerDraft; key: string }> = []
  let cursor: string | null = null
  do {
    const page = await desktopClientStorage.keyValue.listPage({
      ...(cursor ? { cursor } : {}),
      limit: 100,
      query: "composerDraft:",
    })
    for (const item of page.items) {
      if (!item.key.startsWith("composerDraft:")) continue
      const raw = await desktopClientStorage.keyValue.getItem(item.key)
      const draft = decodeValidatedValue(raw, ComposerDraftSchema, { version: 1 })
      if (draft) entries.push({ draft, key: item.key })
      else if (raw !== null) await desktopClientStorage.keyValue.removeItem(item.key)
    }
    cursor = page.nextCursor
  } while (cursor)

  entries.sort((left, right) => right.draft.updatedAt - left.draft.updatedAt)
  for (const entry of entries.slice(MAX_PERSISTED_COMPOSER_DRAFTS)) {
    await desktopClientStorage.keyValue.removeItem(entry.key)
  }
  await desktopClientStorage.attachments.garbageCollect(
    referencedAttachmentKeys(
      entries.slice(0, MAX_PERSISTED_COMPOSER_DRAFTS).map((entry) => entry.draft)
    )
  )
}
