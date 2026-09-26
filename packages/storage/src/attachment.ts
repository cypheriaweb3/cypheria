import type { StoragePage, StoragePageRequest } from "./inspection.js"

export type AttachmentStorageType = "desktop-file" | "native-file" | "web-indexeddb"

export interface AttachmentMetadata {
  readonly id: string
  readonly storageKey: string
  readonly storageType: AttachmentStorageType
  readonly mimeType: string
  readonly fileName: string | null
  readonly byteSize: number
  readonly createdAt: number
}

export type AttachmentDataSource =
  | { readonly kind: "bytes"; readonly bytes: Uint8Array }
  | { readonly kind: "blob"; readonly blob: Blob }
  | { readonly kind: "data_url"; readonly dataUrl: string }
  | { readonly kind: "file_uri"; readonly uri: string }

export interface SaveAttachmentInput {
  readonly id?: string
  readonly mimeType?: string
  readonly fileName?: string | null
  readonly source: AttachmentDataSource
}

export interface AttachmentSourceResolver {
  readonly readFileUri?: (uri: string) => Promise<Uint8Array>
}

export interface AttachmentStore {
  readonly storageType: AttachmentStorageType
  save(input: SaveAttachmentInput): Promise<AttachmentMetadata>
  read(attachment: AttachmentMetadata): Promise<Uint8Array>
  delete(attachment: AttachmentMetadata): Promise<void>
  garbageCollect(referencedStorageKeys: ReadonlySet<string>): Promise<void>
  listPage(request?: StoragePageRequest): Promise<StoragePage<AttachmentInspectionEntry>>
}

export interface AttachmentInspectionEntry {
  readonly storageKey: string
  readonly storageType: AttachmentStorageType
  readonly byteSize: number
  readonly bytePreview: Uint8Array
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

const normalizeMimeType = (value: string | null | undefined): string =>
  value?.trim().toLowerCase() || "application/octet-stream"

const parseDataUrl = (dataUrl: string): { bytes: Uint8Array; mimeType: string | null } => {
  const match = /^data:([^,]*),([\s\S]+)$/iu.exec(dataUrl.trim())
  if (!match) throw new Error("Malformed attachment data URL.")
  const metadata = match[1] ?? ""
  const payload = match[2]?.replace(/\s/gu, "") ?? ""
  const [mimeType, ...parameters] = metadata.split(";").map((part) => part.trim())
  if (!parameters.some((parameter) => parameter.toLowerCase() === "base64")) {
    throw new Error("Attachment data URL must be base64 encoded.")
  }
  if (!payload) throw new Error("Attachment data URL has no payload.")
  try {
    return {
      bytes: Uint8Array.from(atob(payload), (character) => character.charCodeAt(0)),
      mimeType: mimeType || null,
    }
  } catch (error) {
    throw new Error("Attachment data URL has an invalid base64 payload.", { cause: error })
  }
}

const fileNameFromUri = (uri: string): string | null => {
  const lastSegment = uri.replaceAll("\\", "/").split("/").at(-1)?.trim()
  if (!lastSegment) return null
  try {
    return decodeURIComponent(lastSegment)
  } catch {
    return lastSegment
  }
}

const sourceToBytes = async (
  source: AttachmentDataSource,
  resolver: AttachmentSourceResolver
): Promise<{ bytes: Uint8Array; mimeType: string | null }> => {
  if (source.kind === "bytes") {
    return { bytes: new Uint8Array(source.bytes), mimeType: null }
  }
  if (source.kind === "blob") {
    return {
      bytes: new Uint8Array(await source.blob.arrayBuffer()),
      mimeType: source.blob.type || null,
    }
  }
  if (source.kind === "data_url") return parseDataUrl(source.dataUrl)
  if (!resolver.readFileUri) {
    throw new Error("Attachment file URI sources are unavailable in this runtime.")
  }
  return { bytes: new Uint8Array(await resolver.readFileUri(source.uri)), mimeType: null }
}

export const normalizeAttachmentDescriptor = (
  input: SaveAttachmentInput,
  inferredMimeType: string | null = null
) => ({
  id: assertAttachmentId(input.id ?? createAttachmentId()),
  mimeType: normalizeMimeType(input.mimeType ?? inferredMimeType),
  fileName:
    input.fileName?.trim() ||
    (input.source.kind === "file_uri" ? fileNameFromUri(input.source.uri) : null),
  createdAt: Date.now(),
})

export const normalizeAttachmentInput = async (
  input: SaveAttachmentInput,
  resolver: AttachmentSourceResolver = {}
) => {
  const resolved = await sourceToBytes(input.source, resolver)
  const bytes = resolved.bytes
  if (bytes.byteLength === 0) throw new Error("Attachment bytes cannot be empty.")
  return {
    ...normalizeAttachmentDescriptor(input, resolved.mimeType),
    bytes,
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
