import type { CypheriaBinaryFrame } from "./binary-frame.ts"

export const TERMINAL_BINARY_OPCODE = {
  input: 0x02,
  output: 0x01,
  resize: 0x03,
  restore: 0x04,
} as const
export const TERMINAL_RESTORE_FLAG = { end: 0x02, start: 0x01 } as const
export const TERMINAL_RESIZE_FLAG = { claim: 0x01 } as const
export const TERMINAL_MAX_FRAME_BYTES = 64 * 1024
export const TERMINAL_MAX_STREAM_DATA_BYTES = TERMINAL_MAX_FRAME_BYTES - 2
export const TERMINAL_MAX_RESTORE_DATA_BYTES = TERMINAL_MAX_FRAME_BYTES - 3

export type TerminalBinaryFrame =
  | { type: "output"; slot: number; data: Uint8Array }
  | { type: "input"; slot: number; data: Uint8Array }
  | { type: "resize"; slot: number; claim: boolean; cols: number; rows: number }
  | { type: "restore"; slot: number; start: boolean; end: boolean; data: Uint8Array }

const assertSlot = (slot: number): void => {
  if (!Number.isInteger(slot) || slot < 0 || slot > 255)
    throw new TypeError("Invalid terminal slot")
}

const streamFrame = (
  opcode: number,
  slot: number,
  data: Uint8Array,
  flags?: number
): CypheriaBinaryFrame => {
  assertSlot(slot)
  const headerBytes = flags === undefined ? 2 : 3
  if (data.byteLength + headerBytes > TERMINAL_MAX_FRAME_BYTES) {
    throw new TypeError("Terminal frame exceeds the 64 KiB limit")
  }
  const payload = new Uint8Array(data.byteLength + (flags === undefined ? 1 : 2))
  payload[0] = slot
  if (flags === undefined) payload.set(data, 1)
  else {
    payload[1] = flags
    payload.set(data, 2)
  }
  return { opcode, payload }
}

export const encodeTerminalOutputFrame = (slot: number, data: Uint8Array): CypheriaBinaryFrame =>
  streamFrame(TERMINAL_BINARY_OPCODE.output, slot, data)
export const encodeTerminalInputFrame = (slot: number, data: Uint8Array): CypheriaBinaryFrame =>
  streamFrame(TERMINAL_BINARY_OPCODE.input, slot, data)
export const encodeTerminalRestoreFrame = (
  slot: number,
  data: Uint8Array,
  options: { start: boolean; end: boolean }
): CypheriaBinaryFrame =>
  streamFrame(
    TERMINAL_BINARY_OPCODE.restore,
    slot,
    data,
    (options.start ? TERMINAL_RESTORE_FLAG.start : 0) |
      (options.end ? TERMINAL_RESTORE_FLAG.end : 0)
  )
export const encodeTerminalResizeFrame = (
  slot: number,
  size: { cols: number; rows: number },
  claim = false
): CypheriaBinaryFrame => {
  assertSlot(slot)
  if (
    !Number.isInteger(size.cols) ||
    size.cols < 2 ||
    size.cols > 1000 ||
    !Number.isInteger(size.rows) ||
    size.rows < 1 ||
    size.rows > 1000
  ) {
    throw new TypeError("Invalid terminal size")
  }
  return {
    opcode: TERMINAL_BINARY_OPCODE.resize,
    payload: new Uint8Array([
      slot,
      claim ? TERMINAL_RESIZE_FLAG.claim : 0,
      size.cols >>> 8,
      size.cols & 0xff,
      size.rows >>> 8,
      size.rows & 0xff,
    ]),
  }
}

export const decodeTerminalBinaryFrame = (
  frame: CypheriaBinaryFrame
): TerminalBinaryFrame | null => {
  if (frame.payload.byteLength + 1 > TERMINAL_MAX_FRAME_BYTES) {
    throw new TypeError("Terminal frame exceeds the 64 KiB limit")
  }
  const slot = frame.payload[0]
  if (slot === undefined) throw new TypeError("Terminal frame is missing its slot")
  if (frame.opcode === TERMINAL_BINARY_OPCODE.output)
    return { data: frame.payload.subarray(1), slot, type: "output" }
  if (frame.opcode === TERMINAL_BINARY_OPCODE.input)
    return { data: frame.payload.subarray(1), slot, type: "input" }
  if (frame.opcode === TERMINAL_BINARY_OPCODE.restore) {
    const flags = frame.payload[1]
    if (flags === undefined || (flags & ~0x03) !== 0) throw new TypeError("Invalid restore flags")
    return {
      data: frame.payload.subarray(2),
      end: (flags & TERMINAL_RESTORE_FLAG.end) !== 0,
      slot,
      start: (flags & TERMINAL_RESTORE_FLAG.start) !== 0,
      type: "restore",
    }
  }
  if (frame.opcode === TERMINAL_BINARY_OPCODE.resize) {
    if (frame.payload.byteLength !== 6) throw new TypeError("Invalid resize frame length")
    const flags = frame.payload[1] ?? 0
    if ((flags & ~TERMINAL_RESIZE_FLAG.claim) !== 0) throw new TypeError("Invalid resize flags")
    const cols = ((frame.payload[2] ?? 0) << 8) | (frame.payload[3] ?? 0)
    const rows = ((frame.payload[4] ?? 0) << 8) | (frame.payload[5] ?? 0)
    if (cols < 2 || cols > 1000 || rows < 1 || rows > 1000)
      throw new TypeError("Invalid terminal size")
    return { claim: (flags & TERMINAL_RESIZE_FLAG.claim) !== 0, cols, rows, slot, type: "resize" }
  }
  return null
}
