import {
  type DappSession,
  dappPermissionRecordSchema,
  dappSessionSchema,
  type EthereumProviderPermissionRecord,
  type EthereumProviderPersistence,
  normalizeDappOrigin,
  type SolanaProviderPermissionRecord,
  type SolanaProviderPersistence,
  solanaProviderPermissionRecordSchema,
} from "@cypheria/wallet-provider"
import { asc, eq } from "drizzle-orm"
import { z } from "zod"

import type { CypheriaDatabase } from "./client.js"
import { dappOrigins, dappPermissions, solanaDappPermissions } from "./schema/index.js"

const fromSessionRow = (row: typeof dappOrigins.$inferSelect): DappSession =>
  dappSessionSchema.parse({
    origin: row.origin,
    key: row.sessionKey,
    partition: row.partition,
    createdAt: row.createdAt,
    ...(row.lastUsedAt ? { lastUsedAt: row.lastUsedAt } : {}),
  })

const fromPermissionRow = (
  row: typeof dappPermissions.$inferSelect
): EthereumProviderPermissionRecord =>
  dappPermissionRecordSchema.parse({
    id: row.id,
    origin: row.origin,
    sessionKey: row.sessionKey,
    walletId: row.walletId,
    chainKey: row.chainKey,
    accountAddresses: row.accountAddresses,
    methods: row.methods,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}),
  }) as EthereumProviderPermissionRecord

const fromSolanaPermissionRow = (
  row: typeof solanaDappPermissions.$inferSelect
): SolanaProviderPermissionRecord =>
  solanaProviderPermissionRecordSchema.parse({
    id: row.id,
    origin: row.origin,
    sessionKey: row.sessionKey,
    walletId: row.walletId,
    bindings: row.bindings.map((binding) => {
      const account = binding.signingAccount as typeof binding.signingAccount & {
        readonly chainId?: string
      }
      const { chainId, ...current } = account
      return {
        ...binding,
        signingAccount: { ...current, chainKey: current.chainKey ?? chainId },
      }
    }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}),
  }) as SolanaProviderPermissionRecord

export const createDappBrowserPersistenceService = (
  db: CypheriaDatabase
): EthereumProviderPersistence & SolanaProviderPersistence => ({
  deletePermission: async (permissionId) => {
    const [deleted] = await db
      .delete(dappPermissions)
      .where(eq(dappPermissions.id, z.string().min(1).parse(permissionId)))
      .returning({ id: dappPermissions.id })
    return Boolean(deleted)
  },
  getSession: async (originValue) => {
    const origin = normalizeDappOrigin(originValue)
    const [row] = await db.select().from(dappOrigins).where(eq(dappOrigins.origin, origin)).limit(1)
    return row ? fromSessionRow(row) : undefined
  },
  deleteSolanaPermission: async (permissionId) => {
    const [deleted] = await db
      .delete(solanaDappPermissions)
      .where(eq(solanaDappPermissions.id, z.string().min(1).parse(permissionId)))
      .returning({ id: solanaDappPermissions.id })
    return Boolean(deleted)
  },
  listPermissions: async (originValue) => {
    const origin = normalizeDappOrigin(originValue)
    const rows = await db
      .select()
      .from(dappPermissions)
      .where(eq(dappPermissions.origin, origin))
      .orderBy(asc(dappPermissions.createdAt), asc(dappPermissions.id))
    return rows.map(fromPermissionRow)
  },
  listSolanaPermissions: async (originValue) => {
    const origin = normalizeDappOrigin(originValue)
    const rows = await db
      .select()
      .from(solanaDappPermissions)
      .where(eq(solanaDappPermissions.origin, origin))
      .orderBy(asc(solanaDappPermissions.createdAt), asc(solanaDappPermissions.id))
    return rows.map(fromSolanaPermissionRow)
  },
  savePermission: async (permissionValue) => {
    const permission = dappPermissionRecordSchema.parse(
      permissionValue
    ) as EthereumProviderPermissionRecord
    await db
      .insert(dappPermissions)
      .values({
        id: permission.id,
        origin: permission.origin,
        sessionKey: permission.sessionKey,
        walletId: permission.walletId,
        chainKey: permission.chainKey,
        accountAddresses: permission.accountAddresses,
        methods: permission.methods,
        createdAt: permission.createdAt,
        updatedAt: permission.updatedAt,
        expiresAt: permission.expiresAt ?? null,
      })
      .onConflictDoUpdate({
        set: {
          sessionKey: permission.sessionKey,
          accountAddresses: permission.accountAddresses,
          methods: permission.methods,
          updatedAt: permission.updatedAt,
          expiresAt: permission.expiresAt ?? null,
        },
        target: [dappPermissions.origin, dappPermissions.walletId, dappPermissions.chainKey],
      })
    const records = await db
      .select()
      .from(dappPermissions)
      .where(eq(dappPermissions.origin, permission.origin))
    const saved = records.find(
      (record) => record.walletId === permission.walletId && record.chainKey === permission.chainKey
    )
    if (!saved) throw new Error("The dApp permission was not persisted.")
    return fromPermissionRow(saved)
  },
  saveSession: async (sessionValue) => {
    const session = dappSessionSchema.parse(sessionValue) as DappSession
    await db
      .insert(dappOrigins)
      .values({
        origin: session.origin,
        sessionKey: session.key,
        partition: session.partition,
        createdAt: session.createdAt,
        lastUsedAt: session.lastUsedAt ?? null,
      })
      .onConflictDoUpdate({
        set: {
          sessionKey: session.key,
          partition: session.partition,
          lastUsedAt: session.lastUsedAt ?? session.createdAt,
        },
        target: dappOrigins.origin,
      })
    const [saved] = await db
      .select()
      .from(dappOrigins)
      .where(eq(dappOrigins.origin, session.origin))
      .limit(1)
    if (!saved) throw new Error("The dApp session was not persisted.")
    return fromSessionRow(saved)
  },
  saveSolanaPermission: async (permissionValue) => {
    const permission = solanaProviderPermissionRecordSchema.parse(
      permissionValue
    ) as SolanaProviderPermissionRecord
    await db
      .insert(solanaDappPermissions)
      .values({
        id: permission.id,
        origin: permission.origin,
        sessionKey: permission.sessionKey,
        walletId: permission.walletId,
        bindings: permission.bindings,
        createdAt: permission.createdAt,
        updatedAt: permission.updatedAt,
        expiresAt: permission.expiresAt ?? null,
      })
      .onConflictDoUpdate({
        set: {
          sessionKey: permission.sessionKey,
          bindings: permission.bindings,
          updatedAt: permission.updatedAt,
          expiresAt: permission.expiresAt ?? null,
        },
        target: [solanaDappPermissions.origin, solanaDappPermissions.walletId],
      })
    const rows = await db
      .select()
      .from(solanaDappPermissions)
      .where(eq(solanaDappPermissions.origin, permission.origin))
    const saved = rows.find((row) => row.walletId === permission.walletId)
    if (!saved) throw new Error("The Solana dApp permission was not persisted.")
    return fromSolanaPermissionRow(saved)
  },
})

export const createWalletProviderPersistenceService = createDappBrowserPersistenceService
