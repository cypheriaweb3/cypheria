import { sql } from "drizzle-orm"
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

import { wallets } from "./wallet.js"

export const signingIntentClaims = sqliteTable("signing_intent_claims", {
  claimedAt: text("claimed_at").notNull(),
  intentId: text("intent_id").primaryKey(),
  payloadHash: text("payload_hash").notNull(),
})

export const signingPolicies = sqliteTable(
  "signing_policies",
  {
    chainIds: text("chain_ids").notNull(),
    contractAllowlist: text("contract_allowlist"),
    createdAt: text("created_at").notNull(),
    effect: text("effect").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    expiresAt: text("expires_at"),
    id: text("id").primaryKey(),
    maxNativeValue: text("max_native_value"),
    methods: text("methods").notNull(),
    origins: text("origins").notNull(),
    requireHumanApproval: integer("require_human_approval", { mode: "boolean" }).notNull(),
    revision: integer("revision").notNull(),
    updatedAt: text("updated_at").notNull(),
    walletId: text("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("signing_policies_wallet_id_idx").on(table.walletId),
    index("signing_policies_enabled_idx").on(table.enabled),
    check(
      "signing_policies_effect_check",
      sql`${table.effect} IN ('allow', 'deny', 'require-human-approval')`
    ),
    check("signing_policies_revision_check", sql`${table.revision} > 0`),
  ]
)

export const signingIntents = sqliteTable(
  "signing_intents",
  {
    approvalId: text("approval_id"),
    createdAt: text("created_at").notNull(),
    decision: text("decision").notNull(),
    decisionId: text("decision_id").notNull(),
    expiresAt: text("expires_at").notNull(),
    id: text("id").primaryKey(),
    matchedPolicyId: text("matched_policy_id"),
    mode: text("mode").notNull(),
    payload: text("payload").notNull(),
    payloadHash: text("payload_hash").notNull(),
    revision: integer("revision").notNull(),
    source: text("source").notNull(),
    status: text("status").notNull(),
    updatedAt: text("updated_at").notNull(),
    walletId: text("wallet_id").notNull(),
  },
  (table) => [
    index("signing_intents_status_idx").on(table.status),
    index("signing_intents_wallet_id_idx").on(table.walletId),
    check("signing_intents_revision_check", sql`${table.revision} > 0`),
    check("signing_intents_source_check", sql`${table.source} IN ('agent', 'automation', 'dapp')`),
    check(
      "signing_intents_status_check",
      sql`${table.status} IN ('approved', 'expired', 'pending-approval', 'rejected')`
    ),
  ]
)

export const approvalRequests = sqliteTable(
  "approval_requests",
  {
    expiresAt: text("expires_at").notNull(),
    id: text("id").primaryKey(),
    intentId: text("intent_id")
      .notNull()
      .unique()
      .references(() => signingIntents.id, { onDelete: "cascade" }),
    requestedAt: text("requested_at").notNull(),
    resolvedAt: text("resolved_at"),
    reviewer: text("reviewer"),
    revision: integer("revision").notNull(),
    status: text("status").notNull(),
  },
  (table) => [
    index("approval_requests_status_idx").on(table.status),
    check("approval_requests_revision_check", sql`${table.revision} > 0`),
    check(
      "approval_requests_status_check",
      sql`${table.status} IN ('approved', 'expired', 'pending', 'rejected')`
    ),
  ]
)
