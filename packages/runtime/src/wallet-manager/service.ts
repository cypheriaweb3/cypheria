import { randomUUID } from "node:crypto"
import type {
  AuditLogService,
  PersistedActiveWalletContext,
  WalletPublicState,
  WalletPublicStatePersistenceService,
} from "@cypheria/db"
import {
  type ActiveWalletContext,
  type ChainAccount,
  type ChainAccountId,
  type ChainId,
  chainAccountIdSchema,
  createAccountFingerprint,
  createAddressWalletFingerprint,
  createGroupWalletFingerprint,
  createHdAccountFingerprint,
  createHdWalletFingerprint,
  defaultEvmHdDerivationScheme,
  EVM_HD_PROBE_PATH,
  hexAddressSchema,
  toWalletView,
  type VaultId,
  type Wallet,
  type WalletAccount,
  type WalletAccountId,
  type WalletId,
  type WalletKind,
  type WalletView,
  walletAccountIdSchema,
  walletIdSchema,
  walletModes,
} from "@cypheria/wallet-core"
import { mnemonicToEntropy, validateMnemonic } from "@scure/bip39"
import { wordlist as english } from "@scure/bip39/wordlists/english"
import { getAddress, type Hex, toHex } from "viem"
import { generateMnemonic, mnemonicToAccount, privateKeyToAccount } from "viem/accounts"
import { z } from "zod"

import type { VaultEntryId, WalletVault } from "../wallet-vault/index.js"

const nameSchema = z.string().trim().min(1).max(128)
const privateKeySchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/u)
  .transform((value) => value as Hex)
const expectedAddressSchema = hexAddressSchema.optional()

const hdInputSchema = z
  .object({
    accountName: nameSchema.optional(),
    expectedAddress: expectedAddressSchema,
    mnemonic: z.string().trim().min(1),
    name: nameSchema,
    passphrase: z.string().max(1024).optional(),
  })
  .strict()

const privateKeyInputSchema = z
  .object({
    accountName: nameSchema.optional(),
    expectedAddress: expectedAddressSchema,
    name: nameSchema,
    privateKey: privateKeySchema,
  })
  .strict()

const secretGroupMemberSchema = z
  .object({
    expectedAddress: expectedAddressSchema,
    name: nameSchema,
    privateKey: privateKeySchema,
  })
  .strict()

const watchMemberSchema = z
  .object({
    address: hexAddressSchema,
    name: nameSchema,
  })
  .strict()

const generateHdInputSchema = z
  .object({
    accountName: nameSchema.optional(),
    name: nameSchema,
    passphrase: z.string().max(1024).optional(),
    strength: z.union([z.literal(128), z.literal(256)]).optional(),
  })
  .strict()

const privateKeyGroupInputSchema = z
  .object({ accounts: z.array(secretGroupMemberSchema).min(1), name: nameSchema })
  .strict()

const watchWalletInputSchema = z
  .object({
    accountName: nameSchema.optional(),
    address: hexAddressSchema,
    name: nameSchema,
  })
  .strict()

const watchGroupInputSchema = z
  .object({ accounts: z.array(watchMemberSchema).min(1), name: nameSchema })
  .strict()

const activeContextInputSchema = z
  .object({
    chainAccountId: chainAccountIdSchema,
    mode: z.enum(walletModes),
    walletAccountId: walletAccountIdSchema,
    walletId: walletIdSchema,
  })
  .strict()

export type GenerateHdWalletInput = z.input<typeof generateHdInputSchema>

export type ImportHdWalletInput = z.input<typeof hdInputSchema>
export type ImportPrivateKeyWalletInput = z.input<typeof privateKeyInputSchema>

export type ImportPrivateKeyGroupInput = z.input<typeof privateKeyGroupInputSchema>
export type AddWatchWalletInput = z.input<typeof watchWalletInputSchema>
export type AddWatchGroupInput = z.input<typeof watchGroupInputSchema>
export type SetActiveWalletContextInput = z.input<typeof activeContextInputSchema>

export type WalletManager = {
  readonly addWatchGroup: (input: AddWatchGroupInput) => Promise<WalletView>
  readonly addWatchWallet: (input: AddWatchWalletInput) => Promise<WalletView>
  readonly clearActiveContext: () => Promise<void>
  readonly deleteWallet: (walletId: WalletId) => Promise<void>
  readonly generateHdWallet: (input: GenerateHdWalletInput) => Promise<WalletView>
  readonly getActiveContext: () => Promise<ActiveWalletContext>
  readonly getWallet: (walletId: WalletId) => Promise<WalletView | undefined>
  readonly importHdWallet: (input: ImportHdWalletInput) => Promise<WalletView>
  readonly importPrivateKeyGroup: (input: ImportPrivateKeyGroupInput) => Promise<WalletView>
  readonly importPrivateKeyWallet: (input: ImportPrivateKeyWalletInput) => Promise<WalletView>
  readonly listWallets: () => Promise<WalletView[]>
  readonly renameWallet: (walletId: WalletId, name: string) => Promise<WalletView>
  readonly setActiveContext: (input: SetActiveWalletContextInput) => Promise<ActiveWalletContext>
}

export type WalletManagerIdFactory = {
  readonly chainAccountId: () => ChainAccountId
  readonly vaultEntryId: () => VaultEntryId
  readonly vaultId: () => VaultId
  readonly walletAccountId: () => WalletAccountId
  readonly walletId: () => WalletId
}

export type WalletManagerOptions = {
  readonly audit?: Pick<AuditLogService, "append">
  readonly chainIds?: readonly ChainId[]
  readonly idFactory?: WalletManagerIdFactory
  readonly mnemonicFactory?: (strength: 128 | 256) => string
  readonly now?: () => string
  readonly persistence: WalletPublicStatePersistenceService
  readonly vault: WalletVault
}

export type WalletManagerErrorCode =
  | "ADDRESS_MISMATCH"
  | "DUPLICATE_ACCOUNT"
  | "DUPLICATE_WALLET"
  | "INVALID_INPUT"
  | "WALLET_CREATION_FAILED"
  | "WALLET_NOT_FOUND"
  | "WALLET_NOT_READY"

export class WalletManagerError extends Error {
  readonly code: WalletManagerErrorCode

  constructor(code: WalletManagerErrorCode, message: string) {
    super(message)
    this.name = "WalletManagerError"
    this.code = code
  }
}

const defaultIdFactory: WalletManagerIdFactory = {
  chainAccountId: () => `chain_account_${randomUUID()}`,
  vaultEntryId: () => `vault_entry_${randomUUID()}`,
  vaultId: () => `vault_${randomUUID()}`,
  walletAccountId: () => `account_${randomUUID()}`,
  walletId: () => `wallet_${randomUUID()}`,
}

type PreparedMember = {
  readonly address: `0x${string}`
  readonly derivationPath?: string
  readonly fingerprint: WalletAccount["fingerprint"]
  readonly name: string
  readonly publicKey?: `0x${string}`
}

const normalizeMnemonic = (value: string): string =>
  value.trim().toLowerCase().replaceAll(/\s+/gu, " ")

const parseChainIds = (chainIds: readonly ChainId[]): ChainId[] => {
  const parsed = [...new Set(chainIds)]
  if (
    parsed.length === 0 ||
    parsed.some((chainId) => !Number.isSafeInteger(chainId) || chainId <= 0)
  ) {
    throw new WalletManagerError("INVALID_INPUT", "At least one valid chain is required.")
  }
  return parsed
}

const assertExpectedAddress = (
  expectedAddress: `0x${string}` | undefined,
  derivedAddress: `0x${string}`
): void => {
  if (expectedAddress && getAddress(expectedAddress) !== getAddress(derivedAddress)) {
    throw new WalletManagerError(
      "ADDRESS_MISMATCH",
      "The supplied address does not match the wallet secret."
    )
  }
}

const viewFromState = (state: WalletPublicState): WalletView =>
  toWalletView(state.wallet, state.accounts, state.chainAccounts)

export const createWalletManager = (options: WalletManagerOptions): WalletManager => {
  const chainIds = parseChainIds(options.chainIds ?? [1])
  const idFactory = options.idFactory ?? defaultIdFactory
  const now = options.now ?? (() => new Date().toISOString())
  const mnemonicFactory =
    options.mnemonicFactory ?? ((strength: 128 | 256) => generateMnemonic(english, strength))

  const appendAudit = async (
    eventType: string,
    walletId: WalletId,
    summary: string
  ): Promise<void> => {
    await options.audit?.append({
      actor: "user",
      correlationId: walletId,
      createdAt: now(),
      eventType,
      payloadSummary: summary,
      source: "runtime.wallet-manager",
    })
  }

  const loadStates = async (): Promise<WalletPublicState[]> => {
    const wallets = await options.persistence.listWallets()
    const states = await Promise.all(wallets.map((wallet) => options.persistence.get(wallet.id)))
    return states.filter((state): state is WalletPublicState => state !== undefined)
  }

  const assertUnique = async (state: WalletPublicState): Promise<void> => {
    const states = await loadStates()
    if (states.some((item) => item.wallet.fingerprint === state.wallet.fingerprint)) {
      throw new WalletManagerError("DUPLICATE_WALLET", "This wallet already exists.")
    }
    const fingerprints = new Set(state.accounts.map((account) => account.fingerprint))
    if (fingerprints.size !== state.accounts.length) {
      throw new WalletManagerError("DUPLICATE_ACCOUNT", "The wallet contains duplicate accounts.")
    }
    if (
      states.some((item) => item.accounts.some((account) => fingerprints.has(account.fingerprint)))
    ) {
      throw new WalletManagerError("DUPLICATE_ACCOUNT", "This wallet account already exists.")
    }
  }

  const buildState = (input: {
    readonly fingerprint: Wallet["fingerprint"]
    readonly kind: WalletKind
    readonly members: readonly PreparedMember[]
    readonly metadata?: Wallet["metadata"]
    readonly name: string
    readonly status: Wallet["status"]
    readonly vaultId?: VaultId
    readonly walletId: WalletId
  }): WalletPublicState => {
    const timestamp = now()
    const accounts: WalletAccount[] = []
    const chainAccounts: ChainAccount[] = []
    for (const [index, member] of input.members.entries()) {
      const account: WalletAccount = {
        createdAt: timestamp,
        fingerprint: member.fingerprint,
        id: idFactory.walletAccountId(),
        index,
        name: member.name,
        updatedAt: timestamp,
        walletId: input.walletId,
      }
      accounts.push(account)
      for (const chainId of chainIds) {
        chainAccounts.push({
          address: member.address,
          chainId,
          createdAt: timestamp,
          ...(member.derivationPath ? { derivationPath: member.derivationPath } : {}),
          id: idFactory.chainAccountId(),
          namespace: "eip155",
          ...(member.publicKey ? { publicKey: member.publicKey } : {}),
          updatedAt: timestamp,
          walletAccountId: account.id,
        })
      }
    }

    const wallet = {
      createdAt: timestamp,
      fingerprint: input.fingerprint,
      id: input.walletId,
      kind: input.kind,
      metadata: input.metadata ?? {},
      name: input.name,
      provider: input.vaultId ? ("local-vault" as const) : ("read-only" as const),
      status: input.status,
      updatedAt: timestamp,
      ...(input.vaultId ? { vaultId: input.vaultId } : {}),
    } as Wallet

    return {
      accounts,
      chainAccounts,
      hdSchemes: input.kind === "hd" ? [defaultEvmHdDerivationScheme(input.walletId)] : [],
      wallet,
    }
  }

  const prepareHd = (input: {
    accountName?: string
    expectedAddress?: `0x${string}`
    mnemonic: string
    name: string
    passphrase?: string
  }) => {
    const mnemonic = normalizeMnemonic(input.mnemonic)
    if (!validateMnemonic(mnemonic, english)) {
      throw new WalletManagerError("INVALID_INPUT", "The mnemonic phrase is invalid.")
    }
    try {
      const account = mnemonicToAccount(mnemonic, {
        passphrase: input.passphrase,
        path: EVM_HD_PROBE_PATH,
      })
      assertExpectedAddress(input.expectedAddress, account.address)
      return {
        account,
        entropy: toHex(mnemonicToEntropy(mnemonic, english)),
      }
    } catch (error) {
      if (error instanceof WalletManagerError) {
        throw error
      }
      throw new WalletManagerError("INVALID_INPUT", "The HD wallet secret is invalid.")
    }
  }

  const preparePrivateKey = (value: Hex, expectedAddress?: `0x${string}`) => {
    try {
      const account = privateKeyToAccount(value)
      assertExpectedAddress(expectedAddress, account.address)
      return account
    } catch (error) {
      if (error instanceof WalletManagerError) {
        throw error
      }
      throw new WalletManagerError("INVALID_INPUT", "The private key is invalid.")
    }
  }

  const persistImportedLocal = async (
    state: WalletPublicState,
    entries: Parameters<WalletVault["create"]>[0]["entries"]
  ): Promise<WalletView> => {
    await assertUnique(state)
    const wallet = state.wallet
    if (!("vaultId" in wallet)) {
      throw new WalletManagerError("INVALID_INPUT", "A local wallet requires a vault.")
    }
    await options.vault.create({
      entries,
      vaultId: wallet.vaultId,
      walletId: wallet.id,
    })
    try {
      await options.persistence.create(state)
    } catch (error) {
      await options.vault.delete(wallet.vaultId).catch(() => undefined)
      throw error
    }
    await appendAudit("wallet.imported", wallet.id, `Imported ${wallet.kind} wallet ${wallet.id}.`)
    return viewFromState(state)
  }

  const accountIdAt = (state: WalletPublicState, index: number): WalletAccountId => {
    const accountId = state.accounts[index]?.id
    if (!accountId) {
      throw new WalletManagerError("INVALID_INPUT", "The wallet account is missing.")
    }
    return accountId
  }

  const resolveActiveContext = async (
    persisted: PersistedActiveWalletContext
  ): Promise<ActiveWalletContext> => {
    const state = await options.persistence.get(persisted.walletId)
    if (!state) {
      await options.persistence.clearActiveContext()
      return { mode: "read-only" }
    }
    const wallet = viewFromState(state)
    const walletAccount = wallet.accounts.find(
      (item) => item.account.id === persisted.walletAccountId
    )
    const chainAccount = walletAccount?.chainAccounts.find(
      (item) => item.id === persisted.chainAccountId
    )
    if (!walletAccount || !chainAccount) {
      await options.persistence.clearActiveContext()
      return { mode: "read-only" }
    }
    return { chainAccount, mode: persisted.mode, wallet, walletAccount }
  }

  return {
    addWatchGroup: async (inputValue) => {
      const input = watchGroupInputSchema.parse(inputValue)
      const walletId = idFactory.walletId()
      const state = buildState({
        fingerprint: createGroupWalletFingerprint("watch-group", walletId),
        kind: "watch-group",
        members: input.accounts.map((member) => ({
          address: member.address,
          fingerprint: createAccountFingerprint("watch", "eip155", member.address),
          name: member.name,
        })),
        name: input.name,
        status: "ready",
        walletId,
      })
      await assertUnique(state)
      await options.persistence.create(state)
      await appendAudit("wallet.created", walletId, `Created watch-group wallet ${walletId}.`)
      return viewFromState(state)
    },
    addWatchWallet: async (inputValue) => {
      const input = watchWalletInputSchema.parse(inputValue)
      const walletId = idFactory.walletId()
      const state = buildState({
        fingerprint: createAddressWalletFingerprint("watch", "eip155", input.address),
        kind: "watch",
        members: [
          {
            address: input.address,
            fingerprint: createAccountFingerprint("watch", "eip155", input.address),
            name: input.accountName ?? "Account 1",
          },
        ],
        name: input.name,
        status: "ready",
        walletId,
      })
      await assertUnique(state)
      await options.persistence.create(state)
      await appendAudit("wallet.created", walletId, `Created watch wallet ${walletId}.`)
      return viewFromState(state)
    },
    clearActiveContext: async () => {
      await options.persistence.clearActiveContext()
    },
    deleteWallet: async (walletId) => {
      const state = await options.persistence.get(walletId)
      if (!state) {
        throw new WalletManagerError("WALLET_NOT_FOUND", "The wallet does not exist.")
      }
      if ("vaultId" in state.wallet) {
        const deleting = { ...state.wallet, status: "deleting", updatedAt: now() } as Wallet
        await options.persistence.updateWallet(deleting)
        try {
          await options.vault.delete(state.wallet.vaultId)
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "VAULT_NOT_FOUND")) {
            await options.persistence
              .updateWallet({ ...deleting, status: "error", updatedAt: now() } as Wallet)
              .catch(() => undefined)
            throw error
          }
        }
      }
      await options.persistence.delete(walletId)
      await appendAudit("wallet.deleted", walletId, `Deleted wallet ${walletId}.`)
    },
    generateHdWallet: async (inputValue) => {
      const input = generateHdInputSchema.parse(inputValue)
      const strength = input.strength ?? 128
      const prepared = prepareHd({
        accountName: input.accountName,
        mnemonic: mnemonicFactory(strength),
        name: nameSchema.parse(input.name),
        passphrase: input.passphrase,
      })
      const walletId = idFactory.walletId()
      const vaultId = idFactory.vaultId()
      const state = buildState({
        fingerprint: createHdWalletFingerprint(prepared.account.address),
        kind: "hd",
        members: [
          {
            address: prepared.account.address,
            derivationPath: EVM_HD_PROBE_PATH,
            fingerprint: createHdAccountFingerprint(prepared.account.address),
            name: input.accountName ?? "Account 1",
            publicKey: prepared.account.publicKey,
          },
        ],
        metadata: { notBackedUp: true },
        name: nameSchema.parse(input.name),
        status: "initializing",
        vaultId,
        walletId,
      })
      await assertUnique(state)
      await options.persistence.create(state)
      let readyState = state
      try {
        await options.vault.create({
          entries: [
            {
              accountId: accountIdAt(state, 0),
              id: idFactory.vaultEntryId(),
              secret: {
                entropy: prepared.entropy,
                kind: "hd",
                ...(input.passphrase ? { passphrase: input.passphrase } : {}),
              },
            },
          ],
          vaultId,
          walletId,
        })
        const readyWallet = { ...state.wallet, status: "ready", updatedAt: now() } as Wallet
        await options.persistence.updateWallet(readyWallet)
        readyState = { ...state, wallet: readyWallet }
      } catch {
        await options.persistence
          .updateWallet({ ...state.wallet, status: "error", updatedAt: now() } as Wallet)
          .catch(() => undefined)
        await appendAudit(
          "wallet.creation.failed",
          walletId,
          `Failed to initialize HD wallet ${walletId}.`
        ).catch(() => undefined)
        throw new WalletManagerError(
          "WALLET_CREATION_FAILED",
          "The HD wallet could not be initialized."
        )
      }
      await appendAudit("wallet.created", walletId, `Created HD wallet ${walletId}.`)
      return viewFromState(readyState)
    },
    getActiveContext: async () => {
      const persisted = await options.persistence.getActiveContext()
      return persisted ? resolveActiveContext(persisted) : { mode: "read-only" }
    },
    getWallet: async (walletId) => {
      const state = await options.persistence.get(walletId)
      return state ? viewFromState(state) : undefined
    },
    importHdWallet: async (inputValue) => {
      const input = hdInputSchema.parse(inputValue)
      const prepared = prepareHd(input)
      const walletId = idFactory.walletId()
      const vaultId = idFactory.vaultId()
      const state = buildState({
        fingerprint: createHdWalletFingerprint(prepared.account.address),
        kind: "hd",
        members: [
          {
            address: prepared.account.address,
            derivationPath: EVM_HD_PROBE_PATH,
            fingerprint: createHdAccountFingerprint(prepared.account.address),
            name: input.accountName ?? "Account 1",
            publicKey: prepared.account.publicKey,
          },
        ],
        name: input.name,
        status: "ready",
        vaultId,
        walletId,
      })
      return persistImportedLocal(state, [
        {
          accountId: accountIdAt(state, 0),
          id: idFactory.vaultEntryId(),
          secret: {
            entropy: prepared.entropy,
            kind: "hd",
            ...(input.passphrase ? { passphrase: input.passphrase } : {}),
          },
        },
      ])
    },
    importPrivateKeyGroup: async (inputValue) => {
      const input = privateKeyGroupInputSchema.parse(inputValue)
      const prepared = input.accounts.map((member) => ({
        account: preparePrivateKey(member.privateKey, member.expectedAddress),
        member,
      }))
      const walletId = idFactory.walletId()
      const vaultId = idFactory.vaultId()
      const state = buildState({
        fingerprint: createGroupWalletFingerprint("private-key-group", walletId),
        kind: "private-key-group",
        members: prepared.map(({ account, member }) => ({
          address: account.address,
          fingerprint: createAccountFingerprint("private-key", "eip155", account.address),
          name: member.name,
          publicKey: account.publicKey,
        })),
        name: input.name,
        status: "ready",
        vaultId,
        walletId,
      })
      return persistImportedLocal(
        state,
        prepared.map(({ member }, index) => ({
          accountId: accountIdAt(state, index),
          id: idFactory.vaultEntryId(),
          secret: { kind: "private-key", privateKey: member.privateKey },
        }))
      )
    },
    importPrivateKeyWallet: async (inputValue) => {
      const input = privateKeyInputSchema.parse(inputValue)
      const account = preparePrivateKey(input.privateKey, input.expectedAddress)
      const walletId = idFactory.walletId()
      const vaultId = idFactory.vaultId()
      const state = buildState({
        fingerprint: createAddressWalletFingerprint("private-key", "eip155", account.address),
        kind: "private-key",
        members: [
          {
            address: account.address,
            fingerprint: createAccountFingerprint("private-key", "eip155", account.address),
            name: input.accountName ?? "Account 1",
            publicKey: account.publicKey,
          },
        ],
        name: input.name,
        status: "ready",
        vaultId,
        walletId,
      })
      return persistImportedLocal(state, [
        {
          accountId: accountIdAt(state, 0),
          id: idFactory.vaultEntryId(),
          secret: { kind: "private-key", privateKey: input.privateKey },
        },
      ])
    },
    listWallets: async () => (await loadStates()).map(viewFromState),
    renameWallet: async (walletId, nameValue) => {
      const state = await options.persistence.get(walletId)
      if (!state) {
        throw new WalletManagerError("WALLET_NOT_FOUND", "The wallet does not exist.")
      }
      const wallet = {
        ...state.wallet,
        name: nameSchema.parse(nameValue),
        updatedAt: now(),
      } as Wallet
      await options.persistence.updateWallet(wallet)
      await appendAudit("wallet.renamed", walletId, `Renamed wallet ${walletId}.`)
      return viewFromState({ ...state, wallet })
    },
    setActiveContext: async (inputValue) => {
      const input = activeContextInputSchema.parse(inputValue)
      const state = await options.persistence.get(input.walletId)
      if (!state) {
        throw new WalletManagerError("WALLET_NOT_FOUND", "The wallet does not exist.")
      }
      if (state.wallet.status !== "ready") {
        throw new WalletManagerError("WALLET_NOT_READY", "The wallet is not ready.")
      }
      if (state.wallet.provider === "read-only" && input.mode !== "read-only") {
        throw new WalletManagerError(
          "INVALID_INPUT",
          "A watch wallet only supports read-only mode."
        )
      }
      const persisted = await options.persistence.setActiveContext({
        ...input,
        updatedAt: now(),
      })
      await appendAudit(
        "wallet.active-context.updated",
        input.walletId,
        `Selected wallet ${input.walletId}.`
      )
      return resolveActiveContext(persisted)
    },
  }
}
