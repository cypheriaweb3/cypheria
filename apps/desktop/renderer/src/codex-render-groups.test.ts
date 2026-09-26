import type { ThreadTimelineItem, ThreadTimelineProjectedItem } from "@cypheria/protocol"
import { describe, expect, it } from "vitest"

import { splitCodexRenderGroups } from "./codex-render-groups.js"

const entry = (
  item: ThreadTimelineItem,
  seq: number,
  turnId = "turn-1"
): ThreadTimelineProjectedItem => ({
  collapsed: false,
  item,
  seqEnd: seq,
  seqStart: seq,
  sourceSeqRanges: [{ end: seq, start: seq }],
  timestamp: "2026-09-24T00:00:00.000Z",
  turnId,
})

const message = (
  id: string,
  seq: number,
  phase: string | null,
  delivery: string | null = null,
  questions: unknown[] | null = null
) =>
  entry(
    {
      boundary: "assistant-final",
      harnessData: {
        agentId: "codex",
        nativeType: "codex.item.agentMessage",
        payload: { lifecycle: "completed", item: { phase, delivery, questions } },
      },
      itemId: id,
      operation: "replace",
      role: "assistant",
      text: id,
      type: "message",
    },
    seq
  )

const command = (id: string, seq: number) =>
  entry(
    {
      command: "pwd",
      cwd: null,
      durationMs: 1,
      exitCode: 0,
      itemId: id,
      output: "/workspace",
      status: "completed",
      type: "command",
    },
    seq
  )

describe("splitCodexRenderGroups", () => {
  it("separates final answer from trailing completed tools and notices", () => {
    const rows = splitCodexRenderGroups([
      entry(
        {
          boundary: "turn-user",
          itemId: "user",
          operation: "replace",
          role: "user",
          text: "hello",
          type: "message",
        },
        1
      ),
      message("commentary", 2, "commentary"),
      command("cmd-1", 3),
      command("cmd-2", 4),
      message("final", 5, "final_answer"),
      command("finished-late", 6),
      entry(
        { itemId: "reroute", message: "Model rerouted", status: "completed", type: "status" },
        7
      ),
    ])
    expect(rows.map((row) => row.kind)).toEqual([
      "user",
      "tools",
      "tools",
      "assistant",
      "post-assistant",
    ])
    expect(rows[1]?.items.map((item) => item.item.itemId)).toEqual(["cmd-1", "cmd-2"])
    expect(rows[1]?.toolGroupStart).toBeUndefined()
    expect(rows[3]?.items[0]?.item.itemId).toBe("final")
  })

  it("tracks only synchronous latest commentary and does not promote async questions", () => {
    const rows = splitCodexRenderGroups(
      [
        message("sync", 1, "commentary"),
        message("async", 2, "commentary", "async"),
        message("question", 3, "commentary", null, [{ id: "q" }]),
        command("command", 4),
      ],
      "turn-1"
    )
    expect(rows.some((row) => row.currentCommentary)).toBe(false)
    expect(
      rows.some((row) => row.kind === "activity" && row.items[0]?.item.itemId === "async")
    ).toBe(true)
    expect(
      rows.some((row) => row.kind === "activity" && row.items[0]?.item.itemId === "question")
    ).toBe(true)
  })

  it("marks the latest synchronous commentary and its following tool group", () => {
    const rows = splitCodexRenderGroups(
      [message("old", 1, "commentary"), message("live", 2, "commentary"), command("cmd", 3)],
      "turn-1"
    )
    expect(rows.map((row) => row.items[0]?.item.itemId)).toEqual(["live", "cmd"])
    expect(rows[0]?.currentCommentary).toBe(true)
    expect(rows[1]?.toolGroupStart).toBe(true)
  })

  it("does not keep an empty completed commentary or an async question as current", () => {
    const empty = message("empty", 1, "commentary")
    if (empty.item.type !== "message") throw new Error("Expected message fixture")
    empty.item.text = ""
    const rows = splitCodexRenderGroups(
      [empty, message("question", 2, "commentary", null, [])],
      "turn-1"
    )
    expect(rows.some((row) => row.currentCommentary)).toBe(false)
    expect(rows.map((row) => row.items[0]?.item.itemId)).toEqual(["question"])
  })

  it("keeps plans, diffs and pending approvals out of ordinary activity", () => {
    const rows = splitCodexRenderGroups([
      entry({ entries: [{ status: "pending", text: "step" }], itemId: "plan", type: "plan" }, 1),
      entry(
        {
          changes: [{ diff: "+x", kind: "add", path: "a", previousPath: null }],
          itemId: "diff",
          status: "completed",
          type: "diff",
        },
        2
      ),
      entry(
        {
          decision: "pending",
          interactionId: "interaction",
          itemId: "approval",
          message: "Allow?",
          title: null,
          type: "approval",
        },
        3
      ),
      message("legacy-final", 4, null),
    ])
    expect(rows.map((row) => row.kind)).toEqual(["plan", "diff", "assistant"])
  })

  it("does not turn a native plan message into a final answer", () => {
    const plan = entry(
      {
        boundary: null,
        harnessData: {
          agentId: "codex",
          nativeType: "codex.item.plan",
          payload: { item: { text: "Draft plan" } },
        },
        itemId: "plan-message",
        operation: "replace",
        role: "assistant",
        text: "Draft plan",
        type: "message",
      },
      1
    )
    expect(splitCodexRenderGroups([plan]).map((row) => row.kind)).toEqual(["plan"])
  })
})
