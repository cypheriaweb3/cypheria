import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  createMemoryVaultMasterKeyProvider,
  createSafeStorageVaultMasterKeyProvider,
  VaultKeyProviderError,
} from "./key-provider.js"
import { createWalletKeystoreCodec } from "./keystore-codec.js"
import { createWalletVaultController, WalletVaultError } from "./service.js"

const privateKey = `0x${"11".repeat(32)}` as const
const secondPrivateKey = `0x${"22".repeat(32)}` as const
const thirdPrivateKey = `0x${"33".repeat(32)}` as const
const entropy = `0x${"ab".repeat(16)}` as const
const passphrase = "this passphrase must never appear in the vault file"
const timestamp = "2026-09-01T01:00:00.000Z"
const tempDirs: string[] = []

const makeVaultDir = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "cypheria-vault-test-"))
  tempDirs.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true })))
})

const createTestVault = (vaultDir: string, key = new Uint8Array(32).fill(7)) =>
  createWalletVaultController({
    codec: createWalletKeystoreCodec({ scryptN: 1024 }),
    keyProvider: createMemoryVaultMasterKeyProvider(key),
    now: () => timestamp,
    vaultDir,
  })

describe("wallet vault", () => {
  it("encrypts private-key and HD entries and only exposes them while unlocked", async () => {
    const vaultDir = await makeVaultDir()
    const vault = createTestVault(vaultDir)

    const summary = await vault.create({
      entries: [
        {
          accountId: "account_private",
          id: "vault_entry_private",
          secret: { kind: "private-key", privateKey },
        },
        {
          accountId: "account_hd",
          id: "vault_entry_hd",
          secret: { entropy, kind: "hd", passphrase },
        },
      ],
      vaultId: "vault_primary",
      walletId: "wallet_primary",
    })

    expect(summary).toEqual({
      entries: [
        { accountId: "account_private", id: "vault_entry_private", kind: "private-key" },
        { accountId: "account_hd", id: "vault_entry_hd", kind: "hd" },
      ],
      vaultId: "vault_primary",
      walletId: "wallet_primary",
    })
    expect(vault.isUnlocked("vault_primary")).toBe(false)

    const raw = await readFile(join(vaultDir, "vault_primary.vault.json"), "utf8")
    expect(raw).not.toContain(privateKey)
    expect(raw).not.toContain(entropy)
    expect(raw).not.toContain(passphrase)
    expect(JSON.parse(raw)).toMatchObject({ vaultId: "vault_primary", version: 1 })

    await vault.unlock("vault_primary")
    await expect(
      vault.useSecret("vault_primary", "vault_entry_private", (secret) => secret)
    ).resolves.toEqual({ kind: "private-key", privateKey })
    await expect(
      vault.useSecret("vault_primary", "vault_entry_hd", (secret) => secret)
    ).resolves.toEqual({ entropy, kind: "hd", passphrase })

    vault.lock("vault_primary")
    await expect(
      vault.useSecret("vault_primary", "vault_entry_private", () => undefined)
    ).rejects.toMatchObject({ code: "VAULT_LOCKED" })
  })

  it("redacts decryption and write failures", async () => {
    const vaultDir = await makeVaultDir()
    await createTestVault(vaultDir).create({
      entries: [
        {
          id: "vault_entry_private",
          secret: { kind: "private-key", privateKey },
        },
      ],
      vaultId: "vault_primary",
      walletId: "wallet_primary",
    })

    const wrongKeyVault = createTestVault(vaultDir, new Uint8Array(32).fill(8))
    const unlockError = await wrongKeyVault.unlock("vault_primary").catch((error) => error)
    expect(unlockError).toBeInstanceOf(WalletVaultError)
    expect(unlockError).toMatchObject({ code: "VAULT_DECRYPTION_FAILED" })
    expect(String(unlockError)).not.toContain(privateKey)

    const failedWriteVault = createWalletVaultController({
      codec: createWalletKeystoreCodec({ scryptN: 1024 }),
      keyProvider: createMemoryVaultMasterKeyProvider(new Uint8Array(32).fill(7)),
      vaultDir: join(vaultDir, "failed"),
      writeAtomically: async () => {
        throw new Error(`failed to write ${privateKey}`)
      },
    })
    const writeError = await failedWriteVault
      .create({
        entries: [
          {
            id: "vault_entry_private",
            secret: { kind: "private-key", privateKey },
          },
        ],
        vaultId: "vault_failed",
        walletId: "wallet_failed",
      })
      .catch((error) => error)
    expect(writeError).toMatchObject({ code: "VAULT_FILE_OPERATION_FAILED" })
    expect(String(writeError)).not.toContain(privateKey)
  })

  it("keeps a vault locked when lock races with an in-flight unlock", async () => {
    const vaultDir = await makeVaultDir()
    const baseCodec = createWalletKeystoreCodec({ scryptN: 1024 })
    let releaseDecode: (() => void) | undefined
    let markDecodeStarted: (() => void) | undefined
    const decodeStarted = new Promise<void>((resolve) => {
      markDecodeStarted = resolve
    })
    const decodeGate = new Promise<void>((resolve) => {
      releaseDecode = resolve
    })
    const vault = createWalletVaultController({
      codec: {
        ...baseCodec,
        decode: async (...args) => {
          markDecodeStarted?.()
          await decodeGate
          return baseCodec.decode(...args)
        },
      },
      keyProvider: createMemoryVaultMasterKeyProvider(new Uint8Array(32).fill(7)),
      vaultDir,
    })
    await vault.create({
      entries: [
        {
          id: "vault_entry_private",
          secret: { kind: "private-key", privateKey },
        },
      ],
      vaultId: "vault_race",
      walletId: "wallet_race",
    })

    const unlocking = vault.unlock("vault_race")
    await decodeStarted
    vault.lock("vault_race")
    releaseDecode?.()
    await unlocking

    expect(vault.isUnlocked("vault_race")).toBe(false)
  })

  it("updates group entries without re-encrypting unrelated secrets", async () => {
    const vaultDir = await makeVaultDir()
    const vault = createTestVault(vaultDir)
    const file = join(vaultDir, "vault_group.vault.json")
    await vault.create({
      entries: [
        {
          accountId: "account_one",
          id: "vault_entry_one",
          secret: { kind: "private-key", privateKey },
        },
      ],
      vaultId: "vault_group",
      walletId: "wallet_group",
    })
    const before = JSON.parse(await readFile(file, "utf8")) as {
      entries: { id: string; keystore: unknown }[]
    }

    await Promise.all([
      vault.putEntry("vault_group", {
        accountId: "account_two",
        id: "vault_entry_two",
        secret: { kind: "private-key", privateKey: secondPrivateKey },
      }),
      vault.putEntry("vault_group", {
        accountId: "account_three",
        id: "vault_entry_three",
        secret: { kind: "private-key", privateKey: thirdPrivateKey },
      }),
    ])
    const after = JSON.parse(await readFile(file, "utf8")) as typeof before
    expect(after.entries).toHaveLength(3)
    expect(after.entries.find((entry) => entry.id === "vault_entry_one")?.keystore).toEqual(
      before.entries[0]?.keystore
    )

    await vault.deleteEntry("vault_group", "vault_entry_one")
    await vault.unlock("vault_group")
    await expect(
      vault.useSecret("vault_group", "vault_entry_two", (secret) => secret)
    ).resolves.toEqual({ kind: "private-key", privateKey: secondPrivateKey })
    await expect(
      vault.useSecret("vault_group", "vault_entry_three", (secret) => secret)
    ).resolves.toEqual({ kind: "private-key", privateKey: thirdPrivateKey })
  })

  it("quarantines orphan, corrupt, and stale files while reporting missing vaults", async () => {
    const vaultDir = await makeVaultDir()
    const vault = createTestVault(vaultDir)
    await vault.create({
      entries: [],
      vaultId: "vault_referenced",
      walletId: "wallet_referenced",
    })
    await vault.create({
      entries: [],
      vaultId: "vault_orphan",
      walletId: "wallet_orphan",
    })
    await writeFile(join(vaultDir, "vault_corrupt.vault.json"), "not-json")
    await writeFile(join(vaultDir, ".abandoned.tmp"), "partial")

    const report = await vault.recover(["vault_referenced", "vault_missing"])

    expect(report.missingVaultIds).toEqual(["vault_missing"])
    expect(report.quarantined.map(({ reason }) => reason).sort()).toEqual([
      "corrupt",
      "orphan",
      "stale-temporary-file",
    ])
    expect(await readdir(join(vaultDir, "quarantine"))).toHaveLength(3)
    await expect(stat(join(vaultDir, "vault_referenced.vault.json"))).resolves.toBeDefined()
  })

  it("writes mode-restricted files and atomically deletes locked vaults", async () => {
    const vaultDir = await makeVaultDir()
    const vault = createTestVault(vaultDir)
    const file = join(vaultDir, "vault_delete.vault.json")
    await vault.create({
      entries: [],
      vaultId: "vault_delete",
      walletId: "wallet_delete",
    })
    await vault.unlock("vault_delete")

    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect((await readdir(vaultDir)).some((name) => name.endsWith(".tmp"))).toBe(false)

    await vault.delete("vault_delete")
    expect(vault.isUnlocked("vault_delete")).toBe(false)
    await expect(stat(file)).rejects.toMatchObject({ code: "ENOENT" })
  })
})

describe("vault master-key providers", () => {
  it("creates one master key for concurrent first access", async () => {
    const directory = await makeVaultDir()
    let encryptions = 0
    const provider = createSafeStorageVaultMasterKeyProvider({
      keyFile: join(directory, "wallet-master-key.bin"),
      protector: {
        decryptString: (encrypted) => Buffer.from(encrypted).toString("utf8"),
        encryptString: (plainText) => {
          encryptions += 1
          return Buffer.from(plainText)
        },
        isEncryptionAvailable: () => true,
      },
    })

    const keys = await Promise.all([
      provider.getOrCreateMasterKey(),
      provider.getOrCreateMasterKey(),
      provider.getOrCreateMasterKey(),
    ])

    expect(keys[1]).toEqual(keys[0])
    expect(keys[2]).toEqual(keys[0])
    expect(encryptions).toBe(1)
  })

  it("persists the master key through an OS-protected file", async () => {
    const directory = await makeVaultDir()
    const keyFile = join(directory, "wallet-master-key.bin")
    const protector = {
      decryptString: (encrypted: Uint8Array) =>
        Buffer.from(encrypted).subarray(10).toString("utf8").split("").reverse().join(""),
      encryptString: (plainText: string) =>
        Buffer.from(`protected:${plainText.split("").reverse().join("")}`),
      isEncryptionAvailable: () => true,
    }
    const first = createSafeStorageVaultMasterKeyProvider({ keyFile, protector })
    const firstKey = await first.getOrCreateMasterKey()
    const second = createSafeStorageVaultMasterKeyProvider({ keyFile, protector })

    await expect(second.getOrCreateMasterKey()).resolves.toEqual(firstKey)
    expect((await readFile(keyFile, "utf8")).startsWith("protected:")).toBe(true)
    expect((await stat(keyFile)).mode & 0o777).toBe(0o600)
  })

  it("fails closed when OS encryption is unavailable", async () => {
    const directory = await makeVaultDir()
    const provider = createSafeStorageVaultMasterKeyProvider({
      keyFile: join(directory, "wallet-master-key.bin"),
      protector: {
        decryptString: () => "",
        encryptString: () => new Uint8Array(),
        isEncryptionAvailable: () => false,
      },
    })

    await expect(provider.getOrCreateMasterKey()).rejects.toBeInstanceOf(VaultKeyProviderError)
    await expect(provider.getOrCreateMasterKey()).rejects.toMatchObject({
      code: "KEY_STORAGE_UNAVAILABLE",
    })
  })
})
