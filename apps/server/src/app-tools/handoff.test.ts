import { describe, expect, it } from "vitest"

import { HandoffService } from "./handoff.js"

const setup = (options: { fail?: boolean; running?: boolean } = {}) => {
  const log: string[] = []
  let running = options.running ?? false
  const service = new HandoffService({
    git: {
      handoffThread: async (_threadId, onPhase) => {
        onPhase("create-new-worktree")
        onPhase("switching-thread")
        if (options.fail) throw new Error("Another thread owns the target worktree")
        return { direction: "to-worktree", path: "/wt/a" }
      },
    },
    pause: async () => undefined,
    randomId: (() => {
      let next = 0
      return () => `id-${++next}`
    })(),
    threads: {
      cancelTurn: async (threadId) => {
        log.push(`cancel ${threadId}`)
        running = false
      },
      get: async () => ({ activeTurn: running ? {} : null, state: running ? "running" : "idle" }),
      startTurn: async (input) => {
        log.push(`start ${input.content[0]?.text}`)
      },
    },
  })
  return { log, service }
}

const settle = async (service: HandoffService, operationId: string) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const operation = await service.status(operationId)
    if (operation.status === "completed" || operation.status === "failed") return operation
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error("Handoff did not finish")
}

describe("HandoffService", () => {
  it("returns at once, then completes with the destination and sends the follow-up", async () => {
    const { log, service } = setup()
    const started = service.start({ followUpPrompt: "Continue", threadId: "t" })
    expect(started).toMatchObject({ revision: 1, status: "queued", threadId: "t" })
    expect(await settle(service, started.operationId)).toMatchObject({
      direction: "to-worktree",
      status: "completed",
      workspaceDirectory: "/wt/a",
    })
    expect(log).toEqual(["start Continue"])
  })

  it("interrupts a running thread before moving it", async () => {
    const { log, service } = setup({ running: true })
    const { operationId } = service.start({ threadId: "t" })
    expect((await settle(service, operationId)).status).toBe("completed")
    expect(log).toEqual(["cancel t"])
  })

  it("reports a failed move and skips the follow-up", async () => {
    const { log, service } = setup({ fail: true })
    const { operationId } = service.start({ followUpPrompt: "Continue", threadId: "t" })
    expect(await settle(service, operationId)).toMatchObject({
      error: "Another thread owns the target worktree",
      status: "failed",
    })
    expect(log).toEqual([])
  })

  it("wakes a waiting reader when the revision advances", async () => {
    const { service } = setup()
    const { operationId } = service.start({ threadId: "t" })
    const next = await service.status(operationId, { afterRevision: 1, waitMs: 5_000 })
    expect(next.revision).toBeGreaterThan(1)
  })

  it("refuses a second handoff of the same thread while one is running", () => {
    const { service } = setup()
    service.start({ threadId: "t" })
    expect(() => service.start({ threadId: "t" })).toThrow(/already in progress/u)
  })
})
