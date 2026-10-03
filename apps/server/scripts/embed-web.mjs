import { access, cp, mkdir, rm } from "node:fs/promises"
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
for (const entry of [".agents", ".claude-plugin", "cypheria-app-tools", "browser"]) {
  await cp(`${plugins}${entry}`, `${pluginMarketplaceDestination}${entry}`, { recursive: true })
}
await packageCodeReview(`${pluginMarketplaceDestination}code-review`)
