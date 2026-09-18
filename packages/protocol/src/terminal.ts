import { z } from "zod"

import { RequestIdSchema } from "./request-id.ts"

export const TerminalIdSchema = z.string().uuid()
export const TerminalSessionSchema = z
  .object({
    cwd: z.string().min(1),
    terminalId: TerminalIdSchema,
    title: z.string().min(1),
  })
  .strict()
export type TerminalSession = z.infer<typeof TerminalSessionSchema>

const request = <const T extends string, S extends z.ZodType>(type: T, payload: S) =>
  z.object({ payload, requestId: RequestIdSchema, type: z.literal(type) })
const result = <S extends z.ZodType>(value: S) =>
  z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value }).strict(),
    z
      .object({
        error: z.object({ code: z.string(), message: z.string() }).strict(),
        ok: z.literal(false),
      })
      .strict(),
  ])
const response = <const T extends string, S extends z.ZodType>(type: T, value: S) =>
  z.object({ payload: result(value), requestId: RequestIdSchema, type: z.literal(type) })
const succeeded = z.object({ succeeded: z.literal(true) }).strict()

export const TerminalOpenRequestSchema = request(
  "terminal.open.request",
  z
    .object({
      cols: z.int().min(2).max(1000).default(100),
      cwd: z.string().min(1).optional(),
      projectId: z.string().uuid().optional(),
      rows: z.int().min(1).max(1000).default(28),
    })
    .strict()
    .refine((value) => !(value.cwd && value.projectId), {
      message: "Choose either cwd or projectId",
    })
)
export const TerminalWriteRequestSchema = request(
  "terminal.write.request",
  z.object({ data: z.string().max(1024 * 1024), terminalId: TerminalIdSchema }).strict()
)
export const TerminalResizeRequestSchema = request(
  "terminal.resize.request",
  z
    .object({
      cols: z.int().min(2).max(1000),
      rows: z.int().min(1).max(1000),
      terminalId: TerminalIdSchema,
    })
    .strict()
)
export const TerminalCloseRequestSchema = request(
  "terminal.close.request",
  z.object({ terminalId: TerminalIdSchema }).strict()
)
export const TerminalCloseAllRequestSchema = request(
  "terminal.close-all.request",
  z.object({}).strict()
)

export const TerminalOpenResponseSchema = response("terminal.open.response", TerminalSessionSchema)
export const TerminalWriteResponseSchema = response("terminal.write.response", succeeded)
export const TerminalResizeResponseSchema = response("terminal.resize.response", succeeded)
export const TerminalCloseResponseSchema = response("terminal.close.response", succeeded)
export const TerminalCloseAllResponseSchema = response("terminal.close-all.response", succeeded)

export const TerminalOutputNotificationSchema = z
  .object({
    payload: z.object({ data: z.string(), terminalId: TerminalIdSchema }).strict(),
    type: z.literal("terminal.output.notification"),
  })
  .strict()
export const TerminalExitedNotificationSchema = z
  .object({
    payload: z.object({ exitCode: z.int(), terminalId: TerminalIdSchema }).strict(),
    type: z.literal("terminal.exited.notification"),
  })
  .strict()

export const TERMINAL_CLIENT_SCHEMAS = [
  TerminalOpenRequestSchema,
  TerminalWriteRequestSchema,
  TerminalResizeRequestSchema,
  TerminalCloseRequestSchema,
  TerminalCloseAllRequestSchema,
] as const
export const TERMINAL_SERVER_SCHEMAS = [
  TerminalOpenResponseSchema,
  TerminalWriteResponseSchema,
  TerminalResizeResponseSchema,
  TerminalCloseResponseSchema,
  TerminalCloseAllResponseSchema,
  TerminalOutputNotificationSchema,
  TerminalExitedNotificationSchema,
] as const
export const TERMINAL_RESPONSE_TYPES = TERMINAL_SERVER_SCHEMAS.slice(0, 5).map(
  (schema) => schema.shape.type.value
)

export type TerminalClientMessage = z.infer<(typeof TERMINAL_CLIENT_SCHEMAS)[number]>
export type TerminalServerMessage = z.infer<(typeof TERMINAL_SERVER_SCHEMAS)[number]>
