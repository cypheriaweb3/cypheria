import { access, cp, mkdir, rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const source = fileURLToPath(new URL("../../expo/dist/", import.meta.url))
const destination = fileURLToPath(new URL("../dist/web/", import.meta.url))
const migrationsSource = fileURLToPath(new URL("../../../packages/db/drizzle/", import.meta.url))
const migrationsDestination = fileURLToPath(new URL("../dist/drizzle/", import.meta.url))
const pluginMarketplaceSource = fileURLToPath(
  new URL("../../../plugins/marketplace/", import.meta.url)
)
const pluginMarketplaceDestination = fileURLToPath(new URL("../dist/marketplace/", import.meta.url))
const codeReviewAppSource = fileURLToPath(
  new URL("../../../packages/code-review-app/dist/pull-requests.html", import.meta.url)
)
const codeReviewAppDestination = fileURLToPath(
  new URL("../dist/marketplace/plugins/code-review/assets/", import.meta.url)
)

try {
  await access(new URL("index.html", new URL("../../expo/dist/", import.meta.url)))
} catch {
  throw new Error(
    "Expo web output is missing. Run `pnpm --filter @cypheria/expo build` before building the server."
  )
}
try {
  await access(codeReviewAppSource)
} catch {
  throw new Error(
    "Code Review App output is missing. Run `pnpm --filter @cypheria/code-review-app build` before building the server."
  )
}

await rm(destination, { force: true, recursive: true })
await mkdir(destination, { recursive: true })
await cp(source, destination, { recursive: true })
await rm(migrationsDestination, { force: true, recursive: true })
await cp(migrationsSource, migrationsDestination, { recursive: true })
await rm(pluginMarketplaceDestination, { force: true, recursive: true })
await cp(pluginMarketplaceSource, pluginMarketplaceDestination, { recursive: true })
await mkdir(codeReviewAppDestination, { recursive: true })
await cp(codeReviewAppSource, `${codeReviewAppDestination}pull-requests.html`)
