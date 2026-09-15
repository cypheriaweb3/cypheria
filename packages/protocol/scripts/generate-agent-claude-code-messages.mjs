import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const checkOnly = process.argv.includes("--check")
const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const packageDirectory = dirname(
  fileURLToPath(import.meta.resolve("@anthropic-ai/claude-agent-sdk"))
)
const declarationPath = join(packageDirectory, "sdk.d.ts")
const packageJsonPath = join(packageDirectory, "package.json")
const outputPath = join(scriptDirectory, "../src/generated/claude/messages.ts")

const sourceText = await readFile(declarationPath, "utf8")
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"))
const sourceFile = ts.createSourceFile(
  declarationPath,
  sourceText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
)
const program = ts.createProgram([declarationPath], {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  skipLibCheck: true,
  target: ts.ScriptTarget.ESNext,
})
const checker = program.getTypeChecker()
const checkedSourceFile = program.getSourceFile(declarationPath)
if (!checkedSourceFile) throw new Error(`Could not load ${declarationPath}`)

const hasExportModifier = (node) =>
  node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false

const findDeclaration = (name) => {
  const declaration = checkedSourceFile.statements.find(
    (statement) =>
      (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) &&
      statement.name.text === name
  )
  if (!declaration) throw new Error(`Missing Claude Agent SDK declaration: ${name}`)
  return declaration
}

const literalStrings = (type) => {
  const members = type.isUnion() ? type.types : [type]
  return members.flatMap((member) => (member.isStringLiteral() ? [member.value] : []))
}

const propertyLiteralStrings = (type, name, location) => {
  const property = type.getProperty(name)
  if (!property) return []
  return literalStrings(checker.getTypeOfSymbolAtLocation(property, location))
}

const pascalCase = (value) =>
  value
    .split(/[._-]/u)
    .filter(Boolean)
    .map((segment) => `${segment[0].toUpperCase()}${segment.slice(1)}`)
    .join("")

const sdkMessageDeclaration = findDeclaration("SDKMessage")
const sdkMessageType = checker.getTypeAtLocation(sdkMessageDeclaration)
const sdkMessageMembers = (sdkMessageType.isUnion() ? sdkMessageType.types : [sdkMessageType]).map(
  (member) => {
    const alias = member.aliasSymbol?.name ?? member.symbol?.name
    if (!alias) throw new Error("Claude SDKMessage contains an anonymous member")
    const payloadTypes = propertyLiteralStrings(member, "type", sdkMessageDeclaration)
    const payloadSubtypes = propertyLiteralStrings(member, "subtype", sdkMessageDeclaration)
    if (payloadTypes.length !== 1) {
      throw new Error(`${alias} must have exactly one string type discriminator`)
    }
    const replay =
      alias === "SDKUserMessageReplay" ? "replay" : alias === "SDKUserMessage" ? "live" : null
    const logicalSegment =
      payloadTypes[0] === "system"
        ? `system.${payloadSubtypes.join("_")}`
        : payloadTypes[0] === "result"
          ? `result.${alias === "SDKResultSuccess" ? "success" : "error"}`
          : replay === "replay"
            ? "user_replay"
            : payloadTypes[0]
    const stem = `AgentClaude${pascalCase(logicalSegment)}`
    const notificationStem = stem.endsWith("Notification") ? stem : `${stem}Notification`
    return {
      alias,
      logicalType: `agent.claude.${logicalSegment}.notification`,
      payloadSubtypes,
      payloadType: payloadTypes[0],
      replay,
      schemaName: `${notificationStem}Schema`,
      typeName: notificationStem,
    }
  }
)

const duplicateLogicalTypes = sdkMessageMembers
  .map(({ logicalType }) => logicalType)
  .filter((logicalType, index, values) => values.indexOf(logicalType) !== index)
if (duplicateLogicalTypes.length > 0) {
  throw new Error(`Duplicate Claude logical message types: ${duplicateLogicalTypes.join(", ")}`)
}

const optionDeclaration = findDeclaration("Options")
const optionKeys = checker
  .getTypeAtLocation(optionDeclaration)
  .getProperties()
  .map(({ name }) => name)
  .sort()

const queryDeclaration = findDeclaration("Query")
if (!ts.isInterfaceDeclaration(queryDeclaration))
  throw new Error("Claude Query must be an interface")
const queryMethods = queryDeclaration.members
  .filter(ts.isMethodSignature)
  .map((member) => member.name.getText(checkedSourceFile))
  .sort()

const topLevelFunctions = sourceFile.statements
  .filter((statement) => ts.isFunctionDeclaration(statement) && hasExportModifier(statement))
  .map((statement) => statement.name?.text)
  .filter(Boolean)
  .sort()

const quoted = (value) => JSON.stringify(value)
const readonlyArray = (values) => `[${values.map(quoted).join(", ")}] as const`
const typeImports = sdkMessageMembers
  .map(({ alias }) => alias)
  .sort()
  .join(", ")
const schemas = sdkMessageMembers
  .map(
    ({
      alias,
      logicalType,
      payloadSubtypes,
      payloadType,
      replay,
      schemaName,
      typeName,
    }) => `export const ${schemaName} = claudeSdkMessageNotificationSchema<${alias}, ${quoted(logicalType)}>(
  ${quoted(logicalType)},
  ${quoted(payloadType)},
  ${readonlyArray(payloadSubtypes)},
  ${replay === null ? "undefined" : quoted(replay)}
)
export type ${typeName} = z.infer<typeof ${schemaName}>`
  )
  .join("\n\n")
const registryEntries = sdkMessageMembers
  .map(
    ({ alias, logicalType, payloadSubtypes, payloadType, replay, schemaName }) =>
      `  ${quoted(alias)}: { notification: ${quoted(logicalType)}, payloadSubtypes: ${readonlyArray(payloadSubtypes)}, payloadType: ${quoted(payloadType)}, replay: ${replay === null ? "undefined" : quoted(replay)}, schema: ${schemaName} },`
  )
  .join("\n")
const unionTypes = sdkMessageMembers.map(({ typeName }) => `  | ${typeName}`).join("\n")
const unionSchemas = sdkMessageMembers.map(({ schemaName }) => `  ${schemaName},`).join("\n")

const output = `${`// GENERATED CODE! DO NOT MODIFY BY HAND!
// biome-ignore-all format: Keep the generated Claude Agent SDK registry reviewable.
// Run \`pnpm --filter @cypheria/protocol generate:agent-claude-code-messages\` after updating the SDK.

import type { ${typeImports} } from "@anthropic-ai/claude-agent-sdk"
import type { z } from "zod"
import { claudeDiscriminatedUnion, claudeSdkMessageNotificationSchema } from "../../agent/claude-schema-registry.ts"

export const CLAUDE_AGENT_SDK_VERSION = ${quoted(packageJson.version)} as const
export const CLAUDE_AGENT_SDK_OPTION_KEYS = ${readonlyArray(optionKeys)}
export const CLAUDE_AGENT_SDK_QUERY_METHODS = ${readonlyArray(queryMethods)}
export const CLAUDE_AGENT_SDK_TOP_LEVEL_FUNCTIONS = ${readonlyArray(topLevelFunctions)}

${schemas}

export const AGENT_CLAUDE_SDK_NOTIFICATIONS = {
${registryEntries}
} as const

export type AgentClaudeSdkNotification =
${unionTypes}

export const AgentClaudeSdkNotificationSchema = claudeDiscriminatedUnion<AgentClaudeSdkNotification>([
${unionSchemas}
])
`.trimEnd()}\n`

if (checkOnly) {
  const current = await readFile(outputPath, "utf8").catch(() => "")
  if (current !== output) {
    throw new Error(
      "Generated Claude Agent SDK messages are stale. Run pnpm --filter @cypheria/protocol generate:agent-claude-code-messages"
    )
  }
} else {
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, output)
}

console.log(
  `${checkOnly ? "Checked" : "Generated"} Claude Agent SDK ${packageJson.version}: ${sdkMessageMembers.length} messages, ${queryMethods.length} Query methods, ${optionKeys.length} options, and ${topLevelFunctions.length} exported functions.`
)
