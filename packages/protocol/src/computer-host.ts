import { z } from "zod"

import { ProjectThreadIdSchema } from "./project-thread.ts"
import { RequestIdSchema } from "./request-id.ts"

/**
 * What a device offers beyond its windows: the user's external browsers (`chrome`) and native
 * apps (`computer`). Built-in browser tabs and MCP Apps belong to windows and use the browser
 * host messages.
 */
export const ComputerHostCapabilitySchema = z.enum(["chrome", "computer"])
export type ComputerHostCapability = z.infer<typeof ComputerHostCapabilitySchema>

/**
 * A client offering its device as a Computer Use host. The Server keys the host by the client ID,
 * so every window of one client registers the same host; any of them may carry its commands.
 */
export const ComputerHostRegistrationSchema = z
  .object({
    /** The device's name as people know it, such as its host name. */
    name: z.string().trim().min(1).max(128),
    capabilities: z
      .array(ComputerHostCapabilitySchema)
      .transform((capabilities) => [...new Set(capabilities)]),
  })
  .strict()
export type ComputerHostRegistration = z.infer<typeof ComputerHostRegistrationSchema>
export type ComputerHostRegistrationInput = z.input<typeof ComputerHostRegistrationSchema>

/**
 * One Computer Use request for the device. `request` follows the grammar `@cypheria/cua` owns;
 * the Server validates it before sending and the device validates it again before acting.
 */
export const ComputerHostRequestSchema = z
  .object({
    commandId: RequestIdSchema,
    cwd: z.string().min(1).optional(),
    request: z.record(z.string(), z.unknown()),
    threadId: ProjectThreadIdSchema,
  })
  .strict()
export type ComputerHostRequest = z.infer<typeof ComputerHostRequestSchema>

export const ComputerHostOutcomeSchema = z.discriminatedUnion("ok", [
  z.object({ commandId: RequestIdSchema, ok: z.literal(true), value: z.unknown() }).strict(),
  z
    .object({
      commandId: RequestIdSchema,
      error: z
        .object({
          code: z.string().min(1).max(64),
          message: z.string().min(1),
          retryable: z.boolean().default(false),
        })
        .strict(),
      ok: z.literal(false),
    })
    .strict(),
])
export type ComputerHostOutcome = z.infer<typeof ComputerHostOutcomeSchema>
export type ComputerHostOutcomeInput = z.input<typeof ComputerHostOutcomeSchema>

const approvalBase = {
  commandId: RequestIdSchema,
  threadId: ProjectThreadIdSchema,
  risk: z.enum(["low", "high"]),
  /** Whether the person may allow it for good, not only for this Thread. */
  allowAlways: z.boolean(),
}

/**
 * A device asking the people in a Thread whether Computer Use may operate an app (`kind` `app`,
 * the default) or record the computer's audio (`audio`), while it runs one of that Thread's
 * commands. Any client of the Thread can answer.
 */
export const ComputerHostApprovalSchema = z.union([
  z
    .object({
      ...approvalBase,
      kind: z.literal("app").optional(),
      /** The app's bundle identifier or path. */
      app: z.string().trim().min(1).max(1_024),
      displayName: z.string().trim().min(1).max(256),
      subtitle: z.string().max(1_024).optional(),
    })
    .strict(),
  z.object({ ...approvalBase, kind: z.literal("audio") }).strict(),
])
export type ComputerHostApproval = z.infer<typeof ComputerHostApprovalSchema>

/** `session` allows the app for the rest of the Thread; `always` beyond it. */
export const ComputerHostApprovalDecisionSchema = z.enum(["session", "always", "deny"])
export type ComputerHostApprovalDecision = z.infer<typeof ComputerHostApprovalDecisionSchema>

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

export const ComputerHostRegisterRequestSchema = request(
  "computer.host.register.request",
  ComputerHostRegistrationSchema
)
export const ComputerHostUnregisterRequestSchema = request(
  "computer.host.unregister.request",
  z.object({}).strict()
)
export const ComputerHostResultRequestSchema = request(
  "computer.host.result.request",
  ComputerHostOutcomeSchema
)

export const ComputerHostApprovalRequestSchema = request(
  "computer.host.approval.request",
  ComputerHostApprovalSchema
)

export const ComputerHostRegisterResponseSchema = response(
  "computer.host.register.response",
  succeeded
)
export const ComputerHostUnregisterResponseSchema = response(
  "computer.host.unregister.response",
  succeeded
)
export const ComputerHostResultResponseSchema = response(
  "computer.host.result.response",
  z.object({ accepted: z.boolean() }).strict()
)

export const ComputerHostApprovalResponseSchema = response(
  "computer.host.approval.response",
  z.object({ decision: ComputerHostApprovalDecisionSchema }).strict()
)

/** Server-to-host request. The host answers with `computer.host.result.request`. */
export const ComputerHostCommandNotificationSchema = z
  .object({
    payload: ComputerHostRequestSchema,
    type: z.literal("computer.host.command.notification"),
  })
  .strict()

export const COMPUTER_HOST_CLIENT_SCHEMAS = [
  ComputerHostRegisterRequestSchema,
  ComputerHostUnregisterRequestSchema,
  ComputerHostResultRequestSchema,
  ComputerHostApprovalRequestSchema,
] as const
export const COMPUTER_HOST_SERVER_SCHEMAS = [
  ComputerHostRegisterResponseSchema,
  ComputerHostUnregisterResponseSchema,
  ComputerHostResultResponseSchema,
  ComputerHostApprovalResponseSchema,
  ComputerHostCommandNotificationSchema,
] as const
export const COMPUTER_HOST_RESPONSE_TYPES = COMPUTER_HOST_SERVER_SCHEMAS.slice(0, 4).map(
  (schema) => schema.shape.type.value
)

export type ComputerHostClientMessage = z.infer<(typeof COMPUTER_HOST_CLIENT_SCHEMAS)[number]>
export type ComputerHostServerMessage = z.infer<(typeof COMPUTER_HOST_SERVER_SCHEMAS)[number]>
