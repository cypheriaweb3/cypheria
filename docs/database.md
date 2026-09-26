---
title: Database
---

# Database

Cypheria uses SQLite through Drizzle ORM and the local libSQL driver. `packages/db/src/schema/` is the editable schema source; `packages/db/drizzle/` contains the generated migration chain and snapshots.

## Location and ownership

The default database is `$CYPHERIA_HOME/db/cypheria.sqlite`. Only the Server opens it. Desktop, CLI, Expo, Agents, and plugins use the Cypheria protocol and never import database repositories.

This database remains distinct from rebuildable client replicas. Their ownership and platform adapters are documented in [Client Storage](client-storage.md).

Every connection enables foreign keys. Server services define transaction boundaries and validate persisted JSON when it re-enters a domain.

## Table groups

| Domain | Tables | Responsibility |
| --- | --- | --- |
| Runtime | `runtime_metadata`, `settings`, `audit_logs`, `workspaces` | Runtime metadata, key/value settings, append-oriented audit, workspace records |
| Agents | `agent_registry` | User-selected Agent membership, creation time, installation, enablement, versions, and state; native harnesses are seeded |
| Projects and Threads | `projects`, `threads`, `project_items`, `sections`, `section_items`, `thread_attachments` | Durable organization, ordering, membership, archive, harness linkage, and cross-client Git attachments |
| Thread execution | `thread_lifecycle_operations`, `thread_message_requests`, `thread_timeline_epochs`, `thread_timeline_rows` | Lifecycle recovery, message idempotency receipts, and append-only Canonical Timeline |
| Schedules | `schedules`, `schedule_runs` | Definitions, next occurrence, leases, and run history |
| Networks | `networks`, `network_rpc_endpoints`, `dapp_network_contexts` | Chain definitions, ordered endpoints, health, and origin context |
| Wallets | `wallets`, `wallet_accounts`, `chain_accounts`, `wallet_hd_schemes`, `active_wallet_context` | Public wallet metadata and active selection |
| Signing | `signing_policies`, `signing_intents`, `signing_intent_claims`, `approval_requests` | Policy, intent, lease, approval, and replay protection |
| Browser | `dapp_origins`, `dapp_permissions`, `solana_dapp_permissions` | Origin isolation and scoped provider permission |

Private keys, mnemonics, vault encryption keys, decrypted signers, and secret endpoint headers are not ordinary table data.

## Project and Thread constraints

Cypheria UUIDv7 values identify Projects, Threads, and Sections. A Thread has one immutable Agent, at most one harness session linkage per Agent, optional fork origin, and independent Project and Section membership.

`project_items` places a Thread in at most one Project. `section_items` interleaves Project and Thread entries in one ordered domain and places each entry in at most one Section. The fixed Pinned Section has stable ID `01984de2-8f74-7c91-a3b2-5c5e937cf318`.

Project, Thread, and Section deletion is staged. The Server first commits `deleted_at`, which removes the resource from normal reads, then performs Agent or dependent cleanup, and only then purges the row. Thread lifecycle receipts make failed Agent deletion retryable at startup. Tombstoned Projects and Sections are retried at startup and on a five-minute cleanup interval. Cypheria Project identity remains internal and is not mapped to Codex or OpenCode projects.

Ordering columns are non-negative and unique in their scope. Membership moves and compaction execute transactionally so clients never observe duplicate positions.

`thread_attachments` stores Server-authoritative relationships between a Thread and an external pull request or managed worktree. Pull requests use a canonical provider, host, repository, and number identity and may belong to multiple Threads. A managed worktree UUID can belong to only one Thread. Queries are cursor-paginated in both directions, deletion follows the Thread foreign key, and mutations publish typed notifications so Desktop, Expo, Web, and CLI clients can converge without browser-local association state. The model is independent of `agent_id`.

## Canonical Timeline

`thread_timeline_epochs` stores the active epoch and next sequence for each Thread. `thread_timeline_rows` stores immutable canonical rows keyed by Thread, epoch, and sequence. Appending allocates contiguous sequence numbers in one transaction. Rehydration or history replacement creates a new epoch and atomically replaces its rows. The internal nullable `agent_message_id` links a submitted canonical user row to the Agent-native message without exposing that identity in the public Timeline contract.

`thread_message_requests` is keyed by Thread and `client_message_id`. It stores a stable request fingerprint and a `pending` or `completed` receipt with the accepted turn ID. A pending receipt survives restart and blocks automatic replay when Agent delivery is ambiguous; a completed receipt makes identical retries return the original turn. Rows are removed with their owning Thread.

The Server validates stored Timeline JSON against `ThreadTimelineRowSchema` when reading it back. Harness-native history is input to adaptation, not an alternative client-facing history table.

## Schedules and recovery

Schedule definition, next-run advancement, occurrence claim, and run creation are coordinated transactionally. Claims prevent concurrent execution. On restart, abandoned running rows become interrupted before active definitions are recovered. Web3 side effects are not replayed automatically.

Thread lifecycle operations similarly journal non-atomic harness work so deletion and session transitions can be reconciled after failure.

## SQLite conventions

- Use `TEXT` UUIDs unless numeric row identity is intentional.
- Use integer-backed booleans and named `CHECK` constraints for enum-like values.
- Use normalized ISO UTC text for time unless a domain explicitly uses Unix seconds; Project, Thread, Section, and membership timestamps use Unix seconds.
- Store high-precision Web3 quantities as canonical decimal text, never `REAL`.
- Use JSON text only for bounded aggregates that are validated at domain boundaries.
- Promote filtered, joined, unique, or independently updated properties to columns or child tables.
- Use revision columns for compare-and-swap on concurrently mutable records.

## Transactions

Transactions protect ordering changes, memberships, Timeline sequence allocation, schedule claims, signing-intent claims, policy revisions, and approval decisions. External Agent, RPC, or wallet operations must not be held inside a long SQLite transaction. Persist intent or claim first, perform the external operation, then record its terminal result.

## Migration policy

Generated migrations are applied in journal order. The product does not detect or import legacy application data. Generate schema changes from the current Drizzle source, review the SQL, and test creation of an empty database. Published migrations become append-only; do not rewrite applied history.

```sh
pnpm --filter @cypheria/db db:generate --name=<migration-name>
pnpm --filter @cypheria/db db:check
pnpm --filter @cypheria/db db:migrate
pnpm --filter @cypheria/db test
```

Commit schema files, SQL, snapshot, and journal together.
