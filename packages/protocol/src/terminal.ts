import { z } from "zod"

import { RequestIdSchema } from "./request-id.ts"

export const TerminalIdSchema = z.string().uuid()
export const TerminalSubscriptionIdSchema = z.string().uuid()
export const TerminalSizeSchema = z
  .object({
    cols: z.int().min(2).max(1000),
    rows: z.int().min(1).max(1000),
  })
  .strict()
export type TerminalSize = z.infer<typeof TerminalSizeSchema>

export const TerminalInfoSchema = z
  .object({
    cols: z.int().min(2).max(1000),
    createdAt: z.int().nonnegative(),
    cwd: z.string().min(1),
    name: z.string().trim().min(1).max(200),
    rows: z.int().min(1).max(1000),
    terminalId: TerminalIdSchema,
    threadId: z.string().uuid(),
    title: z.string().nullable(),
  })
  .strict()
export type TerminalInfo = z.infer<typeof TerminalInfoSchema>

export const TerminalRestoreModeSchema = z.enum(["visible", "full"])
export type TerminalRestoreMode = z.infer<typeof TerminalRestoreModeSchema>

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

export const TerminalListRequestSchema = request(
  "terminal.list.request",
  z.object({ threadId: z.string().uuid() }).strict()
)
export const TerminalCreateRequestSchema = request(
  "terminal.create.request",
  z
    .object({
      name: z.string().trim().min(1).max(200).optional(),
      size: TerminalSizeSchema.default({ cols: 100, rows: 28 }),
      threadId: z.string().uuid(),
    })
    .strict()
)
export const TerminalRenameRequestSchema = request(
  "terminal.rename.request",
  z.object({ name: z.string().trim().min(1).max(200), terminalId: TerminalIdSchema }).strict()
)
export const TerminalCloseRequestSchema = request(
  "terminal.close.request",
  z.object({ terminalId: TerminalIdSchema }).strict()
)
export const TerminalCaptureRequestSchema = request(
  "terminal.capture.request",
  z
    .object({
      end: z.int().optional(),
      start: z.int().optional(),
      terminalId: TerminalIdSchema,
    })
    .strict()
)
export const TerminalDirectorySubscribeRequestSchema = request(
  "terminal.directory.subscribe.request",
  z.object({ threadId: z.string().uuid() }).strict()
)
export const TerminalDirectoryUnsubscribeRequestSchema = request(
  "terminal.directory.unsubscribe.request",
  z.object({ subscriptionId: TerminalSubscriptionIdSchema }).strict()
)
export const TerminalStreamSubscribeRequestSchema = request(
  "terminal.stream.subscribe.request",
  z
    .object({
      restore: TerminalRestoreModeSchema.default("visible"),
      terminalId: TerminalIdSchema,
    })
    .strict()
)
export const TerminalStreamUnsubscribeRequestSchema = request(
  "terminal.stream.unsubscribe.request",
  z.object({ subscriptionId: TerminalSubscriptionIdSchema }).strict()
)

export const TerminalListResponseSchema = response(
  "terminal.list.response",
  z.object({ terminals: z.array(TerminalInfoSchema) }).strict()
)
export const TerminalCreateResponseSchema = response("terminal.create.response", TerminalInfoSchema)
export const TerminalRenameResponseSchema = response("terminal.rename.response", TerminalInfoSchema)
export const TerminalCloseResponseSchema = response("terminal.close.response", succeeded)
export const TerminalCaptureResponseSchema = response(
  "terminal.capture.response",
  z.object({ text: z.string() }).strict()
)
export const TerminalDirectorySubscribeResponseSchema = response(
  "terminal.directory.subscribe.response",
  z
    .object({
      subscriptionId: TerminalSubscriptionIdSchema,
      terminals: z.array(TerminalInfoSchema),
    })
    .strict()
)
export const TerminalDirectoryUnsubscribeResponseSchema = response(
  "terminal.directory.unsubscribe.response",
  succeeded
)
export const TerminalStreamSubscribeResponseSchema = response(
  "terminal.stream.subscribe.response",
  z
    .object({
      slot: z.int().min(0).max(255),
      subscriptionId: TerminalSubscriptionIdSchema,
    })
    .strict()
)
export const TerminalStreamUnsubscribeResponseSchema = response(
  "terminal.stream.unsubscribe.response",
  succeeded
)

export const TerminalDirectoryChangedNotificationSchema = z
  .object({
    payload: z
      .object({
        subscriptionId: TerminalSubscriptionIdSchema,
        terminals: z.array(TerminalInfoSchema),
        threadId: z.string().uuid(),
      })
      .strict(),
    type: z.literal("terminal.directory.changed.notification"),
  })
  .strict()
export const TerminalExitedNotificationSchema = z
  .object({
    payload: z
      .object({
        exitCode: z.int().nullable(),
        reason: z.enum(["exit", "closed", "worker"]),
        signal: z.int().nullable(),
        terminalId: TerminalIdSchema,
      })
      .strict(),
    type: z.literal("terminal.exited.notification"),
  })
  .strict()

export const TERMINAL_CLIENT_SCHEMAS = [
  TerminalListRequestSchema,
  TerminalCreateRequestSchema,
  TerminalRenameRequestSchema,
  TerminalCloseRequestSchema,
  TerminalCaptureRequestSchema,
  TerminalDirectorySubscribeRequestSchema,
  TerminalDirectoryUnsubscribeRequestSchema,
  TerminalStreamSubscribeRequestSchema,
  TerminalStreamUnsubscribeRequestSchema,
] as const
export const TERMINAL_SERVER_SCHEMAS = [
  TerminalListResponseSchema,
  TerminalCreateResponseSchema,
  TerminalRenameResponseSchema,
  TerminalCloseResponseSchema,
  TerminalCaptureResponseSchema,
  TerminalDirectorySubscribeResponseSchema,
  TerminalDirectoryUnsubscribeResponseSchema,
  TerminalStreamSubscribeResponseSchema,
  TerminalStreamUnsubscribeResponseSchema,
  TerminalDirectoryChangedNotificationSchema,
  TerminalExitedNotificationSchema,
] as const
export const TERMINAL_RESPONSE_TYPES = TERMINAL_SERVER_SCHEMAS.slice(0, 9).map(
  (schema) => schema.shape.type.value
)

export type TerminalClientMessage = z.infer<(typeof TERMINAL_CLIENT_SCHEMAS)[number]>
export type TerminalServerMessage = z.infer<(typeof TERMINAL_SERVER_SCHEMAS)[number]>
