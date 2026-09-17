import { z } from "zod"

import { RequestIdSchema } from "../request-id.ts"

export const AgentOpenCodeCallRequestSchema = z.object({
  payload: z.object({
    body: z.json().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    operation: z.string().trim().min(1).max(160),
    path: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    query: z.record(z.string(), z.json()).optional(),
  }),
  requestId: RequestIdSchema,
  type: z.literal("agent.opencode.call.request"),
})
export const AgentOpenCodeCallResponseSchema = z.object({
  payload: z.discriminatedUnion("ok", [
    z.object({
      data: z.json(),
      headers: z.record(z.string(), z.string()),
      ok: z.literal(true),
      status: z.number().int(),
    }),
    z.object({
      error: z.json(),
      headers: z.record(z.string(), z.string()),
      ok: z.literal(false),
      status: z.number().int(),
    }),
  ]),
  requestId: RequestIdSchema,
  type: z.literal("agent.opencode.call.response"),
})
export const AgentOpenCodeEventSubscribeRequestSchema = z.object({
  payload: z.object({
    stream: z.enum(["event", "global.event"]),
    subscriptionId: z.string().min(1),
  }),
  requestId: RequestIdSchema,
  type: z.literal("agent.opencode.event.subscribe.request"),
})
export const AgentOpenCodeEventSubscribeResponseSchema = z.object({
  payload: z.object({ subscriptionId: z.string().min(1) }),
  requestId: RequestIdSchema,
  type: z.literal("agent.opencode.event.subscribe.response"),
})
export const AgentOpenCodeEventCancelRequestSchema = z.object({
  payload: z.object({ subscriptionId: z.string().min(1) }),
  type: z.literal("agent.opencode.event.cancel.request"),
})
export const AgentOpenCodeEventNotificationSchema = z.object({
  payload: z.object({ event: z.json(), subscriptionId: z.string().min(1) }),
  type: z.literal("agent.opencode.event.notification"),
})
export const AgentOpenCodeEventCompleteNotificationSchema = z.object({
  payload: z.object({ subscriptionId: z.string().min(1) }),
  type: z.literal("agent.opencode.event.complete.notification"),
})
export const AgentOpenCodeEventErrorNotificationSchema = z.object({
  payload: z.object({ message: z.string(), subscriptionId: z.string().min(1) }),
  type: z.literal("agent.opencode.event.error.notification"),
})

export type AgentOpenCodeCallRequest = z.infer<typeof AgentOpenCodeCallRequestSchema>
export type AgentOpenCodeEventSubscribeRequest = z.infer<
  typeof AgentOpenCodeEventSubscribeRequestSchema
>

export const AGENT_OPENCODE_CLIENT_SCHEMAS = [
  AgentOpenCodeCallRequestSchema,
  AgentOpenCodeEventSubscribeRequestSchema,
  AgentOpenCodeEventCancelRequestSchema,
] as const
export const AGENT_OPENCODE_SERVER_SCHEMAS = [
  AgentOpenCodeCallResponseSchema,
  AgentOpenCodeEventSubscribeResponseSchema,
  AgentOpenCodeEventNotificationSchema,
  AgentOpenCodeEventCompleteNotificationSchema,
  AgentOpenCodeEventErrorNotificationSchema,
] as const
export type AgentOpenCodeClientMessage = z.infer<(typeof AGENT_OPENCODE_CLIENT_SCHEMAS)[number]>
export type AgentOpenCodeServerMessage = z.infer<(typeof AGENT_OPENCODE_SERVER_SCHEMAS)[number]>
