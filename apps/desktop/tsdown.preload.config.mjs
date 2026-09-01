import { defineConfig } from "tsdown"

export default defineConfig({
  clean: true,
  deps: {
    alwaysBundle: (id) => id !== "electron" && !id.startsWith("node:"),
    neverBundle: ["electron"],
    onlyBundle: false,
  },
  entry: ["preload/src/index.ts"],
  format: "cjs",
  outDir: "dist/preload",
  platform: "node",
  target: "node24",
})
