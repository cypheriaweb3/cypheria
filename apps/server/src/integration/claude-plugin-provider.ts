import { access, readFile, realpath } from "node:fs/promises"
import { dirname, isAbsolute, join, relative } from "node:path"

import type {
  MarketplaceSourceKind,
  MarketplaceView,
  PluginCapabilities,
  PluginConfigOption,
  PluginDetailView,
  PluginScope,
  PluginView,
} from "@cypheria/protocol"

import {
  ClaudeCli,
  ClaudeCliError,
  type ClaudeCliRunner,
  type ClaudeInstalledPlugin,
  type ClaudeMarketplace,
  type ClaudePluginSource,
  parseTokenCost,
} from "./claude-cli.js"
import {
  inspectPluginDirectory,
  type MarketplaceEntry,
  readMarketplaceEntries,
} from "./claude-plugin-files.js"
import type {
  MarketplaceRemoveValue,
  MarketplaceState,
  PluginConfigValue,
  PluginConfigWriteValue,
  PluginInstallValue,
  PluginListValue,
  PluginLocator,
  PluginProvider,
} from "./plugin-provider.js"
import {
  BUNDLED_MARKETPLACE_NAME,
  BUNDLED_PLUGIN_NAME,
  bundledMarketplaceDirectory,
} from "./plugin-utils.js"

const OFFICIAL_MARKETPLACE_SOURCE = "anthropics/claude-plugins-official"
const OFFICIAL_MARKETPLACE_NAME = "claude-plugins-official"
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9._-]*$/u
const SESSION_ORIGINS: Record<string, string> = {
  inline: "Session plugins",
  "skills-dir": "Skills directory",
  synced: "Synced from claude.ai",
}

const CLAUDE_CAPABILITIES: PluginCapabilities = {
  addMarketplace: true,
  configure: true,
  install: true,
  readDetail: true,
  removeMarketplace: true,
  scopes: ["user", "project", "local"],
  setEnabled: true,
  uninstall: true,
  upgradeMarketplace: true,
}

const assertName = (value: string, label: string): void => {
  if (!NAME.test(value)) throw new ClaudeCliError(`Invalid ${label}`, "INTEGRATION_INVALID")
}
const assertId = (value: string): void => {
  if (!ID.test(value)) throw new ClaudeCliError("Invalid plugin id", "INTEGRATION_INVALID")
}
const splitId = (id: string): { marketplace: string; name: string } => {
  const at = id.lastIndexOf("@")
  return { marketplace: id.slice(at + 1), name: id.slice(0, at) }
}

const scopeOf = (value: string): PluginScope | undefined =>
  value === "user" || value === "project" || value === "local" ? value : undefined

const sourceType = (source: ClaudePluginSource): PluginView["sourceType"] => {
  if (typeof source === "string") return "local"
  switch (source.source) {
    case "npm":
      return "npm"
    case "archive":
      return "archive"
    case "command":
      return "command"
    default:
      return "git"
  }
}

const marketplaceRoot = (installLocation: string): string =>
  installLocation.endsWith(".json") ? dirname(dirname(installLocation)) : installLocation

const DISABLED_CAPABILITIES: PluginCapabilities = {
  addMarketplace: false,
  configure: false,
  install: false,
  readDetail: false,
  removeMarketplace: false,
  scopes: [],
  setEnabled: false,
  uninstall: false,
  upgradeMarketplace: false,
}

const disabledError = (): Error => {
  const error = new Error("Plugins are turned off for Claude. Turn them on in Claude's settings.")
  error.name = "INTEGRATION_DISABLED"
  return error
}

export type ClaudePluginProviderOptions = {
  /** Whether plugins are turned on for Claude (`agents.claude.pluginsEnabled`). */
  enabled?: () => boolean
  runner: ClaudeCliRunner
  /** Applies a plugin change to running sessions. */
  reload: () => Promise<{ applied: number; held: number }>
}

export class ClaudePluginProvider implements PluginProvider {
  readonly agentId = "claude" as const
  readonly #enabled: () => boolean
  readonly #cli: ClaudeCli
  readonly #reload: ClaudePluginProviderOptions["reload"]
  #bundledDirectory: Promise<string | undefined> | undefined
  #bundledReady: Promise<void> | undefined
  #officialReady: Promise<void> | undefined
  #bundledRegistered: Promise<void> | undefined
  #tail: Promise<unknown> = Promise.resolve()

  get capabilities(): PluginCapabilities {
    return this.enabled ? CLAUDE_CAPABILITIES : DISABLED_CAPABILITIES
  }

  get enabled(): boolean {
    return this.#enabled()
  }

  constructor(options: ClaudePluginProviderOptions) {
    this.#enabled = options.enabled ?? (() => true)
    this.#cli = new ClaudeCli(options.runner)
    this.#reload = options.reload
  }

  #exclusive<T>(action: () => Promise<T>): Promise<T> {
    const run = this.#tail.then(action, action)
    this.#tail = run.catch(() => undefined)
    return run
  }

  async #reloadSessions(): Promise<boolean> {
    const result = await this.#reload().catch(() => ({ applied: 0, held: 0 }))
    return result.held > 0
  }

  #ensureOfficial(): Promise<void> {
    this.#officialReady ??= this.#exclusive(async () => {
      const marketplaces = await this.#cli.listMarketplaces()
      if (marketplaces.some((entry) => entry.name === OFFICIAL_MARKETPLACE_NAME)) return
      await this.#cli.marketplace(["add", OFFICIAL_MARKETPLACE_SOURCE, "--scope", "user"])
    }).catch((error: unknown) => {
      this.#officialReady = undefined
      throw error
    })
    return this.#officialReady
  }

  async #bundledSource(): Promise<string | undefined> {
    this.#bundledDirectory ??= bundledMarketplaceDirectory(".claude-plugin/marketplace.json").then(
      (directory) => directory.replace(/[\\/]+$/u, ""),
      () => undefined
    )
    return this.#bundledDirectory
  }

  async #kindOf(marketplace: ClaudeMarketplace): Promise<MarketplaceSourceKind> {
    if (marketplace.name === BUNDLED_MARKETPLACE_NAME) {
      const bundled = await this.#bundledSource()
      const path = marketplace.path ?? marketplace.installLocation
      return bundled && path && path.replace(/[\\/]+$/u, "") === bundled ? "cypheria" : "custom"
    }
    const url = marketplace.url ?? ""
    const official =
      (marketplace.source === "github" && marketplace.repo?.startsWith("anthropics/")) ||
      (marketplace.source === "git" && /github\.com[/:]anthropics\//u.test(url))
    return official ? "claude" : "custom"
  }

  async list(input: { cwd?: string; forceRefresh?: boolean }): Promise<PluginListValue> {
    if (!this.enabled) {
      return {
        capabilities: this.capabilities,
        errors: [{ message: disabledError().message, path: "settings:claude" }],
        marketplaces: [],
      }
    }
    const errors: PluginListValue["errors"] = []
    try {
      await this.#ensureOfficial()
    } catch (error) {
      errors.push({ message: messageOf(error), path: "catalog:official-marketplace" })
    }
    try {
      await this.#ensureBundledRegistered()
    } catch (error) {
      errors.push({ message: messageOf(error), path: "catalog:bundled-marketplace" })
    }
    try {
      if (input.forceRefresh) await this.#cli.marketplace(["update"]).catch(() => undefined)
      const [{ available, installed }, marketplaces] = await Promise.all([
        this.#cli.listAvailable(),
        this.#cli.listMarketplaces(),
      ])
      for (const plugin of installed) {
        for (const message of plugin.errors ?? []) errors.push({ message, path: plugin.id })
      }
      const views = await this.#marketplaceViews(marketplaces, installed, available)
      if (
        views.some(
          (view) =>
            view.sourceKind === "cypheria" &&
            view.plugins.some((plugin) => plugin.name === BUNDLED_PLUGIN_NAME && plugin.installed)
        )
      ) {
        void this.#ensureBundled().catch(() => undefined)
      }
      return { capabilities: this.capabilities, errors, marketplaces: views }
    } catch (error) {
      errors.push({ message: messageOf(error), path: "catalog:claude-cli" })
      return { capabilities: this.capabilities, errors, marketplaces: [] }
    }
  }

  async marketplaceState(name: string): Promise<MarketplaceState> {
    if (!this.enabled) throw disabledError()
    assertName(name, "marketplace name")
    const marketplace = (await this.#cli.listMarketplaces()).find((entry) => entry.name === name)
    const location = marketplace?.installLocation ?? marketplace?.path
    if (!marketplace || !location) return "missing"
    const file = location.endsWith(".json")
      ? location
      : join(location, ".claude-plugin", "marketplace.json")
    return (await access(file).then(
      () => true,
      () => false
    ))
      ? "ok"
      : "unsupported"
  }

  async #marketplaceViews(
    marketplaces: ClaudeMarketplace[],
    installed: ClaudeInstalledPlugin[],
    available: Awaited<ReturnType<ClaudeCli["listAvailable"]>>["available"]
  ): Promise<MarketplaceView[]> {
    const installedById = new Map<string, ClaudeInstalledPlugin[]>()
    for (const plugin of installed) {
      installedById.set(plugin.id, [...(installedById.get(plugin.id) ?? []), plugin])
    }
    const views: MarketplaceView[] = []
    const seen = new Set<string>()
    for (const marketplace of marketplaces) {
      seen.add(marketplace.name)
      const entries = marketplace.installLocation
        ? await readMarketplaceEntries(marketplace.installLocation)
        : new Map<string, MarketplaceEntry>()
      const plugins: PluginView[] = []
      const add = async (
        name: string,
        source: ClaudePluginSource | undefined,
        description: string | undefined,
        version: string | undefined,
        installs: ClaudeInstalledPlugin[]
      ) => {
        const entry = entries.get(name)
        plugins.push(
          this.#pluginView({
            description: description ?? entry?.description,
            entry,
            installs,
            marketplace: marketplace.name,
            name,
            source,
            version,
          })
        )
      }
      for (const [id, installs] of installedById) {
        const parts = splitId(id)
        if (parts.marketplace !== marketplace.name) continue
        const entry = entries.get(parts.name)
        await add(
          parts.name,
          entry?.source as ClaudePluginSource | undefined,
          entry?.description,
          installs[0]?.version,
          installs
        )
      }
      for (const plugin of available) {
        if (plugin.marketplaceName !== marketplace.name || installedById.has(plugin.pluginId)) {
          continue
        }
        await add(plugin.name, plugin.source, plugin.description, plugin.version, [])
      }
      views.push({
        displayName: marketplace.name,
        name: marketplace.name,
        path: marketplace.path ?? marketplace.installLocation ?? null,
        plugins,
        sourceKind: await this.#kindOf(marketplace),
      })
    }
    for (const [origin, label] of Object.entries(SESSION_ORIGINS)) {
      const plugins = [...installedById.entries()]
        .filter(([id]) => splitId(id).marketplace === origin)
        .map(([id, installs]) =>
          this.#pluginView({
            description: undefined,
            entry: undefined,
            installs,
            marketplace: origin,
            name: splitId(id).name,
            source: undefined,
            version: installs[0]?.version,
          })
        )
      if (plugins.length && !seen.has(origin)) {
        views.push({ displayName: label, name: origin, path: null, plugins, sourceKind: "custom" })
      }
    }
    return views
  }

  #pluginView(input: {
    description: string | undefined
    entry: MarketplaceEntry | undefined
    installs: ClaudeInstalledPlugin[]
    marketplace: string
    name: string
    source: ClaudePluginSource | undefined
    version: string | undefined
  }): PluginView {
    const id = `${input.name}@${input.marketplace}`
    const installedScopes = input.installs
      .map((plugin) => scopeOf(plugin.scope))
      .filter((scope): scope is PluginScope => scope !== undefined)
    return {
      availability: "AVAILABLE",
      brandColor: null,
      capabilities: [],
      category: input.entry?.category ?? null,
      compatibility: ["claude"],
      description: input.description ?? null,
      developerName: input.entry?.author?.name ?? null,
      displayName: input.entry?.displayName ?? input.name,
      ecosystem: "claude",
      enabled: input.installs.some((plugin) => plugin.enabled),
      featured: false,
      harness: { agentId: "claude", nativeId: id },
      id,
      installed: input.installs.length > 0,
      installedScopes,
      installPolicy: input.marketplace in SESSION_ORIGINS ? "NOT_AVAILABLE" : "AVAILABLE",
      logoUrl: null,
      marketplaceName: input.marketplace,
      marketplacePath: null,
      name: input.name,
      sourceType: input.source ? sourceType(input.source) : "local",
      version: input.version ?? null,
    }
  }

  async read(locator: PluginLocator): Promise<PluginDetailView> {
    if (!this.enabled) throw disabledError()
    assertName(locator.pluginName, "plugin name")
    assertName(locator.marketplaceName, "marketplace name")
    const id = `${locator.pluginName}@${locator.marketplaceName}`
    const [installed, marketplaces] = await Promise.all([
      this.#cli.listInstalled(),
      this.#cli.listMarketplaces(),
    ])
    const install = installed.find((plugin) => plugin.id === id)
    const marketplace = marketplaces.find((entry) => entry.name === locator.marketplaceName)
    const entry = marketplace?.installLocation
      ? (await readMarketplaceEntries(marketplace.installLocation)).get(locator.pluginName)
      : undefined
    let directory = install?.installPath
    if (!directory && marketplace?.installLocation && typeof entry?.source === "string") {
      const root = marketplaceRoot(marketplace.installLocation)
      const candidate = join(root, entry.source)
      if (await stayInside(root, candidate)) directory = candidate
    }
    const inspection = directory ? await inspectPluginDirectory(directory) : undefined
    const tokenText = install ? await this.#cli.details(id) : null
    const tokenCost = tokenText ? parseTokenCost(tokenText) : undefined
    return {
      apps: [],
      description: entry?.description ?? inspection?.description ?? null,
      detailAvailable: inspection !== undefined,
      mcpServers: inspection?.mcpServers ?? [],
      privacyPolicyUrl: null,
      prompts: [],
      shareUrl: null,
      skills: (inspection?.skills ?? []).map((skill) => ({
        description: skill.description,
        enabled: install?.enabled ?? false,
        name: skill.name,
        path: skill.path,
      })),
      termsOfServiceUrl: null,
      ...(tokenCost ? { tokenCost } : {}),
      websiteUrl: httpUrl(entry?.homepage ?? inspection?.homepage),
    }
  }

  async install(
    locator: PluginLocator & { acceptCommandSha256?: string }
  ): Promise<PluginInstallValue> {
    if (!this.enabled) throw disabledError()
    assertName(locator.pluginName, "plugin name")
    assertName(locator.marketplaceName, "marketplace name")
    const id = `${locator.pluginName}@${locator.marketplaceName}`
    const result = await this.#exclusive(() =>
      this.#cli.mutate(
        [
          "install",
          id,
          "--scope",
          locator.scope ?? "user",
          ...(locator.acceptCommandSha256 ? ["--accept-command", locator.acceptCommandSha256] : []),
        ],
        300_000
      )
    )
    if (result.outcome === "failed") {
      if (result.shownCommand) {
        return {
          confirmation: {
            command: result.shownCommand.command,
            pluginId: result.shownCommand.pluginId,
            sha256: result.shownCommand.sha256,
          },
          installed: false,
        }
      }
      throw new ClaudeCliError(result.message)
    }
    return {
      appsNeedingAuth: [],
      installed: true,
      reloadPending: await this.#reloadSessions(),
    }
  }

  async uninstall(input: { id: string; keepData?: boolean; scope?: PluginScope }): Promise<void> {
    if (!this.enabled) throw disabledError()
    assertId(input.id)
    const result = await this.#exclusive(() =>
      this.#cli.mutate([
        "uninstall",
        input.id,
        "--scope",
        input.scope ?? "user",
        ...(input.keepData ? ["--keep-data"] : []),
      ])
    )
    if (result.outcome === "failed") throw new ClaudeCliError(result.message)
    await this.#reloadSessions()
  }

  async setEnabled(input: { enabled: boolean; id: string; scope?: PluginScope }): Promise<void> {
    if (!this.enabled) throw disabledError()
    assertId(input.id)
    const result = await this.#exclusive(() =>
      this.#cli.mutate([
        input.enabled ? "enable" : "disable",
        input.id,
        ...(input.scope ? ["--scope", input.scope] : []),
      ])
    )
    if (result.outcome === "failed" && result.failureCode !== "already_in_goal_state") {
      throw new ClaudeCliError(result.message)
    }
    await this.#reloadSessions()
  }

  async setGlobalEnabled(enabled: boolean): Promise<void> {
    if (!enabled || !this.enabled) return
    await this.#ensureOfficial().catch(() => undefined)
    await this.#ensureBundled()
  }

  async ensureBundledPlugin(): Promise<void> {
    if (this.enabled) await this.#ensureBundled()
  }

  #ensureBundled(): Promise<void> {
    this.#bundledReady ??= this.#exclusive(() => this.#installBundled()).catch((error: unknown) => {
      this.#bundledReady = undefined
      throw error
    })
    return this.#bundledReady
  }

  /** Offers the bundled marketplace to Claude without installing anything from it. */
  #ensureBundledRegistered(): Promise<void> {
    this.#bundledRegistered ??= this.#exclusive(async () => {
      await this.#registerBundledMarketplace()
    }).catch((error: unknown) => {
      this.#bundledRegistered = undefined
      throw error
    })
    return this.#bundledRegistered
  }

  async #registerBundledMarketplace(): Promise<string> {
    const source = await this.#bundledSource()
    if (!source) throw new Error("Bundled Cypheria plugin marketplace is unavailable")
    const marketplace = (await this.#cli.listMarketplaces()).find(
      (entry) => entry.name === BUNDLED_MARKETPLACE_NAME
    )
    const location = (marketplace?.path ?? marketplace?.installLocation)?.replace(/[\\/]+$/u, "")
    if (marketplace && location === source) return source
    if (marketplace) {
      // The app moved or a foreign marketplace took the name: re-register it from the bundled files.
      await this.#cli.marketplace(["remove", BUNDLED_MARKETPLACE_NAME])
    }
    await this.#cli.marketplace(["add", source, "--scope", "user"])
    return source
  }

  async #installBundled(): Promise<void> {
    const source = await this.#registerBundledMarketplace()
    const id = `${BUNDLED_PLUGIN_NAME}@${BUNDLED_MARKETPLACE_NAME}`
    const bundledVersion = await bundledPluginVersion(source)
    const current = (await this.#cli.listInstalled()).find((plugin) => plugin.id === id)
    if (!current) {
      const result = await this.#cli.mutate(["install", id, "--scope", "user"])
      if (result.outcome === "failed") throw new ClaudeCliError(result.message)
    } else if (bundledVersion && current.version !== bundledVersion) {
      const result = await this.#cli.mutate(["update", id, "--scope", current.scope])
      if (result.outcome === "failed") throw new ClaudeCliError(result.message)
    }
    await this.#reloadSessions()
  }

  async addMarketplace(input: {
    refName?: string
    source: string
    sparsePaths?: string[]
  }): Promise<{ marketplaceName: string | null }> {
    if (!this.enabled) throw disabledError()
    const source = input.source.trim()
    if (!source || source.startsWith("-") || /[\r\n]/u.test(source)) {
      throw new ClaudeCliError("Invalid marketplace source", "INTEGRATION_INVALID")
    }
    for (const path of input.sparsePaths ?? []) {
      if (!path || path.startsWith("-")) {
        throw new ClaudeCliError("Invalid sparse path", "INTEGRATION_INVALID")
      }
    }
    const pinned = input.refName && !source.includes("#") ? `${source}#${input.refName}` : source
    return this.#exclusive(async () => {
      const before = new Set((await this.#cli.listMarketplaces()).map((entry) => entry.name))
      const output = await this.#cli.marketplace([
        "add",
        pinned,
        "--scope",
        "user",
        ...(input.sparsePaths?.length ? ["--sparse", ...input.sparsePaths] : []),
      ])
      const after = await this.#cli.listMarketplaces()
      const created = after.find((entry) => !before.has(entry.name))
      const named = /marketplace(?::|\s)\s*'?([A-Za-z0-9][A-Za-z0-9._-]*)/u.exec(output)?.[1]
      return { marketplaceName: created?.name ?? named ?? null }
    })
  }

  async upgradeMarketplace(name?: string): Promise<void> {
    if (!this.enabled) throw disabledError()
    if (name !== undefined) assertName(name, "marketplace name")
    await this.#exclusive(() => this.#cli.marketplace(["update", ...(name ? [name] : [])]))
  }

  async removeMarketplace(input: {
    confirmUninstall?: boolean
    name: string
  }): Promise<MarketplaceRemoveValue> {
    if (!this.enabled) throw disabledError()
    assertName(input.name, "marketplace name")
    return this.#exclusive(async () => {
      const marketplace = (await this.#cli.listMarketplaces()).find(
        (entry) => entry.name === input.name
      )
      if (!marketplace) throw new ClaudeCliError(`Marketplace ${input.name} is not configured`)
      if ((await this.#kindOf(marketplace)) !== "custom") {
        throw new Error("Official marketplaces cannot be removed")
      }
      const affected = (await this.#cli.listInstalled())
        .map((plugin) => plugin.id)
        .filter((id) => splitId(id).marketplace === input.name)
      const unique = [...new Set(affected)]
      if (unique.length && !input.confirmUninstall) {
        return { affectedPlugins: unique, succeeded: false }
      }
      await this.#cli.marketplace(["remove", input.name])
      await this.#reloadSessions()
      return { succeeded: true, uninstalledPlugins: unique }
    })
  }

  async readConfig(id: string): Promise<PluginConfigValue> {
    if (!this.enabled) throw disabledError()
    assertId(id)
    const config = await this.#cli.readConfig(id)
    const configured = new Set(config.configured)
    const options: PluginConfigOption[] = Object.entries(config.schema).map(([key, option]) => {
      const raw = config.inputs[key]
      const sensitive = option.sensitive === true
      const fallback = option.default
      return {
        configured: configured.has(key),
        default: fallback === undefined ? null : String(fallback),
        description: option.description,
        key,
        multiple: option.multiple === true,
        options: option.options ?? null,
        required: option.required === true,
        sensitive,
        title: option.title,
        type: option.type,
        value: sensitive || typeof raw !== "string" || raw === "" ? null : raw,
      }
    })
    return { options }
  }

  async writeConfig(id: string, values: Record<string, string>): Promise<PluginConfigWriteValue> {
    if (!this.enabled) throw disabledError()
    assertId(id)
    const config = await this.#cli.readConfig(id)
    for (const [key, value] of Object.entries(values)) {
      if (!(key in config.schema)) {
        throw new ClaudeCliError(`Unknown plugin option ${key}`, "INTEGRATION_INVALID")
      }
      if (/[\r\n]/u.test(value)) {
        throw new ClaudeCliError(
          "Plugin option values must be a single line",
          "INTEGRATION_INVALID"
        )
      }
    }
    const saved = await this.#exclusive(() => this.#cli.writeConfig(id, values))
    await this.#reloadSessions()
    return { saved: saved.saved, unconfigured: saved.unconfigured }
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : "Unable to load the Claude plugin catalog"

const httpUrl = (value: string | null | undefined): string | null => {
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

const bundledPluginVersion = async (marketplaceDirectory: string): Promise<string | undefined> => {
  try {
    const text = await readFile(
      join(marketplaceDirectory, "plugins", BUNDLED_PLUGIN_NAME, ".claude-plugin", "plugin.json"),
      "utf8"
    )
    const version = (JSON.parse(text) as { version?: unknown }).version
    return typeof version === "string" ? version : undefined
  } catch {
    return undefined
  }
}

const stayInside = async (root: string, path: string): Promise<boolean> => {
  try {
    const rel = relative(await realpath(root), await realpath(path))
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
  } catch {
    return false
  }
}
