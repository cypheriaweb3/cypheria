import { readFile } from "node:fs/promises"
import { join } from "node:path"
import {
  type NetworkCredentialRef,
  networkCredentialRefSchema,
  normalizeRpcUrl,
} from "@cypheria/network-core"
import { z } from "zod"
import { deleteFileAtomically, writeFileAtomically } from "../wallet-vault/atomic-file.js"
import type { SafeStorageProtector } from "../wallet-vault/index.js"

export const networkCredentialSchema = z
  .object({
    url: z.url(),
    headers: z.record(z.string().min(1), z.string()).optional(),
  })
  .strict()

export type NetworkCredential = z.infer<typeof networkCredentialSchema>

export type NetworkCredentialStore = {
  readonly delete: (reference: NetworkCredentialRef) => Promise<void>
  readonly get: (reference: NetworkCredentialRef) => Promise<NetworkCredential | undefined>
  readonly put: (
    reference: NetworkCredentialRef,
    credential: NetworkCredential,
    transport: "http" | "websocket",
    options?: { readonly allowLoopbackDevelopment?: boolean }
  ) => Promise<void>
}

export type SafeStorageNetworkCredentialStoreOptions = {
  readonly directory: string
  readonly protector: SafeStorageProtector
}

export class NetworkCredentialStoreError extends Error {
  readonly code: "CREDENTIAL_INVALID" | "CREDENTIAL_STORAGE_UNAVAILABLE"

  constructor(code: NetworkCredentialStoreError["code"], message: string) {
    super(message)
    this.name = "NetworkCredentialStoreError"
    this.code = code
  }
}

const parseCredential = (
  value: NetworkCredential,
  transport: "http" | "websocket",
  allowLoopbackDevelopment = false
): NetworkCredential => {
  const credential = networkCredentialSchema.parse(value)
  return {
    ...credential,
    url: normalizeRpcUrl(credential.url, { allowLoopbackDevelopment, transport }),
  }
}

const credentialPath = (directory: string, reference: NetworkCredentialRef): string =>
  join(directory, `${networkCredentialRefSchema.parse(reference)}.bin`)

export const createSafeStorageNetworkCredentialStore = (
  options: SafeStorageNetworkCredentialStoreOptions
): NetworkCredentialStore => {
  const requireEncryption = (): void => {
    if (!options.protector.isEncryptionAvailable()) {
      throw new NetworkCredentialStoreError(
        "CREDENTIAL_STORAGE_UNAVAILABLE",
        "OS-backed network credential storage is unavailable."
      )
    }
  }

  return {
    delete: async (reference) => {
      requireEncryption()
      await deleteFileAtomically(credentialPath(options.directory, reference)).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      })
    },
    get: async (reference) => {
      requireEncryption()
      try {
        const encrypted = await readFile(credentialPath(options.directory, reference))
        const plainText = options.protector.decryptString(encrypted)
        return networkCredentialSchema.parse(JSON.parse(plainText))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
        if (error instanceof NetworkCredentialStoreError) throw error
        throw new NetworkCredentialStoreError(
          "CREDENTIAL_INVALID",
          "The protected network credential could not be read."
        )
      }
    },
    put: async (reference, value, transport, putOptions) => {
      requireEncryption()
      const credential = parseCredential(value, transport, putOptions?.allowLoopbackDevelopment)
      const encrypted = options.protector.encryptString(JSON.stringify(credential))
      await writeFileAtomically(credentialPath(options.directory, reference), encrypted)
    },
  }
}

export const createMemoryNetworkCredentialStore = (): NetworkCredentialStore => {
  const credentials = new Map<NetworkCredentialRef, NetworkCredential>()
  return {
    delete: async (reference) => {
      credentials.delete(networkCredentialRefSchema.parse(reference))
    },
    get: async (reference) => credentials.get(networkCredentialRefSchema.parse(reference)),
    put: async (reference, value, transport, options) => {
      credentials.set(
        networkCredentialRefSchema.parse(reference),
        parseCredential(value, transport, options?.allowLoopbackDevelopment)
      )
    },
  }
}
