import type { CodexTurnItemSnapshot, CodexTurnSnapshot } from "@cypheria/codex-bridge"
import { describe, expect, it } from "vitest"

import type { CodexUiMessage } from "../../../ipc/src/index.js"
import {
  deriveCodexTurnView,
  formatCodexAsyncQuestionReply,
  groupCodexActivity,
  isCodexTurnItemActive,
} from "./codex-turn-view.js"

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

  it("projects asynchronous questions as commentary and formats the structured steer reply", () => {
    const asyncQuestion = snapshot(
      {
        delivery: "async",
        id: "async-question",
        memoryCitation: null,
        phase: "final_answer",
        questions: [{ options: ["Alpha", "Beta"], title: "Choose a branch" }],
        text: "Choose a branch\n- Alpha\n- Beta",
        type: "agentMessage",
      },
      0
    )
    const message: CodexUiMessage = {
      id: "turn-1",
      parts: [
        { data: turn, id: "turn-1", type: "data-codex-turn" },
        { data: asyncQuestion, id: asyncQuestion.item.id, type: "data-codex-item" },
      ],
      role: "assistant",
    }

    const view = deriveCodexTurnView(message)
    const question = view?.asyncQuestions[0]
    expect(view?.finalAnswer).toBeNull()
    expect(view?.activity).toMatchObject([{ id: "async-question", kind: "commentary" }])
    expect(question).toEqual({
      id: JSON.stringify(["request_user_input_async", "async-question", 0]),
      options: ["Alpha", "Beta"],
      questionIndex: 0,
      sourceItemId: "async-question",
      title: "Choose a branch",
    })
    expect(
      question ? formatCodexAsyncQuestionReply([{ answer: "Alpha", question }]) : "missing question"
    ).toBe(
      `<send_user_message_question_reply>\n${JSON.stringify([
        {
          answer: "Alpha",
          question: "Choose a branch",
          questionItemId: JSON.stringify(["request_user_input_async", "async-question", 0]),
        },
      ])}\n</send_user_message_question_reply>`
    )
  })

  it("counts changed files within the current turn only", () => {
    const firstChange = snapshot(
      {
        changes: [
          {
            diff: "+first",
            kind: { move_path: null, type: "update" },
            path: "src/a.ts",
          },
          { diff: "+second", kind: { type: "add" }, path: "src/b.ts" },
        ],
        id: "change-one",
        status: "completed",
        type: "fileChange",
      },
      0
    )
    const repeatedPath = snapshot(
      {
        changes: [
          {
            diff: "+latest",
            kind: { move_path: null, type: "update" },
            path: "src/a.ts",
          },
        ],
        id: "change-two",
        status: "completed",
        type: "fileChange",
      },
      1
    )
    const message: CodexUiMessage = {
      id: "turn-1",
      parts: [
        { data: turn, id: "turn-1", type: "data-codex-turn" },
        ...[firstChange, repeatedPath].map((item) => ({
          data: item,
          id: item.item.id,
          type: "data-codex-item" as const,
        })),
      ],
      role: "assistant",
    }

    expect(deriveCodexTurnView(message)?.changedFileCount).toBe(2)
  })

  it("keeps consecutive tool activity in one group", () => {
    const items = ["one", "two"].map((id, order) =>
      snapshot({ id, path: `/tmp/${id}.png`, type: "imageView" }, order)
    )
    expect(groupCodexActivity(items)).toMatchObject([
      { id: "activity-group:one", items: [{ item: { id: "one" } }, { item: { id: "two" } }] },
    ])
  })

  it("separates completed generated images from collapsible activity", () => {
    const generatedImage = snapshot(
      {
        failure: null,
        id: "generated-image",
        result: "iVBORw0KGgoAAA",
        revisedPrompt: "A quiet landscape",
        status: "completed",
        type: "imageGeneration",
      },
      0
    )
    const message: CodexUiMessage = {
      id: "turn-1",
      parts: [
        { data: turn, id: "turn-1", type: "data-codex-turn" },
        { data: generatedImage, id: generatedImage.item.id, type: "data-codex-item" },
      ],
      role: "assistant",
    }

    const view = deriveCodexTurnView(message)
    expect(view?.generatedImages).toMatchObject([{ item: { id: "generated-image" } }])
    expect(view?.activity).toEqual([])
  })

  it("moves asynchronous image generation into a body placeholder while the turn continues", () => {
    const generatingImage = snapshot(
      {
        failure: null,
        id: "generating-image",
        result: "",
        revisedPrompt: "A quiet landscape",
        status: "inProgress",
        type: "imageGeneration",
      },
      0
    )
    const activeTurn: CodexTurnSnapshot = {
      ...turn,
      completedAt: null,
      durationMs: null,
      status: "inProgress",
    }
    const message: CodexUiMessage = {
      id: "turn-1",
      parts: [
        { data: activeTurn, id: "turn-1", type: "data-codex-turn" },
        { data: generatingImage, id: generatingImage.item.id, type: "data-codex-item" },
      ],
      role: "assistant",
    }

    const view = deriveCodexTurnView(message)
    expect(view?.pendingGeneratedImageCount).toBe(1)
    expect(view?.activity).toEqual([])
  })

  it("shows the body placeholder as soon as image generation starts", () => {
    const generatingImage = {
      ...snapshot(
        {
          failure: null,
          id: "generating-image",
          result: "",
          revisedPrompt: "A quiet landscape",
          status: "inProgress",
          type: "imageGeneration",
        },
        0
      ),
      completedAtMs: null,
      lifecycle: "started" as const,
    }
    const activeTurn: CodexTurnSnapshot = {
      ...turn,
      completedAt: null,
      durationMs: null,
      status: "inProgress",
    }
    const message: CodexUiMessage = {
      id: "turn-1",
      parts: [
        { data: activeTurn, id: "turn-1", type: "data-codex-turn" },
        { data: generatingImage, id: generatingImage.item.id, type: "data-codex-item" },
      ],
      role: "assistant",
    }

    const view = deriveCodexTurnView(message)
    expect(view?.pendingGeneratedImageCount).toBe(1)
    expect(view?.activity).toEqual([])
  })

  it("treats a resultless in-progress image as active after its item completion event", () => {
    const generatingImage = snapshot(
      {
        failure: null,
        id: "generating-image",
        result: "",
        revisedPrompt: "A quiet landscape",
        status: "inProgress",
        type: "imageGeneration",
      },
      0
    )

    expect(generatingImage.lifecycle).toBe("completed")
    expect(isCodexTurnItemActive(generatingImage)).toBe(true)
  })

  it("shows a finished image in the response body while the main turn is still working", () => {
    const generatedImage = snapshot(
      {
        failure: null,
        id: "generated-image",
        result: "iVBORw0KGgoAAA",
        revisedPrompt: "A quiet landscape",
        status: "completed",
        type: "imageGeneration",
      },
      0
    )
    const activeTurn: CodexTurnSnapshot = {
      ...turn,
      completedAt: null,
      durationMs: null,
      status: "inProgress",
    }
    const message: CodexUiMessage = {
      id: "turn-1",
      parts: [
        { data: activeTurn, id: "turn-1", type: "data-codex-turn" },
        { data: generatedImage, id: generatedImage.item.id, type: "data-codex-item" },
      ],
      role: "assistant",
    }

    const view = deriveCodexTurnView(message)
    expect(view?.generatedImages).toMatchObject([{ item: { id: "generated-image" } }])
    expect(view?.activity).toEqual([])
  })

  it("collects successful MCP resource outputs into response artifacts", () => {
    const resourceCall = snapshot(
      {
        appContext: null,
        arguments: {},
        durationMs: 10,
        error: null,
        id: "resource-call",
        pluginId: null,
        readOnlyHint: false,
        result: {
          _meta: {
            artifact: {
              kind: "document",
              ref: "artifact-1",
              stateVersion: 2,
              title: "Quarterly brief",
            },
          },
          content: [
            {
              description: "Presentation deck",
              mimeType: "application/pdf",
              name: "brief.pdf",
              type: "resource_link",
              uri: "file:///tmp/brief.pdf",
            },
          ],
          structuredContent: {
            resources: [
              {
                title: "Preview site",
                type: "website",
                url: "https://preview.example.com",
              },
            ],
          },
        },
        server: "artifact_session",
        status: "completed",
        tool: "js",
        type: "mcpToolCall",
      },
      0
    )
    const message: CodexUiMessage = {
      id: "turn-1",
      parts: [
        { data: turn, id: "turn-1", type: "data-codex-turn" },
        { data: resourceCall, id: resourceCall.item.id, type: "data-codex-item" },
      ],
      role: "assistant",
    }

    const view = deriveCodexTurnView(message)
    expect(view?.artifacts).toMatchObject([
      { kind: "file", title: "brief.pdf", uri: "file:///tmp/brief.pdf" },
      { kind: "website", title: "Preview site", uri: "https://preview.example.com" },
      { kind: "artifact", title: "Quarterly brief", uri: "artifact:artifact-1" },
    ])

    const activeView = deriveCodexTurnView({
      ...message,
      parts: message.parts.map((part) =>
        part.type === "data-codex-turn"
          ? {
              ...part,
              data: {
                ...part.data,
                completedAt: null,
                durationMs: null,
                status: "inProgress" as const,
              },
            }
          : part
      ),
    })
    expect(activeView?.artifacts).toEqual([])
  })

  it("does not promote resources from failed tool calls or active turns", () => {
    const failedResourceCall = snapshot(
      {
        appContext: null,
        arguments: {},
        durationMs: 10,
        error: { message: "failed" },
        id: "failed-resource-call",
        pluginId: null,
        readOnlyHint: false,
        result: {
          _meta: null,
          content: [
            {
              name: "broken.pdf",
              type: "resource_link",
              uri: "file:///tmp/broken.pdf",
            },
          ],
          structuredContent: null,
        },
        server: "files",
        status: "failed",
        tool: "create",
        type: "mcpToolCall",
      },
      0
    )
    const message: CodexUiMessage = {
      id: "turn-1",
      parts: [
        { data: turn, id: "turn-1", type: "data-codex-turn" },
        { data: failedResourceCall, id: failedResourceCall.item.id, type: "data-codex-item" },
      ],
      role: "assistant",
    }

    const view = deriveCodexTurnView(message)
    expect(view?.artifacts).toEqual([])
    expect(view?.activity).toMatchObject([
      { items: [{ item: { id: "failed-resource-call" } }], kind: "group" },
    ])
  })

  it("extracts final-answer file outputs and lets PPTX output replace the image gallery", () => {
    const generatedImage = snapshot(
      {
        failure: null,
        id: "generated-image",
        result: "iVBORw0KGgoAAA",
        revisedPrompt: "Slide preview",
        status: "completed",
        type: "imageGeneration",
      },
      0
    )
    const finalAnswer = snapshot(
      {
        delivery: null,
        id: "final",
        memoryCitation: null,
        phase: "final_answer",
        questions: null,
        text: "Created [deck.pptx](</tmp/Quarterly deck.pptx>). See [source](/tmp/source.ts).",
        type: "agentMessage",
      },
      1
    )
    const message: CodexUiMessage = {
      id: "turn-1",
      parts: [
        { data: turn, id: "turn-1", type: "data-codex-turn" },
        ...[generatedImage, finalAnswer].map((item) => ({
          data: item,
          id: item.item.id,
          type: "data-codex-item" as const,
        })),
      ],
      role: "assistant",
    }

    const view = deriveCodexTurnView(message)
    expect(view?.artifacts).toMatchObject([
      { kind: "file", title: "deck.pptx", uri: "/tmp/Quarterly deck.pptx" },
    ])
    expect(view?.generatedImages).toEqual([])
    expect(view?.activity).toEqual([])
  })
})
