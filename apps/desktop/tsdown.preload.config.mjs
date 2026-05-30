import { defineConfig } from "tsdown"

export default defineConfig({
  clean: true,
  deps: {
    alwaysBundle: [/^@cypheria\//],
    neverBundle: ["electron"],
    onlyBundle: false,
  },
  entry: ["preload/src/index.ts"],
  format: "cjs",
  outDir: "dist/preload",
  platform: "node",
  target: "node24",
})
