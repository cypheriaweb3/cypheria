import { fileURLToPath } from "node:url"

process.env.CYPHERIA_SERVER_WEB_DIR ??= fileURLToPath(new URL("../../expo/dist/", import.meta.url))

await import("./main.js")
