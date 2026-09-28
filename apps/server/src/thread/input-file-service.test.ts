import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { InputFileService } from "./input-file-service.js"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "cypheria-input-file-test-"))
  directories.push(root)
  return new InputFileService(root)
}

describe("InputFileService", () => {
  it("uploads by offset, survives duplicate chunks, and scopes reads to a thread", async () => {
    const service = await fixture()
    const bytes = new TextEncoder().encode("hello from a remote client")
    const sha256 = createHash("sha256").update(bytes).digest("hex")
    const upload = await service.start("device-a", {
      byteSize: bytes.length,
      fileName: "note.txt",
      mimeType: "text/plain",
      sha256,
    })
    expect(await service.chunk("device-a", upload.uploadId, 0, bytes)).toEqual({
      offset: bytes.length,
    })
    expect(await service.chunk("device-a", upload.uploadId, 0, bytes)).toEqual({
      offset: bytes.length,
    })
    await expect(service.status("device-b", upload.uploadId)).rejects.toThrow("another client")
    const file = await service.complete("device-a", upload.uploadId)
    await expect(service.get(file.fileId, "thread-a", 0)).rejects.toThrow("not attached")
    await service.bind(file.fileId, "thread-a")
    const result = await service.get(file.fileId, "thread-a", 0)
    expect(result.file).toEqual(file)
    expect(result.bytes).toEqual(bytes)
    expect(result.nextOffset).toBeNull()
    await service.releaseThread("thread-a")
    await expect(service.get(file.fileId, "thread-a", 0)).rejects.toThrow()
  })

  it("rejects changed chunks and incorrect digests", async () => {
    const service = await fixture()
    const bytes = new TextEncoder().encode("abc")
    const upload = await service.start("device-a", {
      byteSize: 3,
      fileName: "note.txt",
      mimeType: "text/plain",
      sha256: "0".repeat(64),
    })
    await service.chunk("device-a", upload.uploadId, 0, bytes)
    await expect(
      service.chunk("device-a", upload.uploadId, 0, new TextEncoder().encode("xyz"))
    ).rejects.toThrow("Conflicting")
    await expect(service.complete("device-a", upload.uploadId)).rejects.toThrow("checksum")
    expect(await service.status("device-a", upload.uploadId)).toEqual({ offset: 3 })
  })
})
