import type {
  ThreadTimelineCursor,
  ThreadTimelineDirection,
  ThreadTimelineItem,
  ThreadTimelineRow,
} from "@cypheria/protocol"

import type { RequestOptions } from "./request-options.js"
import type { TimelineActions } from "./thread.js"

export type ArtifactTimelineItem = Extract<ThreadTimelineItem, { type: "artifact" }>
export type ArtifactTimelineRow = Omit<ThreadTimelineRow, "item"> & {
  readonly item: ArtifactTimelineItem
}

export type ArtifactPage = {
  readonly artifacts: readonly ArtifactTimelineRow[]
  readonly endCursor: ThreadTimelineCursor | null
  readonly epoch: string
  readonly hasNewer: boolean
  readonly hasOlder: boolean
  readonly startCursor: ThreadTimelineCursor | null
  readonly threadId: string
}

export interface ArtifactActions {
  list(
    input: {
      cursor?: ThreadTimelineCursor
      direction?: ThreadTimelineDirection
      limit?: number
      threadId: string
    },
    options?: RequestOptions
  ): Promise<ArtifactPage>
}

export const createArtifactActions = (timeline: TimelineActions): ArtifactActions => ({
  list: async (input, options) => {
    const page = await timeline.get(
      {
        cursor: input.cursor,
        direction: input.direction ?? "tail",
        limit: input.limit ?? 100,
        projection: "canonical",
        threadId: input.threadId,
      },
      options
    )
    return {
      artifacts: page.canonicalRows.filter(
        (row): row is ArtifactTimelineRow => row.item.type === "artifact"
      ),
      endCursor: page.endCursor,
      epoch: page.epoch,
      hasNewer: page.hasNewer,
      hasOlder: page.hasOlder,
      startCursor: page.startCursor,
      threadId: page.threadId,
    }
  },
})
