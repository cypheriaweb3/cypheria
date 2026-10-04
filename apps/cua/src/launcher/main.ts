// The `cua_repl` MCP server entry point, built to dist/cua-repl.mjs.
import { fileURLToPath } from "node:url"

import { launch } from "./launch.ts"

try {
  await launch(fileURLToPath(new URL("../", import.meta.url)))
} catch (error) {
  console.error(`cua_repl could not start: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
}
