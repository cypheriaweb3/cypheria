import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, extname, join, resolve } from "node:path"

const packageRoot = resolve(import.meta.dirname, "..")
const generatedTypeRoot = resolve(packageRoot, "src/generated/codex/ts")
const generatedSchemaRoot = resolve(packageRoot, "src/generated/codex/schema")
const responseMapPath = resolve(packageRoot, "src/agent/codex-app-server-response-map.ts")

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

const responseEntries = (section) =>
  [...section.matchAll(/readonly (?:"([^"]+)"|(\w+)):\s+(?:v2\.)?(\w+)/g)]
    .map((match) => [match[1] ?? match[2], match[3]])
    .sort(([left], [right]) => left.localeCompare(right))

const generateResponseSchemaMaps = async () => {
  const source = await readFile(responseMapPath, "utf8")
  const [clientSection, serverSection] = source.split(
    "/** Compile-time mapping from every server-initiated request"
  )
  const clientEntries = responseEntries(clientSection)
  const serverEntries = responseEntries(serverSection)

  await mkdir(generatedSchemaRoot, { recursive: true })
  await Promise.all([
    writeFile(
      resolve(generatedSchemaRoot, "client-response-map.json"),
      `${JSON.stringify(Object.fromEntries(clientEntries), null, 2)}\n`
    ),
    writeFile(
      resolve(generatedSchemaRoot, "server-response-map.json"),
      `${JSON.stringify(Object.fromEntries(serverEntries), null, 2)}\n`
    ),
  ])
  console.log(
    `Generated response schema mappings for ${clientEntries.length} client and ${serverEntries.length} server request methods.`
  )
}

const rewriteV2References = (value) => {
  if (Array.isArray(value)) return value.map(rewriteV2References)
  if (typeof value !== "object" || value === null) return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "default")
      .map(([key, entry]) => [
        key,
        key === "$ref" && typeof entry === "string"
          ? entry.replace("#/definitions/v2/", "#/definitions/")
          : rewriteV2References(entry),
      ])
  )
}

const generateZodCompatibleSchema = async () => {
  const sourcePath = resolve(generatedSchemaRoot, "codex_app_server_protocol.schemas.json")
  const protocolSchema = JSON.parse(await readFile(sourcePath, "utf8"))
  const rewritten = rewriteV2References(protocolSchema)
  const v2Definitions = rewritten.definitions.v2
  rewritten.definitions = {
    ...rewritten.definitions,
    ...v2Definitions,
  }
  delete rewritten.definitions.v2

  await writeFile(
    resolve(generatedSchemaRoot, "codex_app_server_protocol.zod.schemas.json"),
    `${JSON.stringify(rewritten, null, 2)}\n`
  )
  console.log(
    `Generated a z.fromJSONSchema-compatible registry with ${Object.keys(rewritten.definitions).length} definitions.`
  )
}

await normalizeGeneratedTypes()
await pruneGeneratedSchemas()
await generateResponseSchemaMaps()
await generateZodCompatibleSchema()
