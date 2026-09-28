import { createHash, randomUUID } from "node:crypto"
import { mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { ThreadInputFile } from "@cypheria/protocol"

const CHUNK_SIZE = 256 * 1024
const MAX_FILE_SIZE = 32 * 1024 * 1024
const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000

type Upload = {
  byteSize: number
  clientId: string
  createdAt: number
  fileName: string
  mimeType: string
  sha256: string
  uploadId: string
}

type StoredFile = ThreadInputFile & {
  clientId: string
  createdAt: number
  threadIds: string[]
}

export class InputFileService {
  readonly #root: string
  readonly #locks = new Map<string, Promise<unknown>>()

  constructor(cypheriaHome: string) {
    this.#root = join(cypheriaHome, "input-files")
  }

  async start(
    clientId: string,
    input: Omit<Upload, "clientId" | "createdAt" | "uploadId">
  ): Promise<{ chunkSize: typeof CHUNK_SIZE; offset: number; uploadId: string }> {
    if (input.byteSize <= 0 || input.byteSize > MAX_FILE_SIZE) throw new Error("Invalid file size")
    const uploadId = randomUUID()
    await mkdir(this.#root, { recursive: true, mode: 0o700 })
    const handle = await open(this.#uploadData(uploadId), "wx", 0o600)
    await handle.close()
    await this.#writeJson(this.#uploadMeta(uploadId), {
      ...input,
      clientId,
      createdAt: Date.now(),
      uploadId,
    } satisfies Upload)
    return { chunkSize: CHUNK_SIZE, offset: 0, uploadId }
  }

  async chunk(clientId: string, uploadId: string, offset: number, bytes: Uint8Array) {
    return this.#withLock(uploadId, async () => {
      const upload = await this.#readUpload(clientId, uploadId)
      if (!bytes.length || bytes.length > CHUNK_SIZE || offset + bytes.length > upload.byteSize)
        throw new Error("Invalid upload chunk")
      const handle = await open(this.#uploadData(uploadId), "r+")
      try {
        const current = (await handle.stat()).size
        if (offset < current) {
          if (offset + bytes.length > current) throw new Error("Overlapping upload chunk")
          const existing = Buffer.alloc(bytes.length)
          await handle.read(existing, 0, existing.length, offset)
          if (!existing.equals(Buffer.from(bytes))) throw new Error("Conflicting upload chunk")
          return { offset: current }
        }
        if (offset !== current) throw new Error("Upload offset mismatch")
        await handle.write(Buffer.from(bytes), 0, bytes.length, offset)
        await handle.sync()
        return { offset: offset + bytes.length }
      } finally {
        await handle.close()
      }
    })
  }

  async status(clientId: string, uploadId: string) {
    await this.#readUpload(clientId, uploadId)
    return { offset: (await stat(this.#uploadData(uploadId))).size }
  }

  async complete(clientId: string, uploadId: string): Promise<ThreadInputFile> {
    return this.#withLock(uploadId, async () => {
      const upload = await this.#readUpload(clientId, uploadId)
      const bytes = await readFile(this.#uploadData(uploadId))
      if (bytes.length !== upload.byteSize) throw new Error("Upload is incomplete")
      if (createHash("sha256").update(bytes).digest("hex") !== upload.sha256)
        throw new Error("Upload checksum mismatch")
      const fileId = randomUUID()
      const file: StoredFile = {
        byteSize: upload.byteSize,
        clientId,
        createdAt: Date.now(),
        fileId,
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        sha256: upload.sha256,
        threadIds: [],
      }
      await rename(this.#uploadData(uploadId), this.#fileData(fileId))
      await this.#writeJson(this.#fileMeta(fileId), file)
      await unlink(this.#uploadMeta(uploadId))
      return this.#public(file)
    })
  }

  async abort(clientId: string, uploadId: string) {
    return this.#withLock(uploadId, async () => {
      await this.#readUpload(clientId, uploadId)
      await Promise.all([
        unlink(this.#uploadData(uploadId)).catch(() => undefined),
        unlink(this.#uploadMeta(uploadId)).catch(() => undefined),
      ])
      return { aborted: true }
    })
  }

  async bind(fileId: string, threadId: string): Promise<{ file: ThreadInputFile; path: string }> {
    return this.#withLock(fileId, async () => {
      const file = await this.#readFile(fileId)
      if (!file.threadIds.includes(threadId)) {
        file.threadIds.push(threadId)
        await this.#writeJson(this.#fileMeta(fileId), file)
      }
      return { file: this.#public(file), path: this.#fileData(fileId) }
    })
  }

  async get(fileId: string, threadId: string, offset: number) {
    const file = await this.#readFile(fileId)
    if (!file.threadIds.includes(threadId)) throw new Error("File is not attached to this thread")
    if (offset > file.byteSize) throw new Error("File offset exceeds size")
    const handle = await open(this.#fileData(fileId), "r")
    try {
      const bytes = Buffer.alloc(Math.min(CHUNK_SIZE, file.byteSize - offset))
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, offset)
      const nextOffset = offset + bytesRead
      return {
        bytes: new Uint8Array(bytes.subarray(0, bytesRead)),
        file: this.#public(file),
        nextOffset: nextOffset < file.byteSize ? nextOffset : null,
      }
    } finally {
      await handle.close()
    }
  }

  async releaseThread(threadId: string): Promise<void> {
    for (const entry of await readdir(this.#root).catch(() => [])) {
      if (!entry.endsWith(".file.json")) continue
      const fileId = entry.slice(0, -".file.json".length)
      await this.#withLock(fileId, async () => {
        const file = await this.#readFile(fileId)
        if (!file.threadIds.includes(threadId)) return
        file.threadIds = file.threadIds.filter((id) => id !== threadId)
        if (file.threadIds.length) await this.#writeJson(this.#fileMeta(fileId), file)
        else await this.#deleteFile(fileId)
      })
    }
  }

  async cleanup(): Promise<void> {
    for (const entry of await readdir(this.#root).catch(() => [])) {
      if (entry.endsWith(".upload.json")) {
        const uploadId = entry.slice(0, -".upload.json".length)
        await this.#withLock(uploadId, async () => {
          const upload = JSON.parse(await readFile(this.#uploadMeta(uploadId), "utf8")) as Upload
          if (Date.now() - upload.createdAt <= ORPHAN_AGE_MS) return
          await Promise.all([
            unlink(this.#uploadData(uploadId)).catch(() => undefined),
            unlink(this.#uploadMeta(uploadId)).catch(() => undefined),
          ])
        })
      } else if (entry.endsWith(".file.json")) {
        const fileId = entry.slice(0, -".file.json".length)
        await this.#withLock(fileId, async () => {
          const file = await this.#readFile(fileId)
          if (!file.threadIds.length && Date.now() - file.createdAt > ORPHAN_AGE_MS)
            await this.#deleteFile(fileId)
        })
      }
    }
  }

  #public(file: StoredFile): ThreadInputFile {
    const { byteSize, fileId, fileName, mimeType, sha256 } = file
    return { byteSize, fileId, fileName, mimeType, sha256 }
  }

  async #readUpload(clientId: string, uploadId: string): Promise<Upload> {
    const upload = JSON.parse(await readFile(this.#uploadMeta(uploadId), "utf8")) as Upload
    if (upload.clientId !== clientId) throw new Error("Upload belongs to another client")
    return upload
  }

  async #readFile(fileId: string): Promise<StoredFile> {
    return JSON.parse(await readFile(this.#fileMeta(fileId), "utf8")) as StoredFile
  }

  async #writeJson(path: string, value: unknown): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
    await rename(temporary, path)
  }

  async #deleteFile(fileId: string): Promise<void> {
    await Promise.all([
      unlink(this.#fileData(fileId)).catch(() => undefined),
      unlink(this.#fileMeta(fileId)).catch(() => undefined),
    ])
  }

  #uploadData(id: string) {
    return join(this.#root, `${id}.part`)
  }
  #uploadMeta(id: string) {
    return join(this.#root, `${id}.upload.json`)
  }
  #fileData(id: string) {
    return join(this.#root, `${id}.bin`)
  }
  #fileMeta(id: string) {
    return join(this.#root, `${id}.file.json`)
  }

  async #withLock<T>(id: string, run: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(id) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(run)
    this.#locks.set(id, current)
    try {
      return await current
    } finally {
      if (this.#locks.get(id) === current) this.#locks.delete(id)
    }
  }
}
