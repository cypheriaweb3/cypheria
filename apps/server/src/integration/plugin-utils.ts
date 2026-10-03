import { access, readFile, stat } from "node:fs/promises"
import { extname } from "node:path"
import { fileURLToPath } from "node:url"

export const webUrl = (value: string | null | undefined): string | null => {
  if (!value) return null
  try {
    const url = new URL(value)
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null
  } catch {
    return null
  }
}

export const pluginImage = async (
  url: string | null | undefined,
  path: string | null | undefined
): Promise<string | null> => {
  if (url && /^https?:\/\//iu.test(url)) return url
  if (!path) return null
  const mime = (
    {
      ".jpeg": "image/jpeg",
      ".jpg": "image/jpeg",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".webp": "image/webp",
    } as Record<string, string>
  )[extname(path).toLowerCase()]
  if (!mime) return null
  try {
    if ((await stat(path)).size > 2_000_000) return null
    return `data:${mime};base64,${(await readFile(path)).toString("base64")}`
  } catch {
    return null
  }
}

export const BUNDLED_MARKETPLACE_NAME = "cypheria-bundled"
/** Plugins the bundled marketplace carries; Server keeps each one installed and current. */
export const BUNDLED_PLUGIN_NAMES = ["cypheria-app-tools", "code-review"] as const

/**
 * Locates the bundled marketplace directory in a checkout or in the built
 * Server. `marker` is the ecosystem-specific manifest that proves the
 * directory carries that Agent's marketplace.
 */
export const bundledMarketplaceDirectory = async (marker: string): Promise<string> => {
  const candidates = [
    new URL("../../../../plugins/", import.meta.url),
    new URL("./marketplace/", import.meta.url),
  ]
  for (const candidate of candidates) {
    const available = await access(new URL(marker, candidate)).then(
      () => true,
      () => false
    )
    if (available) return fileURLToPath(candidate)
  }
  throw new Error("Bundled Cypheria plugin marketplace is unavailable")
}
