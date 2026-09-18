import { defineConfig } from "tsdown"

export default defineConfig({
  clean: true,
  deps: {
    alwaysBundle: [
      /^@agentclientprotocol\//,
      /^@anthropic-ai\//,
      /^@cypheria\//,
      /^@earendil-works\//,
      /^@hono\//,
      /^@opencode-ai\//,
      "extract-zip",
      "hono",
      "pino",
      "tar",
      "ws",
      "zod",
    ],
    neverBundle: ["@libsql/client", /^@libsql\//, "libsql"],
    onlyBundle: false,
  },
  entry: {
    cli: "src/cli.ts",
    main: "src/main.ts",
    supervisor: "src/supervisor-entrypoint.ts",
  },
  format: "esm",
  outDir: "dist",
  platform: "node",
  target: "node24",
})
