import { z } from "zod"

import {
  AGENT_CODEX_CLIENT_NOTIFICATIONS,
  AGENT_CODEX_CLIENT_RPC,
  AGENT_CODEX_SERVER_NOTIFICATIONS,
  AGENT_CODEX_SERVER_RPC,
} from "./codex-app-server-messages.generated.ts"

const values = <T extends Record<string, Record<K, string>>, K extends string>(
  record: T,
  key: K
): Array<T[keyof T][K]> => Object.values(record).map((entry) => entry[key]) as Array<T[keyof T][K]>

const methodByType = <T extends Record<string, Record<K, string>>, K extends string>(
  record: T,
  key: K
): Record<T[keyof T][K], keyof T> =>
  Object.fromEntries(
    Object.entries(record).map(([method, definition]) => [definition[key], method])
  ) as Record<T[keyof T][K], keyof T>

export const AGENT_CODEX_CLIENT_REQUEST_TYPES = values(AGENT_CODEX_CLIENT_RPC, "request")
export const AGENT_CODEX_CLIENT_RESPONSE_TYPES = values(AGENT_CODEX_CLIENT_RPC, "response")
export const AGENT_CODEX_SERVER_REQUEST_TYPES = values(AGENT_CODEX_SERVER_RPC, "request")
export const AGENT_CODEX_SERVER_RESPONSE_TYPES = values(AGENT_CODEX_SERVER_RPC, "response")
export const AGENT_CODEX_SERVER_NOTIFICATION_TYPES = values(
  AGENT_CODEX_SERVER_NOTIFICATIONS,
  "notification"
)
export const AGENT_CODEX_CLIENT_NOTIFICATION_TYPES = values(
  AGENT_CODEX_CLIENT_NOTIFICATIONS,
  "notification"
)

export const AgentCodexClientRequestTypeSchema = z.enum(AGENT_CODEX_CLIENT_REQUEST_TYPES)
export const AgentCodexClientResponseTypeSchema = z.enum(AGENT_CODEX_CLIENT_RESPONSE_TYPES)
export const AgentCodexServerRequestTypeSchema = z.enum(AGENT_CODEX_SERVER_REQUEST_TYPES)
export const AgentCodexServerResponseTypeSchema = z.enum(AGENT_CODEX_SERVER_RESPONSE_TYPES)
export const AgentCodexServerNotificationTypeSchema = z.enum(AGENT_CODEX_SERVER_NOTIFICATION_TYPES)
export const AgentCodexClientNotificationTypeSchema = z.enum(AGENT_CODEX_CLIENT_NOTIFICATION_TYPES)

export const AGENT_CODEX_CLIENT_REQUEST_TYPE_TO_METHOD = methodByType(
  AGENT_CODEX_CLIENT_RPC,
  "request"
)
export const AGENT_CODEX_CLIENT_RESPONSE_TYPE_TO_METHOD = methodByType(
  AGENT_CODEX_CLIENT_RPC,
  "response"
)
export const AGENT_CODEX_SERVER_REQUEST_TYPE_TO_METHOD = methodByType(
  AGENT_CODEX_SERVER_RPC,
  "request"
)
export const AGENT_CODEX_SERVER_RESPONSE_TYPE_TO_METHOD = methodByType(
  AGENT_CODEX_SERVER_RPC,
  "response"
)
export const AGENT_CODEX_SERVER_NOTIFICATION_TYPE_TO_METHOD = methodByType(
  AGENT_CODEX_SERVER_NOTIFICATIONS,
  "notification"
)
export const AGENT_CODEX_CLIENT_NOTIFICATION_TYPE_TO_METHOD = methodByType(
  AGENT_CODEX_CLIENT_NOTIFICATIONS,
  "notification"
)

export * from "./codex-app-server-messages.generated.ts"
export type {
  CodexClientResponse,
  CodexClientResponseMap,
  CodexServerRequestResponse,
  CodexServerRequestResponseMap,
} from "./codex-app-server-response-map.ts"
export { codexGeneratedTypeSchema } from "./codex-app-server-schema-registry.ts"
