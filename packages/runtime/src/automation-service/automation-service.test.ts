import {
  applyDatabaseMigrations,
  createAuditLogService,
  createAutomationPersistenceService,
  createInMemoryDatabase,
  type SigningIntentRecord,
} from "@cypheria/db"
import { describe, expect, it, vi } from "vitest"

import { CypheriaRuntime } from "../index.js"
import { createAutomationRuntimeService } from "./service.js"

const createHarness = async (
  options: {
    executors?: Parameters<typeof createAutomationRuntimeService>[0]["executors"]
    agentRunner?: Parameters<typeof createAutomationRuntimeService>[0]["agentRunner"]
    signingIntents?: Parameters<typeof createAutomationRuntimeService>[0]["signingIntents"]
  } = {}
) => {
  const database = createInMemoryDatabase()
  await applyDatabaseMigrations(database.client)
  let tick = 0
  const service = createAutomationRuntimeService({
    ...options,
    audit: createAuditLogService(database.db),
    idFactory: {
      runId: () => `run_${++tick}`,
      taskId: () => `task_${++tick}`,
    },
    now: () => new Date(Date.UTC(2026, 8, 1, 0, 0, tick++)).toISOString(),
    persistence: createAutomationPersistenceService(database.db),
  })
  const runtime = new CypheriaRuntime({ ensureDirectories: false, services: [service] })
  await runtime.start()
  return { database, runtime, service }
}

const taskInput = {
  definition: { handler: "noop" },
  status: "draft" as const,
  title: "Manual task",
  trigger: { kind: "manual" as const, requestedBy: "user" as const },
  walletPolicyScope: { accountIds: [], chainIds: [1], mode: "read-only" as const },
  workspace: { id: "workspace_test", path: "/tmp/cypheria" },
}

describe("automation runtime service", () => {
  it("creates, lists, resumes, runs, inspects, and pauses tasks through runtime", async () => {
    const { database, runtime } = await createHarness()
    const created = (await runtime.request("automation.task.create", taskInput)) as {
      id: string
      revision: number
    }
    expect(created).toMatchObject({ revision: 1, status: "draft" })
    await expect(runtime.request("automation.task.list", {})).resolves.toHaveLength(1)

    const enabled = (await runtime.request("automation.task.resume", {
      expectedRevision: 1,
      taskId: created.id,
    })) as { revision: number; status: string }
    expect(enabled).toMatchObject({ revision: 2, status: "enabled" })
    const run = (await runtime.request("automation.run.start", { taskId: created.id })) as {
      id: string
      status: string
    }
    expect(run.status).toBe("succeeded")
    await expect(runtime.request("automation.run.get", { runId: run.id })).resolves.toEqual(run)
    await expect(
      runtime.request("automation.task.get", { taskId: created.id })
    ).resolves.toMatchObject({ runs: [{ id: run.id }], task: { id: created.id } })

    await expect(
      runtime.request("automation.task.pause", { expectedRevision: 2, taskId: created.id })
    ).resolves.toMatchObject({ revision: 3, status: "paused" })
    await expect(runtime.request("automation.run.start", { taskId: created.id })).rejects.toThrow(
      "Runtime request failed"
    )

    await runtime.stop()
    database.close()
  })

  it("offers agent and policy-bound signing-intent capabilities to executors", async () => {
    const agentRunner = vi.fn(async () => ({ threadId: "thread_test" }))
    const createIntent = vi.fn(async (input) => ({ input }) as unknown as SigningIntentRecord)
    const { database, service } = await createHarness({
      agentRunner,
      executors: {
        controlled: async ({ capabilities }) => {
          await capabilities.runAgent({ prompt: "Inspect the position" })
          await capabilities.createSigningIntent({
            intent: {
              account: {
                address: "0x1111111111111111111111111111111111111111",
                chainAccountId: "chain_account_1",
                chainId: 1,
                walletAccountId: "account_1",
                walletId: "wallet_1",
              },
              correlationId: "executor-cannot-control-this",
              kind: "personal-sign",
              message: "confirm",
            },
          })
          return { logs: [] }
        },
      },
      signingIntents: { create: createIntent },
    })
    const task = await service.createTask({
      ...taskInput,
      definition: { handler: "controlled" },
      status: "enabled",
      walletPolicyScope: {
        accountIds: ["account_1"],
        chainIds: [1],
        mode: "human-approval",
        policyIds: ["policy_selected"],
        walletId: "wallet_1",
      },
    })
    const run = await service.runTask(task.id)

    expect(run.status).toBe("succeeded")
    expect(agentRunner).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Inspect the position", workspace: task.workspace })
    )
    expect(createIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: expect.objectContaining({ correlationId: run.auditCorrelationId }),
        mode: "human-approval",
        policyIds: ["policy_selected"],
        source: "automation",
      })
    )
    database.close()
  })

  it("fails a run when an executor exceeds its signing scope", async () => {
    const createIntent = vi.fn()
    const { database, service } = await createHarness({
      executors: {
        signing: async ({ capabilities }) => {
          await capabilities.createSigningIntent({
            intent: {
              account: {
                address: "0x1111111111111111111111111111111111111111",
                chainAccountId: "chain_account_1",
                chainId: 1,
                walletAccountId: "account_1",
                walletId: "wallet_1",
              },
              correlationId: "ignored",
              kind: "personal-sign",
              message: "confirm",
            },
          })
          return { logs: [] }
        },
      },
      signingIntents: { create: createIntent },
    })
    const task = await service.createTask({
      ...taskInput,
      definition: { handler: "signing" },
      status: "enabled",
    })
    const run = await service.runTask(task.id)

    expect(run).toMatchObject({ error: { code: "SIGNING_FORBIDDEN" }, status: "failed" })
    expect(createIntent).not.toHaveBeenCalled()
    database.close()
  })

  it("prevents overlapping runs and cancels active work during shutdown", async () => {
    let markEntered: (() => void) | undefined
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve
    })
    const { database, runtime, service } = await createHarness({
      executors: {
        waiting: ({ signal }) =>
          new Promise((resolve) => {
            markEntered?.()
            signal.addEventListener("abort", () => resolve({ logs: [] }), { once: true })
          }),
      },
    })
    const task = await service.createTask({
      ...taskInput,
      definition: { handler: "waiting" },
      status: "enabled",
    })
    const firstRun = service.runTask(task.id)
    await entered
    await expect(service.runTask(task.id)).rejects.toMatchObject({ code: "ACTIVE_RUN_EXISTS" })

    await runtime.stop()
    await expect(firstRun).resolves.toMatchObject({ status: "cancelled" })
    database.close()
  })
})
