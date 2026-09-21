import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { downloadFile } from "./fs-utils.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe("downloadFile", () => {
  it("uses the identity length when fetch decodes an encoded response", async () => {
    const root = await mkdtemp(join(tmpdir(), "cypheria-download-file-"))
    temporaryDirectories.push(root)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Promise.resolve(
          new Response(new Uint8Array([1, 2, 3, 4]), {
            headers: {
              "content-encoding": "gzip",
              "content-length": "3",
              "x-identity-content-length": "4",
            },
          })
        )
      )
    )
    const progress: number[] = []
    const destination = join(root, "archive.zip")

    const result = await downloadFile("https://example.test/archive.zip", destination, {
      onProgress: (value) => progress.push(value),
    })

    expect(result.bytes).toBe(4)
    await expect(readFile(destination)).resolves.toEqual(Buffer.from([1, 2, 3, 4]))
    expect(progress).toEqual([0, 1, 1])
  })
})
