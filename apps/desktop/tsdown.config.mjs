import { defineConfig } from "tsdown"

export default defineConfig({
  clean: true,
  deps: {
    neverBundle: ["electron"],
    onlyBundle: false,
  },
  entry: ["main/src/index.ts"],
  format: "esm",
  outDir: "dist/main",
  platform: "node",
  target: "node24",
})
