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

export const runtimeMetadata = sqliteTable("runtime_metadata", {
  key: text("key").primaryKey(),
  updatedAt: text("updated_at").notNull(),
  value: text("value").notNull(),
})

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  updatedAt: text("updated_at").notNull(),
  value: text("value").notNull(),
})

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    actor: text("actor").notNull(),
    correlationId: text("correlation_id"),
    createdAt: text("created_at").notNull(),
    eventType: text("event_type").notNull(),
    id: text("id").primaryKey(),
    payloadHash: text("payload_hash"),
    payloadSummary: text("payload_summary"),
    source: text("source").notNull(),
  },
  (table) => [
    index("audit_logs_correlation_id_idx").on(table.correlationId),
    index("audit_logs_created_at_idx").on(table.createdAt),
    index("audit_logs_event_type_idx").on(table.eventType),
  ]
)

export const workspaces = sqliteTable(
  "workspaces",
  {
    createdAt: text("created_at").notNull(),
    id: text("id").primaryKey(),
    lastOpenedAt: text("last_opened_at"),
    name: text("name").notNull(),
    path: text("path").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("workspaces_path_idx").on(table.path)]
)

export const automationTasks = sqliteTable(
  "automation_tasks",
  {
    auditCorrelationId: text("audit_correlation_id").notNull(),
    createdAt: text("created_at").notNull(),
    description: text("description"),
    id: text("id").primaryKey(),
    runHistory: text("run_history").notNull(),
    status: text("status").notNull(),
    title: text("title").notNull(),
    trigger: text("trigger").notNull(),
    updatedAt: text("updated_at").notNull(),
    walletPolicyScope: text("wallet_policy_scope").notNull(),
    workspace: text("workspace").notNull(),
  },
  (table) => [
    index("automation_tasks_audit_correlation_id_idx").on(table.auditCorrelationId),
    index("automation_tasks_status_idx").on(table.status),
    index("automation_tasks_workspace_idx").on(table.workspace),
  ]
)

export const automationRuns = sqliteTable(
  "automation_runs",
  {
    auditCorrelationId: text("audit_correlation_id").notNull(),
    completedAt: text("completed_at"),
    error: text("error"),
    id: text("id").primaryKey(),
    logs: text("logs").notNull(),
    startedAt: text("started_at"),
    status: text("status").notNull(),
    taskId: text("task_id").notNull(),
  },
  (table) => [
    index("automation_runs_audit_correlation_id_idx").on(table.auditCorrelationId),
    index("automation_runs_status_idx").on(table.status),
    index("automation_runs_task_id_idx").on(table.taskId),
  ]
)

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

export const schema = {
  activeWalletContext,
  auditLogs,
  automationRuns,
  automationTasks,
  chainAccounts,
  runtimeMetadata,
  settings,
  signingIntentClaims,
  signingPolicies,
  walletAccounts,
  walletHdSchemes,
  wallets,
  workspaces,
}
