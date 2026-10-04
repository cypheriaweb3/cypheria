import { builtinModules } from "node:module"
import { defineConfig } from "vite"

// Builds the two files `cua_repl` runs: the launcher MCP servers start (dist/cua-repl.mjs) and
// the `cua` runtime the REPL banner imports (dist/runtime.mjs). The runtime is self-contained
// because it runs inside the REPL sandbox; only Node builtins stay external for the launcher.
export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: false,
    outDir: "dist",
    reportCompressedSize: false,
    rolldownOptions: {
      input: {
        "cua-repl": "src/launcher/main.ts",
        runtime: "src/runtime/index.ts",
      },
      output: {
        chunkFileNames: "[name].mjs",
        entryFileNames: "[name].mjs",
        format: "es",
      },
    },
    ssr: true,
    target: "node24",
  },
  ssr: {
    external: builtinModules.flatMap((name) => [name, `node:${name}`]),
    noExternal: true,
    target: "node",
  },
})
