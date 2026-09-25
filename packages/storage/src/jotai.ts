import { atomWithStorage } from "jotai/vanilla/utils"
import type { AsyncStorage } from "jotai/vanilla/utils/atomWithStorage"
import type { z } from "zod"

import type { KeyValueStorage } from "./key-value.js"

interface PersistedValueEnvelope {
  readonly version: number
  readonly value: unknown
}

export interface ValidatedJotaiStorageOptions<Value> {
  readonly version?: number
  readonly migrate?: (value: unknown, storedVersion: number) => Value | null
}

const decodeEnvelope = <Value>(
  raw: string | null,
  schema: z.ZodType<Value>,
  version: number,
  migrate?: ValidatedJotaiStorageOptions<Value>["migrate"]
): Value | null => {
  if (raw === null) return null
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    return null
  }
  if (!decoded || typeof decoded !== "object") return null
  const envelope = decoded as Partial<PersistedValueEnvelope>
  if (!Number.isInteger(envelope.version) || !("value" in envelope)) return null
  if (envelope.version !== version) {
    const migrated = migrate?.(envelope.value, envelope.version as number)
    if (migrated === null || migrated === undefined) return null
    const result = schema.safeParse(migrated)
    return result.success ? result.data : null
  }
  const result = schema.safeParse(envelope.value)
  return result.success ? result.data : null
}

export function createValidatedJotaiStorage<Value>(
  storage: KeyValueStorage,
  schema: z.ZodType<Value>,
  options: ValidatedJotaiStorageOptions<Value> = {}
): AsyncStorage<Value> {
  const version = options.version ?? 1
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("Jotai storage version must be a positive integer.")
  }

  const read = async (key: string, initialValue: Value): Promise<Value> => {
    const raw = await storage.getItem(key)
    const value = decodeEnvelope(raw, schema, version, options.migrate)
    if (value !== null) return value
    if (raw !== null) await storage.removeItem(key)
    return initialValue
  }

  return {
    getItem: read,
    async setItem(key, value) {
      const parsed = schema.parse(value)
      await storage.setItem(key, JSON.stringify({ value: parsed, version }))
    },
    removeItem: (key) => storage.removeItem(key),
    ...(storage.subscribe
      ? {
          subscribe(key: string, callback: (value: Value) => void, initialValue: Value) {
            return storage.subscribe?.(key, (raw) => {
              callback(decodeEnvelope(raw, schema, version, options.migrate) ?? initialValue)
            })
          },
        }
      : {}),
  }
}

export interface PersistentAtomOptions<Value> extends ValidatedJotaiStorageOptions<Value> {
  readonly getOnInit?: boolean
}

export function atomWithValidatedStorage<Value>(
  key: string,
  initialValue: Value,
  storage: KeyValueStorage,
  schema: z.ZodType<Value>,
  options: PersistentAtomOptions<Value> = {}
) {
  return atomWithStorage(key, initialValue, createValidatedJotaiStorage(storage, schema, options), {
    getOnInit: options.getOnInit ?? false,
  })
}
