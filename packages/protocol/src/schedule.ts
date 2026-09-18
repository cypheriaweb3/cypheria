import { z } from "zod"

import { AgentIdSchema } from "./agent/registry.ts"
import { ProjectThreadIdSchema } from "./project-thread.ts"
import { RequestIdSchema } from "./request-id.ts"
import { ThreadInputBlockSchema } from "./thread.ts"

export const ScheduleCadenceSchema = z.discriminatedUnion("type", [
  z.object({ at: z.iso.datetime(), type: z.literal("once") }),
  z.object({ everyMs: z.int().min(1_000), type: z.literal("interval") }),
  z.object({
    expression: z.string().trim().min(1).max(256),
    timezone: z.string().trim().min(1).max(128).optional(),
    type: z.literal("cron"),
  }),
])
export type ScheduleCadence = z.infer<typeof ScheduleCadenceSchema>

export const ScheduleTargetSchema = z.discriminatedUnion("type", [
  z.object({
    agentId: AgentIdSchema,
    content: z.array(ThreadInputBlockSchema).min(1),
    cwd: z.string().trim().min(1).nullable().optional(),
    title: z.string().trim().min(1).nullable().optional(),
    type: z.literal("new-thread"),
  }),
  z.object({
    content: z.array(ThreadInputBlockSchema).min(1),
    threadId: ProjectThreadIdSchema,
    type: z.literal("thread"),
  }),
  z.object({
    method: z
      .string()
      .trim()
      .regex(/^(wallet|chain|policy|browser|dapp)\.[A-Za-z0-9._-]+$/),
    params: z.unknown().optional(),
    type: z.literal("web3"),
  }),
])
export type ScheduleTarget = z.infer<typeof ScheduleTargetSchema>

export const ScheduleStatusSchema = z.enum(["active", "paused", "completed"])
export type ScheduleStatus = z.infer<typeof ScheduleStatusSchema>

export const ScheduleRunStatusSchema = z.enum(["running", "succeeded", "failed", "interrupted"])
export type ScheduleRunStatus = z.infer<typeof ScheduleRunStatusSchema>

export const ScheduleSchema = z.object({
  cadence: ScheduleCadenceSchema,
  createdAt: z.iso.datetime(),
  id: z.uuid(),
  lastRunAt: z.iso.datetime().nullable(),
  name: z.string().trim().min(1).nullable(),
  nextRunAt: z.iso.datetime().nullable(),
  revision: z.int().nonnegative(),
  status: ScheduleStatusSchema,
  target: ScheduleTargetSchema,
  updatedAt: z.iso.datetime(),
})
export type Schedule = z.infer<typeof ScheduleSchema>

export const ScheduleRunSchema = z.object({
  createdThreadId: ProjectThreadIdSchema.nullable(),
  error: z.string().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  id: z.uuid(),
  result: z.unknown().nullable(),
  scheduleId: z.uuid(),
  scheduledFor: z.iso.datetime(),
  startedAt: z.iso.datetime(),
  status: ScheduleRunStatusSchema,
  targetType: z.enum(["new-thread", "thread", "web3"]),
})
export type ScheduleRun = z.infer<typeof ScheduleRunSchema>

const createInputSchema = z.object({
  cadence: ScheduleCadenceSchema,
  name: z.string().trim().min(1).nullable().optional(),
  target: ScheduleTargetSchema,
})
export type CreateScheduleInput = z.input<typeof createInputSchema>

const updateInputSchema = z.object({
  cadence: ScheduleCadenceSchema.optional(),
  name: z.string().trim().min(1).nullable().optional(),
  scheduleId: z.uuid(),
  target: ScheduleTargetSchema.optional(),
})
export type UpdateScheduleInput = z.input<typeof updateInputSchema>

const request = <T extends string, S extends z.ZodType>(type: T, payload: S) =>
  z.object({ payload, requestId: RequestIdSchema, type: z.literal(type) })
const errorSchema = z.object({ code: z.string().min(1), message: z.string().min(1) })
const resultSchema = <S extends z.ZodType>(schema: S) =>
  z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value: schema }),
    z.object({ error: errorSchema, ok: z.literal(false) }),
  ])
const response = <T extends string, S extends z.ZodType>(type: T, value: S) =>
  z.object({ payload: resultSchema(value), requestId: RequestIdSchema, type: z.literal(type) })

export const ScheduleCreateRequestSchema = request("schedule.create.request", createInputSchema)
export const ScheduleGetRequestSchema = request(
  "schedule.get.request",
  z.object({ scheduleId: z.uuid() })
)
export const ScheduleListRequestSchema = request("schedule.list.request", z.object({}))
export const ScheduleUpdateRequestSchema = request("schedule.update.request", updateInputSchema)
export const SchedulePauseRequestSchema = request(
  "schedule.pause.request",
  z.object({ scheduleId: z.uuid() })
)
export const ScheduleResumeRequestSchema = request(
  "schedule.resume.request",
  z.object({ scheduleId: z.uuid() })
)
export const ScheduleDeleteRequestSchema = request(
  "schedule.delete.request",
  z.object({ scheduleId: z.uuid() })
)
export const ScheduleRunRequestSchema = request(
  "schedule.run.request",
  z.object({ scheduleId: z.uuid() })
)
export const ScheduleRunsListRequestSchema = request(
  "schedule.runs.list.request",
  z.object({ limit: z.int().min(1).max(500).default(100), scheduleId: z.uuid() })
)

const emptySchema = z.object({})
export const ScheduleCreateResponseSchema = response("schedule.create.response", ScheduleSchema)
export const ScheduleGetResponseSchema = response("schedule.get.response", ScheduleSchema)
export const ScheduleListResponseSchema = response(
  "schedule.list.response",
  z.array(ScheduleSchema)
)
export const ScheduleUpdateResponseSchema = response("schedule.update.response", ScheduleSchema)
export const SchedulePauseResponseSchema = response("schedule.pause.response", ScheduleSchema)
export const ScheduleResumeResponseSchema = response("schedule.resume.response", ScheduleSchema)
export const ScheduleDeleteResponseSchema = response("schedule.delete.response", emptySchema)
export const ScheduleRunResponseSchema = response("schedule.run.response", ScheduleRunSchema)
export const ScheduleRunsListResponseSchema = response(
  "schedule.runs.list.response",
  z.array(ScheduleRunSchema)
)

export const ScheduleChangedNotificationSchema = z.object({
  payload: ScheduleSchema,
  type: z.literal("schedule.changed.notification"),
})
export const ScheduleDeletedNotificationSchema = z.object({
  payload: z.object({ scheduleId: z.uuid() }),
  type: z.literal("schedule.deleted.notification"),
})
export const ScheduleRunChangedNotificationSchema = z.object({
  payload: ScheduleRunSchema,
  type: z.literal("schedule.run.changed.notification"),
})

export const SCHEDULE_CLIENT_SCHEMAS = [
  ScheduleCreateRequestSchema,
  ScheduleGetRequestSchema,
  ScheduleListRequestSchema,
  ScheduleUpdateRequestSchema,
  SchedulePauseRequestSchema,
  ScheduleResumeRequestSchema,
  ScheduleDeleteRequestSchema,
  ScheduleRunRequestSchema,
  ScheduleRunsListRequestSchema,
] as const

export const SCHEDULE_SERVER_SCHEMAS = [
  ScheduleCreateResponseSchema,
  ScheduleGetResponseSchema,
  ScheduleListResponseSchema,
  ScheduleUpdateResponseSchema,
  SchedulePauseResponseSchema,
  ScheduleResumeResponseSchema,
  ScheduleDeleteResponseSchema,
  ScheduleRunResponseSchema,
  ScheduleRunsListResponseSchema,
  ScheduleChangedNotificationSchema,
  ScheduleDeletedNotificationSchema,
  ScheduleRunChangedNotificationSchema,
] as const

export const SCHEDULE_RESPONSE_TYPES = SCHEDULE_SERVER_SCHEMAS.flatMap((schema) => {
  const type = schema.shape.type.value
  return type.endsWith(".response") ? [type] : []
})

export type ScheduleClientMessage = z.infer<(typeof SCHEDULE_CLIENT_SCHEMAS)[number]>
export type ScheduleServerMessage = z.infer<(typeof SCHEDULE_SERVER_SCHEMAS)[number]>
