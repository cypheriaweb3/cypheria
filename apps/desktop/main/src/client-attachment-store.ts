import { randomUUID } from "node:crypto"
import { copyFile, lstat, mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises"
import { isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  assertAttachmentId,
  decodeStorageCursor,
  encodeStorageCursor,
  normalizeStoragePageRequest,
  type StoragePage,
  type StoragePageRequest,
} from "@cypheria/storage"
import type { AttachmentFileInspectionEntry } from "@cypheria/storage/files"

import { MAX_DESKTOP_ATTACHMENT_BYTES } from "../../ipc/src/index.js"

const attachmentDirectoryName = "attachments"

export const getDesktopAttachmentDirectory = (userDataDir: string): string =>
  join(userDataDir, attachmentDirectoryName)

const attachmentPath = (userDataDir: string, storageKey: string): string =>
  join(getDesktopAttachmentDirectory(userDataDir), assertAttachmentId(storageKey))

const sourcePathFromFileUri = (uri: string): string => {
  const normalized = uri.trim()
  if (!normalized) throw new Error("Attachment file URI is required.")
  if (normalized.startsWith("file:")) return fileURLToPath(normalized)
  if (!isAbsolute(normalized)) throw new Error("Attachment file URI must be an absolute path.")
  return resolve(normalized)
}

export const copyDesktopAttachmentFile = async (
  userDataDir: string,
  storageKey: string,
  uri: string
): Promise<{ byteSize: number }> => {
  const source = sourcePathFromFileUri(uri)
  const sourceMetadata = await stat(source)
  if (
    !sourceMetadata.isFile() ||
    sourceMetadata.size === 0 ||
    sourceMetadata.size > MAX_DESKTOP_ATTACHMENT_BYTES
  ) {
    throw new Error("Attachment source is unavailable or exceeds the size limit.")
  }

  const directory = getDesktopAttachmentDirectory(userDataDir)
  await mkdir(directory, { mode: 0o700, recursive: true })
  const destination = attachmentPath(userDataDir, storageKey)
  const temporary = join(directory, `.${storageKey}.${randomUUID()}.tmp`)
  try {
    await copyFile(source, temporary)
    const copiedMetadata = await stat(temporary)
    if (!copiedMetadata.isFile() || copiedMetadata.size !== sourceMetadata.size) {
      throw new Error("Attachment source changed while it was being copied.")
    }
    await rename(temporary, destination)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
  return { byteSize: sourceMetadata.size }
}

export const writeDesktopAttachment = async (
  userDataDir: string,
  storageKey: string,
  bytes: Uint8Array
): Promise<{ byteSize: number }> => {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_DESKTOP_ATTACHMENT_BYTES) {
    throw new Error(`Attachment size must be between 1 and ${MAX_DESKTOP_ATTACHMENT_BYTES} bytes.`)
  }
  const directory = getDesktopAttachmentDirectory(userDataDir)
  await mkdir(directory, { mode: 0o700, recursive: true })
  const destination = attachmentPath(userDataDir, storageKey)
  const temporary = join(directory, `.${storageKey}.${randomUUID()}.tmp`)
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(temporary, "wx", 0o600)
    await handle.writeFile(bytes)
    await handle.close()
    handle = null
    await rename(temporary, destination)
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await rm(temporary, { force: true })
    throw error
  }
  return { byteSize: bytes.byteLength }
}

export const readDesktopAttachment = async (
  userDataDir: string,
  storageKey: string
): Promise<{ bytes: Uint8Array }> => {
  const path = attachmentPath(userDataDir, storageKey)
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.size === 0 || metadata.size > MAX_DESKTOP_ATTACHMENT_BYTES) {
    throw new Error("Stored attachment is unavailable or exceeds the size limit.")
  }
  return { bytes: new Uint8Array(await readFile(path)) }
}

export const deleteDesktopAttachment = async (
  userDataDir: string,
  storageKey: string
): Promise<{ deleted: true }> => {
  await rm(attachmentPath(userDataDir, storageKey), { force: true })
  return { deleted: true }
}

export const listDesktopAttachments = async (
  userDataDir: string
): Promise<{ storageKeys: string[] }> => {
  const directory = getDesktopAttachmentDirectory(userDataDir)
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  })
  return {
    storageKeys: entries
      .filter((entry) => entry.isFile() && /^[A-Za-z0-9_-]{1,128}$/u.test(entry.name))
      .map((entry) => entry.name)
      .sort(),
  }
}

export const listDesktopAttachmentPage = async (
  userDataDir: string,
  request: StoragePageRequest = {}
): Promise<StoragePage<AttachmentFileInspectionEntry>> => {
  const { cursor, limit, query } = normalizeStoragePageRequest(request)
  const cursorKey = decodeStorageCursor(cursor, 1)?.[0] ?? null
  const { storageKeys } = await listDesktopAttachments(userDataDir)
  const matchingKeys = storageKeys.filter(
    (storageKey) =>
      storageKey > (cursorKey ?? "") && (!query || storageKey.toLocaleLowerCase().includes(query))
  )
  const pageKeys = matchingKeys.slice(0, limit + 1)
  const hasMore = pageKeys.length > limit
  if (hasMore) pageKeys.pop()
  const items = await Promise.all(
    pageKeys.map(async (storageKey): Promise<AttachmentFileInspectionEntry> => {
      const path = attachmentPath(userDataDir, storageKey)
      const metadata = await lstat(path)
      if (!metadata.isFile() || metadata.size === 0) {
        throw new Error(`Stored attachment '${storageKey}' is unavailable.`)
      }
      const bytePreview = new Uint8Array(Math.min(metadata.size, 32))
      const handle = await open(path, "r")
      try {
        await handle.read(bytePreview, 0, bytePreview.byteLength, 0)
      } finally {
        await handle.close()
      }
      return { storageKey, byteSize: metadata.size, bytePreview }
    })
  )
  return {
    items,
    nextCursor:
      hasMore && pageKeys.length ? encodeStorageCursor([pageKeys.at(-1) as string]) : null,
  }
}
