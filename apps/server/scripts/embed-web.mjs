import { access, chmod, copyFile, cp, mkdir, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { packagePlugin as packageCodeReview } from "../../../plugins/code-review/scripts/build.mjs"

const source = fileURLToPath(new URL("../../expo/dist/", import.meta.url))
const destination = fileURLToPath(new URL("../dist/web/", import.meta.url))
const migrationsSource = fileURLToPath(new URL("../../../packages/db/drizzle/", import.meta.url))
const migrationsDestination = fileURLToPath(new URL("../dist/drizzle/", import.meta.url))
const plugins = fileURLToPath(new URL("../../../plugins/", import.meta.url))
const pluginMarketplaceDestination = fileURLToPath(new URL("../dist/marketplace/", import.meta.url))

try {
  await access(new URL("index.html", new URL("../../expo/dist/", import.meta.url)))
} catch {
  throw new Error(
    "Expo web output is missing. Run `pnpm --filter @cypheria/expo build` before building the server."
  )
}

await rm(destination, { force: true, recursive: true })
await mkdir(destination, { recursive: true })
await cp(source, destination, { recursive: true })
await rm(migrationsDestination, { force: true, recursive: true })
await cp(migrationsSource, migrationsDestination, { recursive: true })
// The bundled marketplace: its manifests, `cypheria-app-tools` as it is, and `code-review` as an
// installable plugin without its App sources and dependencies.
await rm(pluginMarketplaceDestination, { force: true, recursive: true })
for (const entry of [
  ".agents",
  ".claude-plugin",
  "cypheria-app-tools",
  "browser",
  "chrome",
  "computer-use",
]) {
  await cp(`${plugins}${entry}`, `${pluginMarketplaceDestination}${entry}`, { recursive: true })
}
await packageCodeReview(`${pluginMarketplaceDestination}code-review`)

// The Computer Use runtime next to the bundle (`dist/cua`): the cua_repl launcher and runtime,
// the plugin template and instructions, and this platform's agent-browser and cua-driver.
const cuaSource = fileURLToPath(new URL("../../cua/", import.meta.url))
const cuaDestination = fileURLToPath(new URL("../dist/cua/", import.meta.url))
try {
  await access(join(cuaSource, "dist", "cua-repl.mjs"))
} catch {
  throw new Error("The cua runtime is not built. Run `pnpm --filter @cypheria/cua build` first.")
}
await rm(cuaDestination, { force: true, recursive: true })
for (const entry of ["dist", "plugin", "instructions", "package.json"]) {
  await cp(join(cuaSource, entry), join(cuaDestination, entry), { recursive: true })
}
await mkdir(join(cuaDestination, "bin"), { recursive: true })
const exe = process.platform === "win32" ? ".exe" : ""
const agentBrowser = join(
  dirname(createRequire(join(cuaSource, "package.json")).resolve("agent-browser/package.json")),
  "bin",
  `agent-browser-${process.platform}-${process.arch}${exe}`
)
await copyFile(agentBrowser, join(cuaDestination, "bin", `agent-browser${exe}`))
await chmod(join(cuaDestination, "bin", `agent-browser${exe}`), 0o755)
const cuaDriver = join(cuaSource, "vendor", "cua-driver", `cua-driver${exe}`)
try {
  await access(cuaDriver)
  await copyFile(cuaDriver, join(cuaDestination, "bin", `cua-driver${exe}`))
  await chmod(join(cuaDestination, "bin", `cua-driver${exe}`), 0o755)
} catch {
  // Without `pnpm --filter @cypheria/cua fetch:cua-driver`, native app control uses an installed
  // CuaDriver.app or `CYPHERIA_CUA_DRIVER_PATH`.
}
