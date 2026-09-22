import { readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { AgentRegistryDocumentSchema } from "../src/agent/registry.ts"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const idsPath = resolve(root, "src/generated/acp/agent-ids.ts")
const registryPath = resolve(root, "src/generated/acp/registry.json")
const registryUrl = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json"
const nativeIds = new Set(["codex-acp", "claude-acp", "pi-acp", "opencode"])
const checkOnly = process.argv.includes("--check")

const sourceText = checkOnly
  ? await readFile(registryPath, "utf8")
  : await fetch(registryUrl, { signal: AbortSignal.timeout(20_000) }).then(async (response) => {
      if (!response.ok) throw new Error(`Registry download failed: HTTP ${response.status}`)
      return response.text()
    })
const source = AgentRegistryDocumentSchema.parse(JSON.parse(sourceText))
const sourceIds = new Set(source.agents.map(({ id }) => id))
for (const id of nativeIds) {
  if (!sourceIds.has(id)) throw new Error(`Native ACP registry id is missing: ${id}`)
}

const ids = source.agents
  .map(({ id }) => id)
  .filter((id) => !nativeIds.has(id))
  .sort()
const rendered = `// GENERATED CODE! DO NOT MODIFY BY HAND.\nexport const REGISTRY_AGENT_IDS = ${JSON.stringify(ids, null, 2)} as const\n`
const renderedRegistry = `${JSON.stringify(source, null, 2)}\n`

if (checkOnly) {
  if (sourceText !== renderedRegistry) throw new Error("Committed ACP registry is not normalized")
  if ((await readFile(idsPath, "utf8").catch(() => "")) !== rendered)
    throw new Error("Generated Agent IDs are stale")
} else {
  await Promise.all([writeFile(idsPath, rendered), writeFile(registryPath, renderedRegistry)])
}

console.log(
  `${checkOnly ? "Checked" : "Downloaded"} registry ${source.version} with ${ids.length} usable agent IDs.`
)
