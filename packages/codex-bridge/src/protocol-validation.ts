import Ajv, { type ErrorObject, type ValidateFunction } from "ajv"

import responseSchemaNames from "./generated-schema/client-response-map.json" with { type: "json" }
import protocolSchema from "./generated-schema/codex_app_server_protocol.schemas.json" with {
  type: "json",
}
import serverResponseSchemaNames from "./generated-schema/server-response-map.json" with {
  type: "json",
}
import type {
  CodexClientResponseMap,
  CodexServerRequestResponse,
  CodexServerRequestResponseMap,
} from "./response-map.js"

const ajv = new Ajv({ allErrors: true, strict: false })

const compileDefinition = (definition: "ServerNotification" | "ServerRequest"): ValidateFunction =>
  ajv.compile({
    ...protocolSchema,
    $ref: `#/definitions/${definition}`,
  })

const validateServerNotification = compileDefinition("ServerNotification")
const validateServerRequest = compileDefinition("ServerRequest")
const responseValidators = new Map<keyof CodexClientResponseMap, ValidateFunction>()
const serverResponseValidators = new Map<keyof CodexServerRequestResponseMap, ValidateFunction>()

const compileResponseDefinition = (definition: string): ValidateFunction => {
  const definitionPath = definition in protocolSchema.definitions ? definition : `v2/${definition}`
  return ajv.compile({
    ...protocolSchema,
    $ref: `#/definitions/${definitionPath}`,
  })
}

const formatError = (error: ErrorObject): string => {
  const path = error.instancePath || "message"
  return `${path} ${error.message ?? "is invalid"}`
}

export const validateCodexServerMessage = (
  kind: "notification" | "request",
  value: unknown
): string | undefined => {
  const validate = kind === "request" ? validateServerRequest : validateServerNotification
  if (validate(value)) return undefined
  return validate.errors?.map(formatError).join("; ") || "message does not match the protocol"
}

export const validateCodexClientResponse = <M extends keyof CodexClientResponseMap>(
  method: M,
  value: unknown
): string | undefined => {
  let validate = responseValidators.get(method)
  if (!validate) {
    const definition = responseSchemaNames[method]
    validate = compileResponseDefinition(definition)
    responseValidators.set(method, validate)
  }

  if (validate(value)) return undefined
  return validate.errors?.map(formatError).join("; ") || "response does not match the protocol"
}

export function assertCodexServerRequestResponse<M extends keyof CodexServerRequestResponseMap>(
  method: M,
  value: unknown
): asserts value is CodexServerRequestResponse<M> {
  let validate = serverResponseValidators.get(method)
  if (!validate) {
    validate = compileResponseDefinition(serverResponseSchemaNames[method])
    serverResponseValidators.set(method, validate)
  }

  if (!validate(value)) {
    const detail =
      validate.errors?.map(formatError).join("; ") || "response does not match the protocol"
    throw new Error(`Invalid response for Codex app-server request ${method}: ${detail}`)
  }
}
