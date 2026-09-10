import { defineConfig } from "tsdown"

export default defineConfig({
  clean: true,
  deps: {
    alwaysBundle: [/^@cypheria\//],
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
