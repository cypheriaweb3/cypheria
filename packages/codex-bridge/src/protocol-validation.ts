import {
  AGENT_CODEX_CLIENT_RPC,
  AGENT_CODEX_SERVER_RPC,
  type CodexClientResponse,
  type CodexClientResponseMap,
  type CodexServerRequestResponse,
  type CodexServerRequestResponseMap,
  codexGeneratedTypeSchema,
} from "@cypheria/protocol"
import type { ServerNotification, ServerRequest } from "@cypheria/protocol/codex-types"

const formatValidationError = (
  issues: readonly { message: string; path: PropertyKey[] }[]
): string =>
  issues
    .map(
      ({ message, path }) => `${path.length ? path.map(String).join(".") : "message"} ${message}`
    )
    .join("; ")

const validateGeneratedType = <T>(definition: string, value: unknown): string | undefined => {
  const result = codexGeneratedTypeSchema<T>(definition).safeParse(value)
  return result.success ? undefined : formatValidationError(result.error.issues)
}

export const validateCodexServerMessage = (
  kind: "notification" | "request",
  value: unknown
): string | undefined =>
  kind === "request"
    ? validateGeneratedType<ServerRequest>("ServerRequest", value)
    : validateGeneratedType<ServerNotification>("ServerNotification", value)

export const validateCodexClientResponse = <M extends keyof CodexClientResponseMap>(
  method: M,
  value: unknown
): string | undefined =>
  validateGeneratedType<CodexClientResponse<M>>(AGENT_CODEX_CLIENT_RPC[method].resultType, value)

export function assertCodexServerRequestResponse<M extends keyof CodexServerRequestResponseMap>(
  method: M,
  value: unknown
): asserts value is CodexServerRequestResponse<M> {
  const validationError = validateGeneratedType<CodexServerRequestResponse<M>>(
    AGENT_CODEX_SERVER_RPC[method].resultType,
    value
  )
  if (validationError) {
    throw new Error(`Invalid response for Codex app-server request ${method}: ${validationError}`)
  }
}
