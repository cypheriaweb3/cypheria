export type AttachmentStorageType = "desktop-file" | "native-file" | "web-indexeddb"

export interface AttachmentMetadata {
  readonly id: string
  readonly storageKey: string
  readonly storageType: AttachmentStorageType
  readonly mediaType: string
  readonly fileName: string | null
  readonly byteSize: number
  readonly createdAt: number
}

export interface SaveAttachmentInput {
  readonly id?: string
  readonly bytes: Uint8Array
  readonly mediaType: string
  readonly fileName?: string | null
}

export interface AttachmentStore {
  readonly storageType: AttachmentStorageType
  save(input: SaveAttachmentInput): Promise<AttachmentMetadata>
  read(attachment: AttachmentMetadata): Promise<Uint8Array>
  delete(attachment: AttachmentMetadata): Promise<void>
  garbageCollect(referencedStorageKeys: ReadonlySet<string>): Promise<void>
}

const attachmentIdPattern = /^[A-Za-z0-9_-]{1,128}$/u

export const assertAttachmentId = (id: string): string => {
  if (!attachmentIdPattern.test(id)) throw new Error("Invalid attachment identifier.")
  return id
}

export const createAttachmentId = (): string => {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return `att_${uuid.replaceAll("-", "")}`
  return `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}

export const normalizeAttachmentInput = (input: SaveAttachmentInput) => {
  const id = assertAttachmentId(input.id ?? createAttachmentId())
  const mediaType = input.mediaType.trim().toLowerCase()
  if (!mediaType) throw new Error("Attachment media type is required.")
  const bytes = new Uint8Array(input.bytes)
  if (bytes.byteLength === 0) throw new Error("Attachment bytes cannot be empty.")
  return {
    id,
    bytes,
    mediaType,
    fileName: input.fileName?.trim() || null,
    createdAt: Date.now(),
  }
}

export const assertAttachmentStorageType = (
  attachment: AttachmentMetadata,
  expected: AttachmentStorageType
): void => {
  if (attachment.storageType !== expected) {
    throw new Error(
      `Attachment storage type '${attachment.storageType}' cannot be read by '${expected}'.`
    )
  }
}
