import {
  projectThreadTimelineRows,
  type ThreadSummary,
  type ThreadSummaryEntry,
  type ThreadSummarySection,
  type ThreadTimelineRow,
} from "@cypheria/protocol"

const section = (entries: ThreadSummaryEntry[]): ThreadSummarySection => ({
  count: entries.length,
  entries: entries.slice(-50).reverse(),
})

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const agentStatus = (value: unknown): ThreadSummaryEntry["status"] => {
  switch (value) {
    case "pendingInit":
      return "pending"
    case "running":
      return "running"
    case "completed":
      return "completed"
    case "interrupted":
    case "shutdown":
      return "cancelled"
    case "errored":
    case "notFound":
      return "failed"
    default:
      return null
  }
}

/** A compact, rebuildable projection of the entire canonical history. */
export function projectThreadSummary(
  threadId: string,
  epoch: string,
  rows: readonly ThreadTimelineRow[]
): ThreadSummary {
  const outputs = new Map<string, ThreadSummaryEntry>()
  const sources = new Map<string, ThreadSummaryEntry>()
  const subagents = new Map<string, ThreadSummaryEntry>()
  let plan: ThreadSummaryEntry[] = []
  const upsert = (
    target: Map<string, ThreadSummaryEntry>,
    key: string,
    entry: ThreadSummaryEntry
  ) => {
    target.delete(key)
    target.set(key, entry)
  }

  for (const { item } of projectThreadTimelineRows(rows)) {
    if (item.type === "artifact") {
      const key = `artifact:${item.uri}`
      upsert(outputs, key, {
        itemId: item.itemId,
        label: item.name,
        detail: item.kind,
        status: null,
        uri: item.uri,
      })
    } else if (item.type === "diff") {
      for (const change of item.changes) {
        const key = `file:${change.path}`
        upsert(outputs, key, {
          itemId: item.itemId,
          label: change.path,
          detail: change.kind,
          status: item.status,
          uri: null,
        })
      }
    } else if (item.type === "plan") {
      plan = item.entries.map((entry) => ({
        itemId: item.itemId,
        label: entry.text,
        detail: null,
        status:
          entry.status === "in_progress"
            ? "running"
            : entry.status === "pending"
              ? "pending"
              : "completed",
        uri: null,
      }))
    } else if (item.type === "message" && item.role === "user") {
      for (const block of item.input ?? []) {
        if (block.type === "reference") {
          const key = `${block.kind}:${block.id}`
          upsert(sources, key, {
            itemId: item.itemId,
            label: block.label,
            detail: block.kind,
            status: null,
            uri: block.id,
          })
        } else if (block.type === "resource-link" || block.type === "embedded-resource") {
          upsert(sources, block.uri, {
            itemId: item.itemId,
            label: block.name ?? block.uri,
            detail: block.type,
            status: null,
            uri: block.uri,
          })
        } else if (block.type === "uploaded-file") {
          upsert(sources, block.fileId, {
            itemId: item.itemId,
            label: block.fileId,
            detail: block.type,
            status: null,
            uri: null,
          })
        }
      }
    } else if (item.type === "tool") {
      if (item.harnessData?.nativeType === "codex.item.collabAgentToolCall") {
        const input = record(item.input)
        const states = record(item.output)
        const ids = Array.isArray(input?.receiverThreadIds)
          ? input.receiverThreadIds.filter((id): id is string => typeof id === "string")
          : []
        for (const id of ids) {
          const state = record(states?.[id])
          upsert(subagents, id, {
            itemId: item.itemId,
            label: id,
            detail: item.name,
            status: agentStatus(state?.status) ?? item.status,
            uri: null,
          })
        }
      }
      const candidates = Array.isArray(item.output) ? item.output : [item.output]
      for (const candidate of candidates) {
        const value = record(candidate)
        if (!value || typeof value.url !== "string" || !/^https?:\/\//u.test(value.url)) continue
        upsert(sources, value.url, {
          itemId: item.itemId,
          label: typeof value.title === "string" ? value.title : value.url,
          detail: item.name,
          status: item.status,
          uri: value.url,
        })
      }
    } else if (item.type === "harness" && item.nativeType.toLowerCase().includes("subagent")) {
      const payload = record(item.payload)
      const native = record(payload?.item) ?? payload
      upsert(subagents, String(native?.agentThreadId ?? native?.agentPath ?? item.itemId), {
        itemId: item.itemId,
        label: String(native?.agentPath ?? native?.agentThreadId ?? "Subagent"),
        detail: typeof native?.kind === "string" ? native.kind : null,
        status: item.status ?? null,
        uri: null,
      })
    }
  }

  return {
    epoch,
    outputs: section([...outputs.values()]),
    sources: section([...sources.values()]),
    subagents: section([...subagents.values()]),
    plan: { count: plan.length, entries: plan.slice(0, 50) },
    threadId,
  }
}
