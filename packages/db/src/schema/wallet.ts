import {
  type ChainAccountId,
  chainNamespaces,
  curves,
  type HexAddress,
  type HexData,
  type VaultId,
  type Wallet,
  type WalletAccountId,
  type WalletFingerprint,
  type WalletId,
  walletKinds,
  walletModes,
  walletStatuses,
} from "@cypheria/wallet-core"
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
    id: text("id").$type<WalletId>().primaryKey(),
    name: text("name").notNull(),
    kind: text("kind", { enum: walletKinds }).notNull(),
    fingerprint: text("fingerprint").$type<WalletFingerprint>().notNull(),
    vaultId: text("vault_id").$type<VaultId>(),
    metadata: text("metadata", { mode: "json" }).$type<Wallet["metadata"]>().notNull(),
    position: integer("position").notNull().default(0),
    status: text("status", { enum: walletStatuses }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("wallets_fingerprint_unique").on(table.fingerprint),
    uniqueIndex("wallets_name_unique").on(table.name),
    uniqueIndex("wallets_vault_id_unique").on(table.vaultId),
    index("wallets_position_idx").on(table.position),
    index("wallets_status_idx").on(table.status),
    check(
      "wallets_kind_vault_check",
      sql`(
        (${table.kind} IN ('hd', 'private-key', 'private-key-group') AND ${table.vaultId} IS NOT NULL)
        OR
        (${table.kind} IN ('watch', 'watch-group') AND ${table.vaultId} IS NULL)
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
    id: text("id").$type<WalletAccountId>().primaryKey(),
    walletId: text("wallet_id")
      .$type<WalletId>()
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),
    index: integer("account_index").notNull(),
    name: text("name").notNull(),
    fingerprint: text("fingerprint").$type<WalletFingerprint>().notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
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
    id: text("id").$type<ChainAccountId>().primaryKey(),
    walletAccountId: text("wallet_account_id")
      .$type<WalletAccountId>()
      .notNull()
      .references(() => walletAccounts.id, { onDelete: "cascade" }),
    namespace: text("namespace", { enum: chainNamespaces }).notNull(),
    chainId: integer("chain_id").notNull(),
    address: text("address").$type<HexAddress>().notNull(),
    publicKey: text("public_key").$type<HexData>(),
    derivationPath: text("derivation_path"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
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
    walletId: text("wallet_id")
      .$type<WalletId>()
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),
    namespace: text("namespace", { enum: chainNamespaces }).notNull(),
    curve: text("curve", { enum: curves }).notNull(),
    pathTemplate: text("path_template").notNull(),
    probePath: text("probe_path").notNull(),
    derivePosition: integer("derive_position").notNull(),
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
    id: text("id").$type<"default">().primaryKey(),
    walletId: text("wallet_id")
      .$type<WalletId>()
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),
    walletAccountId: text("wallet_account_id")
      .$type<WalletAccountId>()
      .notNull()
      .references(() => walletAccounts.id, { onDelete: "cascade" }),
    chainAccountId: text("chain_account_id")
      .$type<ChainAccountId>()
      .notNull()
      .references(() => chainAccounts.id, { onDelete: "cascade" }),
    mode: text("mode", { enum: walletModes }).notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "active_wallet_context_mode_check",
      sql`${table.mode} IN ('conditional-auto-signing', 'human-approval', 'read-only')`
    ),
  ]
)
