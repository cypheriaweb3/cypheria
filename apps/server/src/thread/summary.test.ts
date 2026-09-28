import type { ThreadTimelineItem, ThreadTimelineRow } from "@cypheria/protocol"
import { describe, expect, it } from "vitest"

import { projectThreadSummary } from "./summary.js"

const threadId = "01984de2-8f74-7c91-a3b2-5c5e937cf399"
const epoch = "01984de2-8f74-7c91-a3b2-5c5e937cf300"
const row = (seq: number, item: ThreadTimelineItem): ThreadTimelineRow => ({
  harnessItemId: null,
  item,
  seq,
  timestamp: "2026-09-28T00:00:00.000Z",
  turnId: null,
})

describe("projectThreadSummary", () => {
  it("counts the full history while bounding returned rows", () => {
    const rows: ThreadTimelineRow[] = Array.from({ length: 600 }, (_, index) =>
      row(index + 1, {
        itemId: `artifact-${index}`,
        kind: "file",
        mimeType: null,
        name: `Output ${index}`,
        type: "artifact",
        uri: `file:///output-${index}`,
      })
    )
    rows.push(
      row(601, {
        entries: [{ status: "in_progress", text: "First plan" }],
        itemId: "plan-1",
        type: "plan",
      })
    )
    rows.push(
      row(602, {
        entries: [{ status: "completed", text: "Latest plan" }],
        itemId: "plan-2",
        type: "plan",
      })
    )
    const result = projectThreadSummary(threadId, epoch, rows)
    expect(result.epoch).toBe(epoch)
    expect(result.outputs.count).toBe(600)
    expect(result.outputs.entries).toHaveLength(50)
    expect(result.outputs.entries[0]?.itemId).toBe("artifact-599")
    expect(result.plan.entries.map((entry) => entry.label)).toEqual(["Latest plan"])
  })

  it("folds duplicate item updates rather than counting them twice", () => {
    const rows = [
      row(1, {
        itemId: "a",
        kind: "file",
        mimeType: null,
        name: "Original",
        type: "artifact",
        uri: "file:///result",
      }),
      row(2, {
        itemId: "a",
        kind: "file",
        mimeType: null,
        name: "Final",
        type: "artifact",
        uri: "file:///result",
      }),
      row(3, {
        boundary: null,
        itemId: "m",
        operation: "replace",
        role: "assistant",
        text: "Hello",
        type: "message",
      }),
    ]
    const result = projectThreadSummary(threadId, epoch, rows)
    expect(result.outputs.count).toBe(1)
    expect(result.outputs.entries[0]?.label).toBe("Final")
  })

  it("uses the latest status for a file changed more than once", () => {
    const change = { diff: "", kind: "update" as const, path: "src/app.ts", previousPath: null }
    const result = projectThreadSummary(threadId, epoch, [
      row(1, { changes: [change], itemId: "diff-1", status: "running", type: "diff" }),
      row(2, { changes: [change], itemId: "diff-2", status: "completed", type: "diff" }),
    ])
    expect(result.outputs.count).toBe(1)
    expect(result.outputs.entries[0]).toMatchObject({ itemId: "diff-2", status: "completed" })
  })

  it("counts Codex collaboration receivers as subagents", () => {
    const result = projectThreadSummary(threadId, epoch, [
      row(1, {
        error: null,
        harnessData: { agentId: "codex", nativeType: "codex.item.collabAgentToolCall" },
        input: { receiverThreadIds: ["agent-1", "agent-2"] },
        itemId: "spawn-1",
        name: "collaboration.spawnAgent",
        output: { "agent-1": { status: "running" }, "agent-2": { status: "completed" } },
        status: "completed",
        type: "tool",
      }),
    ])
    expect(result.subagents.count).toBe(2)
    expect(result.subagents.entries.map((entry) => entry.status)).toEqual(["completed", "running"])
  })
})
