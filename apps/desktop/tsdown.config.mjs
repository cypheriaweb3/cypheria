import { defineConfig } from "tsdown"

export default defineConfig({
  clean: true,
  deps: {
    alwaysBundle: [/^@cypheria\//],
    neverBundle: ["electron", "@libsql/client", /^@libsql\//, "libsql"],
    onlyBundle: false,
  },
  entry: ["main/src/index.ts"],
  format: "esm",
  outDir: "dist/main",
  platform: "node",
  target: "node24",
})
