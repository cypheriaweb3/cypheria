import { randomUUID } from "node:crypto"

import type { ScheduleCadence, ScheduleStatus, ScheduleTarget } from "@cypheria/protocol"
import { and, asc, desc, eq, isNull, lte, or } from "drizzle-orm"

import type { CypheriaDatabase } from "./client.js"
import { scheduleRuns, schedules } from "./schema/index.js"

export type ScheduleRecord = typeof schedules.$inferSelect & {
  cadence: ScheduleCadence
  target: ScheduleTarget
}
export type ScheduleRunRecord = typeof scheduleRuns.$inferSelect

export type CreateScheduleRecordInput = {
  cadence: ScheduleCadence
  name?: string | null
  nextRunAt: number | null
  status?: ScheduleStatus
  target: ScheduleTarget
}

export type UpdateScheduleRecordInput = {
  cadence?: ScheduleCadence
  name?: string | null
  nextRunAt?: number | null
  status?: ScheduleStatus
  target?: ScheduleTarget
}

export type ClaimedScheduleRun = {
  run: ScheduleRunRecord
  schedule: ScheduleRecord
}

export interface SchedulePersistenceService {
  claim(
    scheduleId: string,
    input: {
      force?: boolean
      lockMs: number
      nextRunAt: number | null
      now: number
      scheduledFor: number
      status: ScheduleStatus
    }
  ): Promise<ClaimedScheduleRun | undefined>
  create(input: CreateScheduleRecordInput, now?: number): Promise<ScheduleRecord>
  delete(scheduleId: string): Promise<boolean>
  finish(
    runId: string,
    input: {
      createdThreadId?: string | null
      error?: string | null
      now: number
      result?: unknown
      status: "succeeded" | "failed"
    }
  ): Promise<ScheduleRunRecord>
  get(scheduleId: string): Promise<ScheduleRecord | undefined>
  list(): Promise<ScheduleRecord[]>
  listDue(now: number): Promise<ScheduleRecord[]>
  listRuns(scheduleId: string, limit?: number): Promise<ScheduleRunRecord[]>
  recoverInterrupted(now: number): Promise<ScheduleRunRecord[]>
  update(
    scheduleId: string,
    input: UpdateScheduleRecordInput,
    now?: number
  ): Promise<ScheduleRecord>
}

const castSchedule = (record: typeof schedules.$inferSelect): ScheduleRecord =>
  record as ScheduleRecord

const requireSchedule = async (
  db: CypheriaDatabase,
  scheduleId: string
): Promise<ScheduleRecord> => {
  const [record] = await db.select().from(schedules).where(eq(schedules.id, scheduleId)).limit(1)
  if (!record) throw new Error(`Schedule not found: ${scheduleId}`)
  return castSchedule(record)
}

export const createSchedulePersistenceService = (
  db: CypheriaDatabase
): SchedulePersistenceService => ({
  claim: (scheduleId, input) =>
    db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(schedules)
        .where(eq(schedules.id, scheduleId))
        .limit(1)
      if (
        !current ||
        (!input.force && current.status !== "active") ||
        (!input.force && current.nextRunAt === null) ||
        (!input.force && current.nextRunAt !== null && current.nextRunAt > input.now) ||
        (current.lockExpiresAt !== null && current.lockExpiresAt > input.now)
      ) {
        return undefined
      }

      const runId = randomUUID()
      const [schedule] = await tx
        .update(schedules)
        .set({
          lastRunAt: input.scheduledFor,
          lockExpiresAt: input.now + input.lockMs,
          lockedBy: runId,
          nextRunAt: input.nextRunAt,
          revision: current.revision + 1,
          status: input.status,
          updatedAt: input.now,
        })
        .where(and(eq(schedules.id, scheduleId), eq(schedules.revision, current.revision)))
        .returning()
      if (!schedule) return undefined
      const [run] = await tx
        .insert(scheduleRuns)
        .values({
          createdThreadId: null,
          error: null,
          finishedAt: null,
          id: runId,
          result: null,
          scheduleId,
          scheduledFor: input.scheduledFor,
          startedAt: input.now,
          status: "running",
          targetType: (schedule.target as ScheduleTarget).type,
        })
        .returning()
      if (!run) throw new Error("Schedule run was not created")
      return { run, schedule: castSchedule(schedule) }
    }),
  create: async (input, now = Date.now()) => {
    const [record] = await db
      .insert(schedules)
      .values({
        cadence: input.cadence,
        createdAt: now,
        id: randomUUID(),
        lastRunAt: null,
        lockExpiresAt: null,
        lockedBy: null,
        name: input.name ?? null,
        nextRunAt: input.nextRunAt,
        revision: 0,
        status: input.status ?? "active",
        target: input.target,
        updatedAt: now,
      })
      .returning()
    if (!record) throw new Error("Schedule was not created")
    return castSchedule(record)
  },
  delete: async (scheduleId) => {
    const deleted = await db.delete(schedules).where(eq(schedules.id, scheduleId)).returning()
    return deleted.length > 0
  },
  finish: (runId, input) =>
    db.transaction(async (tx) => {
      const [run] = await tx.select().from(scheduleRuns).where(eq(scheduleRuns.id, runId)).limit(1)
      if (!run) throw new Error(`Schedule run not found: ${runId}`)
      const [finished] = await tx
        .update(scheduleRuns)
        .set({
          createdThreadId: input.createdThreadId ?? null,
          error: input.error ?? null,
          finishedAt: input.now,
          result: input.result ?? null,
          status: input.status,
        })
        .where(and(eq(scheduleRuns.id, runId), eq(scheduleRuns.status, "running")))
        .returning()
      if (!finished) throw new Error(`Schedule run is no longer running: ${runId}`)
      await tx
        .update(schedules)
        .set({ lockExpiresAt: null, lockedBy: null })
        .where(and(eq(schedules.id, run.scheduleId), eq(schedules.lockedBy, runId)))
      return finished
    }),
  get: async (scheduleId) => {
    const [record] = await db.select().from(schedules).where(eq(schedules.id, scheduleId)).limit(1)
    return record ? castSchedule(record) : undefined
  },
  list: async () =>
    (await db.select().from(schedules).orderBy(asc(schedules.createdAt), asc(schedules.id))).map(
      castSchedule
    ),
  listDue: async (now) =>
    (
      await db
        .select()
        .from(schedules)
        .where(
          and(
            eq(schedules.status, "active"),
            lte(schedules.nextRunAt, now),
            or(isNull(schedules.lockExpiresAt), lte(schedules.lockExpiresAt, now))
          )
        )
        .orderBy(asc(schedules.nextRunAt), asc(schedules.id))
    ).map(castSchedule),
  listRuns: (scheduleId, limit = 100) =>
    db
      .select()
      .from(scheduleRuns)
      .where(eq(scheduleRuns.scheduleId, scheduleId))
      .orderBy(desc(scheduleRuns.startedAt), desc(scheduleRuns.id))
      .limit(limit),
  recoverInterrupted: (now) =>
    db.transaction(async (tx) => {
      const running = await tx.select().from(scheduleRuns).where(eq(scheduleRuns.status, "running"))
      if (running.length === 0) return []
      await tx
        .update(scheduleRuns)
        .set({
          error: "Server stopped before the schedule run completed",
          finishedAt: now,
          status: "interrupted",
        })
        .where(eq(scheduleRuns.status, "running"))
      for (const run of running) {
        await tx
          .update(schedules)
          .set({ lockExpiresAt: null, lockedBy: null })
          .where(and(eq(schedules.id, run.scheduleId), eq(schedules.lockedBy, run.id)))
      }
      return tx
        .select()
        .from(scheduleRuns)
        .where(and(eq(scheduleRuns.status, "interrupted"), eq(scheduleRuns.finishedAt, now)))
    }),
  update: async (scheduleId, input, now = Date.now()) => {
    const current = await requireSchedule(db, scheduleId)
    const [record] = await db
      .update(schedules)
      .set({ ...input, revision: current.revision + 1, updatedAt: now })
      .where(and(eq(schedules.id, scheduleId), eq(schedules.revision, current.revision)))
      .returning()
    if (!record) throw new Error(`Schedule changed concurrently: ${scheduleId}`)
    return castSchedule(record)
  },
})
