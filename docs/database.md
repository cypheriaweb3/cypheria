# Database Guide

Cypheria uses SQLite through Drizzle ORM and the local libSQL SQLite driver. Domain files under `packages/db/src/schema/`, re-exported by `schema/index.ts`, are the only editable schema source. Generated SQL in `packages/db/drizzle` is the only migration source; do not maintain hand-written `CREATE TABLE` statements in TypeScript.

## SQLite column conventions

SQLite stores values as `NULL`, `INTEGER`, `REAL`, `TEXT`, or `BLOB`. Drizzle modes map those storage classes to strict TypeScript values, but compile-time inference does not replace database constraints or runtime validation.

- IDs: use `text("id").primaryKey().$defaultFn(() => crypto.randomUUID())` when the persistence layer owns UUID creation. Use `integer("id", { mode: "number" }).primaryKey({ autoIncrement: true })` only when row-order numeric identity is intentional. Domain-owned IDs should be supplied explicitly.
- Booleans: use `integer("enabled", { mode: "boolean" })`; SQLite stores `0` and `1` while Drizzle exposes `boolean`.
- Time: use non-null ISO-8601 UTC `text` consistently for Cypheria records unless a domain documents a numeric-time exception. ISO text is readable and sorts chronologically when normalized. The project/thread/section tables below are one such exception: all of their timestamps are Unix timestamps in seconds stored as `INTEGER` so recency values and ordered-list records can be compared directly. `$defaultFn()` is an application-side default and is not emitted into Drizzle Kit migrations; use a SQL default when every writer needs a database-enforced default.
- JSON: prefer `text("metadata", { mode: "json" }).$type<Metadata>()`. SQLite JSON functions operate on text JSON; Drizzle explicitly recommends text over JSON-mode BLOB. `.$type()` adds compile-time typing only, so validate untrusted and persisted values with the owning package's Zod schema. Use BLOB for actual binary data.
- Enum-like values: use `text("status", { enum: statuses })` for TypeScript inference and add a named `CHECK` constraint for database enforcement. Drizzle's `enum` option does not validate runtime values.
- Money and Web3 quantities: never use `REAL`. Fiat amounts may use integer minor units only when the currency scale is explicit and values remain in JavaScript's safe integer range. Native/token quantities should use canonical base-unit decimal `TEXT` (or an explicitly documented bigint encoding) because 256-bit values exceed SQLite and JavaScript safe integers.
- Text: use `text`; SQLite does not enforce `varchar(n)` length. Add application validation or a `CHECK` when a real limit matters.
- Constraints: add `NOT NULL`, foreign keys, unique indexes, and named `CHECK` constraints for invariants the database can enforce. Keep Zod validation at package and IPC boundaries for structural and cross-row invariants.

Use JSON columns for bounded aggregates that are normally read and written together. Promote frequently filtered, joined, independently updated, or uniqueness-constrained properties into relational columns or child tables.

## Project, thread, and section storage

Cypheria owns its cross-agent projects, threads, project membership, sections, and section membership. The model uses five tables: `projects`, `threads`, `project_items`, `sections`, and `section_items`. Project membership and section membership are independent: a thread may belong to one project and also appear directly in one section, including the pinned section.

All timestamps in these five tables are Unix timestamps in seconds stored as SQLite `INTEGER`. Project, thread, and section IDs are Cypheria-owned UUIDv7 values validated at the package boundary. The pinned section has the fixed UUIDv7 `01984de2-8f74-7c91-a3b2-5c5e937cf318`. Drizzle and service properties use camel case (`recencyAt`, `forkedFromId`, `agentSessionId`, `createdAt`, and `updatedAt`) while physical SQLite columns follow the existing snake-case convention shown below.

### `projects`

| Column | Storage | Nullability | Meaning |
| --- | --- | --- | --- |
| `id` | `TEXT` | not null, primary key | Cypheria UUIDv7 project identity. |
| `name` | `TEXT` | not null | User-visible project name. |
| `roots` | `TEXT` JSON | not null | Ordered, non-empty array of normalized absolute paths; the first root is the default. |
| `position` | `INTEGER` | not null | Position in the global projects list. |
| `recency_at` | `INTEGER` | nullable | Newest member thread's recency; null when none exist. |
| `created_at` | `INTEGER` | not null | Creation time in Unix seconds. |
| `updated_at` | `INTEGER` | not null | Last persisted project-row change in Unix seconds. |

`position` is non-negative and unique. `recency_at` is a materialized value equivalent to `MAX(threads.recency_at)` across this project's `project_items`; if that set has no non-null recency, it is null.

### `threads`

| Column | Storage | Nullability | Meaning |
| --- | --- | --- | --- |
| `id` | `TEXT` | not null, primary key | Cypheria UUIDv7 thread identity. |
| `agent_id` | `TEXT` | not null | Immutable foreign key to `agent_registry.id`. |
| `agent_session_id` | `TEXT` | nullable | The bound agent's own session/thread identity. |
| `forked_from_id` | `TEXT` | nullable | Source Cypheria thread when this thread was forked. |
| `title` | `TEXT` | nullable | User-visible or generated title. |
| `cwd` | `TEXT` | nullable | Working directory captured for the thread. |
| `position` | `INTEGER` | not null | Position in the global threads list. |
| `recency_at` | `INTEGER` | nullable | Latest meaningful thread activity in Unix seconds. |
| `created_at` | `INTEGER` | not null | Creation time in Unix seconds. |
| `updated_at` | `INTEGER` | not null | Last persisted thread-row change in Unix seconds. |

`agent_id` references `agent_registry.id` with `ON DELETE RESTRICT`. `forked_from_id` references `threads.id` with `ON DELETE SET NULL`. `position` is non-negative and unique. A partial unique index on `(agent_id, agent_session_id)` where `agent_session_id IS NOT NULL` prevents two Cypheria threads from claiming the same agent session. Index `forked_from_id` for fork lookup.

`agent_session_id` may be null and stores read-only provider metadata bound by `ThreadManager`; public operations never route by it. `recency_at` may also be null.

### `project_items`

| Column | Storage | Nullability | Meaning |
| --- | --- | --- | --- |
| `project_id` | `TEXT` | not null | Foreign key to `projects.id`. |
| `thread_id` | `TEXT` | not null | Foreign key to `threads.id`. |
| `position` | `INTEGER` | not null | Thread position inside this project. |
| `created_at` | `INTEGER` | not null | Time the thread entered this project, in Unix seconds. |
| `updated_at` | `INTEGER` | not null | Last membership or position change in Unix seconds. |

The primary key is `(project_id, thread_id)`. Both foreign keys use `ON DELETE CASCADE`. `thread_id` is unique, so a thread belongs to at most one project. `(project_id, position)` is unique and `position` is non-negative.

### `sections`

| Column | Storage | Nullability | Meaning |
| --- | --- | --- | --- |
| `id` | `TEXT` | not null, primary key | Cypheria UUIDv7 section identity. |
| `name` | `TEXT` | not null | User-visible section name. |
| `icon` | `TEXT` | nullable | Optional synchronized icon. |
| `color` | `TEXT` | nullable | Optional synchronized color. |
| `position` | `INTEGER` | not null | Position in the global sections list. |
| `created_at` | `INTEGER` | not null | Creation time in Unix seconds. |
| `updated_at` | `INTEGER` | not null | Last persisted section-row change in Unix seconds. |

`position` is non-negative and unique. The pinned section row has ID `01984de2-8f74-7c91-a3b2-5c5e937cf318` and position zero.

### `section_items`

| Column | Storage | Nullability | Meaning |
| --- | --- | --- | --- |
| `id` | `INTEGER` | not null, autoincrement primary key | Internal association-row identity. |
| `section_id` | `TEXT` | not null | Foreign key to `sections.id`. |
| `item_type` | `TEXT` | not null | Either `thread` or `project`. |
| `thread_id` | `TEXT` | nullable | Foreign key to `threads.id` for a thread item. |
| `project_id` | `TEXT` | nullable | Foreign key to `projects.id` for a project item. |
| `position` | `INTEGER` | not null | Unified thread/project position inside this section. |
| `created_at` | `INTEGER` | not null | Time the item entered this section, in Unix seconds. |
| `updated_at` | `INTEGER` | not null | Last membership or position change in Unix seconds. |

A named check constraint requires exactly one target and requires it to match `item_type`: `thread` requires non-null `thread_id` and null `project_id`; `project` requires non-null `project_id` and null `thread_id`. All three foreign keys use `ON DELETE CASCADE`. Partial unique indexes on non-null `thread_id` and non-null `project_id` place each entity in at most one section. `(section_id, position)` is unique and `position` is non-negative.

Threads and projects share one position domain, so they can be interleaved exactly.

### Position domains

The five position domains are independent:

| Position | Scope |
| --- | --- |
| `projects.position` | All projects. |
| `threads.position` | All threads. |
| `project_items.position` | Threads within one project. |
| `sections.position` | All sections. |
| `section_items.position` | Threads and projects within one section. |

Higher-level mutation and ordering behavior is specified separately in [Project, Thread, and Section Operations](project-thread.md).

## Canonical timeline storage

`thread_timeline_epochs` stores the current epoch, next sequence number, and update time for each Thread. `thread_timeline_rows` stores immutable canonical items keyed by `(thread_id, epoch, seq)`, plus the provider item ID, turn ID, and event timestamp. Both tables cascade from the owning Thread. Appends allocate and insert a contiguous sequence in one transaction; history hydration atomically replaces the epoch and its rows. Persisted item JSON is validated with `ThreadTimelineRowSchema` when it crosses back into the Server timeline domain.

## Migration workflow

Cypheria follows Drizzle's code-first `generate` then `migrate` workflow:

```sh
pnpm --filter @cypheria/db db:generate --name=<migration-name>
pnpm --filter @cypheria/db db:check
pnpm --filter @cypheria/db db:migrate
```

Because pnpm needs its global store, run these commands outside restricted sandboxes. Review generated SQL before applying or committing it. Commit the schema directory, generated SQL, snapshots, and the journal together.

The product has not shipped, so the current history is intentionally one clean `0000_initial.sql` plus its matching snapshot and journal. No old Cypheria data directory is detected, imported, or upgraded. Until the first release, schema changes regenerate this baseline; after release, migrations become append-only.

`drizzle-kit migrate` reads the generated migration directory, compares it with the database migration log, applies only unapplied files, and records successful applications. Runtime and tests may call `applyDatabaseMigrations`, which uses Drizzle ORM's migrator against the same generated directory; it is not a second schema definition.

Never edit an applied migration. Change the relevant domain schema file, generate a new migration, review it, and test migration from both an empty database and the latest committed schema. Migration squashing or deletion is allowed only before any environment has applied the history, or through an explicit coordinated baseline reset.

## Current storage rules

- The default file is `$CYPHERIA_HOME/db/cypheria.sqlite`, falling back to `~/.cypheria/db/cypheria.sqlite`.
- Enable SQLite foreign keys on every connection before normal operations.
- Store timestamps as normalized ISO UTC text unless the owning domain documents another representation. The five project/thread/section tables above use Unix seconds. Store high-precision Web3 quantities as decimal text.
- Keep private keys, mnemonic material, vault encryption keys, and decrypted signers out of SQLite, JSON fields, logs, and audit payloads.
- Use monotonically increasing `revision` columns for compare-and-swap updates on concurrently mutable records.

References: [SQLite column types](https://orm.drizzle.team/docs/sqlite/column-types), [`drizzle-kit generate`](https://orm.drizzle.team/docs/drizzle-kit-generate), and [`drizzle-kit migrate`](https://orm.drizzle.team/docs/sqlite/drizzle-kit-migrate).
