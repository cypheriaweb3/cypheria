import { z } from "zod"

export const JSON_RPC_MAX_DEPTH = 32
export const JSON_RPC_MAX_NODES = 20_000
export const JSON_RPC_MAX_STRING_LENGTH = 1_048_576

const isJsonValue = (root: unknown): boolean => {
  const pending: Array<{ readonly depth: number; readonly value: unknown }> = [
    { depth: 0, value: root },
  ]
  const seen = new WeakSet<object>()
  let nodes = 0
  while (pending.length > 0) {
    const item = pending.pop()
    if (!item || item.depth > JSON_RPC_MAX_DEPTH || ++nodes > JSON_RPC_MAX_NODES) return false
    const { depth, value } = item
    if (
      value === null ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      continue
    }
    if (typeof value === "string") {
      if (value.length > JSON_RPC_MAX_STRING_LENGTH) return false
      continue
    }
    if (!value || typeof value !== "object" || seen.has(value)) return false
    seen.add(value)
    if (Array.isArray(value)) {
      pending.push(...value.map((child) => ({ depth: depth + 1, value: child })))
      continue
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    const entries = Object.entries(value)
    if (entries.some(([key]) => key.length > JSON_RPC_MAX_STRING_LENGTH)) return false
    pending.push(...entries.map(([, child]) => ({ depth: depth + 1, value: child })))
  }
  return true
}

export const jsonRpcValueSchema = z.unknown().refine(isJsonValue, "Invalid JSON-RPC value.")

export const jsonRpcParamsSchema = z
  .unknown()
  .refine(
    (value) =>
      (Array.isArray(value) ||
        (Boolean(value) &&
          typeof value === "object" &&
          (Object.getPrototypeOf(value) === Object.prototype ||
            Object.getPrototypeOf(value) === null))) &&
      isJsonValue(value),
    "Invalid JSON-RPC parameters."
  )

export const bytesToBase64 = (value: {
  readonly [index: number]: number
  readonly length: number
}): string => {
  let binary = ""
  for (let index = 0; index < value.length; index += 1) {
    binary += String.fromCharCode(value[index] ?? 0)
  }
  return btoa(binary)
}

export const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export const base64Schema = z
  .string()
  .max(2_000_000)
  .refine((value) => {
    try {
      return bytesToBase64(base64ToBytes(value)) === value
    } catch {
      return false
    }
  }, "Invalid canonical base64 data.")
