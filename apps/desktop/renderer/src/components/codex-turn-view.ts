import type { CodexTurnItemSnapshot } from "@cypheria/codex-bridge"
import type { CodexUiMessage } from "../../../ipc/src/index.js"

export type CodexActivityUnit =
  | {
      readonly id: string
      readonly item: CodexTurnItemSnapshot
      readonly kind: "commentary"
    }
  | {
      readonly id: string
      readonly items: readonly CodexTurnItemSnapshot[]
      readonly kind: "group"
      readonly reasoning?: CodexTurnItemSnapshot
    }

export type CodexTurnView = {
  readonly activity: readonly CodexActivityUnit[]
  readonly diff:
    | Extract<CodexUiMessage["parts"][number], { type: "data-codex-diff" }>["data"]
    | null
  readonly events: readonly Extract<
    CodexUiMessage["parts"][number],
    { type: "data-codex-event" }
  >["data"][]
  readonly finalAnswer: CodexTurnItemSnapshot | null
  readonly items: readonly CodexTurnItemSnapshot[]
  readonly modelReroutes: readonly Extract<
    CodexUiMessage["parts"][number],
    { type: "data-codex-model-reroute" }
  >["data"][]
  readonly plan:
    | Extract<CodexUiMessage["parts"][number], { type: "data-codex-plan" }>["data"]
    | null
  readonly turn: Extract<CodexUiMessage["parts"][number], { type: "data-codex-turn" }>["data"]
}

const isCommentary = (snapshot: CodexTurnItemSnapshot): boolean =>
  snapshot.item.type === "agentMessage" && snapshot.item.phase === "commentary"

const isReasoning = (snapshot: CodexTurnItemSnapshot): boolean => snapshot.item.type === "reasoning"

const selectFinalAnswer = (
  items: readonly CodexTurnItemSnapshot[]
): CodexTurnItemSnapshot | null => {
  const assistantItems = items.filter(
    (
      snapshot
    ): snapshot is CodexTurnItemSnapshot & {
      item: Extract<CodexTurnItemSnapshot["item"], { type: "agentMessage" }>
    } => snapshot.item.type === "agentMessage" && snapshot.item.text.length > 0
  )
  return (
    assistantItems.findLast((snapshot) => snapshot.item.phase === "final_answer") ??
    assistantItems.findLast((snapshot) => snapshot.item.phase === null) ??
    null
  )
}

export const groupCodexActivity = (
  items: readonly CodexTurnItemSnapshot[]
): CodexActivityUnit[] => {
  const groups: CodexActivityUnit[] = []
  let pending:
    | {
        id: string
        items: CodexTurnItemSnapshot[]
        kind: "group"
        reasoning?: CodexTurnItemSnapshot
      }
    | undefined

  const flush = () => {
    if (pending && (pending.reasoning || pending.items.length)) groups.push(pending)
    pending = undefined
  }

  for (const snapshot of items) {
    if (isCommentary(snapshot)) {
      flush()
      groups.push({ id: snapshot.item.id, item: snapshot, kind: "commentary" })
      continue
    }
    if (isReasoning(snapshot)) {
      flush()
      pending = {
        id: `reasoning-group:${snapshot.item.id}`,
        items: [],
        kind: "group",
        reasoning: snapshot,
      }
      continue
    }
    pending ??= { id: `activity-group:${snapshot.item.id}`, items: [], kind: "group" }
    pending.items.push(snapshot)
  }
  flush()
  return groups
}

export const deriveCodexTurnView = (message: CodexUiMessage): CodexTurnView | null => {
  let turn: CodexTurnView["turn"] | null = null
  let diff: CodexTurnView["diff"] = null
  let plan: CodexTurnView["plan"] = null
  const items: CodexTurnItemSnapshot[] = []
  const events: CodexTurnView["events"][number][] = []
  const modelReroutes: CodexTurnView["modelReroutes"][number][] = []

  for (const part of message.parts) {
    switch (part.type) {
      case "data-codex-turn":
        turn = part.data
        break
      case "data-codex-item":
        items.push(part.data)
        break
      case "data-codex-diff":
        diff = part.data
        break
      case "data-codex-plan":
        plan = part.data
        break
      case "data-codex-model-reroute":
        modelReroutes.push(part.data)
        break
      case "data-codex-event":
        events.push(part.data)
        break
    }
  }
  if (!turn) return null

  items.sort((left, right) => left.order - right.order)
  const finalAnswer = selectFinalAnswer(items)
  const activityItems = items.filter(
    (snapshot) =>
      snapshot.item.id !== finalAnswer?.item.id &&
      snapshot.item.type !== "userMessage" &&
      snapshot.item.type !== "hookPrompt"
  )
  return {
    activity: groupCodexActivity(activityItems),
    diff,
    events,
    finalAnswer,
    items,
    modelReroutes,
    plan,
    turn,
  }
}
