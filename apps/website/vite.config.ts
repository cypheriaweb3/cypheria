import { resolve } from "node:path"
import { cloudflare } from "@cloudflare/vite-plugin"
import { lingui } from "@lingui/vite-plugin"
import babel from "@rolldown/plugin-babel"
import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { fumadocsMdx } from "fumadocs-mdx/vite"
import { defineConfig } from "vite"
import { prerenderPaths } from "./src/lib/site-routes"

export default defineConfig({
  envPrefix: ["VITE_", "CYPHERIA_"],
  plugins: [
    cloudflare({ inspectorPort: false, viteEnvironment: { name: "ssr" } }),
    fumadocsMdx(),
    tanstackStart({
      pages: prerenderPaths.map((path) => ({ path, prerender: { enabled: true } })),
      prerender: {
        autoStaticPathsDiscovery: true,
        concurrency: 4,
        crawlLinks: true,
        enabled: true,
        failOnError: true,
        retryCount: 1,
      },
    }),
    babel({ plugins: ["@lingui/babel-plugin-lingui-macro"] }),
    viteReact(),
    lingui(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
      tslib: "tslib/tslib.es6.js",
    },
    dedupe: ["lucide-react"],
    tsconfigPaths: true,
  },
  server: {
    port: 4173,
    strictPort: true,
  },
})
