import { readdir, readFile, realpath, stat } from "node:fs/promises"
import { isAbsolute, join, relative, sep } from "node:path"

import { z } from "zod"

const MarketplaceEntrySchema = z
  .object({
    author: z.object({ name: z.string() }).passthrough().optional(),
    category: z.string().optional(),
    description: z.string().optional(),
    displayName: z.string().optional(),
    homepage: z.string().optional(),
    name: z.string(),
    source: z.unknown().optional(),
    version: z.string().optional(),
  })
  .passthrough()
export type MarketplaceEntry = z.infer<typeof MarketplaceEntrySchema>

const readJson = async (path: string): Promise<unknown> => {
  try {
    if ((await stat(path)).size > 8_000_000) return undefined
    return JSON.parse(await readFile(path, "utf8"))
  } catch {
    return undefined
  }
}

/** Entries of a marketplace's own catalog file, keyed by plugin name. */
export const readMarketplaceEntries = async (
  installLocation: string
): Promise<Map<string, MarketplaceEntry>> => {
  const file = installLocation.endsWith(".json")
    ? installLocation
    : join(installLocation, ".claude-plugin", "marketplace.json")
  const raw = await readJson(file)
  const entries = new Map<string, MarketplaceEntry>()
  const plugins = (raw as { plugins?: unknown } | undefined)?.plugins
  if (!Array.isArray(plugins)) return entries
  for (const item of plugins) {
    const parsed = MarketplaceEntrySchema.safeParse(item)
    if (parsed.success) {
      entries.set(parsed.data.name, parsed.data)
    }
  }
  return entries
}

export type PluginDirectoryInspection = {
  description: string | null
  homepage: string | null
  mcpServers: string[]
  skills: { description: string; name: string; path: string }[]
}

const frontmatter = (text: string): Record<string, string> => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(text)
  const fields: Record<string, string> = {}
  for (const line of (match?.[1] ?? "").split(/\r?\n/u)) {
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/u.exec(line)
    if (pair?.[1]) fields[pair[1]] = (pair[2] ?? "").replace(/^["']|["']$/gu, "").trim()
  }
  return fields
}

const insideRoot = async (root: string, path: string): Promise<boolean> => {
  try {
    const [realRoot, realPath] = await Promise.all([realpath(root), realpath(path)])
    const rel = relative(realRoot, realPath)
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel) && !rel.includes(`..${sep}`))
  } catch {
    return false
  }
}

const mcpServerNames = (value: unknown): string[] => {
  const servers = (value as { mcpServers?: unknown } | undefined)?.mcpServers ?? value
  return servers && typeof servers === "object" && !Array.isArray(servers)
    ? Object.keys(servers as Record<string, unknown>)
    : []
}

/**
 * Lists the components a plugin directory declares. Only files that resolve
 * inside `directory` are read, so a symlink cannot expose other host files.
 */
export const inspectPluginDirectory = async (
  directory: string
): Promise<PluginDirectoryInspection | undefined> => {
  if (
    !(await stat(directory).then(
      (s) => s.isDirectory(),
      () => false
    ))
  )
    return undefined
  const manifest = (await readJson(join(directory, ".claude-plugin", "plugin.json"))) as
    | Record<string, unknown>
    | undefined
  const skills: PluginDirectoryInspection["skills"] = []
  const skillsRoot = join(directory, "skills")
  if (await insideRoot(directory, skillsRoot)) {
    const names = await readdir(skillsRoot).catch(() => [] as string[])
    for (const name of names.slice(0, 200)) {
      const file = join(skillsRoot, name, "SKILL.md")
      if (!(await insideRoot(directory, file))) continue
      const text = await readFile(file, "utf8").catch(() => undefined)
      if (text === undefined) continue
      const fields = frontmatter(text)
      skills.push({ description: fields.description ?? "", name: fields.name ?? name, path: file })
    }
  }
  const mcp = new Set<string>()
  const defaultMcp = join(directory, ".mcp.json")
  if (await insideRoot(directory, defaultMcp)) {
    for (const name of mcpServerNames(await readJson(defaultMcp))) mcp.add(name)
  }
  const declared = manifest?.mcpServers
  if (typeof declared === "string" && declared.startsWith("./")) {
    const file = join(directory, declared)
    if (await insideRoot(directory, file)) {
      for (const name of mcpServerNames(await readJson(file))) mcp.add(name)
    }
  } else {
    for (const name of mcpServerNames(declared)) mcp.add(name)
  }
  const commandsRoot = join(directory, "commands")
  if (await insideRoot(directory, commandsRoot)) {
    const files = await readdir(commandsRoot).catch(() => [] as string[])
    for (const file of files.filter((name) => name.endsWith(".md")).slice(0, 200)) {
      const path = join(commandsRoot, file)
      if (!(await insideRoot(directory, path))) continue
      const text = await readFile(path, "utf8").catch(() => undefined)
      if (text === undefined) continue
      skills.push({
        description: frontmatter(text).description ?? "",
        name: file.slice(0, -".md".length),
        path,
      })
    }
  }
  return {
    description: typeof manifest?.description === "string" ? manifest.description : null,
    homepage: typeof manifest?.homepage === "string" ? manifest.homepage : null,
    mcpServers: [...mcp],
    skills,
  }
}
