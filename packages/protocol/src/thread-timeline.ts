import type { z } from "zod"
import type {
  ThreadTimelineItem,
  ThreadTimelineProjectedItem,
  ThreadTimelineRow,
  ThreadTimelineSourceRangeSchema,
} from "./thread.ts"

type SourceRange = z.infer<typeof ThreadTimelineSourceRangeSchema>

const appendSourceRange = (ranges: SourceRange[], seq: number): SourceRange[] => {
  const previous = ranges.at(-1)
  if (previous?.end === seq - 1) {
    return [...ranges.slice(0, -1), { end: seq, start: previous.start }]
  }
  return [...ranges, { end: seq, start: seq }]
}

const mergeTimelineItem = (
  previous: ThreadTimelineItem,
  next: ThreadTimelineItem
): ThreadTimelineItem => {
  if (previous.itemId !== next.itemId || previous.type !== next.type) return next
  if (previous.type === "message" && next.type === "message" && previous.role === next.role) {
    return {
      ...next,
      attachments: next.attachments ?? previous.attachments,
      text: next.operation === "append" ? previous.text + next.text : next.text,
      operation: "replace",
    }
  }
  if (previous.type === "reasoning" && next.type === "reasoning") {
    return {
      ...next,
      text: next.operation === "append" ? previous.text + next.text : next.text,
      operation: "replace",
    }
  }
  return next
}

/**
 * Folds append-only canonical rows into stable display items while retaining exact source coverage.
 * The first occurrence fixes display order; later rows with the same item id update that item.
 */
export const projectThreadTimelineRows = (
  rows: readonly ThreadTimelineRow[]
): ThreadTimelineProjectedItem[] => {
  const projected: ThreadTimelineProjectedItem[] = []
  const indexByItemId = new Map<string, number>()

  for (const row of rows) {
    const existingIndex = indexByItemId.get(row.item.itemId)
    if (existingIndex === undefined) {
      indexByItemId.set(row.item.itemId, projected.length)
      projected.push({
        collapsed: false,
        item: row.item,
        seqEnd: row.seq,
        seqStart: row.seq,
        sourceSeqRanges: [{ end: row.seq, start: row.seq }],
        timestamp: row.timestamp,
        turnId: row.turnId,
      })
      continue
    }

    const previous = projected[existingIndex]
    if (!previous) continue
    projected[existingIndex] = {
      ...previous,
      collapsed: true,
      item: mergeTimelineItem(previous.item, row.item),
      seqEnd: Math.max(previous.seqEnd, row.seq),
      sourceSeqRanges: appendSourceRange(previous.sourceSeqRanges, row.seq),
      turnId: row.turnId ?? previous.turnId,
    }
  }

  return projected
}
