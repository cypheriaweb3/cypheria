import { resolve } from "node:path"
import { lingui } from "@lingui/vite-plugin"
import babel from "@rolldown/plugin-babel"
import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: "dist",
    sourcemap: true,
  },
  plugins: [
    tanstackStart({
      client: {
        entry: "client.tsx",
      },
      router: {
        entry: "router.tsx",
        generatedRouteTree: "routeTree.gen.ts",
        quoteStyle: "double",
        routesDirectory: "routes",
        semicolons: false,
      },
      spa: {
        enabled: true,
      },
      srcDirectory: "renderer/src",
    }),
    babel({ plugins: ["@lingui/babel-plugin-lingui-macro"] }),
    viteReact(),
    lingui(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "renderer/src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
