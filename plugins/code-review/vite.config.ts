import { lingui } from "@lingui/vite-plugin"
import babel from "@rolldown/plugin-babel"
import tailwindcss from "@tailwindcss/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { viteSingleFile } from "vite-plugin-singlefile"

/** Languages the diff viewer highlights; others render as plain text. */
const LANGUAGES = new Set([
  "bash",
  "c",
  "csharp",
  "css",
  "diff",
  "docker",
  "dockerfile",
  "go",
  "graphql",
  "java",
  "javascript",
  "json",
  "jsonc",
  "jsx",
  "kotlin",
  "lua",
  "make",
  "proto",
  "python",
  "ruby",
  "rust",
  "scss",
  "shellscript",
  "solidity",
  "sql",
  "swift",
  "toml",
  "tsx",
  "typescript",
  "xml",
  "yaml",
])
/** Themes the App draws code with; the diff viewer's own themes come from @pierre/theme. */
const THEMES = new Set(["github-light", "github-dark"])

/**
 * Keeps the single-file App small enough to serve as one MCP resource. Every Shiki language and
 * theme outside the lists becomes an empty stand-in, so a file in another language still renders,
 * as plain text.
 */
const trimShiki = (): Plugin => ({
  enforce: "pre",
  load(id) {
    const language = /[\\/]@shikijs[\\/]langs[\\/]dist[\\/]([\w-]+)\.mjs$/u.exec(id)?.[1]
    if (language && !LANGUAGES.has(language)) {
      return `export default [${JSON.stringify({ name: language, patterns: [], scopeName: `source.${language}` })}]`
    }
    const theme = /[\\/]@shikijs[\\/]themes[\\/]dist[\\/]([\w-]+)\.mjs$/u.exec(id)?.[1]
    if (theme && !THEMES.has(theme)) {
      return `export default ${JSON.stringify({ colors: {}, name: theme, tokenColors: [], type: "dark" })}`
    }
    if (
      /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:mermaid|katex)[\\/]/u.test(
        id
      )
    ) {
      return "export default { initialize() {}, render() { throw new Error('Diagrams are unavailable') } }"
    }
    return null
  },
  name: "cypheria-trim-shiki",
})

/**
 * One self-contained HTML document, `dist/app.html`: MCP App resources are served as a single
 * `ui://` text.
 */
export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: "../../dist",
    rollupOptions: { input: "app.html" },
  },
  root: "src/app",
  plugins: [
    trimShiki(),
    babel({ plugins: ["@lingui/babel-plugin-lingui-macro"] }),
    viteReact(),
    lingui(),
    tailwindcss(),
    viteSingleFile(),
  ],
})
