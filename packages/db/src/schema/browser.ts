import type { WalletId } from "@cypheria/wallet-core"
import type {
  DappSessionKey,
  EthereumProviderPermissionRecord,
  SolanaProviderPermissionRecord,
} from "@cypheria/wallet-provider"
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

import { wallets } from "./wallet.js"

export const dappOrigins = sqliteTable("dapp_origins", {
  origin: text("origin").primaryKey(),
  sessionKey: text("session_key").$type<DappSessionKey>().notNull().unique(),
  partition: text("partition").notNull(),
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at"),
})

export const dappPermissions = sqliteTable(
  "dapp_permissions",
  {
    id: text("id").primaryKey(),
    origin: text("origin")
      .notNull()
      .references(() => dappOrigins.origin, { onDelete: "cascade" }),
    sessionKey: text("session_key").$type<DappSessionKey>().notNull(),
    walletId: text("wallet_id")
      .$type<WalletId>()
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),
    chainId: integer("chain_id").notNull(),
    accountAddresses: text("account_addresses", { mode: "json" })
      .$type<EthereumProviderPermissionRecord["accountAddresses"]>()
      .notNull(),
    methods: text("methods", { mode: "json" })
      .$type<EthereumProviderPermissionRecord["methods"]>()
      .notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    expiresAt: text("expires_at"),
  },
  (table) => [
    uniqueIndex("dapp_permissions_origin_wallet_chain_unique").on(
      table.origin,
      table.walletId,
      table.chainId
    ),
    index("dapp_permissions_origin_idx").on(table.origin),
    index("dapp_permissions_wallet_id_idx").on(table.walletId),
  ]
)

export const solanaDappPermissions = sqliteTable(
  "solana_dapp_permissions",
  {
    id: text("id").primaryKey(),
    origin: text("origin")
      .notNull()
      .references(() => dappOrigins.origin, { onDelete: "cascade" }),
    sessionKey: text("session_key").$type<DappSessionKey>().notNull(),
    walletId: text("wallet_id")
      .$type<WalletId>()
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),
    bindings: text("bindings", { mode: "json" })
      .$type<SolanaProviderPermissionRecord["bindings"]>()
      .notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    expiresAt: text("expires_at"),
  },
  (table) => [
    uniqueIndex("solana_dapp_permissions_origin_wallet_unique").on(table.origin, table.walletId),
    index("solana_dapp_permissions_origin_idx").on(table.origin),
    index("solana_dapp_permissions_wallet_id_idx").on(table.walletId),
  ]
)
