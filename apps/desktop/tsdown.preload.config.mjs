import { defineConfig } from "tsdown"

export default defineConfig({
  clean: true,
  deps: {
    neverBundle: ["electron"],
  },
  entry: ["preload/src/index.ts"],
  format: "cjs",
  outDir: "dist/preload",
  platform: "node",
  target: "node24",
})
