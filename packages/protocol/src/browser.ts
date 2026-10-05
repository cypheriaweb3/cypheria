import { z } from "zod"

import { ProjectThreadIdSchema } from "./project-thread.ts"
import { RequestIdSchema } from "./request-id.ts"

export const BrowserTabKindSchema = z.enum(["web", "dapp"])
export type BrowserTabKind = z.infer<typeof BrowserTabKindSchema>

const BROWSER_ID_MESSAGE = "browserId must be a built-in browser tab ID"

/** A built-in browser tab's ID, which the window that opened it assigns. */
export const BrowserIdSchema = z
  .string({ error: () => BROWSER_ID_MESSAGE })
  .uuid(BROWSER_ID_MESSAGE)
export type BrowserId = z.infer<typeof BrowserIdSchema>

/** The browser backends a window serves: its built-in browser tabs and the MCP Apps it shows. */
export const BrowserHostBackendSchema = z.enum(["iab", "mcpapps"])
export type BrowserHostBackend = z.infer<typeof BrowserHostBackendSchema>

/**
 * One window offering itself as a browser host. Every window registers on its own connection,
 * even when windows share a client ID, so each keeps its own tabs and Apps.
 */
export const BrowserHostRegistrationSchema = z
  .object({
    /** The device's name as people know it, such as its host name. */
    name: z.string().trim().min(1).max(128).optional(),
    backends: z
      .array(BrowserHostBackendSchema)
      .min(1)
      .transform((backends) => [...new Set(backends)]),
  })
  .strict()
export type BrowserHostRegistration = z.infer<typeof BrowserHostRegistrationSchema>
export type BrowserHostRegistrationInput = z.input<typeof BrowserHostRegistrationSchema>

/**
 * One browser request for a window. `request` follows the browser host grammar `@cypheria/cua`
 * owns; the Server validates it before sending and the window validates it again.
 */
export const BrowserAutomationRequestSchema = z
  .object({
    automationId: z.string().min(1).max(256),
    backend: BrowserHostBackendSchema,
    cwd: z.string().min(1).optional(),
    request: z.record(z.string(), z.unknown()),
    threadId: ProjectThreadIdSchema,
  })
  .strict()
export type BrowserAutomationRequest = z.infer<typeof BrowserAutomationRequestSchema>

export const BrowserAutomationErrorSchema = z
  .object({
    code: z.string().min(1).max(64),
    message: z.string().min(1),
    retryable: z.boolean().default(false),
  })
  .strict()
export type BrowserAutomationError = z.infer<typeof BrowserAutomationErrorSchema>

export const BrowserAutomationOutcomeSchema = z.discriminatedUnion("ok", [
  z
    .object({ automationId: z.string().min(1).max(256), ok: z.literal(true), value: z.unknown() })
    .strict(),
  z
    .object({
      automationId: z.string().min(1).max(256),
      error: BrowserAutomationErrorSchema,
      ok: z.literal(false),
    })
    .strict(),
])
export type BrowserAutomationOutcome = z.infer<typeof BrowserAutomationOutcomeSchema>
export type BrowserAutomationOutcomeInput = z.input<typeof BrowserAutomationOutcomeSchema>

const request = <const T extends string, S extends z.ZodType>(type: T, payload: S) =>
  z.object({ payload, requestId: RequestIdSchema, type: z.literal(type) }).strict()
const response = <const T extends string, S extends z.ZodType>(type: T, value: S) =>
  z
    .object({
      payload: z.discriminatedUnion("ok", [
        z.object({ ok: z.literal(true), value }).strict(),
        z
          .object({
            error: z.object({ code: z.string(), message: z.string() }).strict(),
            ok: z.literal(false),
          })
          .strict(),
      ]),
      requestId: RequestIdSchema,
      type: z.literal(type),
    })
    .strict()
const succeeded = z.object({ succeeded: z.literal(true) }).strict()

export const BrowserHostRegisterRequestSchema = request(
  "browser.host.register.request",
  BrowserHostRegistrationSchema
)
export const BrowserHostUnregisterRequestSchema = request(
  "browser.host.unregister.request",
  z.object({}).strict()
)
export const BrowserAutomationResultRequestSchema = request(
  "browser.automation.result.request",
  BrowserAutomationOutcomeSchema
)

export const BrowserHostRegisterResponseSchema = response(
  "browser.host.register.response",
  succeeded
)
export const BrowserHostUnregisterResponseSchema = response(
  "browser.host.unregister.response",
  succeeded
)
export const BrowserAutomationResultResponseSchema = response(
  "browser.automation.result.response",
  z.object({ accepted: z.boolean() }).strict()
)

/** Server-to-window request. The window answers with `browser.automation.result.request`. */
export const BrowserAutomationCommandNotificationSchema = z
  .object({
    payload: BrowserAutomationRequestSchema,
    type: z.literal("browser.automation.command.notification"),
  })
  .strict()

export const BROWSER_CLIENT_SCHEMAS = [
  BrowserHostRegisterRequestSchema,
  BrowserHostUnregisterRequestSchema,
  BrowserAutomationResultRequestSchema,
] as const
export const BROWSER_SERVER_SCHEMAS = [
  BrowserHostRegisterResponseSchema,
  BrowserHostUnregisterResponseSchema,
  BrowserAutomationResultResponseSchema,
  BrowserAutomationCommandNotificationSchema,
] as const
export const BROWSER_RESPONSE_TYPES = BROWSER_SERVER_SCHEMAS.slice(0, 3).map(
  (schema) => schema.shape.type.value
)

export type BrowserClientMessage = z.infer<(typeof BROWSER_CLIENT_SCHEMAS)[number]>
export type BrowserServerMessage = z.infer<(typeof BROWSER_SERVER_SCHEMAS)[number]>
