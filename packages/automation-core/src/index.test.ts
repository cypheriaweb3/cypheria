import { describe, expect, it } from "vitest"

import {
  type AutomationTask,
  createAutomationAuditCorrelationId,
  createQueuedAutomationRun,
  getLatestAutomationRun,
  isRunnableAutomationTask,
} from "./index.js"

const task = {
  auditCorrelationId: "automation_task_rebalance" as const,
  createdAt: "2026-05-29T00:00:00.000Z",
  id: "task_rebalance" as const,
  runHistory: [],
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
} satisfies AutomationTask

describe("automation task model", () => {
  it("describes scheduled tasks with wallet policy scope", () => {
    expect(task.trigger).toEqual({
      kind: "scheduled",
      rrule: "FREQ=HOURLY;INTERVAL=6",
      timezone: "Asia/Shanghai",
    })
    expect(task.walletPolicyScope).toEqual({
      accountIds: ["account_1"],
      chainIds: [1],
      mode: "conditional-auto-signing",
      origins: ["https://app.example"],
      policyIds: ["policy_1"],
      walletId: "wallet_1",
    })
  })

  it("creates auditable queued runs", () => {
    expect(createQueuedAutomationRun(task, "run_1", "2026-05-29T00:01:00.000Z")).toMatchObject({
      auditCorrelationId: "automation_task_rebalance_run_1",
      id: "run_1",
      status: "queued",
      taskId: "task_rebalance",
    })
  })

  it("identifies runnable enabled tasks", () => {
    expect(isRunnableAutomationTask(task)).toBe(true)
    expect(isRunnableAutomationTask({ status: "paused" })).toBe(false)
  })

  it("returns the latest run by history order", () => {
    const firstRun = createQueuedAutomationRun(task, "run_1", "2026-05-29T00:01:00.000Z")
    const secondRun = createQueuedAutomationRun(task, "run_2", "2026-05-29T00:02:00.000Z")

    expect(getLatestAutomationRun({ runHistory: [firstRun, secondRun] })).toBe(secondRun)
  })

  it("creates stable task and run correlation ids", () => {
    expect(createAutomationAuditCorrelationId("task_rebalance")).toBe("automation_task_rebalance")
    expect(createAutomationAuditCorrelationId("task_rebalance", "run_1")).toBe(
      "automation_task_rebalance_run_1"
    )
  })
})
