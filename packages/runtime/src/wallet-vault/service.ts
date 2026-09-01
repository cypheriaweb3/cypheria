import { hkdfSync, randomUUID } from "node:crypto"
import { access, mkdir, readdir, readFile, rename } from "node:fs/promises"
import { basename, join } from "node:path"

import {
  type VaultId,
  vaultIdSchema,
  type WalletAccountId,
  type WalletId,
  walletAccountIdSchema,
  walletIdSchema,
} from "@cypheria/wallet-core"
import { z } from "zod"

import { deleteFileAtomically, writeFileAtomically } from "./atomic-file.js"
import type { VaultMasterKeyProvider } from "./key-provider.js"
import {
  createWalletKeystoreCodec,
  type EncodedVaultSecret,
  type VaultSecret,
  type WalletKeystoreCodec,
} from "./keystore-codec.js"

const vaultEntryIdSchema = z
  .string()
  .regex(/^vault_entry_[A-Za-z0-9][A-Za-z0-9_-]*$/u)
  .transform((value) => value as VaultEntryId)

const sealedPassphraseSchema = z
  .object({
    algorithm: z.literal("aes-256-gcm"),
    ciphertext: z.string().regex(/^[a-f0-9]*$/u),
    iv: z.string().regex(/^[a-f0-9]{24}$/u),
    tag: z.string().regex(/^[a-f0-9]{32}$/u),
  })
  .strict()

const storedVaultEntrySchema = z
  .object({
    accountId: walletAccountIdSchema.optional(),
    id: vaultEntryIdSchema,
    keystore: z.record(z.string(), z.unknown()),
    kind: z.enum(["hd", "private-key"]),
    sealedPassphrase: sealedPassphraseSchema.optional(),
  })
  .strict()

const vaultDocumentSchema = z
  .object({
    createdAt: z.iso.datetime(),
    entries: z.array(storedVaultEntrySchema),
    updatedAt: z.iso.datetime(),
    vaultId: vaultIdSchema,
    version: z.literal(1),
    walletId: walletIdSchema,
  })
  .strict()
  .superRefine((document, context) => {
    const ids = new Set<string>()
    const accountIds = new Set<string>()
    for (const [index, entry] of document.entries.entries()) {
      if (ids.has(entry.id)) {
        context.addIssue({
          code: "custom",
          message: "Vault entry identifiers must be unique.",
          path: ["entries", index, "id"],
        })
      }
      ids.add(entry.id)
      if (entry.accountId) {
        if (accountIds.has(entry.accountId)) {
          context.addIssue({
            code: "custom",
            message: "Vault account identifiers must be unique.",
            path: ["entries", index, "accountId"],
          })
        }
        accountIds.add(entry.accountId)
      }
    }
  })

type VaultDocument = z.infer<typeof vaultDocumentSchema>
type StoredVaultEntry = z.infer<typeof storedVaultEntrySchema>

export type VaultEntryId = `vault_entry_${string}`

export type VaultEntryInput = {
  readonly accountId?: WalletAccountId
  readonly id: VaultEntryId
  readonly secret: VaultSecret
}

export type CreateVaultInput = {
  readonly entries: readonly VaultEntryInput[]
  readonly vaultId: VaultId
  readonly walletId: WalletId
}

export type UnlockedVaultSummary = {
  readonly entries: readonly {
    readonly accountId?: WalletAccountId
    readonly id: VaultEntryId
    readonly kind: VaultSecret["kind"]
  }[]
  readonly vaultId: VaultId
  readonly walletId: WalletId
}

export type VaultRecoveryReport = {
  readonly missingVaultIds: readonly VaultId[]
  readonly quarantined: readonly {
    readonly file: string
    readonly reason: "corrupt" | "orphan" | "stale-temporary-file"
  }[]
}

export type WalletVault = {
  readonly create: (input: CreateVaultInput) => Promise<UnlockedVaultSummary>
  readonly delete: (vaultId: VaultId) => Promise<void>
  readonly deleteEntry: (vaultId: VaultId, entryId: VaultEntryId) => Promise<void>
  readonly isUnlocked: (vaultId: VaultId) => boolean
  readonly lock: (vaultId: VaultId) => void
  readonly lockAll: () => void
  readonly putEntry: (vaultId: VaultId, entry: VaultEntryInput) => Promise<void>
  readonly recover: (referencedVaultIds: readonly VaultId[]) => Promise<VaultRecoveryReport>
  readonly unlock: (vaultId: VaultId) => Promise<UnlockedVaultSummary>
}

export type WalletVaultController = WalletVault & {
  readonly useAccountSecret: <T>(
    vaultId: VaultId,
    accountId: WalletAccountId,
    operation: (secret: VaultSecret) => Promise<T> | T
  ) => Promise<T>
  readonly useSecret: <T>(
    vaultId: VaultId,
    entryId: VaultEntryId,
    operation: (secret: VaultSecret) => Promise<T> | T
  ) => Promise<T>
}

export type WalletVaultOptions = {
  readonly codec?: WalletKeystoreCodec
  readonly deleteAtomically?: typeof deleteFileAtomically
  readonly keyProvider: VaultMasterKeyProvider
  readonly now?: () => string
  readonly vaultDir: string
  readonly writeAtomically?: typeof writeFileAtomically
}

export type WalletVaultErrorCode =
  | "ENTRY_NOT_FOUND"
  | "VAULT_ALREADY_EXISTS"
  | "VAULT_DECRYPTION_FAILED"
  | "VAULT_FILE_OPERATION_FAILED"
  | "VAULT_INVALID"
  | "VAULT_LOCKED"
  | "VAULT_NOT_FOUND"

export class WalletVaultError extends Error {
  readonly code: WalletVaultErrorCode

  constructor(code: WalletVaultErrorCode, message: string) {
    super(message)
    this.name = "WalletVaultError"
    this.code = code
  }
}

const fileNameForVault = (vaultId: VaultId): string => `${vaultId}.vault.json`

const toEncodedSecret = (entry: StoredVaultEntry): EncodedVaultSecret => ({
  keystore: entry.keystore,
  ...(entry.sealedPassphrase ? { sealedPassphrase: entry.sealedPassphrase } : {}),
})

const toSummary = (document: VaultDocument): UnlockedVaultSummary => ({
  entries: document.entries.map((entry) => ({
    ...(entry.accountId ? { accountId: entry.accountId } : {}),
    id: entry.id,
    kind: entry.kind,
  })),
  vaultId: document.vaultId,
  walletId: document.walletId,
})

const parseEntryInput = (entry: VaultEntryInput): VaultEntryInput => ({
  ...(entry.accountId ? { accountId: walletAccountIdSchema.parse(entry.accountId) } : {}),
  id: vaultEntryIdSchema.parse(entry.id),
  secret: entry.secret,
})

const mapFileError = (error: unknown): WalletVaultError => {
  if (error instanceof WalletVaultError) {
    return error
  }
  if ((error as NodeJS.ErrnoException).code === "ENOENT") {
    return new WalletVaultError("VAULT_NOT_FOUND", "The wallet vault does not exist.")
  }
  return new WalletVaultError(
    "VAULT_FILE_OPERATION_FAILED",
    "The wallet vault file operation failed."
  )
}

export const createWalletVaultController = (options: WalletVaultOptions): WalletVaultController => {
  const codec = options.codec ?? createWalletKeystoreCodec()
  const deleteAtomically = options.deleteAtomically ?? deleteFileAtomically
  const now = options.now ?? (() => new Date().toISOString())
  const writeAtomically = options.writeAtomically ?? writeFileAtomically
  const operations = new Map<VaultId, Promise<void>>()
  const unlockTokens = new Map<VaultId, symbol>()
  const unlocked = new Map<VaultId, Map<VaultEntryId, VaultSecret>>()
  const unlockedAccounts = new Map<VaultId, Map<WalletAccountId, VaultEntryId>>()
  const pathForVault = (vaultId: VaultId): string =>
    join(options.vaultDir, fileNameForVault(vaultIdSchema.parse(vaultId)))

  const runExclusive = async <T>(vaultId: VaultId, operation: () => Promise<T>): Promise<T> => {
    const previous = operations.get(vaultId) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(operation)
    const settled = run.then(
      () => undefined,
      () => undefined
    )
    operations.set(vaultId, settled)
    try {
      return await run
    } finally {
      if (operations.get(vaultId) === settled) {
        operations.delete(vaultId)
      }
    }
  }

  const readDocument = async (vaultId: VaultId): Promise<VaultDocument> => {
    try {
      const raw = await readFile(pathForVault(vaultId), "utf8")
      const document = vaultDocumentSchema.parse(JSON.parse(raw) as unknown)
      if (document.vaultId !== vaultId) {
        throw new WalletVaultError("VAULT_INVALID", "The wallet vault is invalid.")
      }
      return document
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof z.ZodError) {
        throw new WalletVaultError("VAULT_INVALID", "The wallet vault is invalid.")
      }
      throw mapFileError(error)
    }
  }

  const writeDocument = async (document: VaultDocument): Promise<void> => {
    try {
      const parsed = vaultDocumentSchema.parse(document)
      await writeAtomically(pathForVault(parsed.vaultId), `${JSON.stringify(parsed, null, 2)}\n`)
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new WalletVaultError("VAULT_INVALID", "The wallet vault is invalid.")
      }
      throw mapFileError(error)
    }
  }

  const deriveEntryKey = async (vaultId: VaultId, entryId: VaultEntryId): Promise<Uint8Array> => {
    const masterKey = await options.keyProvider.getOrCreateMasterKey()
    return new Uint8Array(
      hkdfSync(
        "sha256",
        masterKey,
        Buffer.from(vaultId, "utf8"),
        Buffer.from(`cypheria:vault-entry:v1:${entryId}`, "utf8"),
        32
      )
    )
  }

  const encodeEntry = async (
    vaultId: VaultId,
    entryValue: VaultEntryInput
  ): Promise<StoredVaultEntry> => {
    const entry = parseEntryInput(entryValue)
    try {
      const encoded = await codec.encode(entry.secret, await deriveEntryKey(vaultId, entry.id))
      return storedVaultEntrySchema.parse({
        ...(entry.accountId ? { accountId: entry.accountId } : {}),
        id: entry.id,
        keystore: encoded.keystore,
        kind: entry.secret.kind,
        ...(encoded.sealedPassphrase ? { sealedPassphrase: encoded.sealedPassphrase } : {}),
      })
    } catch {
      throw new WalletVaultError(
        "VAULT_FILE_OPERATION_FAILED",
        "The wallet secret could not be encrypted."
      )
    }
  }

  const quarantine = async (
    file: string,
    reason: VaultRecoveryReport["quarantined"][number]["reason"]
  ): Promise<VaultRecoveryReport["quarantined"][number]> => {
    const quarantineDir = join(options.vaultDir, "quarantine")
    await mkdir(quarantineDir, { recursive: true, mode: 0o700 })
    const destination = join(quarantineDir, `${basename(file)}.${randomUUID()}.quarantined`)
    await rename(file, destination)
    return { file: destination, reason }
  }

  const controller: WalletVaultController = {
    create: async (input) => {
      const vaultId = vaultIdSchema.parse(input.vaultId)
      return runExclusive(vaultId, async () => {
        const walletId = walletIdSchema.parse(input.walletId)
        const targetPath = pathForVault(vaultId)
        try {
          await access(targetPath)
          throw new WalletVaultError("VAULT_ALREADY_EXISTS", "The wallet vault already exists.")
        } catch (error) {
          if (error instanceof WalletVaultError) {
            throw error
          }
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw mapFileError(error)
          }
        }

        const entries = await Promise.all(input.entries.map((entry) => encodeEntry(vaultId, entry)))
        const timestamp = now()
        const document = vaultDocumentSchema.parse({
          createdAt: timestamp,
          entries,
          updatedAt: timestamp,
          vaultId,
          version: 1,
          walletId,
        })
        await writeDocument(document)
        return toSummary(document)
      })
    },
    delete: async (vaultIdValue) => {
      const vaultId = vaultIdSchema.parse(vaultIdValue)
      await runExclusive(vaultId, async () => {
        controller.lock(vaultId)
        try {
          await deleteAtomically(pathForVault(vaultId))
        } catch (error) {
          throw mapFileError(error)
        }
      })
    },
    deleteEntry: async (vaultIdValue, entryIdValue) => {
      const vaultId = vaultIdSchema.parse(vaultIdValue)
      const entryId = vaultEntryIdSchema.parse(entryIdValue)
      await runExclusive(vaultId, async () => {
        const document = await readDocument(vaultId)
        if (!document.entries.some((entry) => entry.id === entryId)) {
          throw new WalletVaultError("ENTRY_NOT_FOUND", "The wallet vault entry does not exist.")
        }
        await writeDocument({
          ...document,
          entries: document.entries.filter((entry) => entry.id !== entryId),
          updatedAt: now(),
        })
        controller.lock(vaultId)
      })
    },
    isUnlocked: (vaultId) => unlocked.has(vaultIdSchema.parse(vaultId)),
    lock: (vaultId) => {
      const parsedVaultId = vaultIdSchema.parse(vaultId)
      unlockTokens.delete(parsedVaultId)
      unlocked.delete(parsedVaultId)
      unlockedAccounts.delete(parsedVaultId)
    },
    lockAll: () => {
      unlockTokens.clear()
      unlocked.clear()
      unlockedAccounts.clear()
      options.keyProvider.clearCachedMasterKey?.()
    },
    putEntry: async (vaultIdValue, entryValue) => {
      const vaultId = vaultIdSchema.parse(vaultIdValue)
      await runExclusive(vaultId, async () => {
        const document = await readDocument(vaultId)
        const entry = await encodeEntry(vaultId, entryValue)
        const existingIndex = document.entries.findIndex((item) => item.id === entry.id)
        const entries = [...document.entries]
        if (existingIndex === -1) {
          entries.push(entry)
        } else {
          entries[existingIndex] = entry
        }
        await writeDocument({ ...document, entries, updatedAt: now() })
        controller.lock(vaultId)
      })
    },
    recover: async (referencedVaultIdValues) => {
      const referencedVaultIds = referencedVaultIdValues.map((vaultId) =>
        vaultIdSchema.parse(vaultId)
      )
      const missing = new Set(referencedVaultIds)
      const quarantined: VaultRecoveryReport["quarantined"][number][] = []
      await mkdir(options.vaultDir, { recursive: true, mode: 0o700 })
      const entries = await readdir(options.vaultDir, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isFile()) {
          continue
        }
        const file = join(options.vaultDir, entry.name)
        if (entry.name.endsWith(".tmp") || entry.name.endsWith(".deleting")) {
          quarantined.push(await quarantine(file, "stale-temporary-file"))
          continue
        }
        if (!entry.name.endsWith(".vault.json")) {
          continue
        }

        try {
          const document = vaultDocumentSchema.parse(
            JSON.parse(await readFile(file, "utf8")) as unknown
          )
          if (entry.name !== fileNameForVault(document.vaultId)) {
            quarantined.push(await quarantine(file, "corrupt"))
          } else if (referencedVaultIds.includes(document.vaultId)) {
            missing.delete(document.vaultId)
          } else {
            controller.lock(document.vaultId)
            quarantined.push(await quarantine(file, "orphan"))
          }
        } catch {
          quarantined.push(await quarantine(file, "corrupt"))
        }
      }

      return { missingVaultIds: [...missing], quarantined }
    },
    unlock: async (vaultIdValue) => {
      const vaultId = vaultIdSchema.parse(vaultIdValue)
      const unlockToken = Symbol(vaultId)
      unlockTokens.set(vaultId, unlockToken)
      try {
        return await runExclusive(vaultId, async () => {
          const document = await readDocument(vaultId)
          const nextSecrets = new Map<VaultEntryId, VaultSecret>()
          try {
            for (const entry of document.entries) {
              nextSecrets.set(
                entry.id,
                await codec.decode(
                  entry.kind,
                  toEncodedSecret(entry),
                  await deriveEntryKey(vaultId, entry.id)
                )
              )
            }
          } catch {
            throw new WalletVaultError(
              "VAULT_DECRYPTION_FAILED",
              "The wallet vault could not be unlocked."
            )
          }
          if (unlockTokens.get(vaultId) === unlockToken) {
            unlocked.set(vaultId, nextSecrets)
            unlockedAccounts.set(
              vaultId,
              new Map(
                document.entries.flatMap((entry) =>
                  entry.accountId ? [[entry.accountId, entry.id] as const] : []
                )
              )
            )
          }
          return toSummary(document)
        })
      } catch (error) {
        if (unlockTokens.get(vaultId) === unlockToken) {
          unlockTokens.delete(vaultId)
        }
        throw error
      }
    },
    useAccountSecret: async (vaultIdValue, accountIdValue, operation) => {
      const vaultId = vaultIdSchema.parse(vaultIdValue)
      const accountId = walletAccountIdSchema.parse(accountIdValue)
      if (!unlocked.has(vaultId)) {
        throw new WalletVaultError("VAULT_LOCKED", "The wallet vault is locked.")
      }
      const entryId = unlockedAccounts.get(vaultId)?.get(accountId)
      const secret = entryId ? unlocked.get(vaultId)?.get(entryId) : undefined
      if (!secret) {
        throw new WalletVaultError("ENTRY_NOT_FOUND", "The wallet vault entry does not exist.")
      }
      return operation(secret)
    },
    useSecret: async (vaultIdValue, entryIdValue, operation) => {
      const vaultId = vaultIdSchema.parse(vaultIdValue)
      const entryId = vaultEntryIdSchema.parse(entryIdValue)
      const secret = unlocked.get(vaultId)?.get(entryId)
      if (!secret) {
        throw new WalletVaultError("VAULT_LOCKED", "The wallet vault is locked.")
      }
      return operation(secret)
    },
  }

  return controller
}

export const createWalletVault = (options: WalletVaultOptions): WalletVault =>
  createWalletVaultController(options)
