import { randomUUID } from "node:crypto"

import {
  projectThreadTimelineRows,
  type ThreadTimelinePage,
  type ThreadTimelineProjection,
  type ThreadTimelineRow,
} from "@cypheria/protocol"

import type { ThreadProviderHistoryItem } from "./provider-adapter.js"

type Timeline = { epoch: string; rows: ThreadTimelineRow[] }

export class ThreadTimelineStore {
  readonly #timelines = new Map<string, Timeline>()

  append(
    threadId: string,
    input: ThreadProviderHistoryItem
  ): { epoch: string; row: ThreadTimelineRow } {
    const timeline = this.#get(threadId)
    const row: ThreadTimelineRow = {
      item: input.item,
      providerItemId: input.providerItemId ?? null,
      seq: timeline.rows.length + 1,
      timestamp: input.timestamp ?? new Date().toISOString(),
      turnId: input.turnId ?? null,
    }
    timeline.rows.push(row)
    return { epoch: timeline.epoch, row }
  }

  delete(threadId: string): void {
    this.#timelines.delete(threadId)
  }

  head(threadId: string): { endCursor: { epoch: string; seq: number } | null; epoch: string } {
    const timeline = this.#get(threadId)
    const last = timeline.rows.at(-1)
    return {
      endCursor: last ? { epoch: timeline.epoch, seq: last.seq } : null,
      epoch: timeline.epoch,
    }
  }

  page(
    threadId: string,
    options: {
      cursor?: { epoch: string; seq: number }
      direction: "tail" | "before" | "after"
      limit: number
      projection: ThreadTimelineProjection
    }
  ): ThreadTimelinePage {
    const timeline = this.#get(threadId)
    const reset = options.cursor !== undefined && options.cursor.epoch !== timeline.epoch
    const cursor = reset ? undefined : options.cursor
    const direction = reset ? "tail" : options.direction

    if (options.projection === "projected") {
      const sourceRows = cursor
        ? direction === "before"
          ? timeline.rows.filter((row) => row.seq < cursor.seq)
          : direction === "after"
            ? timeline.rows.filter((row) => row.seq > cursor.seq)
            : timeline.rows
        : timeline.rows
      const all = projectThreadTimelineRows(sourceRows)
      const selected =
        direction === "after"
          ? all.slice(0, options.limit)
          : all.slice(Math.max(0, all.length - options.limit))
      let projectedItems = selected
      if (selected.length > 0) {
        let minSeq = Math.min(...selected.map((entry) => entry.seqStart))
        let maxSeq = Math.max(...selected.map((entry) => entry.seqEnd))
        for (let index = 0; index <= all.length; index += 1) {
          const overlapping = all.filter(
            (entry) => entry.seqStart <= maxSeq && entry.seqEnd >= minSeq
          )
          const nextMin = Math.min(...overlapping.map((entry) => entry.seqStart))
          const nextMax = Math.max(...overlapping.map((entry) => entry.seqEnd))
          projectedItems = overlapping
          if (nextMin === minSeq && nextMax === maxSeq) break
          minSeq = nextMin
          maxSeq = nextMax
        }
      }
      const startSeq =
        projectedItems.length > 0
          ? Math.min(...projectedItems.map((entry) => entry.seqStart))
          : null
      const endSeq =
        projectedItems.length > 0 ? Math.max(...projectedItems.map((entry) => entry.seqEnd)) : null
      const minimum = timeline.rows[0]?.seq ?? 1
      const maximum = timeline.rows.at(-1)?.seq ?? 0
      return {
        canonicalRows: [],
        endCursor: endSeq === null ? null : { epoch: timeline.epoch, seq: endSeq },
        epoch: timeline.epoch,
        hasNewer: endSeq !== null && endSeq < maximum,
        hasOlder: startSeq !== null && startSeq > minimum,
        projectedItems,
        projection: options.projection,
        reset,
        startCursor: startSeq === null ? null : { epoch: timeline.epoch, seq: startSeq },
        threadId,
      }
    }

    let candidates = timeline.rows
    if (cursor && direction === "before") {
      candidates = timeline.rows.filter((row) => row.seq < cursor.seq)
    } else if (cursor && direction === "after") {
      candidates = timeline.rows.filter((row) => row.seq > cursor.seq)
    }
    const rows =
      direction === "after"
        ? candidates.slice(0, options.limit)
        : candidates.slice(Math.max(0, candidates.length - options.limit))
    const first = rows[0]
    const last = rows.at(-1)
    return {
      canonicalRows: rows,
      endCursor: last ? { epoch: timeline.epoch, seq: last.seq } : null,
      epoch: timeline.epoch,
      hasNewer: last ? last.seq < timeline.rows.length : false,
      hasOlder: first ? first.seq > 1 : false,
      projectedItems: [],
      projection: options.projection,
      reset,
      startCursor: first ? { epoch: timeline.epoch, seq: first.seq } : null,
      threadId,
    }
  }

  replace(threadId: string, history: readonly ThreadProviderHistoryItem[]): { epoch: string } {
    const epoch = randomUUID()
    const timeline: Timeline = { epoch, rows: [] }
    this.#timelines.set(threadId, timeline)
    for (const item of history) this.append(threadId, item)
    return { epoch }
  }

  #get(threadId: string): Timeline {
    let timeline = this.#timelines.get(threadId)
    if (!timeline) {
      timeline = { epoch: randomUUID(), rows: [] }
      this.#timelines.set(threadId, timeline)
    }
    return timeline
  }
}
