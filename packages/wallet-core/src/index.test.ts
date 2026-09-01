import { describe, expect, expectTypeOf, it } from "vitest"

import {
  chainAccountSchema,
  createAccountFingerprint,
  createAddressWalletFingerprint,
  createGroupWalletFingerprint,
  createHdAccountFingerprint,
  createHdWalletFingerprint,
  defaultEvmHdDerivationScheme,
  derivePath,
  deserializeSigningIntent,
  type HexAddress,
  parseSigningIntent,
  parseWallet,
  serializeSigningIntent,
  toWalletView,
  type WalletSigner,
} from "./index.js"

const address = "0x00000000000000000000000000000000000000AA" as HexAddress
const now = "2026-09-01T00:00:00.000Z"

describe("wallet domain", () => {
  it("enforces wallet kind and provider combinations", () => {
    const fingerprint = createHdWalletFingerprint(address)
    expect(
      parseWallet({
        createdAt: now,
        fingerprint,
        id: "wallet_one",
        kind: "hd",
        name: "Primary",
        provider: "local-vault",
        status: "ready",
        updatedAt: now,
        vaultId: "vault_one",
      })
    ).toMatchObject({ kind: "hd", metadata: {}, provider: "local-vault" })

    expect(() =>
      parseWallet({
        createdAt: now,
        fingerprint,
        id: "wallet_one",
        kind: "watch",
        name: "Invalid watch wallet",
        provider: "local-vault",
        status: "ready",
        updatedAt: now,
        vaultId: "vault_one",
      })
    ).toThrow()

    expect(() =>
      parseWallet({
        createdAt: now,
        fingerprint: createAddressWalletFingerprint("watch", "eip155", address),
        id: "wallet_watch",
        kind: "watch",
        metadata: { notBackedUp: true },
        name: "Invalid metadata",
        provider: "read-only",
        status: "ready",
        updatedAt: now,
      })
    ).toThrow()
  })

  it("normalizes chain account addresses and validates derivation paths", () => {
    const account = chainAccountSchema.parse({
      address: "0x00000000000000000000000000000000000000aa",
      chainId: 1,
      createdAt: now,
      derivationPath: "m/44'/60'/0'/0/0",
      id: "chain_account_one",
      namespace: "eip155",
      updatedAt: now,
      walletAccountId: "account_one",
    })

    expect(account.address).toBe(address)
    expect(() => chainAccountSchema.parse({ ...account, derivationPath: "not/a/path" })).toThrow()
  })

  it("creates stable, domain-separated fingerprints", () => {
    expect(createHdWalletFingerprint(address)).toBe(createHdWalletFingerprint(address))
    expect(createAddressWalletFingerprint("private-key", "eip155", address)).not.toBe(
      createAddressWalletFingerprint("watch", "eip155", address)
    )
    expect(createAccountFingerprint("private-key", "eip155", address)).not.toBe(
      createAccountFingerprint("watch", "eip155", address)
    )
    expect(createAccountFingerprint("private-key", "eip155", address)).not.toBe(
      createHdWalletFingerprint(address)
    )
    expect(createHdAccountFingerprint(address)).not.toBe(createHdWalletFingerprint(address))
    expect(createGroupWalletFingerprint("watch-group", "wallet_one")).toBe(
      createGroupWalletFingerprint("watch-group", "wallet_one")
    )
  })

  it("derives paths from the validated EVM scheme", () => {
    const scheme = defaultEvmHdDerivationScheme("wallet_one")
    expect(derivePath(scheme, 7)).toBe("m/44'/60'/0'/0/7")
    expect(() => derivePath(scheme, -1)).toThrow()
  })

  it("builds a renderer-safe wallet view", () => {
    const wallet = parseWallet({
      createdAt: now,
      fingerprint: createAddressWalletFingerprint("watch", "eip155", address),
      id: "wallet_one",
      kind: "watch",
      name: "Watched",
      provider: "read-only",
      status: "ready",
      updatedAt: now,
    })
    const account = {
      createdAt: now,
      fingerprint: createAccountFingerprint("watch", "eip155", address),
      id: "account_one" as const,
      index: 0,
      name: "Account 1",
      updatedAt: now,
      walletId: wallet.id,
    }
    const chainAccount = chainAccountSchema.parse({
      address,
      chainId: 1,
      createdAt: now,
      id: "chain_account_one",
      namespace: "eip155",
      updatedAt: now,
      walletAccountId: account.id,
    })

    expect(toWalletView(wallet, [account], [chainAccount])).toEqual({
      accounts: [{ account, chainAccounts: [chainAccount] }],
      wallet,
    })
    expect(() =>
      toWalletView(
        { ...wallet, privateKey: "secret" } as unknown as typeof wallet,
        [account],
        [chainAccount]
      )
    ).toThrow()
  })

  it("exposes signing capabilities without secret fields", () => {
    expectTypeOf<keyof WalletSigner>().toEqualTypeOf<
      "address" | "signMessage" | "signTransaction" | "signTypedData"
    >()
  })

  it("strictly validates signing intents", () => {
    const intent = {
      account: {
        address,
        chainAccountId: "chain_account_one",
        chainId: 1,
        walletAccountId: "account_one",
        walletId: "wallet_one",
      },
      correlationId: "request_one",
      createdAt: now,
      id: "signing_intent_one",
      kind: "sign-transaction",
      transaction: { chainId: 1, value: 1n },
    } as const
    expect(parseSigningIntent(intent)).toEqual(intent)
    expect(() => parseSigningIntent({ ...intent, privateKey: "secret" })).toThrow()
    expect(() =>
      parseSigningIntent({ ...intent, transaction: { chainId: 10, value: -1n } })
    ).toThrow()
  })

  it("canonically serializes signing intents with bigint payloads", () => {
    const intent = parseSigningIntent({
      account: {
        address,
        chainAccountId: "chain_account_one",
        chainId: 1,
        walletAccountId: "account_one",
        walletId: "wallet_one",
      },
      correlationId: "request_serialized",
      createdAt: now,
      id: "signing_intent_serialized",
      kind: "sign-transaction",
      transaction: {
        chainId: 1,
        gas: 21_000n,
        to: "0x0000000000000000000000000000000000000001",
        value: 42n,
      },
    })

    const serialized = serializeSigningIntent(intent)
    expect(deserializeSigningIntent(serialized)).toEqual(intent)
    if (intent.kind !== "sign-transaction") throw new Error("Expected a transaction intent.")
    expect(serialized).toBe(
      serializeSigningIntent({ ...intent, transaction: { ...intent.transaction } })
    )
    expect(() => deserializeSigningIntent(JSON.stringify(["bigint", "not-an-int"]))).toThrow()
    expect(() =>
      serializeSigningIntent({
        ...intent,
        kind: "typed-data",
        domain: {},
        message: { value: Number.NaN },
        primaryType: "Message",
        types: {},
      })
    ).toThrow()
  })
})
