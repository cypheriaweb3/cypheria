import type { CodexTurnItemSnapshot, CodexTurnUpdate, ThreadTimelineItem } from "@cypheria/protocol"
import type { v2 } from "@cypheria/protocol/codex-types"

const status = (value: unknown): "pending" | "running" | "completed" | "failed" | "cancelled" => {
  switch (value) {
    case "completed":
    case "success":
    case "succeeded":
      return "completed"
    case "failed":
    case "declined":
      return "failed"
    case "cancelled":
    case "interrupted":
      return "cancelled"
    case "pending":
    case "queued":
      return "pending"
    default:
      return "running"
  }
}

const harnessData = (nativeType: string, payload: unknown) => ({
  agentId: "codex" as const,
  nativeType,
  payload,
})

const toolName = (item: v2.ThreadItem): string => {
  switch (item.type) {
    case "mcpToolCall":
      return `${item.server}.${item.tool}`
    case "dynamicToolCall":
      return item.namespace ? `${item.namespace}.${item.tool}` : item.tool
    case "collabAgentToolCall":
      return `collaboration.${item.tool}`
    case "functionCallOutput":
      return item.namespace ? `${item.namespace}.${item.name}` : item.name
    default:
      return item.type
  }
}

const toolInput = (item: v2.ThreadItem): unknown => {
  switch (item.type) {
    case "mcpToolCall":
    case "dynamicToolCall":
      return item.arguments
    case "webSearch":
      return { action: item.action, query: item.query }
    case "collabAgentToolCall":
      return {
        model: item.model,
        prompt: item.prompt,
        reasoningEffort: item.reasoningEffort,
        receiverThreadIds: item.receiverThreadIds,
      }
    case "functionCallOutput":
      return null
    default:
      return item
  }
}

const toolOutput = (item: v2.ThreadItem, snapshot?: CodexTurnItemSnapshot): unknown => {
  switch (item.type) {
    case "mcpToolCall":
      return item.result ?? item.error ?? snapshot?.progress ?? null
    case "dynamicToolCall":
      return item.contentItems ?? snapshot?.progress ?? null
    case "webSearch":
      return item.results ?? []
    case "collabAgentToolCall":
      return item.agentsStates
    case "functionCallOutput":
      return item.output
    default:
      return snapshot?.progress ?? null
  }
}

export const codexThreadItemToTimeline = (
  item: v2.ThreadItem,
  snapshot?: CodexTurnItemSnapshot
): ThreadTimelineItem | undefined => {
  const metadata = harnessData(`codex.item.${item.type}`, snapshot ?? item)
  switch (item.type) {
    case "userMessage":
    case "hookPrompt":
      return undefined
    case "agentMessage":
      return {
        harnessData: metadata,
        itemId: item.id,
        operation: "replace",
        role: "assistant",
        text: item.text,
        type: "message",
      }
    case "reasoning":
      return {
        harnessData: metadata,
        itemId: item.id,
        operation: "replace",
        text: [...item.summary, ...item.content].filter(Boolean).join("\n\n"),
        type: "reasoning",
      }
    case "plan":
      return {
        harnessData: metadata,
        itemId: item.id,
        operation: "replace",
        role: "assistant",
        text: item.text,
        type: "message",
      }
    case "commandExecution":
      return {
        command: item.command,
        cwd: item.cwd,
        durationMs: item.durationMs,
        exitCode: item.exitCode,
        harnessData: metadata,
        itemId: item.id,
        output: item.aggregatedOutput ?? snapshot?.progress ?? "",
        status: status(item.status),
        type: "command",
      }
    case "fileChange":
      return {
        changes: item.changes.map((change) => ({
          diff: change.diff,
          kind:
            change.kind.type === "add"
              ? "add"
              : change.kind.type === "delete"
                ? "delete"
                : change.kind.move_path
                  ? "move"
                  : "update",
          path:
            change.kind.type === "update" && change.kind.move_path
              ? change.kind.move_path
              : change.path,
          previousPath: change.kind.type === "update" && change.kind.move_path ? change.path : null,
        })),
        harnessData: metadata,
        itemId: item.id,
        status: status(item.status),
        type: "diff",
      }
    case "imageGeneration": {
      const dataUri = item.result.startsWith("data:") ? item.result : null
      const uri = item.savedPath ?? dataUri
      if (!uri) {
        return {
          agentId: "codex",
          itemId: item.id,
          nativeType: item.type,
          payload: snapshot ?? item,
          status: item.failure ? "failed" : status(item.status),
          type: "harness",
        }
      }
      return {
        harnessData: metadata,
        itemId: item.id,
        kind: "image",
        mimeType: dataUri?.slice(5, dataUri.indexOf(";")) || "image/png",
        name: item.revisedPrompt ?? "Generated image",
        type: "artifact",
        uri,
      }
    }
    case "imageView":
      return {
        harnessData: metadata,
        itemId: item.id,
        kind: "image",
        mimeType: null,
        name: item.path.split(/[\\/]/).at(-1) ?? "Image",
        type: "artifact",
        uri: item.path,
      }
    case "enteredReviewMode":
    case "exitedReviewMode":
    case "contextCompaction":
    case "subAgentActivity":
    case "sleep":
      return {
        agentId: "codex",
        itemId: item.id,
        nativeType: item.type,
        payload: snapshot ?? item,
        status: snapshot?.lifecycle === "completed" ? "completed" : "running",
        type: "harness",
      }
    case "mcpToolCall":
    case "dynamicToolCall":
    case "webSearch":
    case "collabAgentToolCall":
    case "functionCallOutput":
      return {
        error: item.type === "mcpToolCall" && item.error ? JSON.stringify(item.error) : null,
        harnessData: metadata,
        input: toolInput(item),
        itemId: item.id,
        name: toolName(item),
        output: toolOutput(item, snapshot),
        status:
          item.type === "functionCallOutput" || item.type === "webSearch"
            ? "completed"
            : status(item.status),
        type: "tool",
      }
  }
}

export const codexTurnUpdateToTimeline = (
  update: CodexTurnUpdate
): ThreadTimelineItem | undefined => {
  switch (update.type) {
    case "item":
      return codexThreadItemToTimeline(update.data.item, update.data)
    case "plan":
      return {
        entries: update.data.plan.map((entry) => ({
          status:
            entry.status === "completed"
              ? "completed"
              : entry.status === "inProgress"
                ? "in_progress"
                : "pending",
          text: entry.step,
        })),
        harnessData: harnessData("turn/plan/updated", update.data),
        itemId: update.id,
        type: "plan",
      }
    case "diff":
      return {
        agentId: "codex",
        itemId: update.id,
        nativeType: "turn/diff/updated",
        payload: update.data,
        status: "completed",
        type: "harness",
      }
    case "model-reroute":
      return {
        harnessData: harnessData("model/rerouted", update.data),
        itemId: update.id,
        message: `Model rerouted from ${update.data.fromModel} to ${update.data.toModel}`,
        status: "completed",
        type: "status",
      }
    case "turn":
    case "event":
      return undefined
  }
}
