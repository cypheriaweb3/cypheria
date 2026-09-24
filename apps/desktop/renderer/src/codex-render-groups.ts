import type { ThreadTimelineProjectedItem } from "@cypheria/protocol"

export type CodexRenderRow = {
  id: string
  kind:
    | "user"
    | "activity"
    | "tools"
    | "subagents"
    | "commentary"
    | "assistant"
    | "notice"
    | "plan"
    | "diff"
    | "post-assistant"
  items: readonly ThreadTimelineProjectedItem[]
  turnId: string | null
  currentCommentary?: boolean
  toolGroupStart?: boolean
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const nativeItem = (entry: ThreadTimelineProjectedItem): Record<string, unknown> => {
  const item = entry.item
  const payload = record(item.type === "harness" ? item.payload : item.harnessData?.payload)
  return record(payload.item ?? payload)
}

const nativeType = (entry: ThreadTimelineProjectedItem): string =>
  entry.item.type === "harness" ? entry.item.nativeType : (entry.item.harnessData?.nativeType ?? "")

const assistantPhase = (entry: ThreadTimelineProjectedItem): string | null => {
  if (entry.item.type !== "message" || entry.item.role !== "assistant") return null
  const phase = nativeItem(entry).phase
  return typeof phase === "string" ? phase : null
}

const isAsyncAssistant = (entry: ThreadTimelineProjectedItem): boolean => {
  const native = nativeItem(entry)
  return native.delivery === "async" || native.questions != null
}

const isCompleted = (entry: ThreadTimelineProjectedItem): boolean => {
  const item = entry.item
  if ("status" in item)
    return item.status === "completed" || item.status === "failed" || item.status === "cancelled"
  return (
    record("harnessData" in item ? item.harnessData?.payload : undefined).lifecycle === "completed"
  )
}

const isTrailingActivity = (entry: ThreadTimelineProjectedItem): boolean => {
  const item = entry.item
  if (item.type === "reasoning") return isCompleted(entry)
  if (item.type === "command" || item.type === "tool") return isCompleted(entry)
  if (item.type === "artifact") return true
  return item.type === "harness" && nativeType(entry).includes("subAgentActivity")
}

const rowKind = (entry: ThreadTimelineProjectedItem): CodexRenderRow["kind"] | null => {
  const item = entry.item
  const type = nativeType(entry)
  if (item.type === "approval" && item.decision === "pending") return null
  if (type === "codex.item.plan") return "plan"
  if (item.type === "message") {
    if (item.role === "user") return "user"
    if (isAsyncAssistant(entry)) return "activity"
    return assistantPhase(entry) === "commentary" && !isAsyncAssistant(entry)
      ? "commentary"
      : "assistant"
  }
  if (item.type === "plan" || type.endsWith(".plan")) return "plan"
  if (item.type === "diff" || type === "turn/diff/updated") return "diff"
  if (item.type === "error") return "post-assistant"
  if (
    item.type === "status" ||
    item.type === "approval" ||
    /model|personality|forked|remoteTaskCreated|automationUpdate|autoReviewInterruptionWarning/u.test(
      type
    )
  )
    return "notice"
  if (item.type === "command" || item.type === "tool") return "tools"
  if (type.includes("subAgentActivity")) return "subagents"
  return "activity"
}

const singleRow = (
  entry: ThreadTimelineProjectedItem,
  kind: CodexRenderRow["kind"]
): CodexRenderRow => ({
  id: `${entry.turnId ?? "thread"}:${entry.item.itemId}`,
  items: [entry],
  kind,
  turnId: entry.turnId,
})

/** Desktop-only presentation routing over projected, stable Canonical Timeline items. */
export function splitCodexRenderGroups(
  items: readonly ThreadTimelineProjectedItem[],
  activeTurnId: string | null = null
): CodexRenderRow[] {
  const turns: ThreadTimelineProjectedItem[][] = []
  for (const entry of items) {
    const last = turns.at(-1)
    if (last && entry.turnId !== null && last[0]?.turnId === entry.turnId) last.push(entry)
    else turns.push([entry])
  }
  const lastTurnId = turns.findLast((turn) => turn[0]?.turnId !== null)?.[0]?.turnId
  const result: CodexRenderRow[] = []
  for (const turn of turns) {
    const turnId = turn[0]?.turnId ?? null
    const latest = turnId !== null && turnId === lastTurnId
    const complete = turnId !== null && turnId !== activeTurnId
    const finalIndex = (() => {
      let index = turn.length - 1
      while (index >= 0) {
        const tail = turn[index]
        if (
          !tail ||
          (!isTrailingActivity(tail) &&
            !["notice", "plan", "diff", "post-assistant"].includes(rowKind(tail) ?? ""))
        )
          break
        index--
      }
      const direct = turn[index]
      if (direct && assistantPhase(direct) === "final_answer" && !isAsyncAssistant(direct))
        return index
      // Native phase is optional. On completed legacy turns, use the last non-commentary
      // assistant message, but never promote async messages or live commentary.
      if (complete) {
        for (let i = index; i >= 0; i--) {
          const candidate = turn[i]
          if (!candidate) continue
          if (
            candidate.item.type === "message" &&
            candidate.item.role === "assistant" &&
            rowKind(candidate) !== "plan" &&
            assistantPhase(candidate) !== "commentary" &&
            !isAsyncAssistant(candidate)
          )
            return i
        }
      }
      return -1
    })()
    let currentCommentaryIndex = -1
    if (latest) {
      for (let i = 0; i < turn.length; i++) {
        const entry = turn[i]
        if (!entry) continue
        if (assistantPhase(entry) === "commentary" && !isAsyncAssistant(entry))
          currentCommentaryIndex =
            !isCompleted(entry) ||
            (entry.item.type === "message" && entry.item.text.trim().length > 0)
              ? i
              : -1
        else if (
          i === finalIndex ||
          isAsyncAssistant(entry) ||
          (entry.item.type === "message" && entry.item.role === "user")
        )
          currentCommentaryIndex = -1
      }
    }
    const final = finalIndex >= 0 ? turn[finalIndex] : null
    const afterFinal: ThreadTimelineProjectedItem[] = []
    let previousCommentary = false
    let previousGroupIndex = -1
    const turnRowStart = result.length
    for (let i = 0; i < turn.length; i++) {
      const entry = turn[i]
      if (!entry) continue
      if (i === finalIndex) continue
      if (
        latest &&
        assistantPhase(entry) === "commentary" &&
        !isAsyncAssistant(entry) &&
        i !== currentCommentaryIndex
      )
        continue
      const kind = rowKind(entry)
      if (!kind) continue
      if (final && i > finalIndex && (kind === "notice" || kind === "post-assistant")) {
        afterFinal.push(entry)
        continue
      }
      const previous = result.at(-1)
      if (
        (kind === "tools" || kind === "subagents") &&
        i === previousGroupIndex + 1 &&
        result.length > turnRowStart &&
        previous?.kind === kind &&
        previous.turnId === turnId
      ) {
        result[result.length - 1] = { ...previous, items: [...previous.items, entry] }
      } else {
        const row = singleRow(entry, kind)
        if (kind === "tools" && previousCommentary) row.toolGroupStart = true
        if (i === currentCommentaryIndex) row.currentCommentary = true
        result.push(row)
      }
      previousGroupIndex = i
      previousCommentary = kind === "commentary"
    }
    if (final) result.push(singleRow(final, "assistant"))
    for (const entry of afterFinal) result.push(singleRow(entry, "post-assistant"))
  }
  return result
}
