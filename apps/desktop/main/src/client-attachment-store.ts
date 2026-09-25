import { randomUUID } from "node:crypto"
import { lstat, mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises"
import { join } from "node:path"
import { assertAttachmentId } from "@cypheria/storage"

import { MAX_DESKTOP_ATTACHMENT_BYTES } from "../../ipc/src/index.js"

const attachmentDirectoryName = "client-attachments"

export const getDesktopAttachmentDirectory = (userDataDir: string): string =>
  join(userDataDir, attachmentDirectoryName)

const attachmentPath = (userDataDir: string, storageKey: string): string =>
  join(getDesktopAttachmentDirectory(userDataDir), assertAttachmentId(storageKey))

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
