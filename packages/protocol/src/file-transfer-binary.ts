import type { CypheriaBinaryFrame } from "./binary-frame.ts"

export const FILE_TRANSFER_BINARY_OPCODE = 0x10
export const FILE_TRANSFER_END_FLAG = 0x01
export const FILE_TRANSFER_MAX_FRAME_BYTES = 64 * 1024
export const FILE_TRANSFER_MAX_DATA_BYTES = FILE_TRANSFER_MAX_FRAME_BYTES - 18

export type FileTransferBinaryFrame = {
  readonly data: Uint8Array
  readonly end: boolean
  readonly streamId: string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

const uuidBytes = (value: string): Uint8Array => {
  if (!UUID_PATTERN.test(value)) throw new TypeError("Invalid file-transfer stream ID")
  return Uint8Array.from(value.replaceAll("-", "").match(/.{2}/gu) ?? [], (byte) =>
    Number.parseInt(byte, 16)
  )
}

const uuidString = (bytes: Uint8Array): string => {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export const encodeFileTransferFrame = (
  streamId: string,
  data: Uint8Array,
  end: boolean
): CypheriaBinaryFrame => {
  if (!(data instanceof Uint8Array)) throw new TypeError("File-transfer data must be bytes")
  if (data.byteLength > FILE_TRANSFER_MAX_DATA_BYTES) {
    throw new TypeError("File-transfer frame exceeds the 64 KiB limit")
  }
  const payload = new Uint8Array(17 + data.byteLength)
  payload.set(uuidBytes(streamId), 0)
  payload[16] = end ? FILE_TRANSFER_END_FLAG : 0
  payload.set(data, 17)
  return { opcode: FILE_TRANSFER_BINARY_OPCODE, payload }
}

export const decodeFileTransferFrame = (
  frame: CypheriaBinaryFrame
): FileTransferBinaryFrame | null => {
  if (frame.opcode !== FILE_TRANSFER_BINARY_OPCODE) return null
  if (frame.payload.byteLength < 17) throw new TypeError("File-transfer frame is truncated")
  if (frame.payload.byteLength + 1 > FILE_TRANSFER_MAX_FRAME_BYTES) {
    throw new TypeError("File-transfer frame exceeds the 64 KiB limit")
  }
  const flags = frame.payload[16] ?? 0
  if ((flags & ~FILE_TRANSFER_END_FLAG) !== 0) {
    throw new TypeError("Invalid file-transfer flags")
  }
  return {
    data: frame.payload.subarray(17),
    end: (flags & FILE_TRANSFER_END_FLAG) !== 0,
    streamId: uuidString(frame.payload.subarray(0, 16)),
  }
}
