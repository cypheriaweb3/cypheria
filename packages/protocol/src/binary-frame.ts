export const CYPHERIA_BINARY_OPCODE_RANGES = {
  fileTransfer: { max: 0x1f, min: 0x10 },
  terminal: { max: 0x0f, min: 0x01 },
} as const

/** A domain-specific binary frame selected by its first-byte opcode. */
export type CypheriaBinaryFrame = {
  readonly opcode: number
  readonly payload: Uint8Array
}

export class CypheriaBinaryFrameError extends TypeError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "CypheriaBinaryFrameError"
  }
}

/** Returns true for opcodes reserved for Cypheria domain binary codecs. */
export function isCypheriaBinaryOpcode(opcode: number): boolean {
  return (
    Number.isInteger(opcode) &&
    ((opcode >= CYPHERIA_BINARY_OPCODE_RANGES.terminal.min &&
      opcode <= CYPHERIA_BINARY_OPCODE_RANGES.terminal.max) ||
      (opcode >= CYPHERIA_BINARY_OPCODE_RANGES.fileTransfer.min &&
        opcode <= CYPHERIA_BINARY_OPCODE_RANGES.fileTransfer.max))
  )
}

/** Encodes one domain frame as `[opcode, ...payload]`. */
export function encodeCypheriaBinaryFrame(frame: CypheriaBinaryFrame): Uint8Array {
  if (!isCypheriaBinaryOpcode(frame.opcode)) {
    throw new CypheriaBinaryFrameError("Binary frame opcode is outside the reserved ranges")
  }
  if (!(frame.payload instanceof Uint8Array)) {
    throw new CypheriaBinaryFrameError("Binary frame payload must be a Uint8Array")
  }
  const bytes = new Uint8Array(1 + frame.payload.byteLength)
  bytes[0] = frame.opcode
  bytes.set(frame.payload, 1)
  return bytes
}

/**
 * Demultiplexes reserved binary opcodes from ordinary CBOR protocol messages. Domain codecs own
 * the payload layout and its validation.
 */
export function decodeCypheriaBinaryFrame(bytes: Uint8Array): CypheriaBinaryFrame | null {
  const opcode = bytes[0]
  if (opcode === undefined || !isCypheriaBinaryOpcode(opcode)) return null
  return {
    opcode,
    payload: bytes.subarray(1),
  }
}
