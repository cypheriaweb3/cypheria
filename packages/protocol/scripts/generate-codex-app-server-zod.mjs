import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { createClient } from "@hey-api/openapi-ts"
import { zod as zodPlugin } from "@hey-api/openapi-ts/plugins"

const packageRoot = resolve(import.meta.dirname, "..")
const generatedCodexRoot = resolve(packageRoot, "src/generated/codex")
const generatedSchemaRoot = resolve(generatedCodexRoot, "schema")
const generatedZodRoot = resolve(generatedCodexRoot, "zod")
const stagingRoot = resolve(generatedCodexRoot, ".zod-staging")
const previousRoot = resolve(generatedCodexRoot, ".zod-previous")
const sourcePath = resolve(generatedSchemaRoot, "codex_app_server_protocol.schemas.json")
const outputPath = resolve(generatedZodRoot, "zod.gen.ts")
const stagingOutputPath = resolve(stagingRoot, "zod.gen.ts")
const registryPath = resolve(generatedZodRoot, "registry.gen.ts")
const stagingRegistryPath = resolve(stagingRoot, "registry.gen.ts")
const checkOnly = process.argv.includes("--check")

const normalizeSchema = (value, parentKey) => {
  if (Array.isArray(value)) return value.map((entry) => normalizeSchema(entry, parentKey))
  if (typeof value !== "object" || value === null) return value

  // A property can legitimately be named `default`. Only remove the JSON Schema
  // annotation when this object is not a `properties` map. Zod defaults transform
  // parsed output, while the protocol boundary must preserve the wire payload.
  const isPropertiesMap = parentKey === "properties"

  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, entry]) =>
          (key !== "default" || isPropertiesMap) &&
          !(key === "format" && (entry === "int64" || entry === "uint64"))
      )
      .map(([key, entry]) => [
        key,
        key === "$ref" && typeof entry === "string"
          ? entry.replace(/^#\/definitions\/(?:v2\/)?/, "#/components/schemas/")
          : normalizeSchema(entry, key),
      ])
  )
}

const prepareSchemas = (protocolSchema) => {
  const normalized = normalizeSchema(protocolSchema)
  const v2Definitions = normalized.definitions.v2

  if (typeof v2Definitions !== "object" || v2Definitions === null) {
    throw new TypeError("Codex schema is missing its nested v2 definitions")
  }

  const schemas = {
    ...normalized.definitions,
    ...v2Definitions,
  }
  delete schemas.v2
  return schemas
}

// Hey API normalizes the JSONRPC initialism when it creates TypeScript identifiers.
// Keep the upstream definition name as the public registry key.
const zodExportName = (definitionName) => definitionName.replace(/^JSONRPC/u, "Jsonrpc")

const renderRegistry = (schemaNames) => `// GENERATED CODE! DO NOT MODIFY BY HAND!
// Run \`pnpm --filter @cypheria/protocol generate:codex-zod\` after regenerating Codex schemas.

import * as schemas from "./zod.gen.ts"
import type { ZodType } from "zod"

export const codexGeneratedZodSchemas: Readonly<Record<string, ZodType>> = {
${schemaNames
  .sort((left, right) => left.localeCompare(right))
  .map((name) => `  ${JSON.stringify(name)}: schemas.z${zodExportName(name)},`)
  .join("\n")}
}
`

const childContext = (context, ...segments) => ({
  path: { "~ref": [...context.path["~ref"], ...segments] },
  plugin: context.plugin,
})

const createZodResolvers = () => ({
  // Hey API 0.99 ignores additionalProperties when an object also declares
  // properties. Preserve JSON Schema semantics for strict, open, and typed-rest
  // objects instead of silently stripping or accepting the wrong keys.
  object(context) {
    const shape = context.nodes.shape(context)
    const zod = context.$(context.plugin.imports.z)
    const additionalProperties = context.schema.additionalProperties

    if (additionalProperties?.type === "never") {
      return zod.attr("strictObject").call(shape)
    }
    if (!additionalProperties || additionalProperties.type === "unknown") {
      return zod.attr("looseObject").call(shape)
    }

    const additionalResult = context.walk(
      additionalProperties,
      childContext(context, "additionalProperties")
    )
    context._childResults.push(additionalResult)
    return zod.attr("object").call(shape).attr("catchall").call(additionalResult.chain)
  },
})

const countSchemaNodes = (value, predicate) => {
  if (Array.isArray(value)) {
    return value.reduce((count, entry) => count + countSchemaNodes(entry, predicate), 0)
  }
  if (typeof value !== "object" || value === null) return 0

  return (
    (predicate(value) ? 1 : 0) +
    Object.values(value).reduce((count, entry) => count + countSchemaNodes(entry, predicate), 0)
  )
}

const generateIntoStaging = async (schemas) => {
  await rm(stagingRoot, { force: true, recursive: true })
  await mkdir(stagingRoot, { recursive: true })

  await createClient({
    input: {
      openapi: "3.1.0",
      info: {
        title: "Codex App Server",
        version: "1",
      },
      components: { schemas },
    },
    output: { path: stagingRoot },
    plugins: [
      zodPlugin({
        $resolvers: createZodResolvers(),
        compatibilityVersion: 4,
        dates: false,
      }),
    ],
  })

  const generated = await readFile(stagingOutputPath, "utf8")
  const generatedNames = new Set(
    [...generated.matchAll(/^export const z([A-Za-z0-9_$]+)\s*=/gmu)].map((match) => match[1])
  )
  const missing = Object.keys(schemas).filter((name) => !generatedNames.has(zodExportName(name)))

  if (missing.length > 0 || generatedNames.size !== Object.keys(schemas).length) {
    throw new Error(
      `Hey API generated ${generatedNames.size} Codex Zod schemas for ${Object.keys(schemas).length} definitions; missing: ${missing.join(", ") || "none"}`
    )
  }
  if (/\b(?:BigInt|bigint)\b/u.test(generated)) {
    throw new Error(
      "Generated Codex Zod schemas contain bigint despite the JSON number wire contract"
    )
  }

  const expectedStrictObjects = countSchemaNodes(
    schemas,
    (schema) => schema.additionalProperties === false
  )
  const generatedStrictObjects = generated.match(/\bz\.strictObject\(/gu)?.length ?? 0
  if (generatedStrictObjects !== expectedStrictObjects) {
    throw new Error(
      `Expected ${expectedStrictObjects} strict Codex object schemas, generated ${generatedStrictObjects}`
    )
  }

  const registry = renderRegistry(Object.keys(schemas))
  await writeFile(stagingRegistryPath, registry)

  return { generated, registry }
}

const replaceGeneratedOutput = async () => {
  await rm(previousRoot, { force: true, recursive: true })

  let movedPrevious = false
  try {
    await rename(generatedZodRoot, previousRoot)
    movedPrevious = true
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error
  }

  try {
    await rename(stagingRoot, generatedZodRoot)
  } catch (error) {
    if (movedPrevious) await rename(previousRoot, generatedZodRoot)
    throw error
  }

  await rm(previousRoot, { force: true, recursive: true })
}

const protocolSchema = JSON.parse(await readFile(sourcePath, "utf8"))
const schemas = prepareSchemas(protocolSchema)
const { generated, registry } = await generateIntoStaging(schemas)

if (checkOnly) {
  const current = await readFile(outputPath, "utf8").catch(() => "")
  const currentRegistry = await readFile(registryPath, "utf8").catch(() => "")
  await rm(stagingRoot, { force: true, recursive: true })
  if (current !== generated || currentRegistry !== registry) {
    throw new Error(
      "Generated Codex Zod schemas are stale. Run pnpm --filter @cypheria/protocol generate:codex-zod"
    )
  }
} else {
  await replaceGeneratedOutput()
}

console.log(
  `${checkOnly ? "Checked" : "Generated"} ${Object.keys(schemas).length} static Codex Zod schemas with Hey API.`
)
