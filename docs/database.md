# Database Guide

Cypheria uses SQLite through Drizzle ORM and the local libSQL SQLite driver. Domain files under `packages/db/src/schema/`, re-exported by `schema/index.ts`, are the only editable schema source. Generated SQL in `packages/db/drizzle` is the only migration source; do not maintain hand-written `CREATE TABLE` statements in TypeScript.

## SQLite column conventions

SQLite stores values as `NULL`, `INTEGER`, `REAL`, `TEXT`, or `BLOB`. Drizzle modes map those storage classes to strict TypeScript values, but compile-time inference does not replace database constraints or runtime validation.

- IDs: use `text("id").primaryKey().$defaultFn(() => crypto.randomUUID())` when the persistence layer owns UUID creation. Use `integer("id", { mode: "number" }).primaryKey({ autoIncrement: true })` only when row-order numeric identity is intentional. Domain-owned IDs should be supplied explicitly.
- Booleans: use `integer("enabled", { mode: "boolean" })`; SQLite stores `0` and `1` while Drizzle exposes `boolean`.
- Time: use non-null ISO-8601 UTC `text` consistently for Cypheria records. ISO text is readable and sorts chronologically when normalized. Use `integer(..., { mode: "timestamp_ms" })` only for a domain that has measured and documented a numeric-time need. `$defaultFn()` is an application-side default and is not emitted into Drizzle Kit migrations; use a SQL default when every writer needs a database-enforced default.
- JSON: prefer `text("metadata", { mode: "json" }).$type<Metadata>()`. SQLite JSON functions operate on text JSON; Drizzle explicitly recommends text over JSON-mode BLOB. `.$type()` adds compile-time typing only, so validate untrusted and persisted values with the owning package's Zod schema. Use BLOB for actual binary data.
- Enum-like values: use `text("status", { enum: statuses })` for TypeScript inference and add a named `CHECK` constraint for database enforcement. Drizzle's `enum` option does not validate runtime values.
- Money and Web3 quantities: never use `REAL`. Fiat amounts may use integer minor units only when the currency scale is explicit and values remain in JavaScript's safe integer range. Native/token quantities should use canonical base-unit decimal `TEXT` (or an explicitly documented bigint encoding) because 256-bit values exceed SQLite and JavaScript safe integers.
- Text: use `text`; SQLite does not enforce `varchar(n)` length. Add application validation or a `CHECK` when a real limit matters.
- Constraints: add `NOT NULL`, foreign keys, unique indexes, and named `CHECK` constraints for invariants the database can enforce. Keep Zod validation at package and IPC boundaries for structural and cross-row invariants.

Use JSON columns for bounded aggregates that are normally read and written together. Promote frequently filtered, joined, independently updated, or uniqueness-constrained properties into relational columns or child tables.

## Migration workflow

Cypheria follows Drizzle's code-first `generate` then `migrate` workflow:

```sh
pnpm --filter @cypheria/db db:generate --name=<migration-name>
pnpm --filter @cypheria/db db:check
pnpm --filter @cypheria/db db:migrate
```

Because pnpm needs its global store, run these commands outside restricted sandboxes. Review generated SQL before applying or committing it. Commit the schema directory, generated SQL, snapshots, and the journal together.

`drizzle-kit migrate` reads the generated migration directory, compares it with the database migration log, applies only unapplied files, and records successful applications. Runtime and tests may call `applyDatabaseMigrations`, which uses Drizzle ORM's migrator against the same generated directory; it is not a second schema definition.

Never edit an applied migration. Change the relevant domain schema file, generate a new migration, review it, and test migration from both an empty database and the latest committed schema. Migration squashing or deletion is allowed only before any environment has applied the history, or through an explicit coordinated baseline reset.

## Current storage rules

- The default file is `$CYPHERIA_HOME/db/cypheria.sqlite`, falling back to `~/.cypheria/db/cypheria.sqlite`.
- Enable SQLite foreign keys on every connection before normal operations.
- Store timestamps as normalized ISO UTC text and high-precision Web3 quantities as decimal text.
- Keep private keys, mnemonic material, vault encryption keys, and decrypted signers out of SQLite, JSON fields, logs, and audit payloads.
- Use monotonically increasing `revision` columns for compare-and-swap updates on concurrently mutable records.

References: [SQLite column types](https://orm.drizzle.team/docs/sqlite/column-types), [`drizzle-kit generate`](https://orm.drizzle.team/docs/drizzle-kit-generate), and [`drizzle-kit migrate`](https://orm.drizzle.team/docs/sqlite/drizzle-kit-migrate).
