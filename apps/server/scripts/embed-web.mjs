import { access, cp, mkdir, rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const source = fileURLToPath(new URL("../../expo/dist/", import.meta.url))
const destination = fileURLToPath(new URL("../dist/web/", import.meta.url))

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
