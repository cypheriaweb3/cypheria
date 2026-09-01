import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

export const wallets = sqliteTable(
  "wallets",
  {
    createdAt: text("created_at").notNull(),
    fingerprint: text("fingerprint").notNull(),
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    metadata: text("metadata").notNull(),
    name: text("name").notNull(),
    provider: text("provider").notNull(),
    status: text("status").notNull(),
    updatedAt: text("updated_at").notNull(),
    vaultId: text("vault_id"),
  },
  (table) => [
    uniqueIndex("wallets_fingerprint_unique").on(table.fingerprint),
    uniqueIndex("wallets_name_unique").on(table.name),
    uniqueIndex("wallets_vault_id_unique").on(table.vaultId),
    index("wallets_status_idx").on(table.status),
    check(
      "wallets_kind_provider_check",
      sql`(
        (${table.kind} IN ('hd', 'private-key', 'private-key-group') AND ${table.provider} = 'local-vault' AND ${table.vaultId} IS NOT NULL)
        OR
        (${table.kind} IN ('watch', 'watch-group') AND ${table.provider} = 'read-only' AND ${table.vaultId} IS NULL)
      )`
    ),
    check(
      "wallets_status_check",
      sql`${table.status} IN ('initializing', 'ready', 'error', 'deleting')`
    ),
  ]
)

export const walletAccounts = sqliteTable(
  "wallet_accounts",
  {
    createdAt: text("created_at").notNull(),
    fingerprint: text("fingerprint").notNull(),
    id: text("id").primaryKey(),
    index: integer("account_index").notNull(),
    name: text("name").notNull(),
    updatedAt: text("updated_at").notNull(),
    walletId: text("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("wallet_accounts_wallet_index_unique").on(table.walletId, table.index),
    uniqueIndex("wallet_accounts_wallet_name_unique").on(table.walletId, table.name),
    uniqueIndex("wallet_accounts_wallet_fingerprint_unique").on(table.walletId, table.fingerprint),
    index("wallet_accounts_wallet_id_idx").on(table.walletId),
    check("wallet_accounts_index_check", sql`${table.index} >= 0`),
  ]
)

export const chainAccounts = sqliteTable(
  "chain_accounts",
  {
    address: text("address").notNull(),
    chainId: integer("chain_id").notNull(),
    createdAt: text("created_at").notNull(),
    derivationPath: text("derivation_path"),
    id: text("id").primaryKey(),
    namespace: text("namespace").notNull(),
    publicKey: text("public_key"),
    updatedAt: text("updated_at").notNull(),
    walletAccountId: text("wallet_account_id")
      .notNull()
      .references(() => walletAccounts.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("chain_accounts_account_namespace_chain_unique").on(
      table.walletAccountId,
      table.namespace,
      table.chainId
    ),
    index("chain_accounts_address_idx").on(table.namespace, table.chainId, table.address),
    index("chain_accounts_wallet_account_id_idx").on(table.walletAccountId),
    check("chain_accounts_chain_id_check", sql`${table.chainId} > 0`),
    check("chain_accounts_namespace_check", sql`${table.namespace} = 'eip155'`),
  ]
)

export const walletHdSchemes = sqliteTable(
  "wallet_hd_schemes",
  {
    curve: text("curve").notNull(),
    derivePosition: integer("derive_position").notNull(),
    namespace: text("namespace").notNull(),
    pathTemplate: text("path_template").notNull(),
    probePath: text("probe_path").notNull(),
    walletId: text("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.walletId, table.namespace] }),
    check("wallet_hd_schemes_curve_check", sql`${table.curve} = 'secp256k1'`),
    check("wallet_hd_schemes_derive_position_check", sql`${table.derivePosition} = 4`),
    check("wallet_hd_schemes_namespace_check", sql`${table.namespace} = 'eip155'`),
  ]
)

export const activeWalletContext = sqliteTable(
  "active_wallet_context",
  {
    chainAccountId: text("chain_account_id")
      .notNull()
      .references(() => chainAccounts.id, { onDelete: "cascade" }),
    id: text("id").primaryKey(),
    mode: text("mode").notNull(),
    updatedAt: text("updated_at").notNull(),
    walletAccountId: text("wallet_account_id")
      .notNull()
      .references(() => walletAccounts.id, { onDelete: "cascade" }),
    walletId: text("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),
  },
  (table) => [
    check(
      "active_wallet_context_mode_check",
      sql`${table.mode} IN ('conditional-auto-signing', 'human-approval', 'read-only')`
    ),
  ]
)
