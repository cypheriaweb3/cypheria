import { randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"

import { writeFileAtomically } from "./atomic-file.js"

const MASTER_KEY_BYTES = 32

export type VaultMasterKeyProvider = {
  readonly clearCachedMasterKey?: () => void
  readonly getOrCreateMasterKey: () => Promise<Uint8Array>
}

export type SafeStorageProtector = {
  readonly decryptString: (encrypted: Uint8Array) => string
  readonly encryptString: (plainText: string) => Uint8Array
  readonly isEncryptionAvailable: () => boolean
}

export class VaultKeyProviderError extends Error {
  readonly code: "KEY_STORAGE_UNAVAILABLE" | "KEY_STORAGE_INVALID" | "KEY_STORAGE_WRITE_FAILED"

  constructor(code: VaultKeyProviderError["code"], message: string) {
    super(message)
    this.name = "VaultKeyProviderError"
    this.code = code
  }
}

const assertMasterKey = (value: Uint8Array): Uint8Array => {
  if (value.byteLength !== MASTER_KEY_BYTES) {
    throw new VaultKeyProviderError("KEY_STORAGE_INVALID", "The wallet master key is invalid.")
  }
  return new Uint8Array(value)
}

export const createMemoryVaultMasterKeyProvider = (
  initialKey: Uint8Array = randomBytes(MASTER_KEY_BYTES)
): VaultMasterKeyProvider => {
  const key = assertMasterKey(initialKey)
  return {
    clearCachedMasterKey: () => undefined,
    getOrCreateMasterKey: async () => new Uint8Array(key),
  }
}

export type SafeStorageVaultMasterKeyProviderOptions = {
  readonly keyFile: string
  readonly protector: SafeStorageProtector
}

export const createSafeStorageVaultMasterKeyProvider = (
  options: SafeStorageVaultMasterKeyProviderOptions
): VaultMasterKeyProvider => {
  let cachedKey: Uint8Array | undefined
  let pendingKey: Promise<Uint8Array> | undefined

  const requireEncryption = (): void => {
    if (!options.protector.isEncryptionAvailable()) {
      throw new VaultKeyProviderError(
        "KEY_STORAGE_UNAVAILABLE",
        "OS-backed wallet key storage is unavailable."
      )
    }
  }

  const loadOrCreateKey = async (): Promise<Uint8Array> => {
    requireEncryption()
    try {
      const protectedKey = await readFile(options.keyFile)
      const decoded = Buffer.from(options.protector.decryptString(protectedKey), "base64")
      cachedKey = assertMasterKey(decoded)
      return new Uint8Array(cachedKey)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        if (error instanceof VaultKeyProviderError) {
          throw error
        }
        throw new VaultKeyProviderError(
          "KEY_STORAGE_INVALID",
          "The OS-protected wallet master key could not be read."
        )
      }
    }

    const key = randomBytes(MASTER_KEY_BYTES)
    try {
      const protectedKey = options.protector.encryptString(key.toString("base64"))
      await writeFileAtomically(options.keyFile, protectedKey)
    } catch {
      throw new VaultKeyProviderError(
        "KEY_STORAGE_WRITE_FAILED",
        "The OS-protected wallet master key could not be stored."
      )
    }
    cachedKey = new Uint8Array(key)
    return new Uint8Array(cachedKey)
  }

  return {
    clearCachedMasterKey: () => {
      cachedKey?.fill(0)
      cachedKey = undefined
    },
    getOrCreateMasterKey: async () => {
      if (cachedKey) {
        return new Uint8Array(cachedKey)
      }
      pendingKey ??= loadOrCreateKey().finally(() => {
        pendingKey = undefined
      })
      return new Uint8Array(await pendingKey)
    },
  }
}
