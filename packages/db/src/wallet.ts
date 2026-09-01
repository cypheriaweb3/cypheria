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
import { asc, eq, inArray } from "drizzle-orm"

import type { CypheriaDatabase } from "./client.js"
import {
  activeWalletContext,
  chainAccounts,
  walletAccounts,
  walletHdSchemes,
  wallets,
} from "./schema.js"

export type WalletPublicState = {
  readonly accounts: readonly WalletAccount[]
  readonly chainAccounts: readonly ChainAccount[]
  readonly hdSchemes: readonly HdDerivationScheme[]
  readonly wallet: Wallet
}

export type ListWalletOptions = {
  readonly statuses?: readonly WalletStatus[]
}

export type PersistedActiveWalletContext = {
  readonly chainAccountId: ChainAccountId
  readonly mode: WalletMode
  readonly updatedAt: string
  readonly walletAccountId: WalletAccountId
  readonly walletId: WalletId
}

export type WalletPublicStatePersistenceService = {
  readonly create: (state: WalletPublicState) => Promise<WalletPublicState>
  readonly clearActiveContext: () => Promise<void>
  readonly delete: (walletId: WalletId) => Promise<void>
  readonly get: (walletId: WalletId) => Promise<WalletPublicState | undefined>
  readonly getActiveContext: () => Promise<PersistedActiveWalletContext | undefined>
  readonly listWallets: (options?: ListWalletOptions) => Promise<Wallet[]>
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
    chainAccountId: chainAccountIdSchema.parse(context.chainAccountId),
    mode: context.mode,
    updatedAt: timestampSchema.parse(context.updatedAt),
    walletAccountId: walletAccountIdSchema.parse(context.walletAccountId),
    walletId: walletIdSchema.parse(context.walletId),
  }
}

type WalletRecord = typeof wallets.$inferSelect
type WalletAccountRecord = typeof walletAccounts.$inferSelect
type ChainAccountRecord = typeof chainAccounts.$inferSelect
type HdDerivationSchemeRecord = typeof walletHdSchemes.$inferSelect

const toWalletRecord = (wallet: Wallet): typeof wallets.$inferInsert => ({
  ...wallet,
  metadata: JSON.stringify(wallet.metadata),
  vaultId: "vaultId" in wallet ? wallet.vaultId : null,
})

const fromWalletRecord = (record: WalletRecord): Wallet =>
  walletSchema.parse({
    createdAt: record.createdAt,
    fingerprint: record.fingerprint,
    id: record.id,
    kind: record.kind,
    metadata: JSON.parse(record.metadata) as unknown,
    name: record.name,
    provider: record.provider,
    status: record.status,
    updatedAt: record.updatedAt,
    ...(record.vaultId === null ? {} : { vaultId: record.vaultId }),
  })

const fromWalletAccountRecord = (record: WalletAccountRecord): WalletAccount =>
  walletAccountSchema.parse(record)

const fromChainAccountRecord = (record: ChainAccountRecord): ChainAccount =>
  chainAccountSchema.parse({
    ...record,
    derivationPath: record.derivationPath ?? undefined,
    publicKey: record.publicKey ?? undefined,
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

  return { accounts, chainAccounts: chainAccountValues, hdSchemes, wallet }
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
          .orderBy(asc(chainAccounts.chainId))
  const hdSchemeRecords = await db
    .select()
    .from(walletHdSchemes)
    .where(eq(walletHdSchemes.walletId, walletId))
    .orderBy(asc(walletHdSchemes.namespace))

  return parsePublicState({
    accounts: accountRecords.map(fromWalletAccountRecord),
    chainAccounts: chainAccountRecords.map(fromChainAccountRecord),
    hdSchemes: hdSchemeRecords.map(fromHdSchemeRecord),
    wallet: fromWalletRecord(walletRecord),
  })
}

export const createWalletPublicStatePersistenceService = (
  db: CypheriaDatabase
): WalletPublicStatePersistenceService => ({
  clearActiveContext: async () => {
    await db.delete(activeWalletContext).where(eq(activeWalletContext.id, "default"))
  },
  create: async (state) => {
    const parsed = parsePublicState(state)
    const queries = [
      db.insert(wallets).values(toWalletRecord(parsed.wallet)),
      ...(parsed.accounts.length > 0
        ? [db.insert(walletAccounts).values([...parsed.accounts])]
        : []),
      ...(parsed.chainAccounts.length > 0
        ? [db.insert(chainAccounts).values([...parsed.chainAccounts])]
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
      chainAccountId: record.chainAccountId as ChainAccountId,
      mode: record.mode as WalletMode,
      updatedAt: record.updatedAt,
      walletAccountId: record.walletAccountId as WalletAccountId,
      walletId: record.walletId as WalletId,
    })
  },
  listWallets: async (options = {}) => {
    const records =
      options.statuses && options.statuses.length > 0
        ? await db
            .select()
            .from(wallets)
            .where(inArray(wallets.status, [...options.statuses]))
            .orderBy(asc(wallets.createdAt))
        : await db.select().from(wallets).orderBy(asc(wallets.createdAt))
    return records.map(fromWalletRecord)
  },
  setActiveContext: async (context) => {
    const parsed = parseActiveContext(context)
    const state = await loadPublicState(db, parsed.walletId)
    const account = state?.accounts.find((item) => item.id === parsed.walletAccountId)
    const chainAccount = state?.chainAccounts.find((item) => item.id === parsed.chainAccountId)
    if (!state || !account || chainAccount?.walletAccountId !== account.id) {
      throw new Error("Active wallet context must reference one persisted wallet account.")
    }
    await db
      .insert(activeWalletContext)
      .values({ ...parsed, id: "default" })
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
