import { describe, expect, it } from "vitest"

import { CODEX_APP_TOOL_NAMES } from "../agent/codex-developer-instructions.js"
import { AppToolService, type AppToolThread, reorderWithinSlots } from "./service.js"

const PINNED_ID = "pinned-section-id"

const thread = (id: string, patch: Partial<AppToolThread> = {}): AppToolThread => ({
  activeTurn: null,
  agentId: "codex",
  archivedAt: null,
  attention: false,
  createdAt: 1,
  id,
  pendingInteractions: [],
  recencyAt: 10,
  roots: ["/work/a"],
  state: "idle",
  title: `Thread ${id}`,
  updatedAt: 1,
  ...patch,
})

const harness = (threads: AppToolThread[] = []) => {
  const archived: string[] = []
  const handoffs: { followUpPrompt?: string; threadId: string }[] = []
  const attached: {
    attachmentType: "pull_request" | "worktree"
    createdAt: number
    identityKey: string
    payload: unknown
  }[] = [
    { attachmentType: "worktree", createdAt: 5, identityKey: "w1", payload: { worktreeId: "w1" } },
    { attachmentType: "worktree", createdAt: 6, identityKey: "w2", payload: { worktreeId: "w2" } },
  ]
  const trees = [
    {
      active: true,
      branch: null,
      head: "abc",
      id: "w1",
      managed: true,
      ownerThreadId: null,
      path: "/wt/w1",
    },
    {
      active: false,
      branch: null,
      head: "def",
      id: "w2",
      managed: true,
      ownerThreadId: null,
      path: "/wt/w2",
    },
    {
      active: true,
      branch: null,
      head: "abc",
      id: "w3",
      managed: true,
      ownerThreadId: null,
      path: "/wt/w3",
    },
  ]
  const [firstTree, secondTree] = [
    trees[0] as (typeof trees)[number],
    trees[1] as (typeof trees)[number],
  ]
  const started: { attachToThreadId: string; cwd: string; startPoint: string }[] = []
  let phase: "queued" | "creating" | "ready" = "creating"
  const requests: { payload: Record<string, unknown>; type: string }[] = []
  const turns: unknown[] = []
  const created: unknown[] = []
  const store = new Map(threads.map((entry) => [entry.id, entry]))
  const service = new AppToolService({
    automations: { call: async (args) => ({ echoed: args.mode }) },
    attachments: {
      attachPullRequest: async (_threadId, url) => {
        const entry = {
          attachmentType: "pull_request" as const,
          createdAt: 7,
          identityKey: `pr:${url}`,
          payload: { url },
        }
        attached.push(entry)
        return entry
      },
      detachPullRequest: async () => true,
      list: async () => attached,
    },
    defaultAgentId: "codex",
    handoff: {
      start: (input) => {
        handoffs.push(input)
        return { operationId: "op", revision: 1, status: "queued", threadId: input.threadId }
      },
      status: async (operationId) => ({
        operationId,
        revision: 2,
        status: "completed",
        threadId: "x",
      }),
    },
    isGitRepository: async (root) => root === "/repo",
    pinnedSectionId: PINNED_ID,
    projectThread: async (type, payload) => {
      requests.push({ payload: payload as Record<string, unknown>, type })
      switch (type) {
        case "project.list.request":
          return {
            data: [
              { id: "p1", name: "One", roots: ["/repo"] },
              { id: "p2", name: "Two", roots: ["/other"] },
              { id: "p3", name: "Three", roots: ["/third"] },
            ],
            nextCursor: null,
          }
        case "project.membership.list.request":
          return { data: [{ projectId: "p1", threadId: "t1" }], nextCursor: null }
        case "section.list.request":
          return {
            data: [
              { id: PINNED_ID, name: "Pinned" },
              { id: "s1", name: "Review" },
            ],
            nextCursor: null,
          }
        case "section.membership.list.request":
          return {
            data: [
              { item: { id: "t2", type: "thread" }, sectionId: PINNED_ID },
              { item: { id: "t3", type: "thread" }, sectionId: "s1" },
            ],
            nextCursor: null,
          }
        case "section.read.request":
          return { id: (payload as { sectionId: string }).sectionId, name: "x" }
        case "section.create.request":
          return { id: "s2", name: (payload as { name: string }).name }
        default:
          return {}
      }
    },
    randomId: () => "message-id",
    threads: {
      archive: async () => ({}),
      create: async (input) => {
        created.push(input)
        const next = thread("new")
        store.set(next.id, next)
        return { thread: next }
      },
      fork: async () => ({ thread: thread("fork") }),
      get: async (id) => {
        const found = store.get(id)
        if (!found) throw new Error("Thread was not found")
        return found
      },
      getTimeline: async () => ({
        epoch: "epoch",
        hasOlder: false,
        projectedItems: [
          {
            item: { role: "user", text: "hi", type: "message" },
            seqEnd: 1,
            seqStart: 1,
            turnId: "a",
          },
          {
            item: { role: "assistant", text: "hello", type: "message" },
            seqEnd: 2,
            seqStart: 2,
            turnId: "a",
          },
          {
            item: { command: "ls", output: "x".repeat(50), status: "completed", type: "command" },
            seqEnd: 3,
            seqStart: 3,
            turnId: "b",
          },
        ],
      }),
      list: async () => ({
        data: [...store.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
        nextCursor: null,
      }),
      startTurn: async (input) => {
        turns.push(input)
        return {}
      },
      steerTurn: async () => ({}),
      unarchive: async () => ({}),
      update: async () => ({}),
      updateConfig: async () => ({}),
    },
    wait: async () => {
      phase = "ready"
    },
    worktrees: {
      archive: async (_cwd, path) => {
        archived.push(path)
      },
      defaultBranch: async () => "origin/main",
      job: (id) => ({
        error: null,
        id,
        log: "Receiving objects",
        path: phase === "ready" ? "/wt/new" : null,
        phase,
        worktree: phase === "ready" ? { ...firstTree, id: "new", path: "/wt/new" } : null,
      }),
      list: async () => trees,
      resolveRef: async (_cwd, ref) => `refs/remotes/${ref}`,
      restore: async (_cwd, path) => ({ ...secondTree, active: true, path }),
      start: async (input) => {
        started.push(input)
        return { error: null, id: "job", log: "", path: null, phase: "queued", worktree: null }
      },
    },
  })
  const call = async (tool: string, args: unknown, threadId = "caller") => {
    const result = await service.call(
      {
        arguments: args,
        callId: "c",
        namespace: null,
        threadId: "codex",
        tool,
        turnId: "t",
      } as never,
      { threadId }
    )
    const first = result.contentItems[0]
    return {
      success: result.success,
      value: first?.type === "inputText" ? first.text : "",
    }
  }
  return { archived, attached, handoffs, call, created, requests, started, store, turns }
}

describe("reorderWithinSlots", () => {
  it("refills the slots of the listed ids and leaves the others in place", () => {
    expect(reorderWithinSlots(["a", "x", "b", "y", "c"], ["c", "a", "b"])).toEqual([
      "c",
      "x",
      "a",
      "y",
      "b",
    ])
  })
})

describe("app tool specs", () => {
  it("expose only names the developer instructions know and nothing about ChatGPT", () => {
    const names = [...AppToolService.toolNames]
    const unnamed = new Set([
      "attach_artifact",
      "get_handoff_status",
      "get_worktree_creation_status",
      "remove_artifact",
      "reorder_section",
    ])
    for (const name of names) {
      if (!unnamed.has(name)) expect(CODEX_APP_TOOL_NAMES as readonly string[]).toContain(name)
    }
    expect(names).not.toContain("set_thread_pinned")
    expect(JSON.stringify(AppToolService.specs)).not.toMatch(/ChatGPT|hostId/u)
  })

  it("defers every tool to tool search except list_artifacts", () => {
    for (const spec of AppToolService.specs) {
      const deferred = spec.type === "function" && spec.deferLoading === true
      expect(deferred).toBe(spec.type === "function" && spec.name !== "list_artifacts")
    }
  })
})

describe("AppToolService", () => {
  it("lists projects with their Git status", async () => {
    const { call } = harness()
    const { value } = await call("list_projects", {})
    expect(JSON.parse(value).projects[0]).toMatchObject({ isGitRepository: true, projectId: "p1" })
    expect(JSON.parse(value).projects[1]).toMatchObject({ isGitRepository: false })
  })

  it("lists pinned threads first with a one-based index, then recent threads with their section", async () => {
    const { call } = harness([thread("t1"), thread("t2"), thread("t3")])
    const listed = JSON.parse((await call("list_threads", {})).value)
    expect(listed.pinnedThreads).toEqual([
      expect.objectContaining({ pinnedIndex: 1, sectionId: "pinned", threadId: "t2" }),
    ])
    expect(listed.threads.map((entry: { threadId: string }) => entry.threadId)).toEqual([
      "t1",
      "t3",
    ])
    expect(listed.threads[0]).toMatchObject({ projectId: "p1" })
    expect(listed.threads[1]).toMatchObject({ sectionId: "s1" })
    expect(listed.sections).toEqual([
      { name: "Review", projectIds: [], sectionId: "s1", threadIds: ["t3"] },
    ])
  })

  it("starts a project thread with the prompt and the requested model", async () => {
    const { call, created, turns } = harness()
    const { success, value } = await call("create_thread", {
      model: "gpt-x",
      prompt: "Do it",
      target: { environment: { type: "local" }, projectId: "p1", type: "project" },
    })
    expect(success).toBe(true)
    expect(JSON.parse(value).threadId).toBe("new")
    expect(created[0]).toMatchObject({ agentId: "codex", projectPlacement: { projectId: "p1" } })
    expect(turns).toEqual([
      {
        clientMessageId: "message-id",
        content: [{ text: "Do it", type: "text" }],
        threadId: "new",
      },
    ])
  })

  it("refuses to message the calling thread", async () => {
    const { call } = harness([thread("caller")])
    const result = await call("send_message_to_thread", { prompt: "x", threadId: "caller" })
    expect(result.success).toBe(false)
  })

  it("steers a running thread instead of starting a second turn", async () => {
    const { call, turns } = harness([thread("other", { activeTurn: {}, state: "running" })])
    const { value } = await call("send_message_to_thread", { prompt: "x", threadId: "other" })
    expect(JSON.parse(value).delivered).toBe("steered")
    expect(turns).toEqual([])
  })

  it("returns recent turns and a cursor for older ones", async () => {
    const { call } = harness([thread("t1")])
    const read = JSON.parse(
      (await call("read_thread", { includeOutputs: true, threadId: "t1", turnLimit: 1 })).value
    )
    expect(read.turns).toHaveLength(1)
    expect(read.turns[0].items[0]).toMatchObject({ command: "ls", type: "command" })
    expect(read.nextCursor).toBe("epoch:3")
  })

  it("returns a completed thread's final text once", async () => {
    const { call } = harness([thread("t1")])
    const first = JSON.parse(
      (await call("wait_threads", { targets: [{ threadId: "t1" }], timeoutMs: 0 })).value
    )
    expect(first).toMatchObject({ finalText: "hello", reason: "completed", threadId: "t1" })
    const again = JSON.parse(
      (
        await call("wait_threads", {
          targets: [{ afterCursor: first.cursor, threadId: "t1" }],
          timeoutMs: 0,
        })
      ).value
    )
    expect(again.finalText).toBeNull()
  })

  it("reports a timeout while every thread is still running", async () => {
    const { call } = harness([thread("t1", { state: "running" })])
    const result = JSON.parse(
      (await call("wait_threads", { targets: [{ threadId: "t1" }], timeoutMs: 0 })).value
    )
    expect(result).toMatchObject({ reason: "timeout", threads: [{ status: "running" }] })
  })

  it("maps sidebar destinations onto Pinned, custom sections, and no section", async () => {
    const { call, requests } = harness()
    await call("move_thread_to_sidebar_section", { sectionId: "pinned", threadId: "t1" })
    await call("move_thread_to_sidebar_section", { sectionId: "s1", threadId: "t1" })
    await call("move_project_to_sidebar_section", { projectId: "p1", sectionId: null })
    expect(requests.map((request) => request.type)).toEqual([
      "section.item.pin.request",
      "section.read.request",
      "section.item.move.request",
      "section.item.remove.request",
    ])
    expect(requests[3]?.payload).toEqual({ item: { id: "p1", type: "project" } })
  })

  it("does not let a tool change the Pinned section", async () => {
    const { call } = harness()
    expect((await call("delete_sidebar_section", { sectionId: "pinned" })).success).toBe(false)
  })

  it("reorders listed projects within their own positions", async () => {
    const { call, requests } = harness()
    await call("reorder_sidebar_projects", { projectIds: ["p3", "p1"] })
    const moves = requests.filter((request) => request.type === "project.move.request")
    expect(moves.map((move) => move.payload)).toEqual([
      { beforeProjectId: null, projectId: "p1" },
      { beforeProjectId: "p1", projectId: "p2" },
      { beforeProjectId: "p2", projectId: "p3" },
    ])
  })

  it("requires every custom section when reordering sections", async () => {
    const { call } = harness()
    expect((await call("reorder_sidebar_sections", { sectionIds: ["pinned"] })).success).toBe(false)
    expect((await call("reorder_sidebar_sections", { sectionIds: ["s1", "pinned"] })).success).toBe(
      true
    )
  })

  describe("automation_update", () => {
    it("hands the arguments and the calling thread to the automation tool", async () => {
      const { call } = harness([thread("caller")])
      const { success, value } = await call("automation_update", { mode: "view" })
      expect(success).toBe(true)
      expect(JSON.parse(value)).toEqual({ echoed: "view" })
    })
  })

  describe("handoff", () => {
    it("starts a handoff of another thread and reads its status", async () => {
      const { call, handoffs } = harness([thread("caller"), thread("other")])
      const started = await call("handoff_thread", { followUpPrompt: "Go", threadId: "other" })
      expect(JSON.parse(started.value)).toMatchObject({ operationId: "op", status: "queued" })
      expect(handoffs).toEqual([{ followUpPrompt: "Go", threadId: "other" }])
      const status = await call("get_handoff_status", {
        afterRevision: 1,
        operationId: "op",
        waitMs: 30_000,
      })
      expect(JSON.parse(status.value)).toMatchObject({ revision: 2, status: "completed" })
    })

    it("refuses to hand off the calling thread", async () => {
      const { call } = harness([thread("caller")])
      expect((await call("handoff_thread", { threadId: "caller" })).success).toBe(false)
    })
  })

  describe("worktrees and artifacts", () => {
    const caller = thread("caller", { roots: ["/repo"] })

    it("creates a worktree from the default branch and reports it once ready", async () => {
      const { call, started } = harness([caller])
      const result = await call("create_worktree", { allowAsync: true })
      expect(started).toEqual([
        { attachToThreadId: "caller", cwd: "/repo", startPoint: "refs/remotes/origin/main" },
      ])
      expect(JSON.parse(result.value)).toMatchObject({
        identityKey: "new",
        status: "completed",
        workspaceDirectory: "/wt/new",
      })
    })

    it("requires allowAsync and refuses an option-like ref", async () => {
      const { call } = harness([caller])
      expect((await call("create_worktree", {})).success).toBe(false)
      expect((await call("create_worktree", { allowAsync: true, ref: "--force" })).success).toBe(
        false
      )
    })

    it("lists attached worktrees as active, archived, or missing", async () => {
      const { call, attached } = harness([caller])
      attached.push({
        attachmentType: "worktree",
        createdAt: 9,
        identityKey: "gone",
        payload: { worktreeId: "gone" },
      })
      const { artifacts } = JSON.parse((await call("list_artifacts", {})).value)
      expect(artifacts.map((entry: { payload: { state: string } }) => entry.payload.state)).toEqual(
        ["active", "archived", "missing"]
      )
    })

    it("archives and restores only worktrees attached to the calling thread", async () => {
      const { archived, call } = harness([caller])
      expect((await call("archive_worktree", { root: "w3" })).success).toBe(false)
      expect((await call("archive_worktree", { root: "w1" })).success).toBe(true)
      expect(archived).toEqual(["/wt/w1"])
      expect((await call("archive_worktree", { root: "w2" })).success).toBe(false)
      const restored = await call("restore_worktree", { root: "w2" })
      expect(JSON.parse(restored.value)).toEqual({
        identityKey: "w2",
        workspaceDirectory: "/wt/w2",
      })
      expect((await call("restore_worktree", { root: "w1" })).success).toBe(false)
    })

    it("attaches pull requests to the calling thread", async () => {
      const { call } = harness([caller])
      const result = await call("attach_artifact", {
        artifact_type: "pull_request",
        url: "https://github.com/o/r/pull/1",
      })
      expect(result.success).toBe(true)
      expect(
        (await call("attach_artifact", { artifact_type: "issue", url: "https://x" })).success
      ).toBe(false)
    })
  })
})
