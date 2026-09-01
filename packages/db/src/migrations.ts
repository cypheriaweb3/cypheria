import type { Client } from "@libsql/client"

export const initialSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS audit_logs (
    actor text NOT NULL,
    correlation_id text,
    created_at text NOT NULL,
    event_type text NOT NULL,
    id text PRIMARY KEY NOT NULL,
    payload_hash text,
    payload_summary text,
    source text NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS audit_logs_correlation_id_idx ON audit_logs (correlation_id)",
  "CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at)",
  "CREATE INDEX IF NOT EXISTS audit_logs_event_type_idx ON audit_logs (event_type)",
  `CREATE TABLE IF NOT EXISTS runtime_metadata (
    key text PRIMARY KEY NOT NULL,
    updated_at text NOT NULL,
    value text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key text PRIMARY KEY NOT NULL,
    updated_at text NOT NULL,
    value text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS workspaces (
    created_at text NOT NULL,
    id text PRIMARY KEY NOT NULL,
    last_opened_at text,
    name text NOT NULL,
    path text NOT NULL,
    updated_at text NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS workspaces_path_idx ON workspaces (path)",
  `CREATE TABLE IF NOT EXISTS automation_tasks (
    audit_correlation_id text NOT NULL,
    created_at text NOT NULL,
    description text,
    id text PRIMARY KEY NOT NULL,
    run_history text NOT NULL,
    status text NOT NULL,
    title text NOT NULL,
    trigger text NOT NULL,
    updated_at text NOT NULL,
    wallet_policy_scope text NOT NULL,
    workspace text NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS automation_tasks_audit_correlation_id_idx ON automation_tasks (audit_correlation_id)",
  "CREATE INDEX IF NOT EXISTS automation_tasks_status_idx ON automation_tasks (status)",
  "CREATE INDEX IF NOT EXISTS automation_tasks_workspace_idx ON automation_tasks (workspace)",
  `CREATE TABLE IF NOT EXISTS automation_runs (
    audit_correlation_id text NOT NULL,
    completed_at text,
    error text,
    id text PRIMARY KEY NOT NULL,
    logs text NOT NULL,
    started_at text,
    status text NOT NULL,
    task_id text NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS automation_runs_audit_correlation_id_idx ON automation_runs (audit_correlation_id)",
  "CREATE INDEX IF NOT EXISTS automation_runs_status_idx ON automation_runs (status)",
  "CREATE INDEX IF NOT EXISTS automation_runs_task_id_idx ON automation_runs (task_id)",
  `CREATE TABLE IF NOT EXISTS wallets (
    created_at text NOT NULL,
    fingerprint text NOT NULL,
    id text PRIMARY KEY NOT NULL,
    kind text NOT NULL,
    metadata text NOT NULL,
    name text NOT NULL,
    provider text NOT NULL,
    status text NOT NULL,
    updated_at text NOT NULL,
    vault_id text,
    CONSTRAINT wallets_kind_provider_check CHECK (
      (kind IN ('hd', 'private-key', 'private-key-group') AND provider = 'local-vault' AND vault_id IS NOT NULL)
      OR
      (kind IN ('watch', 'watch-group') AND provider = 'read-only' AND vault_id IS NULL)
    ),
    CONSTRAINT wallets_status_check CHECK (status IN ('initializing', 'ready', 'error', 'deleting'))
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS wallets_fingerprint_unique ON wallets (fingerprint)",
  "CREATE UNIQUE INDEX IF NOT EXISTS wallets_name_unique ON wallets (name)",
  "CREATE UNIQUE INDEX IF NOT EXISTS wallets_vault_id_unique ON wallets (vault_id)",
  "CREATE INDEX IF NOT EXISTS wallets_status_idx ON wallets (status)",
  `CREATE TABLE IF NOT EXISTS wallet_accounts (
    created_at text NOT NULL,
    fingerprint text NOT NULL,
    id text PRIMARY KEY NOT NULL,
    account_index integer NOT NULL,
    name text NOT NULL,
    updated_at text NOT NULL,
    wallet_id text NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    CONSTRAINT wallet_accounts_index_check CHECK (account_index >= 0)
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS wallet_accounts_wallet_index_unique ON wallet_accounts (wallet_id, account_index)",
  "CREATE UNIQUE INDEX IF NOT EXISTS wallet_accounts_wallet_name_unique ON wallet_accounts (wallet_id, name)",
  "CREATE UNIQUE INDEX IF NOT EXISTS wallet_accounts_wallet_fingerprint_unique ON wallet_accounts (wallet_id, fingerprint)",
  "CREATE INDEX IF NOT EXISTS wallet_accounts_wallet_id_idx ON wallet_accounts (wallet_id)",
  `CREATE TABLE IF NOT EXISTS chain_accounts (
    address text NOT NULL,
    chain_id integer NOT NULL,
    created_at text NOT NULL,
    derivation_path text,
    id text PRIMARY KEY NOT NULL,
    namespace text NOT NULL,
    public_key text,
    updated_at text NOT NULL,
    wallet_account_id text NOT NULL REFERENCES wallet_accounts(id) ON DELETE CASCADE,
    CONSTRAINT chain_accounts_chain_id_check CHECK (chain_id > 0),
    CONSTRAINT chain_accounts_namespace_check CHECK (namespace = 'eip155')
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS chain_accounts_account_namespace_chain_unique ON chain_accounts (wallet_account_id, namespace, chain_id)",
  "CREATE INDEX IF NOT EXISTS chain_accounts_address_idx ON chain_accounts (namespace, chain_id, address)",
  "CREATE INDEX IF NOT EXISTS chain_accounts_wallet_account_id_idx ON chain_accounts (wallet_account_id)",
  `CREATE TABLE IF NOT EXISTS wallet_hd_schemes (
    curve text NOT NULL,
    derive_position integer NOT NULL,
    namespace text NOT NULL,
    path_template text NOT NULL,
    probe_path text NOT NULL,
    wallet_id text NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    PRIMARY KEY (wallet_id, namespace),
    CONSTRAINT wallet_hd_schemes_curve_check CHECK (curve = 'secp256k1'),
    CONSTRAINT wallet_hd_schemes_derive_position_check CHECK (derive_position = 4),
    CONSTRAINT wallet_hd_schemes_namespace_check CHECK (namespace = 'eip155')
  )`,
  `CREATE TABLE IF NOT EXISTS active_wallet_context (
    chain_account_id text NOT NULL REFERENCES chain_accounts(id) ON DELETE CASCADE,
    id text PRIMARY KEY NOT NULL,
    mode text NOT NULL,
    updated_at text NOT NULL,
    wallet_account_id text NOT NULL REFERENCES wallet_accounts(id) ON DELETE CASCADE,
    wallet_id text NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    CONSTRAINT active_wallet_context_mode_check CHECK (mode IN ('conditional-auto-signing', 'human-approval', 'read-only'))
  )`,
  `CREATE TABLE IF NOT EXISTS signing_intent_claims (
    claimed_at text NOT NULL,
    intent_id text PRIMARY KEY NOT NULL,
    payload_hash text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS signing_policies (
    chain_ids text NOT NULL,
    contract_allowlist text,
    created_at text NOT NULL,
    effect text NOT NULL,
    enabled integer NOT NULL,
    expires_at text,
    id text PRIMARY KEY NOT NULL,
    max_native_value text,
    methods text NOT NULL,
    origins text NOT NULL,
    require_human_approval integer NOT NULL,
    revision integer NOT NULL,
    updated_at text NOT NULL,
    wallet_id text NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    CONSTRAINT signing_policies_effect_check CHECK (effect IN ('allow', 'deny', 'require-human-approval')),
    CONSTRAINT signing_policies_revision_check CHECK (revision > 0)
  )`,
  "CREATE INDEX IF NOT EXISTS signing_policies_wallet_id_idx ON signing_policies (wallet_id)",
  "CREATE INDEX IF NOT EXISTS signing_policies_enabled_idx ON signing_policies (enabled)",
  `CREATE TABLE IF NOT EXISTS signing_intents (
    approval_id text,
    created_at text NOT NULL,
    decision text NOT NULL,
    decision_id text NOT NULL,
    expires_at text NOT NULL,
    id text PRIMARY KEY NOT NULL,
    matched_policy_id text,
    mode text NOT NULL,
    payload text NOT NULL,
    payload_hash text NOT NULL,
    revision integer NOT NULL,
    source text NOT NULL,
    status text NOT NULL,
    updated_at text NOT NULL,
    wallet_id text NOT NULL,
    CONSTRAINT signing_intents_revision_check CHECK (revision > 0),
    CONSTRAINT signing_intents_source_check CHECK (source IN ('agent', 'automation', 'dapp')),
    CONSTRAINT signing_intents_status_check CHECK (status IN ('approved', 'expired', 'pending-approval', 'rejected'))
  )`,
  "CREATE INDEX IF NOT EXISTS signing_intents_status_idx ON signing_intents (status)",
  "CREATE INDEX IF NOT EXISTS signing_intents_wallet_id_idx ON signing_intents (wallet_id)",
  `CREATE TABLE IF NOT EXISTS approval_requests (
    expires_at text NOT NULL,
    id text PRIMARY KEY NOT NULL,
    intent_id text NOT NULL UNIQUE REFERENCES signing_intents(id) ON DELETE CASCADE,
    requested_at text NOT NULL,
    resolved_at text,
    reviewer text,
    revision integer NOT NULL,
    status text NOT NULL,
    CONSTRAINT approval_requests_revision_check CHECK (revision > 0),
    CONSTRAINT approval_requests_status_check CHECK (status IN ('approved', 'expired', 'pending', 'rejected'))
  )`,
  "CREATE INDEX IF NOT EXISTS approval_requests_status_idx ON approval_requests (status)",
] as const

export const ensureDatabaseSchema = async (client: Client): Promise<void> => {
  await client.execute("PRAGMA foreign_keys = ON")
  await client.batch(
    initialSchemaStatements.map((sql) => ({ sql })),
    "write"
  )
}
