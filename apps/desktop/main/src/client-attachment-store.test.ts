import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, describe, expect, it } from "vitest"

import { MAX_DESKTOP_ATTACHMENT_BYTES } from "../../ipc/src/index.js"
import {
  copyDesktopAttachmentFile,
  deleteDesktopAttachment,
  getDesktopAttachmentDirectory,
  listDesktopAttachmentPage,
  listDesktopAttachments,
  readDesktopAttachment,
  writeDesktopAttachment,
} from "./client-attachment-store.js"

const temporaryDirectories: string[] = []

const createUserDataDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "cypheria-attachment-test-"))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true }))
  )
})

describe("desktop attachment storage", () => {
  it("writes, reads, lists, overwrites, and deletes opaque attachment files", async () => {
    const userDataDir = await createUserDataDirectory()
    expect(getDesktopAttachmentDirectory(userDataDir)).toBe(join(userDataDir, "attachments"))

    await expect(
      writeDesktopAttachment(userDataDir, "att_one", new Uint8Array([1, 2, 3]))
    ).resolves.toEqual({ byteSize: 3 })
    await expect(readDesktopAttachment(userDataDir, "att_one")).resolves.toEqual({
      bytes: new Uint8Array([1, 2, 3]),
    })
    await writeDesktopAttachment(userDataDir, "att_one", new Uint8Array([4, 5]))
    await expect(
      readFile(join(getDesktopAttachmentDirectory(userDataDir), "att_one"))
    ).resolves.toEqual(Buffer.from([4, 5]))
    await expect(listDesktopAttachments(userDataDir)).resolves.toEqual({
      storageKeys: ["att_one"],
    })
    await expect(listDesktopAttachmentPage(userDataDir, { query: "one" })).resolves.toEqual({
      items: [
        {
          storageKey: "att_one",
          byteSize: 2,
          bytePreview: new Uint8Array([4, 5]),
        },
      ],
      nextCursor: null,
    })
    await expect(deleteDesktopAttachment(userDataDir, "att_one")).resolves.toEqual({
      deleted: true,
    })
    await expect(listDesktopAttachments(userDataDir)).resolves.toEqual({ storageKeys: [] })
  })

  it("rejects path traversal, empty files, and oversized values", async () => {
    const userDataDir = await createUserDataDirectory()

    await expect(
      writeDesktopAttachment(userDataDir, "../escape", new Uint8Array([1]))
    ).rejects.toThrow("Invalid attachment identifier")
    await expect(
      writeDesktopAttachment(userDataDir, "att_empty", new Uint8Array())
    ).rejects.toThrow("Attachment size")
    await expect(
      writeDesktopAttachment(
        userDataDir,
        "att_large",
        new Uint8Array(MAX_DESKTOP_ATTACHMENT_BYTES + 1)
      )
    ).rejects.toThrow("Attachment size")
  })

  it("copies file URI sources inside the main process", async () => {
    const userDataDir = await createUserDataDirectory()
    const source = join(userDataDir, "source file.txt")
    await writeFile(source, "copied without an IPC byte payload")

    await expect(
      copyDesktopAttachmentFile(userDataDir, "att_copied", pathToFileURL(source).href)
    ).resolves.toEqual({ byteSize: 34 })
    await expect(
      readFile(join(getDesktopAttachmentDirectory(userDataDir), "att_copied"), "utf8")
    ).resolves.toBe("copied without an IPC byte payload")
  })

  it("ignores temporary and unrelated files when listing", async () => {
    const userDataDir = await createUserDataDirectory()
    await writeDesktopAttachment(userDataDir, "att_visible", new Uint8Array([1]))
    await writeFile(join(getDesktopAttachmentDirectory(userDataDir), ".partial.tmp"), "partial")

    await expect(listDesktopAttachments(userDataDir)).resolves.toEqual({
      storageKeys: ["att_visible"],
    })
  })

  it("paginates attachment inspection without reading complete files", async () => {
    const userDataDir = await createUserDataDirectory()
    await writeDesktopAttachment(userDataDir, "att_a", new Uint8Array(40).fill(1))
    await writeDesktopAttachment(userDataDir, "att_b", new Uint8Array(40).fill(2))

    const first = await listDesktopAttachmentPage(userDataDir, { limit: 1 })
    expect(first.items).toEqual([
      {
        storageKey: "att_a",
        byteSize: 40,
        bytePreview: new Uint8Array(32).fill(1),
      },
    ])
    expect(first.nextCursor).not.toBeNull()
    await expect(
      listDesktopAttachmentPage(userDataDir, { cursor: first.nextCursor, limit: 1 })
    ).resolves.toMatchObject({ items: [{ storageKey: "att_b" }], nextCursor: null })
  })
})
