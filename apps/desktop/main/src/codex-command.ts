import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const require = createRequire(import.meta.url)

const targetByPlatformArch = {
  "darwin-arm64": ["@openai/codex-darwin-arm64", "aarch64-apple-darwin"],
  "darwin-x64": ["@openai/codex-darwin-x64", "x86_64-apple-darwin"],
  "linux-arm64": ["@openai/codex-linux-arm64", "aarch64-unknown-linux-musl"],
  "linux-x64": ["@openai/codex-linux-x64", "x86_64-unknown-linux-musl"],
  "win32-arm64": ["@openai/codex-win32-arm64", "aarch64-pc-windows-msvc"],
  "win32-x64": ["@openai/codex-win32-x64", "x86_64-pc-windows-msvc"],
} as const

export type ResolveCodexCommandOptions = {
  readonly arch?: NodeJS.Architecture
  readonly isPackaged: boolean
  readonly override?: string
  readonly platform?: NodeJS.Platform
  readonly resourcesPath?: string
}

export const resolveCodexCommand = (options: ResolveCodexCommandOptions): string => {
  if (options.override) {
    return options.override
  }

  if (options.isPackaged) {
    if (!options.resourcesPath) {
      throw new Error("Electron resources path is required for packaged Codex")
    }
    return join(
      options.resourcesPath,
      "codex",
      (options.platform ?? process.platform) === "win32" ? "codex.exe" : "codex"
    )
  }

  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const target = targetByPlatformArch[`${platform}-${arch}` as keyof typeof targetByPlatformArch]
  if (!target) {
    throw new Error(`Unsupported Codex platform: ${platform}-${arch}`)
  }

  const codexEntrypoint = require.resolve("@openai/codex/bin/codex.js")
  const codexRequire = createRequire(codexEntrypoint)
  const platformPackageJson = codexRequire.resolve(`${target[0]}/package.json`)
  return join(
    dirname(platformPackageJson),
    "vendor",
    target[1],
    "bin",
    platform === "win32" ? "codex.exe" : "codex"
  )
}
