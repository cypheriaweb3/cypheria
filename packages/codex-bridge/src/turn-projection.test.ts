import { describe, expect, it } from "vitest"

import type { ServerNotification, v2 } from "./generated/index.js"
import { CodexTurnProjector } from "./turn-projection.js"

const agentMessage = (text = ""): Extract<v2.ThreadItem, { type: "agentMessage" }> => ({
  delivery: null,
  id: "agent-1",
  memoryCitation: null,
  phase: "commentary",
  questions: null,
  text,
  type: "agentMessage",
})

const turn = (items: v2.ThreadItem[] = [agentMessage()]): v2.Turn => ({
  completedAt: null,
  durationMs: null,
  error: null,
  id: "turn-1",
  items,
  itemsView: "full",
  startedAt: 10,
  status: "inProgress",
})

const notification = <M extends ServerNotification["method"]>(
  method: M,
  params: Extract<ServerNotification, { method: M }>["params"]
): Extract<ServerNotification, { method: M }> =>
  ({ method, params }) as Extract<ServerNotification, { method: M }>

describe("CodexTurnProjector", () => {
  it("preserves the complete item while reconciling agent text and completion phase", () => {
    const projector = new CodexTurnProjector("thread-1", turn())

    expect(projector.initialUpdates()).toMatchObject([
      { data: { startedAt: 10, status: "inProgress" }, id: "turn-1", type: "turn" },
      {
        data: { item: { phase: "commentary", type: "agentMessage" }, lifecycle: "started" },
        id: "agent-1",
        type: "item",
      },
    ])

    expect(
      projector.apply(
        notification("item/agentMessage/delta", {
          delta: "Working",
          itemId: "agent-1",
          threadId: "thread-1",
          turnId: "turn-1",
        })
      )
    ).toMatchObject([{ data: { item: { text: "Working" } }, id: "agent-1", type: "item" }])

    const completed = { ...agentMessage("Working"), phase: "final_answer" as const }
    expect(
      projector.apply(
        notification("item/completed", {
          completedAtMs: 12_000,
          item: completed,
          threadId: "thread-1",
          turnId: "turn-1",
        })
      )
    ).toMatchObject([
      {
        data: {
          completedAtMs: 12_000,
          item: { phase: "final_answer", text: "Working" },
          lifecycle: "completed",
        },
      },
    ])
  })

  it("keeps reasoning indices, command output, progress, and terminal input", () => {
    const reasoning: Extract<v2.ThreadItem, { type: "reasoning" }> = {
      content: [],
      id: "reasoning-1",
      summary: [],
      type: "reasoning",
    }
    const command: Extract<v2.ThreadItem, { type: "commandExecution" }> = {
      aggregatedOutput: null,
      command: "pnpm test",
      commandActions: [],
      cwd: "/repo",
      durationMs: null,
      exitCode: null,
      id: "command-1",
      pluginId: null,
      processId: "process-1",
      scriptPath: null,
      source: "agent",
      status: "inProgress",
      type: "commandExecution",
    }
    const projector = new CodexTurnProjector("thread-1", turn([reasoning, command]))

    projector.apply(
      notification("item/reasoning/summaryTextDelta", {
        delta: "Inspecting",
        itemId: "reasoning-1",
        summaryIndex: 1,
        threadId: "thread-1",
        turnId: "turn-1",
      })
    )
    const reasoningUpdate = projector.apply(
      notification("item/reasoning/textDelta", {
        contentIndex: 0,
        delta: "Details",
        itemId: "reasoning-1",
        threadId: "thread-1",
        turnId: "turn-1",
      })
    )
    expect(reasoningUpdate).toMatchObject([
      { data: { item: { content: ["Details"], summary: ["", "Inspecting"] } } },
    ])

    projector.apply(
      notification("item/commandExecution/outputDelta", {
        delta: "PASS\n",
        itemId: "command-1",
        threadId: "thread-1",
        turnId: "turn-1",
      })
    )
    const commandUpdate = projector.apply(
      notification("item/commandExecution/terminalInteraction", {
        itemId: "command-1",
        processId: "process-1",
        stdin: "y\n",
        threadId: "thread-1",
        turnId: "turn-1",
      })
    )
    expect(commandUpdate).toMatchObject([
      {
        data: {
          item: { aggregatedOutput: "PASS\n" },
          terminalInteractions: [{ processId: "process-1", stdin: "y\n" }],
        },
      },
    ])
  })

  it("projects turn-level diff, plan, reroute, completion, and scoped events", () => {
    const projector = new CodexTurnProjector("thread-1", turn([]))

    expect(
      projector.apply(
        notification("turn/diff/updated", {
          diff: "+line",
          threadId: "thread-1",
          turnId: "turn-1",
        })
      )
    ).toMatchObject([{ data: { diff: "+line" }, id: "turn-1:diff", type: "diff" }])
    expect(
      projector.apply(
        notification("turn/plan/updated", {
          explanation: "Plan",
          plan: [{ status: "inProgress", step: "Implement" }],
          threadId: "thread-1",
          turnId: "turn-1",
        })
      )
    ).toMatchObject([{ data: { explanation: "Plan" }, id: "turn-1:plan", type: "plan" }])
    expect(
      projector.apply(
        notification("model/rerouted", {
          fromModel: "a",
          reason: "highRiskCyberActivity",
          threadId: "thread-1",
          toModel: "b",
          turnId: "turn-1",
        })
      )
    ).toMatchObject([{ data: { fromModel: "a", toModel: "b" }, type: "model-reroute" }])

    const completedTurn: v2.Turn = {
      ...turn([]),
      completedAt: 20,
      durationMs: 10_000,
      status: "completed",
    }
    expect(
      projector.apply(notification("turn/completed", { threadId: "thread-1", turn: completedTurn }))
    ).toMatchObject([
      { data: { completedAt: 20, durationMs: 10_000, status: "completed" }, type: "turn" },
    ])

    expect(
      projector.apply(
        notification("turn/moderationMetadata", {
          metadata: null,
          threadId: "thread-1",
          turnId: "turn-1",
        })
      )
    ).toMatchObject([
      { data: { notification: { method: "turn/moderationMetadata" } }, type: "event" },
    ])
    expect(
      projector.apply(
        notification("turn/diff/updated", {
          diff: "ignored",
          threadId: "other-thread",
          turnId: "turn-1",
        })
      )
    ).toEqual([])
  })
})
