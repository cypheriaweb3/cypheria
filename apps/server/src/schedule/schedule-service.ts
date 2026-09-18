import { randomUUID } from "node:crypto"

import type {
  ClaimedScheduleRun,
  SchedulePersistenceService,
  ScheduleRecord,
  ScheduleRunRecord,
} from "@cypheria/db"
import type {
  CreateScheduleInput,
  Schedule,
  ScheduleClientMessage,
  ScheduleRun,
  ScheduleServerMessage,
  ScheduleStatus,
  ServerMessage,
  UpdateScheduleInput,
} from "@cypheria/protocol"
import type { Logger } from "pino"

import type { ThreadManager } from "../thread/thread-manager.js"
import { initialRunAt, nextRunAfter } from "./cron.js"

type Publish = (message: ServerMessage) => void

export type ScheduleServiceOptions = {
  readonly logger: Logger
  readonly persistence: SchedulePersistenceService
  readonly publish: Publish
  readonly requestRuntime: (method: string, params?: unknown) => Promise<unknown>
  readonly threadManager: ThreadManager
  readonly tickMs?: number
}

const toDate = (value: number | null): string | null =>
  value === null ? null : new Date(value).toISOString()

const toSchedule = (record: ScheduleRecord): Schedule => ({
  cadence: record.cadence,
  createdAt: new Date(record.createdAt).toISOString(),
  id: record.id,
  lastRunAt: toDate(record.lastRunAt),
  name: record.name,
  nextRunAt: toDate(record.nextRunAt),
  revision: record.revision,
  status: record.status,
  target: record.target,
  updatedAt: new Date(record.updatedAt).toISOString(),
})

const toRun = (record: ScheduleRunRecord): ScheduleRun => ({
  createdThreadId: record.createdThreadId,
  error: record.error,
  finishedAt: toDate(record.finishedAt),
  id: record.id,
  result: record.result,
  scheduleId: record.scheduleId,
  scheduledFor: new Date(record.scheduledFor).toISOString(),
  startedAt: new Date(record.startedAt).toISOString(),
  status: record.status,
  targetType: record.targetType,
})

export class ScheduleService {
  readonly #logger: Logger
  readonly #persistence: SchedulePersistenceService
  readonly #publish: Publish
  readonly #requestRuntime: ScheduleServiceOptions["requestRuntime"]
  readonly #threadManager: ThreadManager
  readonly #tickMs: number
  #stopping = false
  #timer: NodeJS.Timeout | undefined
  #ticking = false

  constructor(options: ScheduleServiceOptions) {
    this.#logger = options.logger
    this.#persistence = options.persistence
    this.#publish = options.publish
    this.#requestRuntime = options.requestRuntime
    this.#threadManager = options.threadManager
    this.#tickMs = options.tickMs ?? 1_000
  }

  async start(): Promise<void> {
    this.#stopping = false
    const interrupted = await this.#persistence.recoverInterrupted(Date.now())
    for (const run of interrupted) this.#publishRun(run)
    await this.tick()
    this.#timer = setInterval(() => void this.tick(), this.#tickMs)
    this.#timer.unref()
  }

  stop(): void {
    this.#stopping = true
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = undefined
  }

  async tick(now = Date.now()): Promise<void> {
    if (this.#stopping || this.#ticking) return
    this.#ticking = true
    try {
      const due = await this.#persistence.listDue(now)
      for (const schedule of due) {
        if (this.#stopping) break
        const claimed = await this.#claim(schedule, now, false)
        if (claimed) void this.#execute(claimed)
      }
    } catch (error) {
      this.#logger.error({ err: error }, "Schedule tick failed")
    } finally {
      this.#ticking = false
    }
  }

  async create(input: CreateScheduleInput): Promise<Schedule> {
    const now = Date.now()
    const record = await this.#persistence.create(
      {
        cadence: input.cadence,
        name: input.name,
        nextRunAt: initialRunAt(input.cadence, now),
        target: input.target,
      },
      now
    )
    return this.#publishSchedule(record)
  }

  async get(scheduleId: string): Promise<Schedule> {
    const record = await this.#required(scheduleId)
    return toSchedule(record)
  }

  async list(): Promise<Schedule[]> {
    return (await this.#persistence.list()).map(toSchedule)
  }

  async update(input: UpdateScheduleInput): Promise<Schedule> {
    const current = await this.#required(input.scheduleId)
    const now = Date.now()
    const cadence = input.cadence ?? current.cadence
    const record = await this.#persistence.update(
      input.scheduleId,
      {
        ...(input.cadence
          ? { cadence, nextRunAt: initialRunAt(cadence, now), status: "active" }
          : {}),
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.target ? { target: input.target } : {}),
      },
      now
    )
    return this.#publishSchedule(record)
  }

  async pause(scheduleId: string): Promise<Schedule> {
    return this.#publishSchedule(
      await this.#persistence.update(scheduleId, { status: "paused" }, Date.now())
    )
  }

  async resume(scheduleId: string): Promise<Schedule> {
    const current = await this.#required(scheduleId)
    const now = Date.now()
    const nextRunAt =
      current.nextRunAt === null || current.nextRunAt <= now
        ? initialRunAt(current.cadence, now)
        : current.nextRunAt
    return this.#publishSchedule(
      await this.#persistence.update(scheduleId, { nextRunAt, status: "active" }, now)
    )
  }

  async delete(scheduleId: string): Promise<void> {
    if (!(await this.#persistence.delete(scheduleId)))
      throw new Error(`Schedule not found: ${scheduleId}`)
    this.#publish({ payload: { scheduleId }, type: "schedule.deleted.notification" })
  }

  async run(scheduleId: string): Promise<ScheduleRun> {
    const schedule = await this.#required(scheduleId)
    const claimed = await this.#claim(schedule, Date.now(), true)
    if (!claimed) throw new Error(`Schedule is already running: ${scheduleId}`)
    void this.#execute(claimed)
    return toRun(claimed.run)
  }

  async listRuns(scheduleId: string, limit: number): Promise<ScheduleRun[]> {
    await this.#required(scheduleId)
    return (await this.#persistence.listRuns(scheduleId, limit)).map(toRun)
  }

  async handle(
    message: ScheduleClientMessage,
    send: (message: ScheduleServerMessage) => void
  ): Promise<void> {
    try {
      let value: unknown
      switch (message.type) {
        case "schedule.create.request":
          value = await this.create(message.payload)
          break
        case "schedule.get.request":
          value = await this.get(message.payload.scheduleId)
          break
        case "schedule.list.request":
          value = await this.list()
          break
        case "schedule.update.request":
          value = await this.update(message.payload)
          break
        case "schedule.pause.request":
          value = await this.pause(message.payload.scheduleId)
          break
        case "schedule.resume.request":
          value = await this.resume(message.payload.scheduleId)
          break
        case "schedule.delete.request":
          await this.delete(message.payload.scheduleId)
          value = {}
          break
        case "schedule.run.request":
          value = await this.run(message.payload.scheduleId)
          break
        case "schedule.runs.list.request":
          value = await this.listRuns(message.payload.scheduleId, message.payload.limit)
          break
      }
      send({
        payload: { ok: true, value },
        requestId: message.requestId,
        type: message.type.replace(/\.request$/, ".response"),
      } as ScheduleServerMessage)
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      send({
        payload: {
          error: { code: failure.name || "SCHEDULE_ERROR", message: failure.message },
          ok: false,
        },
        requestId: message.requestId,
        type: message.type.replace(/\.request$/, ".response"),
      } as ScheduleServerMessage)
    }
  }

  async #claim(
    schedule: ScheduleRecord,
    now: number,
    manual: boolean
  ): Promise<ClaimedScheduleRun | undefined> {
    const scheduledFor = manual ? now : (schedule.nextRunAt ?? now)
    const nextRunAt = manual
      ? schedule.nextRunAt
      : nextRunAfter(schedule.cadence, scheduledFor, now)
    const status: ScheduleStatus = manual
      ? schedule.status
      : nextRunAt === null
        ? "completed"
        : "active"
    const claimed = await this.#persistence.claim(schedule.id, {
      force: manual,
      lockMs: 5 * 60_000,
      nextRunAt,
      now,
      scheduledFor,
      status,
    })
    if (claimed) {
      this.#publishSchedule(claimed.schedule)
      this.#publishRun(claimed.run)
    }
    return claimed
  }

  async #execute(claimed: ClaimedScheduleRun): Promise<void> {
    let createdThreadId: string | null = null
    try {
      const target = claimed.schedule.target
      let result: unknown
      if (target.type === "new-thread") {
        const created = await this.#threadManager.create({
          agentId: target.agentId,
          cwd: target.cwd,
          title: target.title,
        })
        createdThreadId = created.thread.id
        const turn = await this.#threadManager.startTurn({
          clientMessageId: `schedule:${claimed.run.id}:${randomUUID()}`,
          content: target.content,
          threadId: created.thread.id,
        })
        result = { threadId: created.thread.id, turnId: turn.turnId }
      } else if (target.type === "thread") {
        const turn = await this.#threadManager.startTurn({
          clientMessageId: `schedule:${claimed.run.id}:${randomUUID()}`,
          content: target.content,
          threadId: target.threadId,
        })
        result = { threadId: target.threadId, turnId: turn.turnId }
      } else {
        result = await this.#requestRuntime(target.method, target.params)
      }
      if (this.#stopping) return
      this.#publishRun(
        await this.#persistence.finish(claimed.run.id, {
          createdThreadId,
          now: Date.now(),
          result,
          status: "succeeded",
        })
      )
    } catch (error) {
      if (this.#stopping) return
      const message = error instanceof Error ? error.message : String(error)
      this.#logger.error({ err: error, scheduleId: claimed.schedule.id }, "Schedule run failed")
      this.#publishRun(
        await this.#persistence.finish(claimed.run.id, {
          createdThreadId,
          error: message,
          now: Date.now(),
          status: "failed",
        })
      )
    }
  }

  async #required(scheduleId: string): Promise<ScheduleRecord> {
    const record = await this.#persistence.get(scheduleId)
    if (!record) throw new Error(`Schedule not found: ${scheduleId}`)
    return record
  }

  #publishSchedule(record: ScheduleRecord): Schedule {
    const schedule = toSchedule(record)
    this.#publish({ payload: schedule, type: "schedule.changed.notification" })
    return schedule
  }

  #publishRun(record: ScheduleRunRecord): ScheduleRun {
    const run = toRun(record)
    this.#publish({ payload: run, type: "schedule.run.changed.notification" })
    return run
  }
}
