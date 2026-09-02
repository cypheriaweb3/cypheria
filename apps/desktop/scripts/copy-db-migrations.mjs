import { cp, rm } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const source = resolve(desktopDir, "../../packages/db/drizzle")
const destination = resolve(desktopDir, "dist/drizzle")

await rm(destination, { force: true, recursive: true })
await cp(source, destination, { recursive: true })
