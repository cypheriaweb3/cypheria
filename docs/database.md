---
title: Database
---

# Database

Cypheria uses SQLite through Drizzle ORM and the local libSQL driver. `packages/db/src/schema/` is the editable schema source; `packages/db/drizzle/0000_initial.sql` and its snapshot are the current generated migration baseline.

## Location and ownership

The default database is `$CYPHERIA_HOME/db/cypheria.sqlite`. Only the Server opens it. Desktop, CLI, Expo, Agents, and plugins use the Cypheria protocol and never import database repositories.

Every connection enables foreign keys. Server services define transaction boundaries and validate persisted JSON when it re-enters a domain.

## Table groups

| Domain | Tables | Responsibility |
| --- | --- | --- |
| Runtime | `runtime_metadata`, `settings`, `audit_logs`, `workspaces` | Runtime metadata, key/value settings, append-oriented audit, workspace records |
| Agents | `agent_registry` | User-selected Agent membership, creation time, installation, enablement, versions, and state; native harnesses are seeded |
| Projects and Threads | `projects`, `threads`, `project_items`, `sections`, `section_items` | Durable organization, ordering, membership, archive and harness linkage |
| Thread execution | `thread_lifecycle_operations`, `thread_timeline_epochs`, `thread_timeline_rows` | Recovery journal and append-only Canonical Timeline |
| Schedules | `schedules`, `schedule_runs` | Definitions, next occurrence, leases, and run history |
| Networks | `networks`, `network_rpc_endpoints`, `dapp_network_contexts` | Chain definitions, ordered endpoints, health, and origin context |
| Wallets | `wallets`, `wallet_accounts`, `chain_accounts`, `wallet_hd_schemes`, `active_wallet_context` | Public wallet metadata and active selection |
| Signing | `signing_policies`, `signing_intents`, `signing_intent_claims`, `approval_requests` | Policy, intent, lease, approval, and replay protection |
| Browser | `dapp_origins`, `dapp_permissions`, `solana_dapp_permissions` | Origin isolation and scoped provider permission |

Private keys, mnemonics, vault encryption keys, decrypted signers, and secret endpoint headers are not ordinary table data.

## Project and Thread constraints

Cypheria UUIDv7 values identify Projects, Threads, and Sections. A Thread has one immutable Agent, at most one harness session linkage per Agent, optional fork origin, and independent Project and Section membership.

`project_items` places a Thread in at most one Project. `section_items` interleaves Project and Thread entries in one ordered domain and places each entry in at most one Section. The fixed Pinned Section has stable ID `01984de2-8f74-7c91-a3b2-5c5e937cf318`.

Ordering columns are non-negative and unique in their scope. Membership moves and compaction execute transactionally so clients never observe duplicate positions.

## Canonical Timeline

`thread_timeline_epochs` stores the active epoch and next sequence for each Thread. `thread_timeline_rows` stores immutable canonical rows keyed by Thread, epoch, and sequence. Appending allocates contiguous sequence numbers in one transaction. Rehydration or history replacement creates a new epoch and atomically replaces its rows.

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

The product has not shipped. There is deliberately one baseline migration, `0000_initial.sql`, with one matching snapshot and journal entry. No old application data is detected, imported, or upgraded. Before the first release, schema changes replace this baseline.

After the first public release, migrations become append-only: never edit or delete an applied migration. Generate from the schema, review SQL, and test both empty-database creation and upgrade from the previous released schema.

```sh
pnpm --filter @cypheria/db db:generate --name=<migration-name>
pnpm --filter @cypheria/db db:check
pnpm --filter @cypheria/db db:migrate
pnpm --filter @cypheria/db test
```

Commit schema files, SQL, snapshot, and journal together.
