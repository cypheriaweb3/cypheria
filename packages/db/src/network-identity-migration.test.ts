import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { createInMemoryDatabase } from "./client.js"

const migrationPath = (index: number, name: string): string =>
  fileURLToPath(
    new URL(`../drizzle/${String(index).padStart(4, "0")}_${name}.sql`, import.meta.url)
  )

const migrations = [
  "initial",
  "moaning_agent_brand",
  "pale_lord_tyger",
  "typed_columns",
  "nappy_shape",
  "faithful_old_lace",
  "clean_phantom_reporter",
] as const

describe("canonical network identity migration", () => {
  it("preserves durable records, converts legacy chain scopes, and clears ephemeral selection", async () => {
    const database = createInMemoryDatabase()
    for (const [index, name] of migrations.entries()) {
      await database.client.executeMultiple(await readFile(migrationPath(index, name), "utf8"))
    }

    const timestamp = "2026-09-01T00:00:00.000Z"
    await database.client.batch(
      [
        {
          sql: "INSERT INTO wallets (id,name,kind,fingerprint,metadata,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
          args: [
            "wallet_migration",
            "Migration",
            "watch",
            `sha256:${"1".repeat(64)}`,
            "{}",
            "ready",
            timestamp,
            timestamp,
          ],
        },
        {
          sql: "INSERT INTO wallet_accounts (id,wallet_id,account_index,name,fingerprint,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
          args: [
            "account_migration",
            "wallet_migration",
            0,
            "Account",
            `sha256:${"2".repeat(64)}`,
            timestamp,
            timestamp,
          ],
        },
        {
          sql: "INSERT INTO chain_accounts (id,wallet_account_id,namespace,chain_id,address,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
          args: [
            "chain_account_migration",
            "account_migration",
            "eip155",
            1,
            "0x0000000000000000000000000000000000000001",
            timestamp,
            timestamp,
          ],
        },
        {
          sql: "INSERT INTO dapp_origins (origin,session_key,partition,created_at) VALUES (?,?,?,?)",
          args: [
            "https://app.example",
            "cypheria:dapp:https://app.example",
            "persist:cypheria:dapp:https://app.example",
            timestamp,
          ],
        },
        {
          sql: "INSERT INTO dapp_permissions (id,origin,session_key,wallet_id,chain_id,account_addresses,methods,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
          args: [
            "dapp_permission_migration",
            "https://app.example",
            "cypheria:dapp:https://app.example",
            "wallet_migration",
            1,
            '["0x0000000000000000000000000000000000000001"]',
            '["eth_accounts"]',
            timestamp,
            timestamp,
          ],
        },
        {
          sql: "INSERT INTO signing_policies (id,wallet_id,chain_ids,methods,origins,effect,require_human_approval,enabled,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          args: [
            "policy_migration",
            "wallet_migration",
            '[1,"solana:mainnet"]',
            '["personal_sign"]',
            '["*"]',
            "allow",
            0,
            1,
            1,
            timestamp,
            timestamp,
          ],
        },
        {
          sql: "INSERT INTO automation_tasks (id,workspace,title,trigger,definition,wallet_policy_scope,run_history,status,revision,audit_correlation_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          args: [
            "task_migration",
            '{"id":"workspace","path":"/tmp"}',
            "Migration",
            '{"kind":"manual","requestedBy":"user"}',
            '{"handler":"noop"}',
            '{"accountIds":[],"chainIds":[1],"mode":"read-only"}',
            "[]",
            "draft",
            1,
            "automation_task_migration",
            timestamp,
            timestamp,
          ],
        },
        {
          sql: "INSERT INTO active_wallet_context (id,wallet_id,wallet_account_id,chain_account_id,mode,updated_at) VALUES (?,?,?,?,?,?)",
          args: [
            "default",
            "wallet_migration",
            "account_migration",
            "chain_account_migration",
            "read-only",
            timestamp,
          ],
        },
      ],
      "write"
    )

    await database.client.executeMultiple(
      await readFile(migrationPath(7, "omniscient_magma"), "utf8")
    )

    const chain = await database.client.execute(
      "SELECT namespace, reference FROM chain_accounts WHERE id = 'chain_account_migration'"
    )
    expect(chain.rows[0]).toMatchObject({ namespace: "eip155", reference: "1" })
    const permission = await database.client.execute(
      "SELECT chain_key FROM dapp_permissions WHERE id = 'dapp_permission_migration'"
    )
    expect(permission.rows[0]?.chain_key).toBe("eip155:1")
    const policy = await database.client.execute(
      "SELECT chain_keys FROM signing_policies WHERE id = 'policy_migration'"
    )
    expect(JSON.parse(String(policy.rows[0]?.chain_keys))).toEqual(["eip155:1", "solana:mainnet"])
    const automation = await database.client.execute(
      "SELECT wallet_policy_scope FROM automation_tasks WHERE id = 'task_migration'"
    )
    expect(JSON.parse(String(automation.rows[0]?.wallet_policy_scope))).toMatchObject({
      accountIds: [],
      chainKeys: ["eip155:1"],
      mode: "read-only",
    })
    const active = await database.client.execute(
      "SELECT count(*) AS count FROM active_wallet_context"
    )
    expect(Number(active.rows[0]?.count)).toBe(0)
    await expect(database.client.execute("PRAGMA foreign_key_check")).resolves.toMatchObject({
      rows: [],
    })
    database.close()
  })
})
