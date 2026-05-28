import type { Database } from "better-sqlite3"

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
] as const

export const ensureDatabaseSchema = (sqlite: Database): void => {
  const migrate = sqlite.transaction(() => {
    for (const statement of initialSchemaStatements) {
      sqlite.prepare(statement).run()
    }
  })

  migrate()
}
