import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, extname, join, resolve } from "node:path"

const packageRoot = resolve(import.meta.dirname, "..")
const generatedTypeRoot = resolve(packageRoot, "src/generated/codex/ts")
const generatedSchemaRoot = resolve(packageRoot, "src/generated/codex/schema")
const responseMapPath = resolve(packageRoot, "src/generated/codex/response-map.ts")
const checkOnly = process.argv.includes("--check")

const retainedCodexSchemas = new Set([
  "codex_app_server_protocol.schemas.json",
  "codex_app_server_protocol.v2.schemas.json",
])

const collectGeneratedTypes = async (directory) => {
  const paths = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      paths.push(...(await collectGeneratedTypes(path)))
      continue
    }
    if (entry.isFile() && extname(entry.name) === ".ts") paths.push(path)
  }
  return paths
}

const normalizeRelativeTypeSpecifiers = (source, path, generatedTypePaths) => {
  const specifiers = [...source.matchAll(/(?:from\s+|import\s*)["'](\.{1,2}\/[^"']+)["']/gu)].map(
    (match) => match[1]
  )
  let replacements = 0

  for (const specifier of new Set(specifiers)) {
    if (extname(specifier)) continue

    const fileCandidate = resolve(dirname(path), `${specifier}.ts`)
    const directoryCandidate = resolve(dirname(path), specifier, "index.ts")
    const normalizedSpecifier = generatedTypePaths.has(fileCandidate)
      ? `${specifier}.ts`
      : generatedTypePaths.has(directoryCandidate)
        ? `${specifier}/index.ts`
        : undefined

    if (!normalizedSpecifier) {
      throw new Error(`Cannot resolve generated TypeScript import ${specifier} from ${path}`)
    }

    source = source
      .replaceAll(`"${specifier}"`, `"${normalizedSpecifier}"`)
      .replaceAll(`'${specifier}'`, `'${normalizedSpecifier}'`)
    replacements += 1
  }

  return { replacements, source }
}

const normalizeGeneratedTypes = async () => {
  const paths = await collectGeneratedTypes(generatedTypeRoot)
  const generatedTypePaths = new Set(paths)
  let integerReplacements = 0
  let specifierReplacements = 0

  for (const path of paths) {
    const before = await readFile(path, "utf8")
    const matches = before.match(/\bbigint\b/gu)
    const integerNormalized = before.replaceAll(/\bbigint\b/gu, "number")
    const specifierNormalized = normalizeRelativeTypeSpecifiers(
      integerNormalized,
      path,
      generatedTypePaths
    )

    if (specifierNormalized.source !== before) await writeFile(path, specifierNormalized.source)
    integerReplacements += matches?.length ?? 0
    specifierReplacements += specifierNormalized.replacements
  }

  console.log(
    `Normalized ${integerReplacements} generated 64-bit integer type(s) to JSON number and ${specifierReplacements} relative TypeScript specifier(s).`
  )
}

const pruneGeneratedSchemas = async () => {
  for (const entry of await readdir(generatedSchemaRoot, { withFileTypes: true })) {
    if (!retainedCodexSchemas.has(entry.name)) {
      await rm(join(generatedSchemaRoot, entry.name), { force: true, recursive: true })
    }
  }
}

const responseTypeOverrides = {
  "account/logout": "LogoutAccountResponse",
  "account/rateLimits/read": "GetAccountRateLimitsResponse",
  "account/workspaceMessages/read": "GetWorkspaceMessagesResponse",
  "config/batchWrite": "ConfigWriteResponse",
  "config/mcpServer/reload": "McpServerRefreshResponse",
  "config/value/write": "ConfigWriteResponse",
  "configRequirements/read": "ConfigRequirementsReadResponse",
  "externalAgentConfig/import/readHistories": "ExternalAgentConfigImportHistoriesReadResponse",
  "memory/reset": "MemoryResetResponse",
  "remoteControl/status/read": "RemoteControlStatusReadResponse",
  "windowsSandbox/readiness": "WindowsSandboxReadinessResponse",
}

const responseTypeLocation = async (responseType) => {
  const locations = await Promise.all(
    ["root", "v2"].map(async (namespace) => {
      const directory = namespace === "root" ? generatedTypeRoot : resolve(generatedTypeRoot, "v2")
      try {
        await readFile(resolve(directory, `${responseType}.ts`), "utf8")
        return namespace
      } catch (error) {
        if (error?.code === "ENOENT") return null
        throw error
      }
    })
  )
  const matches = locations.filter(Boolean)
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one generated TypeScript definition for ${responseType}, found ${matches.length}`
    )
  }
  return matches[0]
}

const requestResponseEntries = async (fileName, overrides = {}) => {
  const source = await readFile(resolve(generatedTypeRoot, fileName), "utf8")
  const requests = [
    ...source.matchAll(/\{ "method": "([^"]+)", id: RequestId, params\??: (.*?), \}/g),
  ]

  return Promise.all(
    requests.map(async ([, method, rawParamsType]) => {
      const paramsType = rawParamsType.replace(/ \| (?:null|undefined)/g, "")
      const responseType = overrides[method] ?? paramsType.replace(/Params$/, "Response")
      if (responseType === paramsType) {
        throw new Error(`Cannot infer the response type for ${method} from ${paramsType}`)
      }
      return {
        method,
        namespace: await responseTypeLocation(responseType),
        responseType,
      }
    })
  )
}

const responseTypeReference = ({ namespace, responseType }) =>
  namespace === "v2" ? `v2.${responseType}` : responseType

const renderResponseMap = (name, description, entries) => `/** ${description} */
export type ${name} = {
${entries.map((entry) => `  readonly ${JSON.stringify(entry.method)}: ${responseTypeReference(entry)}`).join("\n")}
}`

const checkGeneratedFile = async (path, expected) => {
  const actual = await readFile(path, "utf8")
  if (actual !== expected) {
    throw new Error(`Generated Codex response mapping is stale: ${path}`)
  }
}

const generateResponseMaps = async () => {
  const [clientEntries, serverEntries] = await Promise.all([
    requestResponseEntries("ClientRequest.ts", responseTypeOverrides),
    requestResponseEntries("ServerRequest.ts"),
  ])
  const rootResponseTypes = [
    ...new Set(
      [...clientEntries, ...serverEntries]
        .filter(({ namespace }) => namespace === "root")
        .map(({ responseType }) => responseType)
    ),
  ].sort()
  const responseMapSource = `// GENERATED CODE! DO NOT MODIFY BY HAND!
// Generated from Codex request unions and response types by process-codex-app-server-generated.mjs.

import type { ${[...rootResponseTypes, "v2"].join(", ")} } from "./ts/index.ts"

${renderResponseMap(
  "CodexClientResponseMap",
  "Compile-time mapping from every client request method to its generated result type.",
  clientEntries
)}

${renderResponseMap(
  "CodexServerRequestResponseMap",
  "Compile-time mapping from every server-initiated request to the required client result.",
  serverEntries
)}

export type CodexClientResponse<M extends keyof CodexClientResponseMap> = CodexClientResponseMap[M]

export type CodexServerRequestResponse<M extends keyof CodexServerRequestResponseMap> =
  CodexServerRequestResponseMap[M]
`
  const clientSchemaEntries = clientEntries
    .map(({ method, responseType }) => [method, responseType])
    .sort(([left], [right]) => left.localeCompare(right))
  const serverSchemaEntries = serverEntries
    .map(({ method, responseType }) => [method, responseType])
    .sort(([left], [right]) => left.localeCompare(right))

  const clientSchemaSource = `${JSON.stringify(Object.fromEntries(clientSchemaEntries), null, 2)}\n`
  const serverSchemaSource = `${JSON.stringify(Object.fromEntries(serverSchemaEntries), null, 2)}\n`

  if (checkOnly) {
    await Promise.all([
      checkGeneratedFile(responseMapPath, responseMapSource),
      checkGeneratedFile(
        resolve(generatedSchemaRoot, "client-response-map.json"),
        clientSchemaSource
      ),
      checkGeneratedFile(
        resolve(generatedSchemaRoot, "server-response-map.json"),
        serverSchemaSource
      ),
    ])
    console.log(
      `Checked response mappings for ${clientEntries.length} client and ${serverEntries.length} server request methods.`
    )
    return
  }

  await mkdir(generatedSchemaRoot, { recursive: true })
  await Promise.all([
    writeFile(responseMapPath, responseMapSource),
    writeFile(resolve(generatedSchemaRoot, "client-response-map.json"), clientSchemaSource),
    writeFile(resolve(generatedSchemaRoot, "server-response-map.json"), serverSchemaSource),
  ])
  console.log(
    `Generated response schema mappings for ${clientEntries.length} client and ${serverEntries.length} server request methods.`
  )
}

if (!checkOnly) {
  await normalizeGeneratedTypes()
  await pruneGeneratedSchemas()
}
await generateResponseMaps()
