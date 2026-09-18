import { describe, expect, it, vi } from "vitest"

import { createArtifactActions } from "./artifact.js"
import type { TimelineActions } from "./thread.js"

describe("artifact actions", () => {
  it("projects canonical artifact rows without hiding timeline cursors", async () => {
    const epoch = crypto.randomUUID()
    const get = vi.fn(async () => ({
      canonicalRows: [
        {
          item: {
            itemId: "artifact-1",
            kind: "image" as const,
            mimeType: "image/png",
            name: "result.png",
            type: "artifact" as const,
            uri: "artifact://artifact-1",
          },
          providerItemId: "native-1",
          seq: 1,
          timestamp: "2026-09-19T00:00:00.000Z",
          turnId: "turn-1",
        },
        {
          item: {
            itemId: "status-1",
            message: "Done",
            status: "completed" as const,
            type: "status" as const,
          },
          providerItemId: null,
          seq: 2,
          timestamp: "2026-09-19T00:00:01.000Z",
          turnId: "turn-1",
        },
      ],
      endCursor: { epoch, seq: 2 },
      epoch,
      hasNewer: false,
      hasOlder: false,
      projectedItems: [],
      projection: "canonical" as const,
      reset: false,
      startCursor: null,
      threadId: "thread-1",
    }))
    const artifacts = createArtifactActions({ get } as unknown as TimelineActions)

    const page = await artifacts.list({ limit: 25, threadId: "thread-1" })

    expect(get).toHaveBeenCalledWith(
      {
        cursor: undefined,
        direction: "tail",
        limit: 25,
        projection: "canonical",
        threadId: "thread-1",
      },
      undefined
    )
    expect(page.artifacts.map((row) => row.item.itemId)).toEqual(["artifact-1"])
    expect(page.endCursor?.seq).toBe(2)
  })
})
