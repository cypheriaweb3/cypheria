import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { createClient } from "@hey-api/openapi-ts"
import { zod as zodPlugin } from "@hey-api/openapi-ts/plugins"

const packageRoot = resolve(import.meta.dirname, "..")
const generatedMagpieRoot = resolve(packageRoot, "src/generated/magpie")
const generatedZodRoot = resolve(generatedMagpieRoot, "zod")
const stagingRoot = resolve(generatedMagpieRoot, ".zod-staging")
const previousRoot = resolve(generatedMagpieRoot, ".zod-previous")
const sourcePath = resolve(generatedMagpieRoot, "openapi.json")
const outputPath = resolve(generatedZodRoot, "zod.gen.ts")
const stagingOutputPath = resolve(stagingRoot, "zod.gen.ts")
const releasePath = resolve(generatedMagpieRoot, "release.json")
const checkOnly = process.argv.includes("--check")
// --fetch replaces openapi.json with the one of the pinned release first
const fetchSource = process.argv.includes("--fetch")

const fetchPinnedOpenApi = async () => {
  const release = JSON.parse(await readFile(releasePath, "utf8"))
  const url = `https://raw.githubusercontent.com/${release.sourceRepository}/v${release.version}/internal/gui/openapi.json`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`GET ${url}: ${response.status}`)
  const text = await response.text()
  JSON.parse(text)
  await writeFile(sourcePath, text)
  console.log(`Fetched magpie v${release.version} OpenAPI.`)
}

const generateIntoStaging = async () => {
  await rm(stagingRoot, { force: true, recursive: true })
  await mkdir(stagingRoot, { recursive: true })

  await createClient({
    input: sourcePath,
    output: { path: stagingRoot },
    plugins: [
      zodPlugin({
        compatibilityVersion: 4,
        dates: false,
      }),
    ],
  })

  const generated = await readFile(stagingOutputPath, "utf8")
  return { generated }
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

if (fetchSource && !checkOnly) await fetchPinnedOpenApi()

const { generated } = await generateIntoStaging()

if (checkOnly) {
  const current = await readFile(outputPath, "utf8").catch(() => "")
  await rm(stagingRoot, { force: true, recursive: true })
  if (current !== generated) {
    throw new Error(
      "Generated Magpie Zod schemas are stale. Run pnpm --filter @cypheria/protocol generate:magpie-zod"
    )
  }
} else {
  await replaceGeneratedOutput()
}

console.log(`${checkOnly ? "Checked" : "Generated"} Magpie Zod schemas with Hey API.`)
