import { describe, expect, it } from "vitest"

import {
  decodeFileTransferFrame,
  encodeFileTransferFrame,
  FILE_TRANSFER_MAX_DATA_BYTES,
} from "./file-transfer-binary.js"

describe("file-transfer binary frames", () => {
  it("round-trips a stream chunk", () => {
    const streamId = "01984de2-8f74-7c91-a3b2-5c5e937cf400"
    expect(
      decodeFileTransferFrame(encodeFileTransferFrame(streamId, new Uint8Array([1, 2]), true))
    ).toEqual({ data: new Uint8Array([1, 2]), end: true, streamId })
  })

  it("rejects oversized chunks", () => {
    expect(() =>
      encodeFileTransferFrame(
        "01984de2-8f74-7c91-a3b2-5c5e937cf400",
        new Uint8Array(FILE_TRANSFER_MAX_DATA_BYTES + 1),
        false
      )
    ).toThrow("64 KiB")
  })
})
