import { readdir, rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const schemaDirectory = fileURLToPath(new URL("../src/generated-schema/", import.meta.url))
const retained = new Set([
  "codex_app_server_protocol.schemas.json",
  "codex_app_server_protocol.v2.schemas.json",
])

for (const entry of await readdir(schemaDirectory, { withFileTypes: true })) {
  if (!retained.has(entry.name)) {
    await rm(`${schemaDirectory}/${entry.name}`, { force: true, recursive: true })
  }
}
