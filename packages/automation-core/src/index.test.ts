import { describe, expect, it } from "vitest"

import {
  type AutomationTask,
  automationTaskSchema,
  canTransitionAutomationRun,
  canTransitionAutomationTask,
  createAutomationAuditCorrelationId,
  createQueuedAutomationRun,
  getLatestAutomationRun,
  isRunnableAutomationTask,
} from "./index.js"

const task = automationTaskSchema.parse({
  auditCorrelationId: "automation_task_rebalance",
  createdAt: "2026-05-29T00:00:00.000Z",
  definition: { handler: "portfolio.rebalance", input: { threshold: 0.1 } },
  id: "task_rebalance",
  revision: 1,
  status: "enabled",
  title: "Rebalance vault",
  trigger: {
    kind: "scheduled",
    rrule: "FREQ=HOURLY;INTERVAL=6",
    timezone: "Asia/Shanghai",
  },
  updatedAt: "2026-05-29T00:00:00.000Z",
  walletPolicyScope: {
    accountIds: ["account_1"],
    chainIds: [1],
    mode: "conditional-auto-signing",
    origins: ["https://app.example"],
    policyIds: ["policy_1"],
    walletId: "wallet_1",
  },
  workspace: {
    id: "workspace_1",
    label: "Main workspace",
    path: "/Users/example/Code/cypheria",
  },
}) as AutomationTask

describe("automation task model", () => {
  it("validates persisted definitions and rejects non-JSON input", () => {
    expect(task.definition).toEqual({
      handler: "portfolio.rebalance",
      input: { threshold: 0.1 },
    })
    expect(() =>
      automationTaskSchema.parse({
        ...task,
        definition: { handler: "bad handler", input: { amount: 1n } },
      })
    ).toThrow()
    expect(() =>
      automationTaskSchema.parse({
        ...task,
        definition: { handler: "noop", input: { nested: { privateKey: "secret" } } },
      })
    ).toThrow()
    expect(() =>
      automationTaskSchema.parse({
        ...task,
        walletPolicyScope: {
          accountIds: [],
          chainIds: [],
          mode: "conditional-auto-signing",
        },
      })
    ).toThrow()
  })

  it("creates validated auditable queued runs", () => {
    const run = createQueuedAutomationRun(task, "run_1", "2026-05-29T00:01:00.000Z")
    expect(run).toMatchObject({
      auditCorrelationId: "automation_task_rebalance_run_1",
      id: "run_1",
      queuedAt: "2026-05-29T00:01:00.000Z",
      revision: 1,
      status: "queued",
      taskId: "task_rebalance",
    })
  })

  it("defines strict task and run state transitions", () => {
    expect(isRunnableAutomationTask(task)).toBe(true)
    expect(canTransitionAutomationTask("enabled", "paused")).toBe(true)
    expect(canTransitionAutomationTask("paused", "draft")).toBe(false)
    expect(canTransitionAutomationRun("queued", "running")).toBe(true)
    expect(canTransitionAutomationRun("running", "queued")).toBe(false)
  })

  it("returns the latest run by supplied history order", () => {
    const first = createQueuedAutomationRun(task, "run_1", "2026-05-29T00:01:00.000Z")
    const second = createQueuedAutomationRun(task, "run_2", "2026-05-29T00:02:00.000Z")
    expect(getLatestAutomationRun([first, second])).toBe(second)
  })

  it("creates stable task and run correlation ids", () => {
    expect(createAutomationAuditCorrelationId("task_rebalance")).toBe("automation_task_rebalance")
    expect(createAutomationAuditCorrelationId("task_rebalance", "run_1")).toBe(
      "automation_task_rebalance_run_1"
    )
  })
})
