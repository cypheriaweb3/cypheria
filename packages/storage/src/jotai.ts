import type { WritableAtom } from "jotai/vanilla"
import type { RESET } from "jotai/vanilla/utils"
import { atomWithStorage } from "jotai/vanilla/utils"
import type { AsyncStorage } from "jotai/vanilla/utils/atomWithStorage"
import type { KeyValueStorage } from "./key-value.js"
import {
  decodeValidatedValue,
  type RuntimeSchema,
  type ValidatedValueOptions,
  writeValidatedValue,
} from "./validated-value.js"

export type ValidatedJotaiStorageOptions = ValidatedValueOptions

export function createValidatedJotaiStorage<Value>(
  storage: KeyValueStorage,
  schema: RuntimeSchema<Value>,
  options: ValidatedJotaiStorageOptions = {}
): AsyncStorage<Value> {
  const read = async (key: string, initialValue: Value): Promise<Value> => {
    const raw = await storage.getItem(key)
    const value = decodeValidatedValue(raw, schema, options)
    if (value !== null) return value
    if (raw !== null) await storage.removeItem(key)
    return initialValue
  }

  return {
    getItem: read,
    async setItem(key, value) {
      await writeValidatedValue(storage, key, value, schema, options)
    },
    removeItem: (key) => storage.removeItem(key),
    ...(storage.subscribe
      ? {
          subscribe(key: string, callback: (value: Value) => void, initialValue: Value) {
            return storage.subscribe?.(key, (raw) => {
              callback(decodeValidatedValue(raw, schema, options) ?? initialValue)
            })
          },
        }
      : {}),
  }
}

export interface PersistentAtomOptions extends ValidatedJotaiStorageOptions {
  readonly getOnInit?: boolean
}

export type ValidatedStorageSetStateAction<Value> =
  | Value
  | typeof RESET
  | ((previous: Value) => Value | typeof RESET)

export type ValidatedStorageAtom<Value> = WritableAtom<
  Value | Promise<Value>,
  [ValidatedStorageSetStateAction<Value | Promise<Value>>],
  Promise<void>
>

export function atomWithValidatedStorage<Value>(
  key: string,
  initialValue: Value,
  storage: KeyValueStorage,
  schema: RuntimeSchema<Value>,
  options: PersistentAtomOptions = {}
): ValidatedStorageAtom<Value> {
  return atomWithStorage(key, initialValue, createValidatedJotaiStorage(storage, schema, options), {
    getOnInit: options.getOnInit ?? false,
  })
}
