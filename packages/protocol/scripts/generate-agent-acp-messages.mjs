import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  AGENT_METHODS as ACP_V1_AGENT_METHODS,
  CLIENT_METHODS as ACP_V1_CLIENT_METHODS,
} from "@agentclientprotocol/sdk"
import {
  AGENT_METHODS as ACP_V2_AGENT_METHODS,
  CLIENT_METHODS as ACP_V2_CLIENT_METHODS,
} from "@agentclientprotocol/sdk/experimental/v2"
import * as acpV2Zod from "@agentclientprotocol/sdk/experimental/v2/zod"
import * as acpV1Zod from "@agentclientprotocol/sdk/zod"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const outputPath = resolve(packageRoot, "src/generated/acp/messages.ts")
const checkOnly = process.argv.includes("--check")
const require = createRequire(import.meta.url)
const sdkRoot = resolve(dirname(require.resolve("@agentclientprotocol/sdk")), "..")

const [v1Source, v2Source] = await Promise.all([
  readFile(resolve(sdkRoot, "dist/acp.d.ts"), "utf8"),
  readFile(resolve(sdkRoot, "dist/v2/acp.d.ts"), "utf8"),
])

const compact = (source) => source.replace(/\s+/g, " ")

const handlerBlock = (source, name) => {
  const match = compact(source).match(new RegExp(`export type ${name} = \\{(.*?)\\};`))
  if (!match) throw new Error(`Unable to find ${name} in ACP SDK declarations`)
  return match[1]
}

const collectRpc = (source, name, constants) => {
  const block = handlerBlock(source, name)
  const expectedCount = [...block.matchAll(/\[schema\./g)].length
  const entries = [
    ...block.matchAll(
      /\[schema\.(?:AGENT_METHODS|CLIENT_METHODS)\s*\.\s*([A-Za-z0-9_]+)\]: (?:Agent|Client)RequestHandler<schema\.([A-Za-z0-9_]+), schema\.([A-Za-z0-9_]+)( \| void)?>;/g
    ),
  ].map(([, key, paramsType, resultType, nullable]) => ({
    method: constants[key],
    paramsType,
    resultType,
    allowNull: Boolean(nullable),
  }))
  if (entries.length !== expectedCount || entries.some(({ method }) => !method)) {
    throw new Error(`Unable to parse every ${name} entry from ACP SDK declarations`)
  }
  return entries
}

const collectNotifications = (source, name, constants) => {
  const block = handlerBlock(source, name)
  const expectedCount = [...block.matchAll(/\[schema\./g)].length
  const entries = [
    ...block.matchAll(
      /\[schema\.(?:AGENT_METHODS|CLIENT_METHODS)\s*\.\s*([A-Za-z0-9_]+)\]: (?:Agent|Client)NotificationHandler<schema\.([A-Za-z0-9_]+)>;/g
    ),
  ].map(([, key, paramsType]) => ({ method: constants[key], paramsType }))
  if (entries.length !== expectedCount || entries.some(({ method }) => !method)) {
    throw new Error(`Unable to parse every ${name} entry from ACP SDK declarations`)
  }
  return entries
}

const versions = [
  {
    version: 1,
    zod: acpV1Zod,
    zodName: "acpV1Zod",
    clientRpc: collectRpc(v1Source, "AgentRequestHandlersByMethod", ACP_V1_AGENT_METHODS),
    clientNotifications: collectNotifications(
      v1Source,
      "AgentNotificationHandlersByMethod",
      ACP_V1_AGENT_METHODS
    ),
    serverRpc: collectRpc(v1Source, "ClientRequestHandlersByMethod", ACP_V1_CLIENT_METHODS),
    serverNotifications: collectNotifications(
      v1Source,
      "ClientNotificationHandlersByMethod",
      ACP_V1_CLIENT_METHODS
    ),
  },
  {
    version: 2,
    zod: acpV2Zod,
    zodName: "acpV2Zod",
    clientRpc: collectRpc(v2Source, "AgentRequestHandlersByMethod", ACP_V2_AGENT_METHODS),
    clientNotifications: collectNotifications(
      v2Source,
      "AgentNotificationHandlersByMethod",
      ACP_V2_AGENT_METHODS
    ),
    serverRpc: collectRpc(v2Source, "ClientRequestHandlersByMethod", ACP_V2_CLIENT_METHODS),
    serverNotifications: collectNotifications(
      v2Source,
      "ClientNotificationHandlersByMethod",
      ACP_V2_CLIENT_METHODS
    ),
  },
]

for (const definition of versions) {
  for (const entry of [...definition.clientRpc, ...definition.serverRpc]) {
    for (const schemaName of [`z${entry.paramsType}`, `z${entry.resultType}`]) {
      if (!(schemaName in definition.zod)) {
        throw new Error(`ACP v${definition.version} SDK does not export ${schemaName}`)
      }
    }
  }
  for (const entry of [...definition.clientNotifications, ...definition.serverNotifications]) {
    if (!(`z${entry.paramsType}` in definition.zod)) {
      throw new Error(`ACP v${definition.version} SDK does not export z${entry.paramsType}`)
    }
  }
}

const snakeCase = (value) =>
  value
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()

const operationName = (method) => method.split("/").map(snakeCase).join(".")
const wireName = (method, direction) => `agent.acp.${operationName(method)}.${direction}`
const quote = (value) => JSON.stringify(value)

const renderRpcDefinitions = (definition, entries) =>
  entries
    .map(
      ({ method, paramsType, resultType, allowNull }) =>
        `  ${quote(method)}: { request: ${quote(wireName(method, "request"))}, response: ${quote(wireName(method, "response"))}, requestSchema: acpRequestSchema(${definition.version}, ${quote(wireName(method, "request"))}, ${definition.zodName}.z${paramsType}), responseSchema: acpResponseSchema(${definition.version}, ${quote(wireName(method, "response"))}, ${definition.zodName}.z${resultType}, ${allowNull}) },`
    )
    .join("\n")

const renderNotificationDefinitions = (definition, entries) =>
  entries
    .map(
      ({ method, paramsType }) =>
        `  ${quote(method)}: { notification: ${quote(wireName(method, "notification"))}, schema: acpNotificationSchema(${definition.version}, ${quote(wireName(method, "notification"))}, ${definition.zodName}.z${paramsType}) },`
    )
    .join("\n")

const sections = versions
  .map((definition) => {
    const prefix = `AGENT_ACP_V${definition.version}`
    const typePrefix = `AgentAcpV${definition.version}`
    return `export const ${prefix}_CLIENT_RPC = {
${renderRpcDefinitions(definition, definition.clientRpc)}
} as const
export const ${prefix}_SERVER_RPC = {
${renderRpcDefinitions(definition, definition.serverRpc)}
} as const
export const ${prefix}_CLIENT_NOTIFICATIONS = {
${renderNotificationDefinitions(definition, definition.clientNotifications)}
} as const
export const ${prefix}_SERVER_NOTIFICATIONS = {
${renderNotificationDefinitions(definition, definition.serverNotifications)}
} as const

export const ${prefix}_CLIENT_REQUEST_SCHEMAS = schemasByMethod(${prefix}_CLIENT_RPC, "requestSchema")
export const ${prefix}_SERVER_RESPONSE_SCHEMAS = schemasByMethod(${prefix}_CLIENT_RPC, "responseSchema")
export const ${prefix}_SERVER_REQUEST_SCHEMAS = schemasByMethod(${prefix}_SERVER_RPC, "requestSchema")
export const ${prefix}_CLIENT_RESPONSE_SCHEMAS = schemasByMethod(${prefix}_SERVER_RPC, "responseSchema")
export const ${prefix}_CLIENT_NOTIFICATION_SCHEMAS = schemasByMethod(${prefix}_CLIENT_NOTIFICATIONS, "schema")
export const ${prefix}_SERVER_NOTIFICATION_SCHEMAS = schemasByMethod(${prefix}_SERVER_NOTIFICATIONS, "schema")

export type ${typePrefix}ClientRequest = SchemaOutput<typeof ${prefix}_CLIENT_REQUEST_SCHEMAS>
export type ${typePrefix}ServerResponse = SchemaOutput<typeof ${prefix}_SERVER_RESPONSE_SCHEMAS>
export type ${typePrefix}ServerRequest = SchemaOutput<typeof ${prefix}_SERVER_REQUEST_SCHEMAS>
export type ${typePrefix}ClientResponse = SchemaOutput<typeof ${prefix}_CLIENT_RESPONSE_SCHEMAS>
export type ${typePrefix}ClientNotification = SchemaOutput<typeof ${prefix}_CLIENT_NOTIFICATION_SCHEMAS>
export type ${typePrefix}ServerNotification = SchemaOutput<typeof ${prefix}_SERVER_NOTIFICATION_SCHEMAS>
`
  })
  .join("\n")

const output = `${`// GENERATED CODE! DO NOT MODIFY BY HAND!
// biome-ignore-all format: Keep the generated ACP registry compact and reviewable.
// Run \`pnpm --filter @cypheria/protocol generate:agent-acp-messages\` after updating the ACP SDK.

import * as acpV1Zod from "@agentclientprotocol/sdk/zod"
import * as acpV2Zod from "@agentclientprotocol/sdk/experimental/v2/zod"
import type { z } from "zod"
import { acpNotificationSchema, acpRequestSchema, acpResponseSchema } from "../../agent/acp-schema-registry.ts"

type SchemaOutput<Schemas extends Readonly<Record<string, z.ZodType>>> = z.output<Schemas[keyof Schemas]>

const schemasByMethod = <
  Definitions extends Readonly<Record<string, Record<Key, z.ZodType>>>,
  Key extends string,
>(definitions: Definitions, key: Key): { readonly [Method in keyof Definitions]: Definitions[Method][Key] } =>
  Object.fromEntries(Object.entries(definitions).map(([method, definition]) => [method, definition[key]])) as {
    readonly [Method in keyof Definitions]: Definitions[Method][Key]
  }

${sections}
`.trimEnd()}\n`

if (checkOnly) {
  const current = await readFile(outputPath, "utf8").catch(() => "")
  if (current !== output) {
    throw new Error(
      "Generated ACP logical messages are stale. Run pnpm --filter @cypheria/protocol generate:agent-acp-messages"
    )
  }
} else {
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, output)
}

const totals = versions.reduce(
  (result, definition) => ({
    notifications:
      result.notifications +
      definition.clientNotifications.length +
      definition.serverNotifications.length,
    rpc: result.rpc + definition.clientRpc.length + definition.serverRpc.length,
  }),
  { notifications: 0, rpc: 0 }
)
console.log(
  `${checkOnly ? "Checked" : "Generated"} ${totals.rpc} ACP RPCs and ${totals.notifications} ACP notifications across v1 and v2.`
)
