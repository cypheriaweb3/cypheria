import {
  type AttachmentSourceResolver,
  type AttachmentStorageType,
  type AttachmentStore,
  assertAttachmentId,
  assertAttachmentStorageType,
  normalizeAttachmentDescriptor,
  normalizeAttachmentInput,
} from "./attachment.js"
import type { StoragePage, StoragePageRequest } from "./inspection.js"

export interface AttachmentFileInspectionEntry {
  readonly storageKey: string
  readonly byteSize: number
  readonly bytePreview: Uint8Array
}

export interface AttachmentFileDriver {
  write(storageKey: string, bytes: Uint8Array): Promise<void>
  copyFileUri?(storageKey: string, uri: string): Promise<number>
  read(storageKey: string): Promise<Uint8Array>
  delete(storageKey: string): Promise<void>
  list(): Promise<readonly string[]>
  listPage(request?: StoragePageRequest): Promise<StoragePage<AttachmentFileInspectionEntry>>
}

export function createFileAttachmentStore(
  storageType: Extract<AttachmentStorageType, "desktop-file" | "native-file">,
  driver: AttachmentFileDriver,
  sourceResolver: AttachmentSourceResolver = {}
): AttachmentStore {
  return {
    storageType,
    async save(input) {
      if (input.source.kind === "file_uri" && driver.copyFileUri) {
        const normalized = normalizeAttachmentDescriptor(input)
        const byteSize = await driver.copyFileUri(normalized.id, input.source.uri)
        if (!Number.isSafeInteger(byteSize) || byteSize < 1) {
          await driver.delete(normalized.id)
          throw new Error("Attachment bytes cannot be empty.")
        }
        return {
          ...normalized,
          storageKey: normalized.id,
          storageType,
          byteSize,
        }
      }
      const normalized = await normalizeAttachmentInput(input, sourceResolver)
      await driver.write(normalized.id, normalized.bytes)
      return {
        id: normalized.id,
        storageKey: normalized.id,
        storageType,
        mimeType: normalized.mimeType,
        fileName: normalized.fileName,
        byteSize: normalized.bytes.byteLength,
        createdAt: normalized.createdAt,
      }
    },
    async read(attachment) {
      assertAttachmentStorageType(attachment, storageType)
      return driver.read(assertAttachmentId(attachment.storageKey))
    },
    async delete(attachment) {
      assertAttachmentStorageType(attachment, storageType)
      await driver.delete(assertAttachmentId(attachment.storageKey))
    },
    async garbageCollect(referencedStorageKeys) {
      const referenced = new Set([...referencedStorageKeys].map(assertAttachmentId))
      const storedKeys = await driver.list()
      await Promise.all(
        storedKeys.map(async (storageKey) => {
          const validKey = assertAttachmentId(storageKey)
          if (!referenced.has(validKey)) await driver.delete(validKey)
        })
      )
    },
    async listPage(request) {
      const page = await driver.listPage(request)
      return {
        items: page.items.map((item) => ({ ...item, storageType })),
        nextCursor: page.nextCursor,
      }
    },
  }
}
