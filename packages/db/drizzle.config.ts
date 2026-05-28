import { homedir } from "node:os"
import { join } from "node:path"

import { defineConfig } from "drizzle-kit"

const cypheriaHome = process.env.CYPHERIA_HOME?.trim() || join(homedir(), ".cypheria")
const databaseUrl = process.env.CYPHERIA_DATABASE_URL || join(cypheriaHome, "db", "cypheria.sqlite")

export default defineConfig({
  dbCredentials: {
    url: databaseUrl,
  },
  dialect: "sqlite",
  out: "./drizzle",
  schema: "./src/schema.ts",
  strict: true,
  verbose: true,
})
