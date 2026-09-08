import type { ServerNotification, v2 } from "./generated/index.js"

export type CodexTurnSnapshot = Omit<v2.Turn, "items"> & {
  readonly threadId: string
}

export type CodexTerminalInteraction = {
  readonly processId: string
  readonly stdin: string
}

export type CodexTurnItemSnapshot = {
  readonly completedAtMs: number | null
  readonly item: v2.ThreadItem
  readonly lifecycle: "completed" | "started"
  readonly order: number
  readonly progress: string
  readonly startedAtMs: number | null
  readonly terminalInteractions: readonly CodexTerminalInteraction[]
  readonly threadId: string
  readonly turnId: string
}

export type CodexTurnDiffSnapshot = {
  readonly diff: string
  readonly threadId: string
  readonly turnId: string
}

export type CodexTurnPlanSnapshot = {
  readonly explanation: string | null
  readonly plan: readonly v2.TurnPlanStep[]
  readonly threadId: string
  readonly turnId: string
}

export type CodexTurnModelRerouteSnapshot = {
  readonly fromModel: string
  readonly reason: v2.ModelRerouteReason
  readonly threadId: string
  readonly toModel: string
  readonly turnId: string
}

export type CodexTurnEventSnapshot = {
  readonly notification: ServerNotification
  readonly sequence: number
  readonly threadId: string
  readonly turnId: string
}

export type CodexTurnUpdate =
  | { readonly data: CodexTurnSnapshot; readonly id: string; readonly type: "turn" }
  | { readonly data: CodexTurnItemSnapshot; readonly id: string; readonly type: "item" }
  | { readonly data: CodexTurnDiffSnapshot; readonly id: string; readonly type: "diff" }
  | { readonly data: CodexTurnPlanSnapshot; readonly id: string; readonly type: "plan" }
  | {
      readonly data: CodexTurnModelRerouteSnapshot
      readonly id: string
      readonly type: "model-reroute"
    }
  | { readonly data: CodexTurnEventSnapshot; readonly id: string; readonly type: "event" }

const turnSnapshot = (threadId: string, turn: v2.Turn): CodexTurnSnapshot => {
  const { items: _items, ...snapshot } = turn
  return { ...snapshot, threadId }
}

const appendAt = (values: readonly string[], index: number, delta: string): string[] => {
  const next = [...values]
  while (next.length <= index) next.push("")
  next[index] = `${next[index] ?? ""}${delta}`
  return next
}

const hasTurnScope = (
  notification: ServerNotification,
  threadId: string,
  turnId: string
): boolean => {
  const params: unknown = notification.params
  if (typeof params !== "object" || params === null) return false
  const scoped = params as {
    readonly threadId?: unknown
    readonly turn?: unknown
    readonly turnId?: unknown
  }
  if (scoped.threadId !== threadId) return false
  if (typeof scoped.turnId === "string") return scoped.turnId === turnId
  if (typeof scoped.turn === "object" && scoped.turn !== null && "id" in scoped.turn) {
    return (scoped.turn as { readonly id?: unknown }).id === turnId
  }
  return false
}

export class CodexTurnProjector {
  readonly #items = new Map<string, CodexTurnItemSnapshot>()
  #eventSequence = 0
  #nextItemOrder = 0
  #turn: CodexTurnSnapshot

  constructor(
    readonly threadId: string,
    turn: v2.Turn
  ) {
    this.#turn = turnSnapshot(threadId, turn)
    for (const item of turn.items) {
      this.#items.set(item.id, this.#createItemSnapshot(item))
    }
  }

  initialUpdates(): CodexTurnUpdate[] {
    return [this.#turnUpdate(), ...[...this.#items.values()].map((item) => this.#itemUpdate(item))]
  }

  item(itemId: string): CodexTurnItemSnapshot | undefined {
    return this.#items.get(itemId)
  }

  apply(notification: ServerNotification): CodexTurnUpdate[] {
    if (!hasTurnScope(notification, this.threadId, this.#turn.id)) return []

    switch (notification.method) {
      case "turn/started":
      case "turn/completed":
        return this.#replaceTurn(notification.params.turn)
      case "item/started": {
        const current = this.#items.get(notification.params.item.id)
        const item = this.#createItemSnapshot(notification.params.item, {
          ...current,
          lifecycle: "started",
          startedAtMs: notification.params.startedAtMs,
        })
        this.#items.set(item.item.id, item)
        return [this.#itemUpdate(item)]
      }
      case "item/completed": {
        const current = this.#items.get(notification.params.item.id)
        const item = this.#createItemSnapshot(notification.params.item, {
          ...current,
          completedAtMs: notification.params.completedAtMs,
          lifecycle: "completed",
        })
        this.#items.set(item.item.id, item)
        return [this.#itemUpdate(item)]
      }
      case "item/agentMessage/delta":
        return this.#updateItem(notification.params.itemId, (item) =>
          item.type === "agentMessage"
            ? { ...item, text: `${item.text}${notification.params.delta}` }
            : item
        )
      case "item/plan/delta":
        return this.#updateItem(notification.params.itemId, (item) =>
          item.type === "plan"
            ? { ...item, text: `${item.text}${notification.params.delta}` }
            : item
        )
      case "item/reasoning/textDelta":
        return this.#updateItem(notification.params.itemId, (item) =>
          item.type === "reasoning"
            ? {
                ...item,
                content: appendAt(
                  item.content,
                  notification.params.contentIndex,
                  notification.params.delta
                ),
              }
            : item
        )
      case "item/reasoning/summaryPartAdded":
        return this.#updateItem(notification.params.itemId, (item) =>
          item.type === "reasoning"
            ? { ...item, summary: appendAt(item.summary, notification.params.summaryIndex, "") }
            : item
        )
      case "item/reasoning/summaryTextDelta":
        return this.#updateItem(notification.params.itemId, (item) =>
          item.type === "reasoning"
            ? {
                ...item,
                summary: appendAt(
                  item.summary,
                  notification.params.summaryIndex,
                  notification.params.delta
                ),
              }
            : item
        )
      case "item/commandExecution/outputDelta":
        return this.#updateItem(notification.params.itemId, (item) =>
          item.type === "commandExecution"
            ? {
                ...item,
                aggregatedOutput: `${item.aggregatedOutput ?? ""}${notification.params.delta}`,
              }
            : item
        )
      case "item/fileChange/outputDelta":
        return this.#updateItem(
          notification.params.itemId,
          (item) => item,
          notification.params.delta
        )
      case "item/fileChange/patchUpdated":
        return this.#updateItem(notification.params.itemId, (item) =>
          item.type === "fileChange" ? { ...item, changes: notification.params.changes } : item
        )
      case "item/mcpToolCall/progress":
        return this.#updateItem(
          notification.params.itemId,
          (item) => item,
          notification.params.message
        )
      case "item/commandExecution/terminalInteraction":
        return this.#updateItem(notification.params.itemId, (item) => item, undefined, {
          processId: notification.params.processId,
          stdin: notification.params.stdin,
        })
      case "turn/diff/updated":
        return [
          {
            data: {
              diff: notification.params.diff,
              threadId: this.threadId,
              turnId: this.#turn.id,
            },
            id: `${this.#turn.id}:diff`,
            type: "diff",
          },
        ]
      case "turn/plan/updated":
        return [
          {
            data: {
              explanation: notification.params.explanation,
              plan: notification.params.plan,
              threadId: this.threadId,
              turnId: this.#turn.id,
            },
            id: `${this.#turn.id}:plan`,
            type: "plan",
          },
        ]
      case "model/rerouted":
        return [
          {
            data: { ...notification.params },
            id: `${this.#turn.id}:model-reroute:${this.#eventSequence++}`,
            type: "model-reroute",
          },
        ]
      default:
        return [this.#eventUpdate(notification)]
    }
  }

  #createItemSnapshot(
    item: v2.ThreadItem,
    existing?: Partial<CodexTurnItemSnapshot>
  ): CodexTurnItemSnapshot {
    const order = existing?.order ?? this.#nextItemOrder++
    return {
      completedAtMs: existing?.completedAtMs ?? null,
      item,
      lifecycle:
        existing?.lifecycle ?? (this.#turn.status === "inProgress" ? "started" : "completed"),
      order,
      progress: existing?.progress ?? "",
      startedAtMs: existing?.startedAtMs ?? null,
      terminalInteractions: existing?.terminalInteractions ?? [],
      threadId: this.threadId,
      turnId: this.#turn.id,
    }
  }

  #eventUpdate(notification: ServerNotification): CodexTurnUpdate {
    const sequence = this.#eventSequence++
    return {
      data: {
        notification,
        sequence,
        threadId: this.threadId,
        turnId: this.#turn.id,
      },
      id: `${this.#turn.id}:event:${sequence}`,
      type: "event",
    }
  }

  #itemUpdate(data: CodexTurnItemSnapshot): CodexTurnUpdate {
    return { data, id: data.item.id, type: "item" }
  }

  #replaceTurn(turn: v2.Turn): CodexTurnUpdate[] {
    this.#turn = turnSnapshot(this.threadId, turn)
    const updates: CodexTurnUpdate[] = [this.#turnUpdate()]
    for (const rawItem of turn.items) {
      const current = this.#items.get(rawItem.id)
      const item = this.#createItemSnapshot(rawItem, {
        ...current,
        lifecycle: turn.status === "inProgress" ? (current?.lifecycle ?? "started") : "completed",
      })
      this.#items.set(rawItem.id, item)
      updates.push(this.#itemUpdate(item))
    }
    return updates
  }

  #turnUpdate(): CodexTurnUpdate {
    return { data: this.#turn, id: this.#turn.id, type: "turn" }
  }

  #updateItem(
    itemId: string,
    update: (item: v2.ThreadItem) => v2.ThreadItem,
    progressDelta?: string,
    terminalInteraction?: CodexTerminalInteraction
  ): CodexTurnUpdate[] {
    const current = this.#items.get(itemId)
    if (!current) return []
    const next: CodexTurnItemSnapshot = {
      ...current,
      item: update(current.item),
      progress: `${current.progress}${progressDelta ?? ""}`,
      terminalInteractions: terminalInteraction
        ? [...current.terminalInteractions, terminalInteraction]
        : current.terminalInteractions,
    }
    this.#items.set(itemId, next)
    return [this.#itemUpdate(next)]
  }
}
