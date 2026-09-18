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
    let candidates = timeline.rows
    if (cursor && options.direction === "before") {
      candidates = timeline.rows.filter((row) => row.seq < cursor.seq)
    } else if (cursor && options.direction === "after") {
      candidates = timeline.rows.filter((row) => row.seq > cursor.seq)
    }
    const rows =
      options.direction === "after"
        ? candidates.slice(0, options.limit)
        : candidates.slice(Math.max(0, candidates.length - options.limit))
    const first = rows[0]
    const last = rows.at(-1)
    return {
      canonicalRows: options.projection === "canonical" ? rows : [],
      endCursor: last ? { epoch: timeline.epoch, seq: last.seq } : null,
      epoch: timeline.epoch,
      hasNewer: last ? last.seq < timeline.rows.length : false,
      hasOlder: first ? first.seq > 1 : false,
      projectedItems: options.projection === "projected" ? projectThreadTimelineRows(rows) : [],
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
