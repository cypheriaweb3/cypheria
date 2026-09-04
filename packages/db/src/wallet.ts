import { chainKeySchema, type NetworkId, networkIdSchema, toChainKey } from "@cypheria/network-core"
import {
  type ChainAccount,
  type ChainAccountId,
  chainAccountIdSchema,
  chainAccountSchema,
  type HdDerivationScheme,
  hdDerivationSchemeSchema,
  timestampSchema,
  type Wallet,
  type WalletAccount,
  type WalletAccountId,
  type WalletId,
  type WalletMode,
  type WalletStatus,
  walletAccountIdSchema,
  walletAccountSchema,
  walletIdSchema,
  walletModes,
  walletSchema,
} from "@cypheria/wallet-core"
import { and, asc, eq, inArray, max } from "drizzle-orm"

import type { CypheriaDatabase } from "./client.js"
import {
  activeWalletContext,
  chainAccounts,
  networks,
  walletAccounts,
  walletHdSchemes,
  wallets,
} from "./schema/index.js"

export type WalletPublicState = {
  readonly wallet: Wallet
  readonly accounts: readonly WalletAccount[]
  readonly chainAccounts: readonly ChainAccount[]
  readonly hdSchemes: readonly HdDerivationScheme[]
}

export type ListWalletOptions = {
  readonly statuses?: readonly WalletStatus[]
}

export type PersistedActiveWalletContext = {
  readonly walletId: WalletId
  readonly walletAccountId: WalletAccountId
  readonly chainAccountId: ChainAccountId
  readonly networkId: NetworkId
  readonly mode: WalletMode
  readonly updatedAt: string
}

export type WalletPublicStatePersistenceService = {
  readonly addAccount: (
    walletId: WalletId,
    account: WalletAccount,
    chainAccounts: readonly ChainAccount[]
  ) => Promise<void>
  readonly create: (state: WalletPublicState) => Promise<WalletPublicState>
  readonly clearActiveContext: () => Promise<void>
  readonly delete: (walletId: WalletId) => Promise<void>
  readonly get: (walletId: WalletId) => Promise<WalletPublicState | undefined>
  readonly getActiveContext: () => Promise<PersistedActiveWalletContext | undefined>
  readonly listWallets: (options?: ListWalletOptions) => Promise<Wallet[]>
  readonly reorderWallets: (walletIds: readonly WalletId[]) => Promise<void>
  readonly reorderWalletAccounts: (
    walletId: WalletId,
    walletAccountIds: readonly WalletAccountId[]
  ) => Promise<void>
  readonly setActiveContext: (
    context: PersistedActiveWalletContext
  ) => Promise<PersistedActiveWalletContext>
  readonly updateWallet: (wallet: Wallet) => Promise<Wallet>
}

const parseActiveContext = (
  context: PersistedActiveWalletContext
): PersistedActiveWalletContext => {
  if (!walletModes.includes(context.mode)) {
    throw new Error("Active wallet context has an invalid mode.")
  }
  return {
    walletId: walletIdSchema.parse(context.walletId),
    walletAccountId: walletAccountIdSchema.parse(context.walletAccountId),
    chainAccountId: chainAccountIdSchema.parse(context.chainAccountId),
    networkId: networkIdSchema.parse(context.networkId),
    mode: context.mode,
    updatedAt: timestampSchema.parse(context.updatedAt),
  }
}

type WalletRecord = typeof wallets.$inferSelect
type WalletAccountRecord = typeof walletAccounts.$inferSelect
type ChainAccountRecord = typeof chainAccounts.$inferSelect
type HdDerivationSchemeRecord = typeof walletHdSchemes.$inferSelect

const toWalletRecord = (wallet: Wallet, position?: number): typeof wallets.$inferInsert => ({
  id: wallet.id,
  name: wallet.name,
  kind: wallet.kind,
  fingerprint: wallet.fingerprint,
  vaultId: "vaultId" in wallet ? wallet.vaultId : null,
  metadata: wallet.metadata,
  ...(position === undefined ? {} : { position }),
  status: wallet.status,
  createdAt: wallet.createdAt,
  updatedAt: wallet.updatedAt,
})

const fromWalletRecord = (record: WalletRecord): Wallet =>
  walletSchema.parse({
    id: record.id,
    name: record.name,
    kind: record.kind,
    fingerprint: record.fingerprint,
    ...(record.vaultId === null ? {} : { vaultId: record.vaultId }),
    metadata: record.metadata,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  })

const fromWalletAccountRecord = (record: WalletAccountRecord): WalletAccount =>
  walletAccountSchema.parse(record)

const fromChainAccountRecord = (record: ChainAccountRecord): ChainAccount =>
  chainAccountSchema.parse({
    id: record.id,
    walletAccountId: record.walletAccountId,
    chain: { namespace: record.namespace, reference: record.reference },
    address: record.address,
    derivationPath: record.derivationPath ?? undefined,
    publicKey: record.publicKey ?? undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  })

const toChainAccountRecord = (account: ChainAccount): typeof chainAccounts.$inferInsert => ({
  id: account.id,
  walletAccountId: account.walletAccountId,
  namespace: account.chain.namespace,
  reference: account.chain.reference,
  address: account.address,
  publicKey: account.publicKey,
  derivationPath: account.derivationPath,
  createdAt: account.createdAt,
  updatedAt: account.updatedAt,
})

const fromHdSchemeRecord = (record: HdDerivationSchemeRecord): HdDerivationScheme =>
  hdDerivationSchemeSchema.parse(record)

const parsePublicState = (state: WalletPublicState): WalletPublicState => {
  const wallet = walletSchema.parse(state.wallet)
  const accounts = state.accounts.map((account) => walletAccountSchema.parse(account))
  const accountIds = new Set(accounts.map((account) => account.id))
  const chainAccountValues = state.chainAccounts.map((account) => chainAccountSchema.parse(account))
  const hdSchemes = state.hdSchemes.map((scheme) => hdDerivationSchemeSchema.parse(scheme))

  if (accounts.some((account) => account.walletId !== wallet.id)) {
    throw new Error("Every wallet account must belong to the persisted wallet.")
  }
  if (chainAccountValues.some((account) => !accountIds.has(account.walletAccountId))) {
    throw new Error("Every chain account must belong to a persisted wallet account.")
  }
  if (hdSchemes.some((scheme) => scheme.walletId !== wallet.id)) {
    throw new Error("Every HD derivation scheme must belong to the persisted wallet.")
  }
  if (wallet.kind === "hd" && hdSchemes.length === 0) {
    throw new Error("An HD wallet must have at least one derivation scheme.")
  }
  if (wallet.kind !== "hd" && hdSchemes.length > 0) {
    throw new Error("Only HD wallets may have derivation schemes.")
  }

  return { wallet, accounts, chainAccounts: chainAccountValues, hdSchemes }
}

const loadPublicState = async (
  db: CypheriaDatabase,
  walletId: WalletId
): Promise<WalletPublicState | undefined> => {
  const [walletRecord] = await db.select().from(wallets).where(eq(wallets.id, walletId)).limit(1)
  if (!walletRecord) {
    return undefined
  }

  const accountRecords = await db
    .select()
    .from(walletAccounts)
    .where(eq(walletAccounts.walletId, walletId))
    .orderBy(asc(walletAccounts.index))
  const accountIds = accountRecords.map((account) => account.id)
  const chainAccountRecords =
    accountIds.length === 0
      ? []
      : await db
          .select()
          .from(chainAccounts)
          .where(inArray(chainAccounts.walletAccountId, accountIds))
          .orderBy(asc(chainAccounts.namespace), asc(chainAccounts.reference))
  const hdSchemeRecords = await db
    .select()
    .from(walletHdSchemes)
    .where(eq(walletHdSchemes.walletId, walletId))
    .orderBy(asc(walletHdSchemes.namespace))

  return parsePublicState({
    wallet: fromWalletRecord(walletRecord),
    accounts: accountRecords.map(fromWalletAccountRecord),
    chainAccounts: chainAccountRecords.map(fromChainAccountRecord),
    hdSchemes: hdSchemeRecords.map(fromHdSchemeRecord),
  })
}

export const createWalletPublicStatePersistenceService = (
  db: CypheriaDatabase
): WalletPublicStatePersistenceService => ({
  addAccount: async (walletIdValue, accountValue, chainAccountValues) => {
    const walletId = walletIdSchema.parse(walletIdValue)
    const account = walletAccountSchema.parse(accountValue)
    const parsedChainAccounts = chainAccountValues.map((item) => chainAccountSchema.parse(item))
    if (account.walletId !== walletId) {
      throw new Error("The wallet account must belong to the target wallet.")
    }
    if (parsedChainAccounts.some((item) => item.walletAccountId !== account.id)) {
      throw new Error("Every chain account must belong to the new wallet account.")
    }
    const [wallet] = await db
      .select({ id: wallets.id })
      .from(wallets)
      .where(eq(wallets.id, walletId))
    if (!wallet) {
      throw new Error(`Wallet ${walletId} does not exist.`)
    }
    const queries = [
      db.insert(walletAccounts).values(account),
      ...(parsedChainAccounts.length > 0
        ? [db.insert(chainAccounts).values(parsedChainAccounts.map(toChainAccountRecord))]
        : []),
    ] as const
    await db.batch(queries)
  },
  clearActiveContext: async () => {
    await db.delete(activeWalletContext).where(eq(activeWalletContext.id, "default"))
  },
  create: async (state) => {
    const parsed = parsePublicState(state)
    const [lastWallet] = await db.select({ position: max(wallets.position) }).from(wallets)
    const queries = [
      db.insert(wallets).values(toWalletRecord(parsed.wallet, (lastWallet?.position ?? -1) + 1)),
      ...(parsed.accounts.length > 0
        ? [db.insert(walletAccounts).values([...parsed.accounts])]
        : []),
      ...(parsed.chainAccounts.length > 0
        ? [db.insert(chainAccounts).values(parsed.chainAccounts.map(toChainAccountRecord))]
        : []),
      ...(parsed.hdSchemes.length > 0
        ? [db.insert(walletHdSchemes).values([...parsed.hdSchemes])]
        : []),
    ] as const
    await db.batch(queries)
    return parsed
  },
  delete: async (walletId) => {
    await db.delete(wallets).where(eq(wallets.id, walletId))
  },
  get: (walletId) => loadPublicState(db, walletId),
  getActiveContext: async () => {
    const [record] = await db
      .select()
      .from(activeWalletContext)
      .where(eq(activeWalletContext.id, "default"))
      .limit(1)
    if (!record) {
      return undefined
    }
    return parseActiveContext({
      walletId: record.walletId as WalletId,
      walletAccountId: record.walletAccountId as WalletAccountId,
      chainAccountId: record.chainAccountId as ChainAccountId,
      networkId: record.networkId as NetworkId,
      mode: record.mode as WalletMode,
      updatedAt: record.updatedAt,
    })
  },
  listWallets: async (options = {}) => {
    const records =
      options.statuses && options.statuses.length > 0
        ? await db
            .select()
            .from(wallets)
            .where(inArray(wallets.status, [...options.statuses]))
            .orderBy(asc(wallets.position), asc(wallets.createdAt))
        : await db.select().from(wallets).orderBy(asc(wallets.position), asc(wallets.createdAt))
    return records.map(fromWalletRecord)
  },
  reorderWallets: async (walletIds) => {
    const parsedIds = walletIds.map((walletId) => walletIdSchema.parse(walletId))
    if (new Set(parsedIds).size !== parsedIds.length) {
      throw new Error("Wallet order cannot contain duplicate wallet ids.")
    }
    const records = await db.select({ id: wallets.id }).from(wallets)
    const persistedIds = new Set(records.map(({ id }) => id))
    if (
      persistedIds.size !== parsedIds.length ||
      parsedIds.some((walletId) => !persistedIds.has(walletId))
    ) {
      throw new Error("Wallet order must contain every persisted wallet exactly once.")
    }
    if (parsedIds.length === 0) return
    const queries = parsedIds.map((walletId, position) =>
      db.update(wallets).set({ position }).where(eq(wallets.id, walletId))
    )
    await db.batch(queries as unknown as Parameters<typeof db.batch>[0])
  },
  reorderWalletAccounts: async (walletIdValue, walletAccountIds) => {
    const walletId = walletIdSchema.parse(walletIdValue)
    const parsedIds = walletAccountIds.map((accountId) => walletAccountIdSchema.parse(accountId))
    if (new Set(parsedIds).size !== parsedIds.length) {
      throw new Error("Wallet account order cannot contain duplicate account ids.")
    }
    const records = await db
      .select({ id: walletAccounts.id, index: walletAccounts.index })
      .from(walletAccounts)
      .where(eq(walletAccounts.walletId, walletId))
    const persistedIds = new Set(records.map(({ id }) => id))
    if (
      persistedIds.size !== parsedIds.length ||
      parsedIds.some((accountId) => !persistedIds.has(accountId))
    ) {
      throw new Error("Wallet account order must contain every account exactly once.")
    }
    if (parsedIds.length === 0) return
    const temporaryStart = Math.max(...records.map(({ index }) => index)) + parsedIds.length + 1
    const queries = [
      ...parsedIds.map((accountId, position) =>
        db
          .update(walletAccounts)
          .set({ index: temporaryStart + position })
          .where(eq(walletAccounts.id, accountId))
      ),
      ...parsedIds.map((accountId, index) =>
        db.update(walletAccounts).set({ index }).where(eq(walletAccounts.id, accountId))
      ),
    ]
    await db.batch(queries as unknown as Parameters<typeof db.batch>[0])
  },
  setActiveContext: async (context) => {
    const parsed = parseActiveContext(context)
    const state = await loadPublicState(db, parsed.walletId)
    const account = state?.accounts.find((item) => item.id === parsed.walletAccountId)
    const chainAccount = state?.chainAccounts.find((item) => item.id === parsed.chainAccountId)
    const [network] = await db
      .select({ namespace: networks.namespace, reference: networks.reference })
      .from(networks)
      .where(and(eq(networks.id, parsed.networkId), eq(networks.enabled, true)))
      .limit(1)
    if (
      !state ||
      !account ||
      chainAccount?.walletAccountId !== account.id ||
      !network ||
      chainKeySchema.parse(toChainKey(chainAccount.chain)) !==
        toChainKey({ namespace: network.namespace, reference: network.reference })
    ) {
      throw new Error("Active wallet context must reference one persisted wallet account.")
    }
    await db
      .insert(activeWalletContext)
      .values({ id: "default", ...parsed })
      .onConflictDoUpdate({
        set: parsed,
        target: activeWalletContext.id,
      })
    return parsed
  },
  updateWallet: async (wallet) => {
    const parsed = walletSchema.parse(wallet)
    const [updated] = await db
      .update(wallets)
      .set(toWalletRecord(parsed))
      .where(eq(wallets.id, parsed.id))
      .returning({ id: wallets.id })
    if (!updated) {
      throw new Error(`Wallet ${parsed.id} does not exist.`)
    }
    return parsed
  },
})
