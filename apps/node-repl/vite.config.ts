import fs from "node:fs"
import { builtinModules } from "node:module"
import path from "node:path"
import { defineConfig, minify, type Plugin } from "vite"

// Bundles the Node kernel and trusted worker into the assets that the Go binary
// embeds. Dependencies such as meriyah are bundled; only Node builtins stay
// external.

const vendorChunk = "vendor"

function packageRoot(moduleId: string): string | null {
  const match = /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)/.exec(moduleId)
  return match?.[1] ?? null
}

function collectLicenses(moduleIds: readonly string[]): string {
  const roots = [...new Set(moduleIds.map(packageRoot).filter((root) => root !== null))].sort()
  return roots
    .map((root) => {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
      const licenseFile = fs.readdirSync(root).find((name) => /^licen[cs]e/i.test(name))
      const text = licenseFile
        ? fs.readFileSync(path.join(root, licenseFile), "utf8").trim()
        : `License: ${pkg.license}`
      return `${pkg.name}@${pkg.version}\n\n${text}\n`
    })
    .join("\n---\n\n")
}

// Third-party modules are split into a vendor chunk and minified as a whole,
// leaving Cypheria sources readable in the bundle for debugging. This runs in
// generateBundle because Vite's own renderChunk transforms reprint the code.
function minifyVendorChunk(): Plugin {
  return {
    name: "node-repl-minify-vendor",
    async generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk" || output.name !== vendorChunk) {
          continue
        }
        // The CommonJS chunk publishes through `exports`, so top-level names are private.
        const result = await minify(output.fileName, output.code, {
          compress: true,
          mangle: { toplevel: true },
        })
        if (result.errors.length > 0) {
          this.error(`failed to minify ${output.fileName}: ${result.errors[0]?.message}`)
        }
        output.code = result.code
        // Minification drops license headers, so ship the notices alongside.
        this.emitFile({
          fileName: "THIRD_PARTY_LICENSES.txt",
          source: collectLicenses(output.moduleIds),
          type: "asset",
        })
      }
    },
  }
}

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: false,
    outDir: "internal/assets/files",
    reportCompressedSize: false,
    rolldownOptions: {
      input: {
        kernel: "src/kernel.ts",
      },
      output: {
        chunkFileNames: "[name].js",
        codeSplitting: {
          groups: [{ name: vendorChunk, test: /[\\/]node_modules[\\/]/ }],
        },
        entryFileNames: "[name].js",
        format: "cjs",
      },
    },
    ssr: true,
    target: "node24",
  },
  plugins: [
    minifyVendorChunk(),
    {
      name: "node-repl-package-type",
      generateBundle() {
        // The runtime is extracted outside any package, so pin its module type.
        this.emitFile({
          fileName: "package.json",
          source: '{"type":"commonjs"}',
          type: "asset",
        })
      },
    },
  ],
  ssr: {
    external: builtinModules.flatMap((name) => [name, `node:${name}`]),
    noExternal: true,
    target: "node",
  },
})
