import { describe, expect, it, vi } from "vitest"
import { ensureCypheriaClient } from "./cypheria-client.js"
import { ThreadConversationController } from "./thread-conversation-controller.js"

vi.mock("./cypheria-client.js", () => ({ ensureCypheriaClient: vi.fn() }))

describe("ThreadConversationController", () => {
  it("reconnects after a development-mode effect remount", async () => {
    vi.mocked(ensureCypheriaClient).mockResolvedValue({
      on: () => () => undefined,
      subscribeConnectionStatus: () => () => undefined,
    } as never)
    const controller = new ThreadConversationController({ agentId: "codex" })
    const firstConnect = controller.connect()
    controller.dispose()
    await controller.connect()
    await firstConnect
    expect(controller.getSnapshot().loadState).toBe("ready")
  })

  it("creates and binds a selected worktree before the first turn", async () => {
    const createWorktree = vi.fn(async () => ({ path: "/worktrees/cypheria-task" }))
    const create = vi.fn(async () => ({
      thread: { activeTurn: null, agentId: "codex", id: "thread-1" },
      timeline: { epoch: "epoch-1" },
    }))
    const moveThreadToWorktree = vi.fn(async () => undefined)
    const get = vi.fn(async () => ({
      activeTurn: null,
      agentId: "codex",
      id: "thread-1",
      roots: ["/worktrees/cypheria-task"],
    }))
    const startTurn = vi.fn(async () => ({ thread: await get(), turnId: "turn-1" }))
    vi.mocked(ensureCypheriaClient).mockResolvedValue({
      git: {
        createWorktree,
        deleteWorktree: vi.fn(),
        moveThreadToWorktree,
      },
      on: () => () => undefined,
      subscribeConnectionStatus: () => () => undefined,
      threads: { create, delete: vi.fn(), get, startTurn },
    } as never)
    const controller = new ThreadConversationController({ agentId: "codex" })
    controller.setCreationTarget({
      projectId: "01984de2-8f74-7c91-a3b2-5c5e937cf319",
      worktree: { cwd: "/repo", startPoint: "main" },
    })
    await controller.connect()
    await controller.submit([{ text: "Start", type: "text" }], "send")

    expect(createWorktree).toHaveBeenCalledWith("/repo", "main")
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPlacement: { projectId: "01984de2-8f74-7c91-a3b2-5c5e937cf319" },
      })
    )
    expect(moveThreadToWorktree).toHaveBeenCalledWith(
      "/repo",
      "/worktrees/cypheria-task",
      "thread-1"
    )
    expect(startTurn).toHaveBeenCalledWith(expect.objectContaining({ threadId: "thread-1" }))
    expect(moveThreadToWorktree.mock.invocationCallOrder[0]).toBeLessThan(
      startTurn.mock.invocationCallOrder[0] as number
    )
  })

  it("checks out a selected local branch before creating a non-worktree thread", async () => {
    const checkout = vi.fn(async () => ({ branch: "feature" }))
    const status = vi.fn(async () => ({ branch: "main", head: "a".repeat(40) }))
    const thread = { activeTurn: null, agentId: "codex", id: "thread-1" }
    const create = vi.fn(async () => ({
      thread,
      timeline: { epoch: "epoch-1" },
    }))
    const startTurn = vi.fn(async () => ({ thread, turnId: "turn-1" }))
    vi.mocked(ensureCypheriaClient).mockResolvedValue({
      git: { checkout, status },
      on: () => () => undefined,
      subscribeConnectionStatus: () => () => undefined,
      threads: { create, startTurn },
    } as never)
    const controller = new ThreadConversationController({ agentId: "codex" })
    controller.setCreationTarget({
      checkout: { cwd: "/repo", target: "feature" },
      projectId: "01984de2-8f74-7c91-a3b2-5c5e937cf319",
    })
    await controller.connect()
    await controller.submit([{ text: "Start", type: "text" }], "send")

    expect(checkout).toHaveBeenCalledWith("/repo", "feature", false)
    expect(checkout.mock.invocationCallOrder[0]).toBeLessThan(
      create.mock.invocationCallOrder[0] as number
    )
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(
      startTurn.mock.invocationCallOrder[0] as number
    )
  })

  it("restores the previous branch when thread creation fails after checkout", async () => {
    const checkout = vi.fn(async () => ({ branch: "feature" }))
    const status = vi.fn(async () => ({ branch: "main", head: "a".repeat(40) }))
    vi.mocked(ensureCypheriaClient).mockResolvedValue({
      git: { checkout, status },
      on: () => () => undefined,
      subscribeConnectionStatus: () => () => undefined,
      threads: { create: vi.fn(async () => Promise.reject(new Error("create failed"))) },
    } as never)
    const controller = new ThreadConversationController({ agentId: "codex" })
    controller.setCreationTarget({
      checkout: { cwd: "/repo", target: "feature" },
      projectId: "01984de2-8f74-7c91-a3b2-5c5e937cf319",
    })
    await controller.connect()

    await expect(controller.submit([{ text: "Start", type: "text" }], "send")).rejects.toThrow(
      "create failed"
    )
    expect(checkout).toHaveBeenNthCalledWith(1, "/repo", "feature", false)
    expect(checkout).toHaveBeenNthCalledWith(2, "/repo", "main", false)
  })
})
