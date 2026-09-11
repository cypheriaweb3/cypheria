import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const generatedTypeRoot = resolve(packageRoot, "src/generated/codex/ts")
const generatedSchemaRoot = resolve(packageRoot, "src/generated/codex/schema")
const outputPath = resolve(packageRoot, "src/generated/codex/messages.ts")
const checkOnly = process.argv.includes("--check")

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"))

const [
  clientRequestSource,
  serverRequestSource,
  serverNotificationSource,
  clientNotificationSource,
] = await Promise.all([
  readFile(resolve(generatedTypeRoot, "ClientRequest.ts"), "utf8"),
  readFile(resolve(generatedTypeRoot, "ServerRequest.ts"), "utf8"),
  readFile(resolve(generatedTypeRoot, "ServerNotification.ts"), "utf8"),
  readFile(resolve(generatedTypeRoot, "ClientNotification.ts"), "utf8"),
])

const [clientResponseMap, serverResponseMap, generatedZodRegistry] = await Promise.all([
  readJson(resolve(generatedSchemaRoot, "client-response-map.json")),
  readJson(resolve(generatedSchemaRoot, "server-response-map.json")),
  readFile(resolve(packageRoot, "src/generated/codex/zod/registry.gen.ts"), "utf8"),
])

const generatedZodDefinitions = new Set(
  [...generatedZodRegistry.matchAll(/^ {2}"([A-Za-z0-9_$]+)": schemas\.z/gmu)].map(
    (match) => match[1]
  )
)

const collectRequests = (source) =>
  [...source.matchAll(/\{ "method": "([^"]+)", id: RequestId, params\??: (.*?), \}/g)].map(
    ([, method, paramsType]) => ({
      method,
      paramsType: paramsType.replace(/ \| (?:null|undefined)/g, ""),
    })
  )

const collectNotifications = (source) =>
  [...source.matchAll(/\{ "method": "([^"]+)"(?:, "params": (\w+))? \}/g)].map(
    ([, method, paramsType]) => ({ method, paramsType: paramsType ?? null })
  )

const clientRequests = collectRequests(clientRequestSource)
const serverRequests = collectRequests(serverRequestSource)
const serverNotifications = collectNotifications(serverNotificationSource)
const clientNotifications = collectNotifications(clientNotificationSource)

const expectedCounts = {
  clientNotifications: 1,
  clientRequests: 158,
  serverNotifications: 83,
  serverRequests: 11,
}

for (const [name, actual] of Object.entries({
  clientNotifications: clientNotifications.length,
  clientRequests: clientRequests.length,
  serverNotifications: serverNotifications.length,
  serverRequests: serverRequests.length,
})) {
  if (actual !== expectedCounts[name]) {
    throw new Error(`Expected ${expectedCounts[name]} ${name}, found ${actual}`)
  }
}

const missingClientResponses = clientRequests
  .map(({ method }) => method)
  .filter((method) => !(method in clientResponseMap))
const missingServerResponses = serverRequests
  .map(({ method }) => method)
  .filter((method) => !(method in serverResponseMap))

if (missingClientResponses.length || missingServerResponses.length) {
  throw new Error(
    `Missing response mappings: ${[...missingClientResponses, ...missingServerResponses].join(", ")}`
  )
}

const legacySchemaDefinitions = new Set([
  "GetAuthStatusParams",
  "GetAuthStatusResponse",
  "GetConversationSummaryParams",
  "GetConversationSummaryResponse",
  "GitDiffToRemoteParams",
  "GitDiffToRemoteResponse",
])
const hasSchema = (typeName) =>
  typeName === "undefined" ||
  typeName === null ||
  generatedZodDefinitions.has(typeName) ||
  legacySchemaDefinitions.has(typeName)
const missingSchemas = [
  ...clientRequests.map(({ paramsType }) => paramsType),
  ...serverRequests.map(({ paramsType }) => paramsType),
  ...serverNotifications.map(({ paramsType }) => paramsType),
  ...clientNotifications.map(({ paramsType }) => paramsType),
  ...Object.values(clientResponseMap),
  ...Object.values(serverResponseMap),
].filter((typeName) => !hasSchema(typeName))

if (missingSchemas.length) {
  throw new Error(`Missing Codex schemas: ${[...new Set(missingSchemas)].join(", ")}`)
}

const snakeCase = (value) =>
  value
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()

const operationName = (method) => method.split("/").map(snakeCase).join(".")
const wireName = (method, direction) => `agent.codex.${operationName(method)}.${direction}`
const quote = (value) => JSON.stringify(value)

const renderRpc = (entries, responseMap) =>
  entries
    .map(
      ({ method, paramsType }) =>
        `  ${quote(method)}: { request: ${quote(wireName(method, "request"))}, response: ${quote(
          wireName(method, "response")
        )}, paramsType: ${quote(paramsType)}, resultType: ${quote(responseMap[method])} },`
    )
    .join("\n")

const renderNotifications = (entries) =>
  entries
    .map(
      ({ method, paramsType }) =>
        `  ${quote(method)}: { notification: ${quote(
          wireName(method, "notification")
        )}, paramsType: ${paramsType === null ? "null" : quote(paramsType)} },`
    )
    .join("\n")

const renderRequestSchemas = (entries, messageType) =>
  entries
    .map(({ method, paramsType }) => {
      const type = wireName(method, "request")
      return `  ${quote(method)}: codexTopLevelParamsMessageSchema<Extract<${messageType}, { type: ${quote(
        type
      )} }>>(${quote(type)}, ${paramsType === "undefined" ? "null" : quote(paramsType)}),`
    })
    .join("\n")

const renderResponseSchemas = (entries, responseMap, messageType) =>
  entries
    .map(({ method }) => {
      const type = wireName(method, "response")
      return `  ${quote(method)}: codexResponseMessageSchema<Extract<${messageType}, { type: ${quote(
        type
      )} }>>(${quote(type)}, ${quote(responseMap[method])}),`
    })
    .join("\n")

const renderNotificationSchemas = (entries, messageType) =>
  entries
    .map(({ method, paramsType }) => {
      const type = wireName(method, "notification")
      return `  ${quote(method)}: codexNotificationMessageSchema<Extract<${messageType}, { type: ${quote(
        type
      )} }>>(${quote(type)}, ${paramsType === null ? "null" : quote(paramsType)}),`
    })
    .join("\n")

const output = `// GENERATED CODE! DO NOT MODIFY BY HAND!
// biome-ignore-all format: Keep the generated message registry compact and reviewable.
// Run \`pnpm --filter @cypheria/protocol generate:agent-codex-app-server-messages\` after regenerating Codex types.

import type { ClientNotification as CodexClientNotification, ClientRequest as CodexClientRequest, ServerNotification as CodexServerNotification, ServerRequest as CodexServerRequest } from "./ts/index.ts"
import type { RequestId } from "../../request-id.ts"
import type { CodexClientResponseMap, CodexServerRequestResponseMap } from "./response-map.ts"
import { codexMessageSchemaUnion, codexNotificationMessageSchema, codexResponseMessageSchema, codexTopLevelParamsMessageSchema } from "../../agent/codex-app-server-schema-registry.ts"

/** Cypheria wire names for every Codex App Server client-initiated RPC. */
export const AGENT_CODEX_CLIENT_RPC = {
${renderRpc(clientRequests, clientResponseMap)}
} as const

/** Cypheria wire names for every Codex App Server server-initiated RPC. */
export const AGENT_CODEX_SERVER_RPC = {
${renderRpc(serverRequests, serverResponseMap)}
} as const

/** Cypheria wire names for every Codex App Server server notification. */
export const AGENT_CODEX_SERVER_NOTIFICATIONS = {
${renderNotifications(serverNotifications)}
} as const

/** Cypheria wire names for every Codex App Server client notification. */
export const AGENT_CODEX_CLIENT_NOTIFICATIONS = {
${renderNotifications(clientNotifications)}
} as const

type DefinedCodexParams<T> = [Exclude<T, null | undefined>] extends [never] ? Record<never, never> : Exclude<T, null | undefined>
type CodexParams<T> = T extends { params?: infer P } ? DefinedCodexParams<P> : Record<never, never>
type CodexNotificationMessage<T, Type extends string> = T extends { params: infer P } ? { type: Type, payload: P } : { type: Type }

type ClientMethod = keyof typeof AGENT_CODEX_CLIENT_RPC
type ServerMethod = keyof typeof AGENT_CODEX_SERVER_RPC
type ServerNotificationMethod = keyof typeof AGENT_CODEX_SERVER_NOTIFICATIONS
type ClientNotificationMethod = keyof typeof AGENT_CODEX_CLIENT_NOTIFICATIONS

export type AgentCodexClientRequestMessage = {
  [M in ClientMethod]: { type: (typeof AGENT_CODEX_CLIENT_RPC)[M]["request"], requestId: RequestId } & CodexParams<Extract<CodexClientRequest, { method: M }>>
}[ClientMethod]
export type AgentCodexClientResponseMessage = {
  [M in ClientMethod]: { type: (typeof AGENT_CODEX_CLIENT_RPC)[M]["response"], payload: { requestId: RequestId } & CodexClientResponseMap[M] }
}[ClientMethod]
export type AgentCodexServerRequestMessage = {
  [M in ServerMethod]: { type: (typeof AGENT_CODEX_SERVER_RPC)[M]["request"], requestId: RequestId } & CodexParams<Extract<CodexServerRequest, { method: M }>>
}[ServerMethod]
export type AgentCodexServerResponseMessage = {
  [M in ServerMethod]: { type: (typeof AGENT_CODEX_SERVER_RPC)[M]["response"], payload: { requestId: RequestId } & CodexServerRequestResponseMap[M] }
}[ServerMethod]
export type AgentCodexServerNotificationMessage = {
  [M in ServerNotificationMethod]: CodexNotificationMessage<Extract<CodexServerNotification, { method: M }>, (typeof AGENT_CODEX_SERVER_NOTIFICATIONS)[M]["notification"]>
}[ServerNotificationMethod]
export type AgentCodexClientNotificationMessage = {
  [M in ClientNotificationMethod]: CodexNotificationMessage<Extract<CodexClientNotification, { method: M }>, (typeof AGENT_CODEX_CLIENT_NOTIFICATIONS)[M]["notification"]>
}[ClientNotificationMethod]

export const AGENT_CODEX_CLIENT_REQUEST_MESSAGE_SCHEMAS = {
${renderRequestSchemas(clientRequests, "AgentCodexClientRequestMessage")}
} as const
export const AGENT_CODEX_CLIENT_RESPONSE_MESSAGE_SCHEMAS = {
${renderResponseSchemas(clientRequests, clientResponseMap, "AgentCodexClientResponseMessage")}
} as const
export const AGENT_CODEX_SERVER_REQUEST_MESSAGE_SCHEMAS = {
${renderRequestSchemas(serverRequests, "AgentCodexServerRequestMessage")}
} as const
export const AGENT_CODEX_SERVER_RESPONSE_MESSAGE_SCHEMAS = {
${renderResponseSchemas(serverRequests, serverResponseMap, "AgentCodexServerResponseMessage")}
} as const
export const AGENT_CODEX_SERVER_NOTIFICATION_MESSAGE_SCHEMAS = {
${renderNotificationSchemas(serverNotifications, "AgentCodexServerNotificationMessage")}
} as const
export const AGENT_CODEX_CLIENT_NOTIFICATION_MESSAGE_SCHEMAS = {
${renderNotificationSchemas(clientNotifications, "AgentCodexClientNotificationMessage")}
} as const

export const AgentCodexClientRequestMessageSchema = codexMessageSchemaUnion<AgentCodexClientRequestMessage>(Object.values(AGENT_CODEX_CLIENT_REQUEST_MESSAGE_SCHEMAS))
export const AgentCodexClientResponseMessageSchema = codexMessageSchemaUnion<AgentCodexClientResponseMessage>(Object.values(AGENT_CODEX_CLIENT_RESPONSE_MESSAGE_SCHEMAS))
export const AgentCodexServerRequestMessageSchema = codexMessageSchemaUnion<AgentCodexServerRequestMessage>(Object.values(AGENT_CODEX_SERVER_REQUEST_MESSAGE_SCHEMAS))
export const AgentCodexServerResponseMessageSchema = codexMessageSchemaUnion<AgentCodexServerResponseMessage>(Object.values(AGENT_CODEX_SERVER_RESPONSE_MESSAGE_SCHEMAS))
export const AgentCodexServerNotificationMessageSchema = codexMessageSchemaUnion<AgentCodexServerNotificationMessage>(Object.values(AGENT_CODEX_SERVER_NOTIFICATION_MESSAGE_SCHEMAS))
export const AgentCodexClientNotificationMessageSchema = codexMessageSchemaUnion<AgentCodexClientNotificationMessage>(Object.values(AGENT_CODEX_CLIENT_NOTIFICATION_MESSAGE_SCHEMAS))
`

if (checkOnly) {
  const current = await readFile(outputPath, "utf8").catch(() => "")
  if (current !== output) {
    throw new Error(
      "Generated agent Codex App Server messages are stale. Run pnpm --filter @cypheria/protocol generate:agent-codex-app-server-messages"
    )
  }
} else {
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, output)
}

console.log(
  `${checkOnly ? "Checked" : "Generated"} ${clientRequests.length} client RPCs, ${serverRequests.length} server RPCs, ${serverNotifications.length} server notifications, and ${clientNotifications.length} client notification schemas.`
)
