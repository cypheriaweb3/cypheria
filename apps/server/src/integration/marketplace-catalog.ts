import { readdir, readFile, stat } from "node:fs/promises"
import { isAbsolute, join, normalize, relative, sep } from "node:path"

import { z } from "zod"

/** Marketplace files Cypheria reads in a marketplace directory, one per Agent ecosystem. */
export const CATALOG_FILES = {
  claude: ".claude-plugin/marketplace.json",
  codex: ".agents/plugins/marketplace.json",
  copilot: ".github/plugin/marketplace.json",
  cursor: ".cursor-plugin/marketplace.json",
  grok: ".grok-plugin/marketplace.json",
} as const
/** Devin publishes a marketplace as a plugin whose manifest lists the others. */
export const DEVIN_MARKETPLACE_FILE = ".devin-plugin/plugin.json"
export type CatalogFile = keyof typeof CATALOG_FILES | "devin" | "directory"

/** Where a catalog entry's files come from. */
export type CatalogSource =
  | { kind: "local"; path: string }
  | { kind: "git"; path: string | null; ref: string | null; url: string }
  | { kind: "npm"; package: string; version: string | null }

export type CatalogEntry = {
  category: string | null
  description: string | null
  developerName: string | null
  displayName: string
  name: string
  source: CatalogSource | null
  version: string | null
}

export type MarketplaceCatalog = {
  /** Marketplace files present, keyed by ecosystem. */
  files: CatalogFile[]
  name: string | null
  plugins: CatalogEntry[]
}

const EntrySchema = z
  .object({
    author: z.object({ name: z.string() }).passthrough().optional(),
    category: z.string().optional(),
    description: z.string().optional(),
    displayName: z.string().optional(),
    interface: z
      .object({ displayName: z.string().optional(), shortDescription: z.string().optional() })
      .passthrough()
      .optional(),
    name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
    source: z.unknown().optional(),
    version: z.string().optional(),
  })
  .passthrough()

const FileSchema = z
  .object({
    metadata: z.object({ pluginRoot: z.string().optional() }).passthrough().optional(),
    name: z.string().optional(),
    plugins: z.array(z.unknown()).default([]),
  })
  .passthrough()

const readJson = async (path: string): Promise<unknown> => {
  try {
    if ((await stat(path)).size > 8_000_000) return undefined
    return JSON.parse(await readFile(path, "utf8")) as unknown
  } catch {
    return undefined
  }
}

/** A path inside the marketplace, or null for one that escapes it. */
const containedPath = (value: string): string | null => {
  const path = normalize(value.replace(/^\.\//u, ""))
  if (isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`)) return null
  return path === "." ? "" : path
}

const github = (repo: string): string => `https://github.com/${repo.replace(/\.git$/u, "")}.git`

const parseSource = (value: unknown, pluginRoot: string): CatalogSource | null => {
  if (typeof value === "string") {
    const local = containedPath(value.startsWith("./") ? value : join(pluginRoot, value))
    return local === null ? null : { kind: "local", path: local }
  }
  if (!value || typeof value !== "object") return null
  const source = value as Record<string, unknown>
  const text = (key: string): string | null =>
    typeof source[key] === "string" && source[key] ? (source[key] as string) : null
  // Grok writes the kind as `type`, as in `{ "type": "local", "path": "./plugins/name" }`.
  switch (text("source") ?? text("type")) {
    case "local": {
      const path = text("path")
      const local = path === null ? null : containedPath(path)
      return local === null ? null : { kind: "local", path: local }
    }
    case "github": {
      const repo = text("repo")
      return repo
        ? { kind: "git", path: text("path"), ref: text("ref") ?? text("sha"), url: github(repo) }
        : null
    }
    case "url":
    case "git":
    case "git-subdir": {
      const url = text("url")
      return url ? { kind: "git", path: text("path"), ref: text("ref") ?? text("sha"), url } : null
    }
    case "npm": {
      const name = text("package")
      return name ? { kind: "npm", package: name, version: text("version") } : null
    }
    default:
      return null
  }
}

const DevinManifestSchema = z
  .object({
    name: z.string().optional(),
    optionalPlugins: z.array(z.unknown()).optional(),
    requiredPlugins: z.array(z.unknown()).optional(),
  })
  .passthrough()

const PluginManifestSchema = z
  .object({
    description: z.string().optional(),
    displayName: z.string().optional(),
    name: z.string().optional(),
    version: z.string().optional(),
  })
  .passthrough()

/** The entries a Devin marketplace manifest lists in `requiredPlugins` and `optionalPlugins`. */
const readDevinEntries = async (directory: string, values: unknown[]): Promise<CatalogEntry[]> => {
  const entries: CatalogEntry[] = []
  for (const value of values) {
    const raw = typeof value === "string" ? value : (value as { source?: unknown } | null)?.source
    if (typeof raw !== "string") continue
    const path = containedPath(raw)
    if (!path) continue
    const manifest = PluginManifestSchema.safeParse(
      await readJson(join(directory, path, DEVIN_MARKETPLACE_FILE))
    )
    const name = manifest.data?.name ?? path.split(sep).at(-1) ?? path
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)) continue
    entries.push({
      category: null,
      description: manifest.data?.description ?? null,
      developerName: null,
      displayName: manifest.data?.displayName ?? name,
      name,
      source: { kind: "local", path },
      version: manifest.data?.version ?? null,
    })
  }
  return entries
}

/**
 * A marketplace that is only a directory of plugins, such as the Cline Official repository's
 * `plugins/<slug>`: every subdirectory is one plugin named after the directory.
 */
const readDirectoryEntries = async (directory: string, root: string): Promise<CatalogEntry[]> => {
  const children = await readdir(join(directory, root), { withFileTypes: true }).catch(() => [])
  const entries: CatalogEntry[] = []
  for (const child of children) {
    if (!child.isDirectory() || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(child.name)) continue
    const path = join(root, child.name)
    const manifest = PluginManifestSchema.safeParse(
      await readJson(join(directory, path, "package.json"))
    )
    entries.push({
      category: null,
      description: manifest.data?.description ?? null,
      developerName: null,
      displayName: child.name,
      name: child.name,
      source: { kind: "local", path },
      version: null,
    })
  }
  return entries
}

/**
 * Reads the Codex, Claude, Copilot, Cursor, and Grok marketplace files of a marketplace directory, a Devin
 * marketplace manifest, or, when `pluginDirectory` is given, a plain directory of plugins, and
 * merges the entries by plugin name. Sources that would escape the directory are dropped.
 */
export const readMarketplaceCatalog = async (
  directory: string,
  options: { pluginDirectory?: string } = {}
): Promise<MarketplaceCatalog> => {
  const catalog: MarketplaceCatalog = { files: [], name: null, plugins: [] }
  const byName = new Map<string, CatalogEntry>()
  const extra: CatalogEntry[] = []
  const devin = DevinManifestSchema.safeParse(
    await readJson(join(directory, DEVIN_MARKETPLACE_FILE))
  )
  const devinList = [...(devin.data?.requiredPlugins ?? []), ...(devin.data?.optionalPlugins ?? [])]
  if (devin.success && devinList.length) {
    catalog.files.push("devin")
    catalog.name = devin.data.name?.trim() || null
    extra.push(...(await readDevinEntries(directory, devinList)))
  }
  if (options.pluginDirectory) {
    const entries = await readDirectoryEntries(directory, options.pluginDirectory)
    if (entries.length) {
      catalog.files.push("directory")
      extra.push(...entries)
    }
  }
  for (const entry of extra) if (!byName.has(entry.name)) byName.set(entry.name, entry)
  for (const [ecosystem, file] of Object.entries(CATALOG_FILES) as [CatalogFile, string][]) {
    const parsed = FileSchema.safeParse(await readJson(join(directory, file)))
    if (!parsed.success) continue
    catalog.files.push(ecosystem)
    catalog.name ??= parsed.data.name?.trim() || null
    const pluginRoot = parsed.data.metadata?.pluginRoot ?? "."
    for (const raw of parsed.data.plugins) {
      const entry = EntrySchema.safeParse(raw)
      if (!entry.success) continue
      const current = byName.get(entry.data.name)
      const next: CatalogEntry = {
        category: current?.category ?? entry.data.category ?? null,
        description:
          current?.description ??
          entry.data.description ??
          entry.data.interface?.shortDescription ??
          null,
        developerName: current?.developerName ?? entry.data.author?.name ?? null,
        displayName:
          current?.displayName ??
          entry.data.displayName ??
          entry.data.interface?.displayName ??
          entry.data.name,
        name: entry.data.name,
        source: current?.source ?? parseSource(entry.data.source, pluginRoot),
        version: current?.version ?? entry.data.version ?? null,
      }
      byName.set(next.name, next)
    }
  }
  catalog.plugins = [...byName.values()].sort((left, right) => left.name.localeCompare(right.name))
  return catalog
}

/** Whether `path` stays inside `root` after normalization. */
export const isInside = (root: string, path: string): boolean => {
  const offset = relative(root, path)
  return offset === "" || (!offset.startsWith("..") && !isAbsolute(offset))
}
