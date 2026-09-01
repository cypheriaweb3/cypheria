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
    createdAt: row.createdAt,
    key: row.sessionKey,
    ...(row.lastUsedAt ? { lastUsedAt: row.lastUsedAt } : {}),
    origin: row.origin,
    partition: row.partition,
  })

const fromPermissionRow = (
  row: typeof dappPermissions.$inferSelect
): EthereumProviderPermissionRecord =>
  dappPermissionRecordSchema.parse({
    accountAddresses: JSON.parse(row.accountAddresses) as unknown,
    chainId: row.chainId,
    createdAt: row.createdAt,
    ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}),
    id: row.id,
    methods: JSON.parse(row.methods) as unknown,
    origin: row.origin,
    sessionKey: row.sessionKey,
    updatedAt: row.updatedAt,
    walletId: row.walletId,
  }) as EthereumProviderPermissionRecord

const fromSolanaPermissionRow = (
  row: typeof solanaDappPermissions.$inferSelect
): SolanaProviderPermissionRecord =>
  solanaProviderPermissionRecordSchema.parse({
    bindings: JSON.parse(row.bindings) as unknown,
    createdAt: row.createdAt,
    ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}),
    id: row.id,
    origin: row.origin,
    sessionKey: row.sessionKey,
    updatedAt: row.updatedAt,
    walletId: row.walletId,
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
        accountAddresses: JSON.stringify(permission.accountAddresses),
        chainId: permission.chainId,
        createdAt: permission.createdAt,
        expiresAt: permission.expiresAt ?? null,
        id: permission.id,
        methods: JSON.stringify(permission.methods),
        origin: permission.origin,
        sessionKey: permission.sessionKey,
        updatedAt: permission.updatedAt,
        walletId: permission.walletId,
      })
      .onConflictDoUpdate({
        set: {
          accountAddresses: JSON.stringify(permission.accountAddresses),
          expiresAt: permission.expiresAt ?? null,
          methods: JSON.stringify(permission.methods),
          sessionKey: permission.sessionKey,
          updatedAt: permission.updatedAt,
        },
        target: [dappPermissions.origin, dappPermissions.walletId, dappPermissions.chainId],
      })
    const records = await db
      .select()
      .from(dappPermissions)
      .where(eq(dappPermissions.origin, permission.origin))
    const saved = records.find(
      (record) => record.walletId === permission.walletId && record.chainId === permission.chainId
    )
    if (!saved) throw new Error("The dApp permission was not persisted.")
    return fromPermissionRow(saved)
  },
  saveSession: async (sessionValue) => {
    const session = dappSessionSchema.parse(sessionValue) as DappSession
    await db
      .insert(dappOrigins)
      .values({
        createdAt: session.createdAt,
        lastUsedAt: session.lastUsedAt ?? null,
        origin: session.origin,
        partition: session.partition,
        sessionKey: session.key,
      })
      .onConflictDoUpdate({
        set: {
          lastUsedAt: session.lastUsedAt ?? session.createdAt,
          partition: session.partition,
          sessionKey: session.key,
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
        bindings: JSON.stringify(permission.bindings),
        createdAt: permission.createdAt,
        expiresAt: permission.expiresAt ?? null,
        id: permission.id,
        origin: permission.origin,
        sessionKey: permission.sessionKey,
        updatedAt: permission.updatedAt,
        walletId: permission.walletId,
      })
      .onConflictDoUpdate({
        set: {
          bindings: JSON.stringify(permission.bindings),
          expiresAt: permission.expiresAt ?? null,
          sessionKey: permission.sessionKey,
          updatedAt: permission.updatedAt,
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
