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
    viteReact(),
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
})
