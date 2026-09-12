import { fromByteArray, toByteArray } from "base64-js"

export const arrayBufferToBase64 = (buffer: ArrayBuffer): string =>
  fromByteArray(new Uint8Array(buffer))

export const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
  const standard = base64.trim().replaceAll("-", "+").replaceAll("_", "/")
  const bytes = toByteArray(standard.padEnd(Math.ceil(standard.length / 4) * 4, "="))
  const result = new Uint8Array(bytes.byteLength)
  result.set(bytes)
  return result.buffer
}
