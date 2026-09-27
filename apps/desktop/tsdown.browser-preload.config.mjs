import { defineConfig } from "tsdown"

export default defineConfig({
  clean: true,
  deps: {
    alwaysBundle: (id) => id !== "electron" && !id.startsWith("node:"),
    neverBundle: ["electron"],
    onlyBundle: false,
  },
  entry: ["browser-preload/src/index.ts"],
  format: "cjs",
  outDir: "dist/browser-preload",
  platform: "node",
  target: "node24",
})
