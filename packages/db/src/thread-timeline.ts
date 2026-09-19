import { randomUUID } from "node:crypto"

import { and, asc, eq } from "drizzle-orm"

import type { CypheriaDatabase } from "./client.js"
import { threadTimelineEpochs, threadTimelineRows } from "./schema/index.js"

export type PersistedThreadTimelineRow = {
  readonly item: unknown
  readonly harnessItemId: string | null
  readonly seq: number
  readonly timestamp: string
  readonly turnId: string | null
}

export type ThreadTimelineAppendInput = Omit<PersistedThreadTimelineRow, "seq">

export type PersistedThreadTimeline = {
  readonly epoch: string
  readonly rows: readonly PersistedThreadTimelineRow[]
}

export type ThreadTimelinePersistenceService = {
  append(
    threadId: string,
    input: ThreadTimelineAppendInput
  ): Promise<{ epoch: string; row: PersistedThreadTimelineRow }>
  delete(threadId: string): Promise<void>
  get(threadId: string): Promise<PersistedThreadTimeline>
  replace(
    threadId: string,
    rows: readonly ThreadTimelineAppendInput[]
  ): Promise<PersistedThreadTimeline>
}

const readRows = async (
  db: CypheriaDatabase,
  threadId: string,
  epoch: string
): Promise<PersistedThreadTimelineRow[]> =>
  db
    .select({
      item: threadTimelineRows.item,
      harnessItemId: threadTimelineRows.harnessItemId,
      seq: threadTimelineRows.seq,
      timestamp: threadTimelineRows.timestamp,
      turnId: threadTimelineRows.turnId,
    })
    .from(threadTimelineRows)
    .where(and(eq(threadTimelineRows.threadId, threadId), eq(threadTimelineRows.epoch, epoch)))
    .orderBy(asc(threadTimelineRows.seq))

export const createThreadTimelinePersistenceService = (
  db: CypheriaDatabase
): ThreadTimelinePersistenceService => ({
  async append(threadId, input) {
    return db.transaction(async (tx) => {
      let [state] = await tx
        .select()
        .from(threadTimelineEpochs)
        .where(eq(threadTimelineEpochs.threadId, threadId))
        .limit(1)
      if (!state) {
        const epoch = randomUUID()
        await tx.insert(threadTimelineEpochs).values({
          epoch,
          nextSeq: 1,
          threadId,
          updatedAt: Date.now(),
        })
        state = { epoch, nextSeq: 1, threadId, updatedAt: Date.now() }
      }
      const row = { ...input, seq: state.nextSeq }
      await tx.insert(threadTimelineRows).values({ ...row, epoch: state.epoch, threadId })
      await tx
        .update(threadTimelineEpochs)
        .set({ nextSeq: state.nextSeq + 1, updatedAt: Date.now() })
        .where(eq(threadTimelineEpochs.threadId, threadId))
      return { epoch: state.epoch, row }
    })
  },

  async delete(threadId) {
    await db.delete(threadTimelineEpochs).where(eq(threadTimelineEpochs.threadId, threadId))
  },

  async get(threadId) {
    let [state] = await db
      .select()
      .from(threadTimelineEpochs)
      .where(eq(threadTimelineEpochs.threadId, threadId))
      .limit(1)
    if (!state) {
      const epoch = randomUUID()
      await db.insert(threadTimelineEpochs).values({
        epoch,
        nextSeq: 1,
        threadId,
        updatedAt: Date.now(),
      })
      state = { epoch, nextSeq: 1, threadId, updatedAt: Date.now() }
    }
    return { epoch: state.epoch, rows: await readRows(db, threadId, state.epoch) }
  },

  async replace(threadId, inputs) {
    const epoch = randomUUID()
    await db.transaction(async (tx) => {
      await tx.delete(threadTimelineEpochs).where(eq(threadTimelineEpochs.threadId, threadId))
      await tx.insert(threadTimelineEpochs).values({
        epoch,
        nextSeq: inputs.length + 1,
        threadId,
        updatedAt: Date.now(),
      })
      if (inputs.length > 0) {
        await tx.insert(threadTimelineRows).values(
          inputs.map((input, index) => ({
            ...input,
            epoch,
            seq: index + 1,
            threadId,
          }))
        )
      }
    })
    return {
      epoch,
      rows: inputs.map((input, index) => ({ ...input, seq: index + 1 })),
    }
  },
})
