import { createHash } from "node:crypto"
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises"
import { dirname, join } from "node:path"

import type { PluginNativeInstallReceipt } from "@cypheria/db"
import type { AgentId, PluginCommandConfirmation } from "@cypheria/protocol"
import { parseDocument } from "yaml"
import { z } from "zod"

/** An installed plugin as a package-installing Agent needs it. */
export type PackagePlugin = {
  id: string
  installPath: string
  installSourceType: "agent_cache" | "git" | "local" | "npm" | "remote"
  installSourceUrl: string
  marketplaceId: string
  /** The marketplace directory when it carries marketplace files an Agent can register. */
  marketplacePath: string | null
  name: string
  /** The Git marketplace and the plugin's path in it, for Agents that install from a URL. */
  origin: { path: string; url: string } | null
}

export type PackageInstallResult =
  | { confirmation: PluginCommandConfirmation; installed: false }
  | { installed: true; receipt: PluginNativeInstallReceipt }

/**
 * Drives one Agent's own plugin installation for Agents without a Cypheria-managed catalog.
 * Every command runs in the Agent's managed home; see Agent Plugin Capabilities.
 */
export interface PackagePluginProvider {
  readonly agentId: AgentId
  /** Whether the Agent can install this particular package natively. */
  supports(plugin: PackagePlugin): boolean
  install(
    plugin: PackagePlugin,
    options?: { acceptCommandSha256?: string }
  ): Promise<PackageInstallResult>
  setEnabled(
    plugin: PackagePlugin,
    receipt: PluginNativeInstallReceipt | null,
    enabled: boolean
  ): Promise<void>
  uninstall(plugin: PackagePlugin, receipt: PluginNativeInstallReceipt | null): Promise<void>
  /**
   * Brings the Agent's installation up to date after the plugin's files changed, keeping whether
   * it is enabled, and returns the new receipt. Absent when an update needs the user's review.
   */
  update?(
    plugin: PackagePlugin,
    receipt: PluginNativeInstallReceipt | null,
    enabled: boolean
  ): Promise<PluginNativeInstallReceipt | null>
  /** Whether updating this plugin runs package code and so needs the user's review first. */
  updateNeedsReview?(plugin: PackagePlugin): boolean
  /** True when disabling removes the plugin and enabling installs it again. */
  readonly enableInstalls?: boolean
}

export type AgentCliRunner = (
  args: string[],
  options?: { timeoutMs?: number }
) => Promise<{ exitCode: number; stderr: string; stdout: string }>

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex")

const run = async (runner: AgentCliRunner, label: string, args: string[]): Promise<string> => {
  const result = await runner(args, { timeoutMs: 300_000 })
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim().slice(0, 600)
    throw new Error(
      `${label} ${args.slice(0, 2).join(" ")} failed: ${detail || `exit ${result.exitCode}`}`
    )
  }
  return result.stdout
}

/** A command that runs package code on this computer runs only after the user confirmed its hash. */
const confirmed = (
  plugin: PackagePlugin,
  command: string,
  accepted: string | undefined
): PackageInstallResult | undefined =>
  accepted === sha256(command)
    ? undefined
    : { confirmation: { command, pluginId: plugin.id, sha256: sha256(command) }, installed: false }

/**
 * Pi packages: `pi install` with the plugin directory, used in place, or `npm:<name>` for
 * the Pi package catalog, where npm installs the package and its dependencies.
 */
export class PiPackageProvider implements PackagePluginProvider {
  readonly agentId = "pi" as const
  /** Enabling installs the plugin again, from its current revision. */
  readonly enableInstalls = true
  readonly #run: AgentCliRunner

  constructor(runner: AgentCliRunner) {
    this.#run = runner
  }

  supports(): boolean {
    return true
  }

  #source(plugin: PackagePlugin): string {
    return plugin.installSourceType === "npm" && plugin.marketplaceId === "pi-package-catalog"
      ? `npm:${plugin.installSourceUrl}`
      : plugin.installPath
  }

  async install(
    plugin: PackagePlugin,
    options: { acceptCommandSha256?: string } = {}
  ): Promise<PackageInstallResult> {
    const source = this.#source(plugin)
    const command = `pi install ${source}`
    if (source.startsWith("npm:")) {
      const pending = confirmed(plugin, command, options.acceptCommandSha256)
      if (pending) return pending
    }
    await run(this.#run, "Pi", ["install", source])
    return { installed: true, receipt: { command, nativeId: source } }
  }

  async setEnabled(
    plugin: PackagePlugin,
    receipt: PluginNativeInstallReceipt | null,
    enabled: boolean
  ): Promise<void> {
    // Pi has no command that switches a package off, so the package is removed and re-added.
    const source = receipt?.nativeId ?? this.#source(plugin)
    if (enabled) await run(this.#run, "Pi", ["install", source])
    else await run(this.#run, "Pi", ["remove", source])
  }

  async uninstall(
    plugin: PackagePlugin,
    receipt: PluginNativeInstallReceipt | null
  ): Promise<void> {
    await run(this.#run, "Pi", ["remove", receipt?.nativeId ?? this.#source(plugin)])
  }

  /** A catalog package is installed from npm, which runs the new version's scripts. */
  updateNeedsReview(plugin: PackagePlugin): boolean {
    return this.#source(plugin).startsWith("npm:")
  }

  /**
   * Pi loads a local package from its directory, so an update installs the new revision's
   * directory in place of the old one. A disabled package is not installed, and its next enable
   * installs the new revision.
   */
  async update(
    plugin: PackagePlugin,
    receipt: PluginNativeInstallReceipt | null,
    enabled: boolean
  ): Promise<PluginNativeInstallReceipt | null> {
    const source = this.#source(plugin)
    if (!enabled || receipt?.nativeId === source) return receipt
    if (receipt?.nativeId) await run(this.#run, "Pi", ["remove", receipt.nativeId])
    await run(this.#run, "Pi", ["install", source])
    return { command: `pi install ${source}`, nativeId: source }
  }
}

const InstallMetadataSchema = z
  .object({ format: z.string().optional(), source: z.string(), source_type: z.string() })
  .passthrough()

export type GoosePluginEntry = {
  directory: string
  enabled: boolean
  /** Installed by `goose plugin install`, as opposed to a Cypheria link. */
  goose: boolean
  linkedTo: string | null
  name: string
  source: string | null
}

/**
 * Goose 1.52 installs and updates plugins but cannot list, switch, or remove them. Cypheria
 * implements those on Goose's own layout: one directory per plugin in `.agents/plugins/`, and
 * the `plugins` map in `config/config.yaml`, keyed by directory path with `{ enabled }`.
 */
export class GoosePackageProvider implements PackagePluginProvider {
  readonly agentId = "goose" as const
  readonly #home: string
  readonly #run: AgentCliRunner

  constructor(options: { home: string; run: AgentCliRunner }) {
    this.#home = options.home
    this.#run = options.run
  }

  get pluginsDirectory(): string {
    return join(this.#home, ".agents", "plugins")
  }

  get configFile(): string {
    return join(this.#home, "config", "config.yaml")
  }

  supports(): boolean {
    return true
  }

  async install(plugin: PackagePlugin): Promise<PackageInstallResult> {
    const directory = join(this.pluginsDirectory, plugin.name)
    const existing = await lstat(directory).catch(() => undefined)
    if (existing && !existing.isSymbolicLink()) {
      throw new Error(`Goose already has a plugin named ${plugin.name}`)
    }
    await mkdir(this.pluginsDirectory, { recursive: true })
    await rm(directory, { force: true })
    await symlink(plugin.installPath, directory, "dir")
    await this.#setConfig(directory, true)
    return { installed: true, receipt: { command: "link", nativeId: directory } }
  }

  async setEnabled(
    plugin: PackagePlugin,
    receipt: PluginNativeInstallReceipt | null,
    enabled: boolean
  ): Promise<void> {
    await this.#setConfig(receipt?.nativeId ?? join(this.pluginsDirectory, plugin.name), enabled)
  }

  async uninstall(
    plugin: PackagePlugin,
    receipt: PluginNativeInstallReceipt | null
  ): Promise<void> {
    await this.remove(receipt?.nativeId ?? join(this.pluginsDirectory, plugin.name))
  }

  /** Installs a Git plugin with Goose itself. */
  async installGit(url: string): Promise<void> {
    if (url.startsWith("-")) throw new Error("Invalid repository URL")
    await run(this.#run, "Goose", ["plugin", "install", url])
  }

  /** Removes a plugin directory, or only Cypheria's link, and its `plugins` entry. */
  async remove(directory: string): Promise<void> {
    if (dirname(directory) !== this.pluginsDirectory)
      throw new Error("Not a Goose plugin directory")
    const entry = await lstat(directory).catch(() => undefined)
    if (entry?.isSymbolicLink()) await rm(directory, { force: true })
    else if (entry?.isDirectory()) await rm(directory, { force: true, recursive: true })
    await this.#updateConfig((plugins) => {
      delete plugins[directory]
    })
  }

  /** Every user plugin with its enablement, read the way Goose reads them. */
  async list(): Promise<GoosePluginEntry[]> {
    const plugins = await this.#readPlugins()
    const disabledByName = await this.#settingsDisabled()
    const entries = await readdir(this.pluginsDirectory, { withFileTypes: true }).catch(() => [])
    const result: GoosePluginEntry[] = []
    for (const entry of entries) {
      const directory = join(this.pluginsDirectory, entry.name)
      const info = await stat(directory).catch(() => undefined)
      if (!info?.isDirectory()) continue
      const metadata = InstallMetadataSchema.safeParse(
        await readFile(join(directory, ".goose-plugin-install.json"), "utf8")
          .then((text) => JSON.parse(text) as unknown)
          .catch(() => undefined)
      )
      const link = entry.isSymbolicLink() ? await readlink(directory) : null
      result.push({
        directory,
        enabled: (plugins[directory]?.enabled ?? true) && !disabledByName.has(entry.name),
        goose: metadata.success,
        linkedTo: link,
        name: entry.name,
        source: metadata.success ? metadata.data.source : null,
      })
    }
    return result.sort((left, right) => left.name.localeCompare(right.name))
  }

  async #settingsDisabled(): Promise<Set<string>> {
    const raw = await readFile(join(this.#home, ".config", "goose", "settings.json"), "utf8")
      .then((text) => JSON.parse(text) as { disabledPlugins?: unknown })
      .catch(() => ({ disabledPlugins: [] }))
    return new Set(
      Array.isArray(raw.disabledPlugins)
        ? raw.disabledPlugins.filter((name): name is string => typeof name === "string")
        : []
    )
  }

  async #readPlugins(): Promise<Record<string, { enabled?: boolean }>> {
    const text = await readFile(this.configFile, "utf8").catch(() => "")
    const value = parseDocument(text).get("plugins")
    const json =
      value && typeof value === "object" && "toJSON" in value
        ? (value as { toJSON(): unknown }).toJSON()
        : value
    return json && typeof json === "object" ? (json as Record<string, { enabled?: boolean }>) : {}
  }

  async #setConfig(directory: string, enabled: boolean): Promise<void> {
    await this.#updateConfig((plugins) => {
      plugins[directory] = { enabled }
    })
  }

  async #updateConfig(
    change: (plugins: Record<string, { enabled?: boolean }>) => void
  ): Promise<void> {
    const text = await readFile(this.configFile, "utf8").catch(() => "")
    const document = parseDocument(text)
    const plugins = await this.#readPlugins()
    change(plugins)
    document.set("plugins", plugins)
    await mkdir(dirname(this.configFile), { recursive: true })
    const staging = `${this.configFile}.${process.pid}.tmp`
    await writeFile(staging, document.toString())
    await rename(staging, this.configFile)
  }

  /** Points the plugin's link at the new revision; its enablement is keyed by the link. */
  async update(
    plugin: PackagePlugin,
    receipt: PluginNativeInstallReceipt | null
  ): Promise<PluginNativeInstallReceipt | null> {
    const directory = receipt?.nativeId ?? join(this.pluginsDirectory, plugin.name)
    if (dirname(directory) !== this.pluginsDirectory) {
      throw new Error("Not a Goose plugin directory")
    }
    const entry = await lstat(directory).catch(() => undefined)
    if (entry && !entry.isSymbolicLink()) throw new Error(`${directory} is not Cypheria's link`)
    await rm(directory, { force: true })
    await symlink(plugin.installPath, directory, "dir")
    return receipt
  }
}

const GeminiManifestSchema = z.object({ name: z.string().min(1) }).passthrough()

/** Gemini CLI links an extension directory, so the extension is used in place. */
export class GeminiPackageProvider implements PackagePluginProvider {
  readonly agentId = "gemini" as const
  readonly #run: AgentCliRunner

  constructor(runner: AgentCliRunner) {
    this.#run = runner
  }

  supports(): boolean {
    return true
  }

  async #name(plugin: PackagePlugin): Promise<string> {
    const raw = await readFile(join(plugin.installPath, "gemini-extension.json"), "utf8")
      .then((text) => JSON.parse(text) as unknown)
      .catch(() => undefined)
    return GeminiManifestSchema.safeParse(raw).data?.name ?? plugin.name
  }

  async install(plugin: PackagePlugin): Promise<PackageInstallResult> {
    const name = await this.#name(plugin)
    await run(this.#run, "Gemini CLI", ["extensions", "link", plugin.installPath, "--consent"])
    return {
      installed: true,
      receipt: { command: `gemini extensions link ${plugin.installPath}`, nativeId: name },
    }
  }

  async setEnabled(
    plugin: PackagePlugin,
    receipt: PluginNativeInstallReceipt | null,
    enabled: boolean
  ): Promise<void> {
    const name = receipt?.nativeId ?? (await this.#name(plugin))
    await run(this.#run, "Gemini CLI", ["extensions", enabled ? "enable" : "disable", name])
  }

  async uninstall(
    plugin: PackagePlugin,
    receipt: PluginNativeInstallReceipt | null
  ): Promise<void> {
    await run(this.#run, "Gemini CLI", [
      "extensions",
      "uninstall",
      receipt?.nativeId ?? (await this.#name(plugin)),
    ])
  }

  /** Links the new revision's directory in place of the old one, keeping its enablement. */
  async update(
    plugin: PackagePlugin,
    receipt: PluginNativeInstallReceipt | null,
    enabled: boolean
  ): Promise<PluginNativeInstallReceipt | null> {
    await this.uninstall(plugin, receipt)
    const result = await this.install(plugin)
    if (!result.installed) return receipt
    if (!enabled) await this.setEnabled(plugin, result.receipt, false)
    return result.receipt
  }
}

/** Marketplaces Copilot CLI ships, which it installs from without registering them. */
export const COPILOT_BUILTIN_MARKETPLACES: ReadonlySet<string> = new Set([
  "copilot-plugins",
  "awesome-copilot",
])

/**
 * Copilot CLI installs `plugin@marketplace` from a registered marketplace, so it supports
 * plugins whose marketplace directory carries a marketplace file it reads, and those of the
 * marketplaces it ships. Copilot deprecates installing a plugin directly from a path, URL, or
 * repository, so Cypheria does not use it.
 */
export class CopilotPackageProvider implements PackagePluginProvider {
  readonly agentId = "github-copilot-cli" as const
  readonly #run: AgentCliRunner
  readonly #registered = new Set<string>()

  constructor(runner: AgentCliRunner) {
    this.#run = runner
  }

  supports(plugin: PackagePlugin): boolean {
    return plugin.marketplacePath !== null || COPILOT_BUILTIN_MARKETPLACES.has(plugin.marketplaceId)
  }

  async install(plugin: PackagePlugin): Promise<PackageInstallResult> {
    if (!COPILOT_BUILTIN_MARKETPLACES.has(plugin.marketplaceId)) {
      if (!plugin.marketplacePath) {
        throw new Error("Copilot CLI installs plugins from a marketplace")
      }
      if (!this.#registered.has(plugin.marketplacePath)) {
        const result = await this.#run(["plugin", "marketplace", "add", plugin.marketplacePath])
        if (result.exitCode !== 0 && !/already/iu.test(`${result.stderr}${result.stdout}`)) {
          throw new Error(`Copilot CLI could not add the marketplace: ${result.stderr.trim()}`)
        }
        this.#registered.add(plugin.marketplacePath)
      }
    }
    const id = `${plugin.name}@${plugin.marketplaceId}`
    await run(this.#run, "Copilot CLI", ["plugin", "install", id])
    return { installed: true, receipt: { command: `copilot plugin install ${id}`, nativeId: id } }
  }

  async setEnabled(
    plugin: PackagePlugin,
    receipt: PluginNativeInstallReceipt | null,
    enabled: boolean
  ): Promise<void> {
    const id = receipt?.nativeId ?? `${plugin.name}@${plugin.marketplaceId}`
    await run(this.#run, "Copilot CLI", ["plugin", enabled ? "enable" : "disable", id])
  }

  async uninstall(
    plugin: PackagePlugin,
    receipt: PluginNativeInstallReceipt | null
  ): Promise<void> {
    const id = receipt?.nativeId ?? `${plugin.name}@${plugin.marketplaceId}`
    await run(this.#run, "Copilot CLI", ["plugin", "uninstall", id])
  }

  /**
   * A plugin inside a local marketplace directory loads from that directory, but one the catalog
   * fetches from elsewhere, and every plugin of Copilot's own marketplaces, is a copy, so the
   * plugin is updated with `copilot plugin update`, which does nothing when it is current.
   */
  async update(
    plugin: PackagePlugin,
    receipt: PluginNativeInstallReceipt | null
  ): Promise<PluginNativeInstallReceipt | null> {
    const id = receipt?.nativeId ?? `${plugin.name}@${plugin.marketplaceId}`
    await run(this.#run, "Copilot CLI", ["plugin", "update", id])
    return receipt
  }
}

const ClineInstallSchema = z.object({ installPath: z.string().min(1) }).passthrough()

/**
 * Cline installs a plugin by copying it into its plugin store and running `npm install` for its
 * dependencies, so every install is a command that runs package code and needs confirmation.
 * Cline Official plugins install by slug, the way `cline plugin install <slug>` does.
 */
export class ClinePackageProvider implements PackagePluginProvider {
  readonly agentId = "cline" as const
  /** Enabling installs the plugin again, from its current revision. */
  readonly enableInstalls = true
  readonly #run: AgentCliRunner

  constructor(runner: AgentCliRunner) {
    this.#run = runner
  }

  supports(): boolean {
    return true
  }

  #source(plugin: PackagePlugin): string {
    return plugin.marketplaceId === "cline-official" ? plugin.name : plugin.installPath
  }

  async install(
    plugin: PackagePlugin,
    options: { acceptCommandSha256?: string } = {}
  ): Promise<PackageInstallResult> {
    const source = this.#source(plugin)
    const command = `cline plugin install ${source}`
    const pending = confirmed(plugin, command, options.acceptCommandSha256)
    if (pending) return pending
    const output = await run(this.#run, "Cline", ["plugin", "install", source, "--force", "--json"])
    const parsed = ClineInstallSchema.safeParse(JSON.parse(output.trim() || "{}") as unknown)
    if (!parsed.success) throw new Error("Cline did not report where it installed the plugin")
    return { installed: true, receipt: { command, nativeId: parsed.data.installPath } }
  }

  async setEnabled(
    plugin: PackagePlugin,
    receipt: PluginNativeInstallReceipt | null,
    enabled: boolean
  ): Promise<void> {
    // Cline cannot switch an installed plugin off from its CLI, so it is removed and reinstalled.
    if (!enabled) {
      await this.uninstall(plugin, receipt)
      return
    }
    await run(this.#run, "Cline", ["plugin", "install", this.#source(plugin), "--force", "--json"])
  }

  async uninstall(
    plugin: PackagePlugin,
    receipt: PluginNativeInstallReceipt | null
  ): Promise<void> {
    await run(this.#run, "Cline", [
      "plugin",
      "uninstall",
      receipt?.nativeId ?? plugin.name,
      "--json",
    ])
  }
}

/**
 * Devin installs a plugin on this machine only: a plugin of a Git marketplace by its URL and
 * path (`<url>#<path>`), so Devin can update it, and any other plugin by its local path. It has
 * no command that switches a plugin off, so disabling removes it and enabling installs it again.
 */
export class DevinPackageProvider implements PackagePluginProvider {
  readonly agentId = "devin" as const
  /** Enabling installs the plugin again, from its current revision. */
  readonly enableInstalls = true
  readonly #run: AgentCliRunner

  constructor(runner: AgentCliRunner) {
    this.#run = runner
  }

  supports(): boolean {
    return true
  }

  async install(plugin: PackagePlugin): Promise<PackageInstallResult> {
    const source = plugin.origin
      ? `${plugin.origin.url.replace(/\.git$/u, "")}#${plugin.origin.path}`
      : plugin.installPath
    // Cypheria's own confirmation replaces Devin's trust prompt, so `--yes` is passed.
    await run(this.#run, "Devin", ["plugins", "install", source, "--yes", "--local"])
    return {
      installed: true,
      receipt: { command: `devin plugins install ${source}`, nativeId: plugin.name },
    }
  }

  async setEnabled(
    plugin: PackagePlugin,
    receipt: PluginNativeInstallReceipt | null,
    enabled: boolean
  ): Promise<void> {
    if (enabled) await this.install(plugin)
    else await this.uninstall(plugin, receipt)
  }

  async uninstall(
    plugin: PackagePlugin,
    receipt: PluginNativeInstallReceipt | null
  ): Promise<void> {
    await run(this.#run, "Devin", [
      "plugins",
      "remove",
      receipt?.nativeId ?? plugin.name,
      "--local",
      "--yes",
    ])
  }

  /** A disabled plugin is not installed, so the next enable installs the new files. */
  async update(
    plugin: PackagePlugin,
    receipt: PluginNativeInstallReceipt | null,
    enabled: boolean
  ): Promise<PluginNativeInstallReceipt | null> {
    if (!enabled) return receipt
    await this.uninstall(plugin, receipt)
    const result = await this.install(plugin)
    return result.installed ? result.receipt : receipt
  }
}

const GrokListSchema = z.array(
  z.object({ name: z.string(), path: z.string(), source: z.string().nullable() }).passthrough()
)

/**
 * Grok Build copies a plugin into its managed home with `grok plugin install <path> --trust`,
 * which also enables it, and names it after its manifest. Cypheria records that name from
 * `grok plugin list --json` and switches and removes the plugin by it.
 */
export class GrokPackageProvider implements PackagePluginProvider {
  readonly agentId = "grok-build" as const
  readonly #run: AgentCliRunner

  constructor(runner: AgentCliRunner) {
    this.#run = runner
  }

  supports(): boolean {
    return true
  }

  async install(plugin: PackagePlugin): Promise<PackageInstallResult> {
    await run(this.#run, "Grok Build", ["plugin", "install", plugin.installPath, "--trust"])
    const listed = GrokListSchema.safeParse(
      JSON.parse(await run(this.#run, "Grok Build", ["plugin", "list", "--json"]))
    )
    const name =
      (listed.success ? listed.data : []).find((entry) => entry.source === plugin.installPath)
        ?.name ?? plugin.name
    return {
      installed: true,
      receipt: { command: `grok plugin install ${plugin.installPath} --trust`, nativeId: name },
    }
  }

  async setEnabled(
    plugin: PackagePlugin,
    receipt: PluginNativeInstallReceipt | null,
    enabled: boolean
  ): Promise<void> {
    const name = receipt?.nativeId ?? plugin.name
    await run(this.#run, "Grok Build", ["plugin", enabled ? "enable" : "disable", name])
  }

  async uninstall(
    plugin: PackagePlugin,
    receipt: PluginNativeInstallReceipt | null
  ): Promise<void> {
    const name = receipt?.nativeId ?? plugin.name
    await run(this.#run, "Grok Build", ["plugin", "uninstall", name, "--confirm"])
  }

  /**
   * Grok copies a local plugin but reports it as a live link, so `grok plugin update` does not
   * copy it again. Server reinstalls it instead, keeping its data and whether it is enabled.
   */
  async update(
    plugin: PackagePlugin,
    receipt: PluginNativeInstallReceipt | null,
    enabled: boolean
  ): Promise<PluginNativeInstallReceipt | null> {
    const name = receipt?.nativeId ?? plugin.name
    await run(this.#run, "Grok Build", ["plugin", "uninstall", name, "--keep-data", "--confirm"])
    const result = await this.install(plugin)
    if (!result.installed) return receipt
    if (!enabled) await this.setEnabled(plugin, result.receipt, false)
    return result.receipt
  }
}
