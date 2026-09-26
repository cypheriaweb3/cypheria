import type { KeyValueStorage } from "./key-value.js"

/** Structural runtime schema contract so callers may use any Zod 4 patch release. */
export interface RuntimeSchema<Value> {
  parse(input: unknown): Value
  safeParse(input: unknown): { success: true; data: Value } | { success: false }
}

export interface PersistedValueEnvelope {
  readonly version: number
  readonly value: unknown
}

export interface ValidatedValueOptions {
  readonly version?: number
}

const resolveVersion = (version = 1): number => {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("Persisted value version must be a positive integer.")
  }
  return version
}

export const decodeValidatedValue = <Value>(
  raw: string | null,
  schema: RuntimeSchema<Value>,
  options: ValidatedValueOptions = {}
): Value | null => {
  if (raw === null) return null
  const version = resolveVersion(options.version)
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    return null
  }
  if (!decoded || typeof decoded !== "object") return null
  const envelope = decoded as Partial<PersistedValueEnvelope>
  if (!Number.isInteger(envelope.version) || !("value" in envelope)) return null
  if (envelope.version !== version) return null
  const result = schema.safeParse(envelope.value)
  return result.success ? result.data : null
}

export const encodeValidatedValue = <Value>(
  value: Value,
  schema: RuntimeSchema<Value>,
  options: ValidatedValueOptions = {}
): string =>
  JSON.stringify({
    value: schema.parse(value),
    version: resolveVersion(options.version),
  } satisfies PersistedValueEnvelope)

export const readValidatedValue = async <Value>(
  storage: KeyValueStorage,
  key: string,
  defaultValue: Value,
  schema: RuntimeSchema<Value>,
  options: ValidatedValueOptions = {}
): Promise<Value> => {
  const raw = await storage.getItem(key)
  const value = decodeValidatedValue(raw, schema, options)
  if (value !== null) return value
  if (raw !== null) await storage.removeItem(key)
  return defaultValue
}

export const writeValidatedValue = async <Value>(
  storage: KeyValueStorage,
  key: string,
  value: Value,
  schema: RuntimeSchema<Value>,
  options: ValidatedValueOptions = {}
): Promise<void> => storage.setItem(key, encodeValidatedValue(value, schema, options))
