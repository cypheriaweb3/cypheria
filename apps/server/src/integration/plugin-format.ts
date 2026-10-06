import { readdir, readFile, stat } from "node:fs/promises"
import { isAbsolute, join, relative, resolve } from "node:path"

import type { AgentId, PluginFormat } from "@cypheria/protocol"
import { z } from "zod"

/** The file whose presence marks each format; see Polyglot Plugins. */
const FORMAT_MARKERS: readonly (readonly [PluginFormat, string])[] = [
  ["agent_plugin", "plugin.json"],
  ["codex", ".codex-plugin/plugin.json"],
  ["claude", ".claude-plugin/plugin.json"],
  ["copilot", ".github/plugin/plugin.json"],
  ["cursor", ".cursor-plugin/plugin.json"],
  ["devin", ".devin-plugin/plugin.json"],
  ["goose", ".goose-plugin/plugin.json"],
  ["gemini", "gemini-extension.json"],
  ["grok", ".grok-plugin/plugin.json"],
]

/**
 * The formats each Agent installs natively, in the order it prefers them. An Agent missing
 * here has no plugin installation Cypheria can drive and supports no plugin.
 */
export const AGENT_NATIVE_FORMATS: Partial<Record<AgentId, readonly PluginFormat[]>> = {
  claude: ["claude", "agent_plugin"],
  cline: ["cline"],
  codex: ["codex", "agent_plugin", "claude", "cursor"],
  devin: ["devin", "claude"],
  gemini: ["gemini"],
  "github-copilot-cli": ["agent_plugin", "copilot", "claude"],
  goose: ["goose", "agent_plugin", "gemini"],
  "grok-build": ["grok", "claude", "agent_plugin"],
  pi: ["pi"],
}

export const nativeFormatFor = (
  agentId: AgentId,
  formats: readonly PluginFormat[]
): PluginFormat | undefined =>
  AGENT_NATIVE_FORMATS[agentId]?.find((format) => formats.includes(format))

const isFile = (path: string): Promise<boolean> =>
  stat(path).then(
    (entry) => entry.isFile(),
    () => false
  )

const isDirectory = (path: string): Promise<boolean> =>
  stat(path).then(
    (entry) => entry.isDirectory(),
    () => false
  )

const readJson = async (path: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown
  } catch {
    return undefined
  }
}

const PackageJsonSchema = z
  .object({
    description: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    name: z.string().optional(),
    cline: z.record(z.string(), z.unknown()).optional(),
    pi: z.record(z.string(), z.unknown()).optional(),
    version: z.string().optional(),
  })
  .passthrough()

/** Formats the package at `directory` carries. Directory names alone never decide a format. */
export const detectPluginFormats = async (directory: string): Promise<PluginFormat[]> => {
  const found: PluginFormat[] = []
  for (const [format, marker] of FORMAT_MARKERS) {
    if (await isFile(join(directory, marker))) found.push(format)
  }
  const pkg = PackageJsonSchema.safeParse(await readJson(join(directory, "package.json")))
  if (pkg.success && pkg.data.pi) found.push("pi")
  if (pkg.success && pkg.data.cline) found.push("cline")
  return found
}

const ManifestSchema = z
  .object({
    description: z.string().optional(),
    displayName: z.string().optional(),
    name: z.string().optional(),
    version: z.string().optional(),
  })
  .passthrough()

export type PluginMetadata = {
  description: string | null
  displayName: string | null
  name: string | null
  version: string | null
}

/** Name, version, and description from the first manifest that has them. */
export const readPluginMetadata = async (directory: string): Promise<PluginMetadata> => {
  const files = [
    "plugin.json",
    ".codex-plugin/plugin.json",
    ".claude-plugin/plugin.json",
    ".cursor-plugin/plugin.json",
    ".devin-plugin/plugin.json",
    ".goose-plugin/plugin.json",
    "gemini-extension.json",
    "package.json",
  ]
  const metadata: PluginMetadata = {
    description: null,
    displayName: null,
    name: null,
    version: null,
  }
  for (const file of files) {
    const parsed = ManifestSchema.safeParse(await readJson(join(directory, file)))
    if (!parsed.success) continue
    metadata.name ??= parsed.data.name?.trim() || null
    metadata.version ??= parsed.data.version?.trim() || null
    metadata.description ??= parsed.data.description?.trim() || null
    metadata.displayName ??= parsed.data.displayName?.trim() || null
  }
  return metadata
}

const McpDocumentSchema = z.object({ mcpServers: z.record(z.string(), z.unknown()) }).passthrough()

/** Manifests that may declare `mcpServers` inline, or as a path to a file inside the plugin. */
const INLINE_MCP_MANIFESTS = [
  ".devin-plugin/plugin.json",
  ".claude-plugin/plugin.json",
  ".cursor-plugin/plugin.json",
  ".goose-plugin/plugin.json",
  "gemini-extension.json",
]

/**
 * Names of the package's MCP servers: `mcp.json` (Agent Plugins), else `.mcp.json`, the file
 * Claude, Cursor, Goose, and Grok plugins use, else `mcpServers` declared in a vendor manifest,
 * inline or as a path inside the plugin.
 */
export const readPluginMcpServerNames = async (directory: string): Promise<string[]> => {
  for (const file of ["mcp.json", ".mcp.json"]) {
    const document = McpDocumentSchema.safeParse(await readJson(join(directory, file)))
    if (document.success) return Object.keys(document.data.mcpServers)
  }
  for (const file of INLINE_MCP_MANIFESTS) {
    const manifest = (await readJson(join(directory, file))) as { mcpServers?: unknown } | undefined
    const declared = manifest?.mcpServers
    if (declared && typeof declared === "object" && !Array.isArray(declared)) {
      return Object.keys(declared)
    }
    if (typeof declared === "string") {
      const path = resolve(directory, declared)
      if (!isInsideDirectory(directory, path)) return []
      const document = McpDocumentSchema.safeParse(await readJson(path))
      if (document.success) return Object.keys(document.data.mcpServers)
    }
  }
  return []
}

const isInsideDirectory = (root: string, path: string): boolean => {
  const offset = relative(root, path)
  return offset === "" || (!offset.startsWith("..") && !isAbsolute(offset))
}

export type PluginSkill = { name: string; path: string }

/** Skills under `skills/*\/SKILL.md`, as absolute directory paths. */
export const readPluginSkills = async (directory: string): Promise<PluginSkill[]> => {
  const root = join(directory, "skills")
  if (!(await isDirectory(root))) return []
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const skills: PluginSkill[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const path = join(root, entry.name)
    if (await isFile(join(path, "SKILL.md"))) skills.push({ name: entry.name, path })
  }
  return skills
}
