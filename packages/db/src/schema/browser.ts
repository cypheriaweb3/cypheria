import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

import { wallets } from "./wallet.js"

export const dappOrigins = sqliteTable("dapp_origins", {
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at"),
  origin: text("origin").primaryKey(),
  partition: text("partition").notNull(),
  sessionKey: text("session_key").notNull().unique(),
})

export const dappPermissions = sqliteTable(
  "dapp_permissions",
  {
    accountAddresses: text("account_addresses").notNull(),
    chainId: integer("chain_id").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at"),
    id: text("id").primaryKey(),
    methods: text("methods").notNull(),
    origin: text("origin")
      .notNull()
      .references(() => dappOrigins.origin, { onDelete: "cascade" }),
    sessionKey: text("session_key").notNull(),
    updatedAt: text("updated_at").notNull(),
    walletId: text("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),
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
