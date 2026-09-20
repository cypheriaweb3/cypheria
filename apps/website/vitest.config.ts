import { resolve } from "node:path"
import { lingui } from "@lingui/vite-plugin"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [lingui()],
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "src") },
  },
  test: {
    include: ["src/**/*.test.ts", "source.config.test.ts"],
  },
})
