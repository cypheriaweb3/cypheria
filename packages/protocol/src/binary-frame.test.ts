import { describe, expect, it } from "vitest"

import {
  CYPHERIA_BINARY_OPCODE_RANGES,
  decodeCypheriaBinaryFrame,
  encodeCypheriaBinaryFrame,
  isCypheriaBinaryOpcode,
} from "./binary-frame.js"
import { encodeProtocolMessage } from "./index.js"

describe("Cypheria binary frames", () => {
  it("round-trips an opaque payload behind its first-byte opcode", () => {
    const encoded = encodeCypheriaBinaryFrame({
      opcode: 0x01,
      payload: new Uint8Array([0, 255, 16, 128]),
    })

    expect(encoded).toEqual(new Uint8Array([0x01, 0, 255, 16, 128]))
    expect(decodeCypheriaBinaryFrame(encoded)).toEqual({
      opcode: 0x01,
      payload: new Uint8Array([0, 255, 16, 128]),
    })
  })

  it("does not confuse existing deterministic CBOR messages with binary frames", () => {
    const message = encodeProtocolMessage({ type: "ping" })

    expect(message[0]).toBeGreaterThanOrEqual(0xa0)
    expect(decodeCypheriaBinaryFrame(message)).toBeNull()
  })

  it("reserves disjoint terminal and file-transfer opcode ranges", () => {
    expect(CYPHERIA_BINARY_OPCODE_RANGES).toEqual({
      fileTransfer: { max: 0x1f, min: 0x10 },
      terminal: { max: 0x0f, min: 0x01 },
    })
    expect(isCypheriaBinaryOpcode(0x01)).toBe(true)
    expect(isCypheriaBinaryOpcode(0x10)).toBe(true)
    expect(isCypheriaBinaryOpcode(0x20)).toBe(false)
    expect(decodeCypheriaBinaryFrame(new Uint8Array([0x20, 1, 2]))).toBeNull()
  })

  it("rejects encoders that use unreserved opcodes", () => {
    expect(() =>
      encodeCypheriaBinaryFrame({
        opcode: 0,
        payload: new Uint8Array(),
      })
    ).toThrow("opcode is outside the reserved ranges")
  })
})
