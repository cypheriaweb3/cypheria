import { cp, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..")
const serverDist = join(desktopDir, "..", "server", "dist")
const output = join(desktopDir, "dist", "cypheria-server")

await mkdir(output, { recursive: true })
await cp(serverDist, output, { recursive: true })
