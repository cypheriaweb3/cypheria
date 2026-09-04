import { policyDecisions, type SigningPolicy } from "@cypheria/policy-engine"
import { type WalletId, walletModes } from "@cypheria/wallet-core"
import { sql } from "drizzle-orm"
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

import { wallets } from "./wallet.js"

export const signingIntentSources = ["agent", "automation", "dapp"] as const
export const signingIntentStatuses = [
  "approved",
  "expired",
  "pending-approval",
  "rejected",
] as const
export const approvalRequestStatuses = ["approved", "expired", "pending", "rejected"] as const

export const signingIntentClaims = sqliteTable("signing_intent_claims", {
  intentId: text("intent_id").primaryKey(),
  payloadHash: text("payload_hash").notNull(),
  claimedAt: text("claimed_at").notNull(),
})

export const signingPolicies = sqliteTable(
  "signing_policies",
  {
    id: text("id").primaryKey(),
    walletId: text("wallet_id")
      .$type<WalletId>()
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),
    chainIds: text("chain_ids", { mode: "json" }).$type<SigningPolicy["chainIds"]>().notNull(),
    methods: text("methods", { mode: "json" }).$type<SigningPolicy["methods"]>().notNull(),
    origins: text("origins", { mode: "json" }).$type<SigningPolicy["origins"]>().notNull(),
    contractAllowlist: text("contract_allowlist", { mode: "json" }).$type<
      NonNullable<SigningPolicy["contractAllowlist"]>
    >(),
    maxNativeValue: text("max_native_value"),
    effect: text("effect", { enum: policyDecisions }).notNull(),
    requireHumanApproval: integer("require_human_approval", { mode: "boolean" }).notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    revision: integer("revision").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    expiresAt: text("expires_at"),
  },
  (table) => [
    index("signing_policies_wallet_id_idx").on(table.walletId),
    index("signing_policies_enabled_idx").on(table.enabled),
    check(
      "signing_policies_effect_check",
      sql`${table.effect} IN ('allow', 'deny', 'require-human-approval')`
    ),
    check("signing_policies_enabled_check", sql`${table.enabled} IN (0, 1)`),
    check(
      "signing_policies_require_human_approval_check",
      sql`${table.requireHumanApproval} IN (0, 1)`
    ),
    check("signing_policies_revision_check", sql`${table.revision} > 0`),
  ]
)

export const signingIntents = sqliteTable(
  "signing_intents",
  {
    id: text("id").primaryKey(),
    walletId: text("wallet_id").$type<WalletId>().notNull(),
    approvalId: text("approval_id"),
    matchedPolicyId: text("matched_policy_id"),
    payload: text("payload").notNull(),
    payloadHash: text("payload_hash").notNull(),
    source: text("source", { enum: signingIntentSources }).notNull(),
    mode: text("mode", { enum: walletModes }).notNull(),
    decision: text("decision", { enum: policyDecisions }).notNull(),
    decisionId: text("decision_id").notNull(),
    status: text("status", { enum: signingIntentStatuses }).notNull(),
    revision: integer("revision").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    index("signing_intents_status_idx").on(table.status),
    index("signing_intents_wallet_id_idx").on(table.walletId),
    check("signing_intents_revision_check", sql`${table.revision} > 0`),
    check("signing_intents_source_check", sql`${table.source} IN ('agent', 'automation', 'dapp')`),
    check(
      "signing_intents_mode_check",
      sql`${table.mode} IN ('conditional-auto-signing', 'human-approval', 'read-only')`
    ),
    check(
      "signing_intents_decision_check",
      sql`${table.decision} IN ('allow', 'deny', 'require-human-approval')`
    ),
    check(
      "signing_intents_status_check",
      sql`${table.status} IN ('approved', 'expired', 'pending-approval', 'rejected')`
    ),
  ]
)

export const approvalRequests = sqliteTable(
  "approval_requests",
  {
    id: text("id").primaryKey(),
    intentId: text("intent_id")
      .notNull()
      .unique()
      .references(() => signingIntents.id, { onDelete: "cascade" }),
    status: text("status", { enum: approvalRequestStatuses }).notNull(),
    reviewer: text("reviewer"),
    revision: integer("revision").notNull(),
    requestedAt: text("requested_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    resolvedAt: text("resolved_at"),
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
