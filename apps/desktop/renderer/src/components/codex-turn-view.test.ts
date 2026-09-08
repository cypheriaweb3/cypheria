import type { CodexTurnItemSnapshot, CodexTurnSnapshot } from "@cypheria/codex-bridge"
import { describe, expect, it } from "vitest"

import type { CodexUiMessage } from "../../../ipc/src/index.js"
import { deriveCodexTurnView, groupCodexActivity } from "./codex-turn-view.js"

const turn: CodexTurnSnapshot = {
  completedAt: 20,
  durationMs: 10_000,
  error: null,
  id: "turn-1",
  itemsView: "full",
  startedAt: 10,
  status: "completed",
  threadId: "thread-1",
}

const snapshot = (item: CodexTurnItemSnapshot["item"], order: number): CodexTurnItemSnapshot => ({
  completedAtMs: 20_000,
  item,
  lifecycle: "completed",
  order,
  progress: "",
  startedAtMs: 10_000,
  terminalInteractions: [],
  threadId: "thread-1",
  turnId: "turn-1",
})

describe("Codex turn view", () => {
  it("extracts the explicit final answer and groups commentary and reasoning activity", () => {
    const commentary = snapshot(
      {
        delivery: null,
        id: "commentary",
        memoryCitation: null,
        phase: "commentary",
        questions: null,
        text: "I will inspect the code.",
        type: "agentMessage",
      },
      0
    )
    const reasoning = snapshot(
      { content: ["details"], id: "reasoning", summary: ["Inspecting files"], type: "reasoning" },
      1
    )
    const command = snapshot(
      {
        aggregatedOutput: "done",
        command: "rg turn",
        commandActions: [],
        cwd: "/repo",
        durationMs: 20,
        exitCode: 0,
        id: "command",
        pluginId: null,
        processId: null,
        scriptPath: null,
        source: "agent",
        status: "completed",
        type: "commandExecution",
      },
      2
    )
    const finalAnswer = snapshot(
      {
        delivery: null,
        id: "final",
        memoryCitation: null,
        phase: "final_answer",
        questions: null,
        text: "Done.",
        type: "agentMessage",
      },
      3
    )
    const message: CodexUiMessage = {
      id: "turn-1",
      parts: [
        { data: turn, id: "turn-1", type: "data-codex-turn" },
        ...[commentary, reasoning, command, finalAnswer].map((item) => ({
          data: item,
          id: item.item.id,
          type: "data-codex-item" as const,
        })),
      ],
      role: "assistant",
    }

    const view = deriveCodexTurnView(message)
    expect(view?.finalAnswer?.item.id).toBe("final")
    expect(view?.activity).toMatchObject([
      { id: "commentary", kind: "commentary" },
      {
        items: [{ item: { id: "command" } }],
        kind: "group",
        reasoning: { item: { id: "reasoning" } },
      },
    ])
  })

  it("keeps consecutive tool activity in one group", () => {
    const items = ["one", "two"].map((id, order) =>
      snapshot({ id, path: `/tmp/${id}.png`, type: "imageView" }, order)
    )
    expect(groupCodexActivity(items)).toMatchObject([
      { id: "activity-group:one", items: [{ item: { id: "one" } }, { item: { id: "two" } }] },
    ])
  })
})
