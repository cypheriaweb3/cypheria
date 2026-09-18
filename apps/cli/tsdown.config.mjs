import { defineConfig } from "tsdown"

export default defineConfig({
  clean: true,
  deps: {
    alwaysBundle: [/^@cypheria\//],
    onlyBundle: false,
  },
  entry: { cli: "src/main.ts" },
  format: "esm",
  outDir: "dist",
  platform: "node",
  target: "node24",
})
