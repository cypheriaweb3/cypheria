import { readdir, rm, stat } from "node:fs/promises"
import { dirname, join, relative, sep } from "node:path"

import type {
  InstalledPluginRecord,
  PluginAgentBindingRecord,
  PluginMarketplaceRecord,
  PluginPersistenceService,
} from "@cypheria/db"
import type {
  AgentId,
  MarketplaceView,
  PluginAgentResult,
  PluginAgentState,
  PluginDetailView,
  PluginFormat,
  PluginScope,
  PluginView,
} from "@cypheria/protocol"

import {
  type CatalogFile,
  type CatalogSource,
  isInside,
  readMarketplaceCatalog,
} from "./marketplace-catalog.js"
import {
  assertMarketplaceName,
  normalizeMarketplaceInput,
  sameMarketplaceSource,
} from "./marketplace-source.js"
import { contentFingerprint, gitRemote, type MarketplaceStore } from "./marketplace-store.js"
import type { PackagePlugin, PackagePluginProvider } from "./package-plugin-providers.js"
import { PI_PACKAGE_CATALOG, type PiPackageCatalog } from "./pi-package-catalog.js"
import {
  detectPluginFormats,
  nativeFormatFor,
  readPluginMcpServerNames,
  readPluginMetadata,
  readPluginSkills,
} from "./plugin-format.js"
import type { PluginListValue, PluginLocator, PluginProvider } from "./plugin-provider.js"
import { BUNDLED_MARKETPLACE_NAME } from "./plugin-utils.js"

export const STANDALONE_MARKETPLACE = "standalone-plugins"
export const CURATED_MARKETPLACE = "cypheria-curated"

/** Marketplaces only Cypheria lists; Codex and Claude never see them in their own catalogs. */
const CYPHERIA_ONLY = new Set([STANDALONE_MARKETPLACE, PI_PACKAGE_CATALOG])

/**
 * Official catalogs of Agents that Cypheria cannot read through the Agent itself. Cypheria clones
 * each into its own directory, registers it with Codex and Claude when it ships a marketplace file
 * they read that lists the whole catalog, and lists it to every other Agent. Each id is the name its marketplace files use.
 * Copilot CLI ships `copilot-plugins` and `awesome-copilot` and installs from them by name.
 */
export const AGENT_CATALOGS: readonly {
  displayName: string
  id: string
  /** Catalogs that are only a directory of plugins, one plugin per subdirectory. */
  pluginDirectory?: string
  /**
   * False for a catalog whose marketplace files that Codex or Claude read list only part of it,
   * so it is listed through Cypheria instead of being registered with them.
   */
  registerWithCatalogAgents?: false
  source: string
}[] = [
  {
    displayName: "Cursor Marketplace",
    id: "cursor-plugins",
    // Its `.claude-plugin` marketplace file lists one of its plugins.
    registerWithCatalogAgents: false,
    source: "https://github.com/cursor/plugins",
  },
  {
    displayName: "Cline Official",
    id: "cline-official",
    pluginDirectory: "plugins",
    source: "https://github.com/cline/plugins",
  },
  {
    displayName: "Devin Marketplace",
    id: "devin-marketplace",
    source: "https://github.com/CognitionAI/devin-marketplace",
  },
  {
    displayName: "xAI Official",
    id: "xai-official",
    source: "https://github.com/xai-org/plugin-marketplace",
  },
  {
    displayName: "Copilot Plugins",
    id: "copilot-plugins",
    source: "https://github.com/github/copilot-plugins",
  },
  {
    displayName: "Awesome Copilot",
    id: "awesome-copilot",
    source: "https://github.com/github/awesome-copilot",
  },
]
const AGENT_CATALOG_IDS: ReadonlySet<string> = new Set(AGENT_CATALOGS.map((entry) => entry.id))
const UNREGISTERED_CATALOG_IDS: ReadonlySet<string> = new Set(
  AGENT_CATALOGS.filter((entry) => entry.registerWithCatalogAgents === false).map(
    (entry) => entry.id
  )
)

/** The marketplace files each catalog Agent reads; see Agent Plugin Capabilities. */
const CATALOG_READERS: Partial<Record<AgentId, readonly CatalogFile[]>> = {
  claude: ["claude"],
  codex: ["codex", "claude", "cursor"],
}

const readCatalog = (record: { id: string; localPath: string }) =>
  readMarketplaceCatalog(record.localPath, {
    pluginDirectory: AGENT_CATALOGS.find((entry) => entry.id === record.id)?.pluginDirectory,
  })

/** A source Cypheria clones: GitHub shorthand or a Git URL, not a path or a hosted file. */
const isGitSource = (source: string): boolean =>
  !source.startsWith("/") &&
  !/^[A-Za-z]:[\\/]/u.test(source) &&
  !/^[a-z]+:\/\/[^/]*\/.*\.json(?:[?#].*)?$/iu.test(source) &&
  (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:#.*)?$/u.test(source) ||
    /^(?:https?|ssh|git):\/\//u.test(source) ||
    /^[A-Za-z0-9_.-]+@[A-Za-z0-9.-]+:/u.test(source))

type Catalog = PluginListValue | undefined
type Found = { marketplace: MarketplaceView; plugin: PluginView }

export type PluginAuditEvent = {
  eventType: string
  payloadHash?: string | null
  summary: string
}

export type PluginHubOptions = {
  activeAgents: () => AgentId[]
  agentHome: (agentId: AgentId) => string
  audit?: (event: PluginAuditEvent) => Promise<void>
  /**
   * Whether an Agent has a session that is not stopped. Plugin updates wait until it has none,
   * so a running session keeps the plugins it started with.
   */
  isAgentBusy?: (agentId: AgentId) => Promise<boolean>
  packages?: ReadonlyMap<AgentId, PackagePluginProvider>
  persistence: PluginPersistenceService
  piCatalog?: PiPackageCatalog
  providers: ReadonlyMap<AgentId, PluginProvider>
  store: MarketplaceStore
}

const invalid = (message: string): Error => {
  const error = new Error(message)
  error.name = "INTEGRATION_INVALID"
  return error
}

const unsupported = (message: string): Error => {
  const error = new Error(message)
  error.name = "INTEGRATION_UNSUPPORTED"
  return error
}

const messageOf = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > 400 ? `${text.slice(0, 400)}…` : text
}

const find = (catalog: Catalog, marketplaceName: string, pluginName: string): Found | undefined => {
  const marketplace = catalog?.marketplaces.find((entry) => entry.name === marketplaceName)
  const plugin = marketplace?.plugins.find((entry) => entry.name === pluginName)
  return marketplace && plugin ? { marketplace, plugin } : undefined
}

export const pluginIdOf = (pluginName: string, marketplaceName: string): string =>
  `${pluginName}@${marketplaceName}`

/** Directory-safe plugin name for an npm package such as `@scope/name`. */
export const npmPluginName = (packageName: string): string =>
  packageName.replace(/^@/u, "").replace(/\//gu, "__")

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false
  )

/**
 * Presents one plugin identity (`<pluginName>@<marketplaceId>`) across Agents. Codex and Claude
 * install from catalogs they read themselves; other Agents install packages through their own
 * CLI. An Agent that reads none of the plugin's formats does not support it. The database
 * records what is installed where.
 */
export class PluginHub {
  readonly #providers: ReadonlyMap<AgentId, PluginProvider>
  readonly #packages: ReadonlyMap<AgentId, PackagePluginProvider>
  readonly #db: PluginPersistenceService
  readonly #store: MarketplaceStore
  readonly #activeAgents: () => AgentId[]
  readonly #agentHome: (agentId: AgentId) => string
  readonly #audit: (event: PluginAuditEvent) => Promise<void>
  readonly #piCatalog: PiPackageCatalog | undefined
  readonly #isAgentBusy: (agentId: AgentId) => Promise<boolean>
  #builtins: Promise<void> | undefined

  constructor(options: PluginHubOptions) {
    this.#providers = options.providers
    this.#packages = options.packages ?? new Map()
    this.#db = options.persistence
    this.#store = options.store
    this.#activeAgents = options.activeAgents
    this.#agentHome = options.agentHome
    this.#audit = options.audit ?? (async () => undefined)
    this.#piCatalog = options.piCatalog
    this.#isAgentBusy = options.isAgentBusy ?? (async () => false)
  }

  get store(): MarketplaceStore {
    return this.#store
  }

  /** Catalog Agents that have plugins turned on; the others take no part in their operations. */
  #active(): PluginProvider[] {
    return [...this.#providers.values()].filter((provider) => provider.enabled)
  }

  /** Every installed and enabled Agent that is not a catalog Agent with plugins turned off. */
  #agents(): AgentId[] {
    return this.#activeAgents().filter((agentId) => this.#providers.get(agentId)?.enabled !== false)
  }

  provider(agentId: AgentId): PluginProvider {
    const provider = this.#providers.get(agentId)
    if (!provider) {
      const error = new Error(`The ${agentId} plugin adapter is not available yet`)
      error.name = "INTEGRATION_UNSUPPORTED"
      throw error
    }
    return provider
  }

  /** Records the built-in marketplaces once per Server process. */
  ensureBuiltins(): Promise<void> {
    this.#builtins ??= (async () => {
      const builtins: Omit<PluginMarketplaceRecord, "createdAt" | "updatedAt">[] = [
        {
          displayName: "Cypheria",
          id: BUNDLED_MARKETPLACE_NAME,
          isBuiltin: true,
          localPath: this.#store.directoryFor(BUNDLED_MARKETPLACE_NAME),
          ownerAgentId: null,
          refName: null,
          source: "bundled://plugins",
          sparsePaths: null,
        },
        {
          displayName: "Cypheria Curated",
          id: CURATED_MARKETPLACE,
          isBuiltin: true,
          localPath: this.#store.directoryFor(CURATED_MARKETPLACE),
          ownerAgentId: null,
          refName: null,
          source: "https://cypheria.dev/marketplace",
          sparsePaths: null,
        },
        {
          displayName: "Standalone plugins",
          id: STANDALONE_MARKETPLACE,
          isBuiltin: true,
          localPath: this.#store.directoryFor(STANDALONE_MARKETPLACE),
          ownerAgentId: null,
          refName: null,
          source: "virtual://standalone",
          sparsePaths: null,
        },
        {
          displayName: "Pi packages",
          id: PI_PACKAGE_CATALOG,
          isBuiltin: true,
          localPath: join(this.#store.root, ".sources", PI_PACKAGE_CATALOG),
          ownerAgentId: null,
          refName: null,
          source: "npm:keywords:pi-package",
          sparsePaths: null,
        },
        {
          displayName: "OpenAI",
          id: "openai-curated",
          isBuiltin: true,
          localPath: join(this.#agentHome("codex"), ".tmp", "plugins"),
          ownerAgentId: "codex",
          refName: null,
          source: "openai-curated",
          sparsePaths: null,
        },
        {
          displayName: "Claude Plugins",
          id: "claude-plugins-official",
          isBuiltin: true,
          localPath: join(
            this.#agentHome("claude"),
            "plugins",
            "marketplaces",
            "claude-plugins-official"
          ),
          ownerAgentId: "claude",
          refName: null,
          source: "anthropics/claude-plugins-official",
          sparsePaths: null,
        },
        ...AGENT_CATALOGS.map((entry) => ({
          displayName: entry.displayName,
          id: entry.id,
          isBuiltin: true,
          localPath: this.#store.directoryFor(entry.id),
          ownerAgentId: null,
          refName: null,
          source: entry.source,
          sparsePaths: null,
        })),
      ]
      await this.#store.cleanup()
      // A built-in marketplace that is no longer built in, such as a renamed Agent catalog.
      const known = new Set(builtins.map((builtin) => builtin.id))
      for (const record of await this.#db.marketplaces.list()) {
        if (!record.isBuiltin || known.has(record.id)) continue
        await this.#db.marketplaces.remove(record.id)
        await this.#store.remove(record.localPath)
      }
      for (const builtin of builtins) {
        const current = await this.#db.marketplaces.get(builtin.id)
        if (current?.isBuiltin && current.localPath === builtin.localPath) continue
        await this.#db.marketplaces.upsert(builtin)
      }
      void this.#fetchAgentCatalogs()
    })().catch((error: unknown) => {
      this.#builtins = undefined
      throw error
    })
    return this.#builtins
  }

  #catalogFetch: Promise<void> | undefined

  /**
   * Clones the Agent catalogs that are not on disk yet, then registers each with the catalog
   * Agents that read one of its marketplace files. Listing shows a catalog once it is on disk.
   */
  #fetchAgentCatalogs(): Promise<void> {
    this.#catalogFetch ??= (async () => {
      for (const entry of AGENT_CATALOGS) {
        const target = this.#store.directoryFor(entry.id)
        if (!(await exists(target))) {
          const staged = await this.#store.stage({ source: entry.source }).catch(() => undefined)
          if (staged) await this.#store.commit(staged.path, entry.id).catch(() => undefined)
        }
        if (await exists(target)) await this.#registerAgentCatalog(entry.id, target)
      }
    })().finally(() => {
      this.#catalogFetch = undefined
    })
    return this.#catalogFetch
  }

  /**
   * Registers an Agent catalog with every catalog Agent that reads one of its marketplace files
   * and does not list it yet. A registration that reads another name is removed again.
   */
  async #registerAgentCatalog(id: string, localPath: string): Promise<void> {
    if (UNREGISTERED_CATALOG_IDS.has(id)) return
    const { files } = await readCatalog({ id, localPath })
    const catalogs = await this.#catalogs()
    for (const provider of this.#active()) {
      if (!CATALOG_READERS[provider.agentId]?.some((file) => files.includes(file))) continue
      if (catalogs.get(provider.agentId)?.marketplaces.some((entry) => entry.name === id)) continue
      try {
        const { marketplaceName } = await provider.addMarketplace({ source: localPath })
        if (marketplaceName && marketplaceName !== id) {
          await provider
            .removeMarketplace({ confirmUninstall: true, name: marketplaceName })
            .catch(() => undefined)
        }
      } catch {
        // The Agent could not read the catalog: Cypheria still lists it there.
      }
    }
  }

  async #catalogs(): Promise<Map<AgentId, Catalog>> {
    const entries = await Promise.all(
      this.#active().map(
        async (provider) =>
          [provider.agentId, await provider.list({}).catch(() => undefined)] as const
      )
    )
    return new Map(entries)
  }

  // ---------------------------------------------------------------------------------------------
  // Listing

  /**
   * One Agent's plugin list: what its catalog shows, plus the marketplaces only Cypheria lists
   * (standalone packages, the Pi package catalog, and Cypheria-owned marketplaces it cannot read).
   */
  async list(
    agentId: AgentId,
    input: { cwd?: string; forceRefresh?: boolean }
  ): Promise<PluginListValue> {
    await this.ensureBuiltins()
    const value = await this.provider(agentId).list(input)
    const shown = new Set(value.marketplaces.map((marketplace) => marketplace.name))
    const extra = await this.#cypheriaMarketplaces(agentId, shown, input.forceRefresh ?? false)
    return {
      ...value,
      errors: [...value.errors, ...extra.errors],
      marketplaces: [...value.marketplaces, ...extra.marketplaces],
    }
  }

  async #cypheriaMarketplaces(
    agentId: AgentId,
    shown: ReadonlySet<string>,
    forceRefresh: boolean
  ): Promise<{ errors: PluginListValue["errors"]; marketplaces: MarketplaceView[] }> {
    const errors: PluginListValue["errors"] = []
    const marketplaces: MarketplaceView[] = []
    const installed = await this.#db.plugins.list()
    const bindings = await this.#db.bindings.list({ agentId })
    const supported = new Map(
      await Promise.all(
        installed.map(
          async (record) => [record.id, Boolean(await this.#packageFor(agentId, record))] as const
        )
      )
    )
    const view = (
      record: {
        description: string | null
        displayName: string
        name: string
        version: string | null
      },
      marketplace: string,
      sourceType: PluginView["sourceType"]
    ): PluginView => {
      const id = pluginIdOf(record.name, marketplace)
      const plugin = installed.find((entry) => entry.id === id)
      const binding = bindings.find((entry) => entry.pluginId === id)
      return {
        availability: "AVAILABLE",
        brandColor: null,
        capabilities: [],
        category: null,
        compatibility: ["acp"],
        description: record.description,
        developerName: null,
        displayName: record.displayName,
        ecosystem: marketplace === PI_PACKAGE_CATALOG ? "pi" : "cypheria",
        enabled: binding?.enabled ?? false,
        featured: false,
        harness: { agentId, nativeId: id },
        id,
        installed: plugin !== undefined,
        installedScopes: [],
        installPolicy: "AVAILABLE",
        logoUrl: null,
        marketplaceName: marketplace,
        marketplacePath: null,
        name: record.name,
        sourceType,
        ...(plugin ? { supported: supported.get(id) ?? false } : {}),
        version: plugin?.version ?? record.version,
      }
    }

    for (const record of await this.#db.marketplaces.list()) {
      if (shown.has(record.id) || record.ownerAgentId) continue
      if (record.id === PI_PACKAGE_CATALOG) {
        if (!this.#piCatalog) continue
        try {
          const packages = await this.#piCatalog.list(forceRefresh)
          marketplaces.push({
            displayName: record.displayName,
            name: record.id,
            path: null,
            plugins: packages.map((entry) =>
              view(
                {
                  description: entry.description,
                  displayName: entry.name,
                  name: npmPluginName(entry.name),
                  version: entry.version,
                },
                record.id,
                "npm"
              )
            ),
            sourceKind: "pi",
          })
        } catch (error) {
          errors.push({ message: messageOf(error), path: `catalog:${PI_PACKAGE_CATALOG}` })
        }
        continue
      }
      if (record.id === STANDALONE_MARKETPLACE) {
        const plugins = installed.filter((entry) => entry.marketplaceId === record.id)
        if (!plugins.length) continue
        marketplaces.push({
          displayName: record.displayName,
          name: record.id,
          path: null,
          plugins: plugins.map((entry) =>
            view(
              { ...entry, name: entry.pluginName },
              record.id,
              entry.installSourceType === "npm"
                ? "npm"
                : entry.installSourceType === "git"
                  ? "git"
                  : "local"
            )
          ),
          sourceKind: "custom",
        })
        continue
      }
      if (!(await exists(record.localPath))) continue
      const catalog = await readCatalog(record)
      if (!catalog.plugins.length) continue
      marketplaces.push({
        displayName: record.displayName,
        name: record.id,
        path: record.localPath,
        plugins: catalog.plugins.map((entry) =>
          view(
            entry,
            record.id,
            entry.source?.kind === "git" ? "git" : entry.source?.kind === "npm" ? "npm" : "local"
          )
        ),
        sourceKind:
          record.id === BUNDLED_MARKETPLACE_NAME ||
          record.id === CURATED_MARKETPLACE ||
          AGENT_CATALOG_IDS.has(record.id)
            ? "cypheria"
            : "custom",
      })
    }
    return { errors, marketplaces }
  }

  /** Plugin detail; plugins only Cypheria lists are read from their files. */
  async read(agentId: AgentId, locator: PluginLocator): Promise<PluginDetailView> {
    const record = await this.#db.plugins.get(
      pluginIdOf(locator.pluginName, locator.marketplaceName)
    )
    const cypheriaOnly =
      CYPHERIA_ONLY.has(locator.marketplaceName) ||
      !(await this.#catalogs())
        .get(agentId)
        ?.marketplaces.some((entry) => entry.name === locator.marketplaceName)
    if (!cypheriaOnly) return this.provider(agentId).read(locator)
    const directory = record?.installPath || (await this.#catalogEntryPath(locator))
    const [metadata, mcp, skills] = directory
      ? await Promise.all([
          readPluginMetadata(directory),
          readPluginMcpServerNames(directory),
          readPluginSkills(directory),
        ])
      : [undefined, [], []]
    return {
      apps: [],
      description: metadata?.description ?? record?.description ?? null,
      detailAvailable: Boolean(directory),
      mcpServers: mcp,
      privacyPolicyUrl: null,
      prompts: [],
      shareUrl: null,
      skills: skills.map((skill) => ({
        description: "",
        enabled: true,
        name: skill.name,
        path: join(skill.path, "SKILL.md"),
      })),
      termsOfServiceUrl: null,
      websiteUrl: null,
    }
  }

  async #catalogEntryPath(locator: {
    marketplaceName: string
    pluginName: string
  }): Promise<string | null> {
    const record = await this.#db.marketplaces.get(locator.marketplaceName)
    if (!record || !(await exists(record.localPath))) return null
    const entry = (await readCatalog(record)).plugins.find(
      (plugin) => plugin.name === locator.pluginName
    )
    if (entry?.source?.kind !== "local") return null
    const path = join(record.localPath, entry.source.path)
    return isInside(record.localPath, path) ? path : null
  }

  // ---------------------------------------------------------------------------------------------
  // Per-Agent state

  /** Where one plugin is offered, installed, or enabled, per Agent. */
  async agents(locator: {
    marketplaceName: string
    pluginName: string
  }): Promise<PluginAgentState[]> {
    await this.ensureBuiltins()
    const catalogs = await this.#catalogs()
    const pluginId = pluginIdOf(locator.pluginName, locator.marketplaceName)
    const record = await this.#db.plugins.get(pluginId)
    const bindings = await this.#db.bindings.list({ pluginId })
    const states: PluginAgentState[] = []
    for (const agentId of this.#agents()) {
      const provider = this.#providers.get(agentId)
      const found = provider
        ? find(catalogs.get(agentId), locator.marketplaceName, locator.pluginName)
        : undefined
      const binding = bindings.find((entry) => entry.agentId === agentId)
      if (found) {
        states.push({
          agentId,
          enabled: found.plugin.installed && found.plugin.enabled,
          id: found.plugin.id,
          installed: found.plugin.installed,
          installedScopes: found.plugin.installedScopes,
          marketplacePath: found.plugin.marketplacePath,
          statusMessage: binding?.statusMessage ?? null,
          supported: true,
        })
        continue
      }
      if (!record) continue
      const native = await this.#packageFor(agentId, record)
      if (native) {
        states.push({
          agentId,
          enabled: binding?.enabled ?? false,
          id: pluginId,
          installed: binding?.nativeInstallReceipt != null,
          installedScopes: [],
          marketplacePath: null,
          statusMessage: binding?.statusMessage ?? null,
          supported: true,
        })
        continue
      }
      states.push({
        agentId,
        enabled: false,
        id: pluginId,
        installed: false,
        installedScopes: [],
        marketplacePath: null,
        statusMessage: null,
        supported: false,
      })
    }
    return states
  }

  // ---------------------------------------------------------------------------------------------
  // Install

  async install(input: {
    acceptCommands?: Record<string, string>
    agentIds?: AgentId[]
    marketplaceName: string
    pluginName: string
    scope?: PluginScope
  }): Promise<PluginAgentResult[]> {
    await this.ensureBuiltins()
    const catalogs = await this.#catalogs()
    const wanted = (agentId: AgentId): boolean =>
      !input.agentIds || input.agentIds.includes(agentId)
    const results: PluginAgentResult[] = []
    for (const provider of this.#active()) {
      if (!wanted(provider.agentId)) continue
      const found = find(catalogs.get(provider.agentId), input.marketplaceName, input.pluginName)
      if (!found) continue
      results.push(
        await this.#installOne(provider, found, {
          acceptCommandSha256: input.acceptCommands?.[provider.agentId],
          scope: input.scope,
        })
      )
    }

    let record: InstalledPluginRecord | undefined
    try {
      record = await this.#recordPlugin(input.marketplaceName, input.pluginName)
    } catch (error) {
      if (!results.length) throw error
    }
    if (!record && !results.length) {
      throw new Error(`${input.pluginName} is not listed in ${input.marketplaceName}`)
    }
    if (record) {
      for (const result of results) {
        await this.#bindNative(record.id, result.agentId, result.status === "done", null)
      }
      results.push(
        ...(await this.#installPackages(record, {
          acceptCommands: input.acceptCommands,
          skip: new Set(results.map((result) => result.agentId)),
          wanted,
        }))
      )
    }
    return results
  }

  /**
   * Installs a Git repository, npm package, or local directory under `standalone-plugins`.
   * Agents that read one of its formats install it natively; the others do not support it.
   */
  async installStandalone(input: {
    acceptCommands?: Record<string, string>
    source: string
    sourceType: "git" | "local" | "npm"
  }): Promise<{ marketplaceName: string; pluginName: string; results: PluginAgentResult[] }> {
    await this.ensureBuiltins()
    const source = input.source.trim()
    if (!source || source.startsWith("-")) throw invalid("Enter a package source")
    if (input.sourceType === "git")
      await normalizeMarketplaceInput({ source }).catch(() => {
        throw invalid("Use owner/repo or a git URL")
      })
    const fetched = await this.#store.fetchStandalone({ source, sourceType: input.sourceType })
    let path = fetched.path
    try {
      const metadata = await readPluginMetadata(fetched.path)
      const pluginName = npmPluginName(metadata.name ?? fetched.suggestedName)
      assertMarketplaceName(pluginName)
      const existing = await this.#db.plugins.get(pluginIdOf(pluginName, STANDALONE_MARKETPLACE))
      if (existing && existing.installSourceUrl !== source) {
        throw invalid(
          `A standalone plugin named ${pluginName} is already installed from ${existing.installSourceUrl}. Uninstall it first.`
        )
      }
      path = await this.#store.renameStandalone(fetched.path, pluginName)
      const record = await this.#savePlugin({
        installPath: path,
        marketplaceId: STANDALONE_MARKETPLACE,
        pluginName,
        sourceType: input.sourceType,
        sourceUrl: source,
      })
      const results = await this.#installPackages(record, {
        acceptCommands: input.acceptCommands,
        skip: new Set(),
        wanted: () => true,
      })
      await this.#audit({
        eventType: "plugin.standalone.installed",
        summary: `${record.id} from ${input.sourceType} ${source}`,
      })
      return { marketplaceName: STANDALONE_MARKETPLACE, pluginName, results }
    } catch (error) {
      if (this.#store.owns(path)) await rm(path, { force: true, recursive: true })
      throw error
    }
  }

  /** Native installation in every package Agent that reads the plugin and is not already done. */
  async #installPackages(
    record: InstalledPluginRecord,
    options: {
      acceptCommands?: Record<string, string>
      skip: ReadonlySet<AgentId>
      wanted: (agentId: AgentId) => boolean
    }
  ): Promise<PluginAgentResult[]> {
    const results: PluginAgentResult[] = []
    for (const agentId of this.#agents()) {
      if (options.skip.has(agentId) || !options.wanted(agentId) || this.#providers.has(agentId)) {
        continue
      }
      const provider = await this.#packageFor(agentId, record)
      if (!provider) continue
      results.push(await this.#installPackage(provider, record, options.acceptCommands?.[agentId]))
    }
    return results
  }

  async #installPackage(
    provider: PackagePluginProvider,
    record: InstalledPluginRecord,
    acceptCommandSha256: string | undefined
  ): Promise<PluginAgentResult> {
    const agentId = provider.agentId
    try {
      const revision = await this.#revision(record)
      const outcome = await provider.install(await this.#packagePlugin(record, revision.path), {
        acceptCommandSha256,
      })
      if (!outcome.installed) {
        return { agentId, confirmation: outcome.confirmation, status: "confirmation_required" }
      }
      await this.#bindNative(record.id, agentId, true, outcome.receipt, null, revision.sha256)
      await this.#audit({
        eventType: "plugin.native.installed",
        summary: `${record.id} for ${agentId}: ${outcome.receipt.command ?? "installed"}`,
      })
      return { agentId, appsNeedingAuth: [], reloadPending: true, status: "done" }
    } catch (error) {
      await this.#bindNative(record.id, agentId, false, null, messageOf(error))
      return { agentId, message: messageOf(error), status: "failed" }
    }
  }

  /** Enables the plugin in a catalog `provider`, installing it there first when needed. */
  async #installOne(
    provider: PluginProvider,
    found: Found,
    options: { acceptCommandSha256?: string; scope?: PluginScope }
  ): Promise<PluginAgentResult> {
    const agentId = provider.agentId
    try {
      let apps: string[] = []
      let reloadPending = false
      if (!found.plugin.installed) {
        const value = await provider.install({
          acceptCommandSha256: options.acceptCommandSha256,
          marketplaceName: found.marketplace.name,
          marketplacePath: found.plugin.marketplacePath,
          pluginName: found.plugin.name,
          scope: options.scope,
        })
        if (!value.installed) {
          return { agentId, confirmation: value.confirmation, status: "confirmation_required" }
        }
        apps = value.appsNeedingAuth
        reloadPending = value.reloadPending
      }
      if (!found.plugin.installed || !found.plugin.enabled) {
        await provider.setEnabled({ enabled: true, id: found.plugin.id, scope: options.scope })
      }
      return { agentId, appsNeedingAuth: apps, reloadPending, status: "done" }
    } catch (error) {
      return { agentId, message: messageOf(error), status: "failed" }
    }
  }

  async #packageFor(
    agentId: AgentId,
    record: InstalledPluginRecord
  ): Promise<PackagePluginProvider | undefined> {
    const provider = this.#packages.get(agentId)
    if (!provider || !nativeFormatFor(agentId, record.detectedFormats)) return undefined
    return provider.supports(await this.#packagePlugin(record)) ? provider : undefined
  }

  /** The plugin as package Agents need it, installed from `installPath` when given. */
  async #packagePlugin(
    record: InstalledPluginRecord,
    installPath?: string
  ): Promise<PackagePlugin> {
    const marketplace = CYPHERIA_ONLY.has(record.marketplaceId)
      ? undefined
      : await this.#db.marketplaces.get(record.marketplaceId)
    const path = installPath ?? record.installPath
    // A plugin without files is never offered to a package Agent: it has no format to read.
    if (!path) throw new Error(`${record.displayName} has no files to install`)
    return {
      id: record.id,
      installPath: path,
      installSourceType: record.installSourceType,
      installSourceUrl: record.installSourceUrl,
      marketplaceId: record.marketplaceId,
      // Agent catalogs install by name or not at all; any other marketplace directory, including
      // one an Agent manages such as Claude's official catalog, is registered as it is.
      marketplacePath:
        marketplace &&
        !AGENT_CATALOG_IDS.has(marketplace.id) &&
        (await exists(marketplace.localPath))
          ? marketplace.localPath
          : null,
      name: record.pluginName,
      origin:
        marketplace &&
        isGitSource(marketplace.source) &&
        record.installPath &&
        isInside(marketplace.localPath, record.installPath)
          ? {
              path: relative(marketplace.localPath, record.installPath).split(sep).join("/"),
              url: gitRemote(marketplace.source, marketplace.refName).url,
            }
          : null,
    }
  }

  async #bindNative(
    pluginId: string,
    agentId: AgentId,
    enabled: boolean,
    receipt: PluginAgentBindingRecord["nativeInstallReceipt"],
    statusMessage: string | null = null,
    /** The revision the Agent now holds; omitted to keep the recorded one. */
    installedSha256?: string | null
  ): Promise<void> {
    const current = await this.#db.bindings.get(pluginId, agentId)
    await this.#db.bindings.upsert({
      agentId,
      enabled,
      installedSha256:
        installedSha256 === undefined ? (current?.installedSha256 ?? null) : installedSha256,
      nativeInstallReceipt: receipt ?? current?.nativeInstallReceipt ?? null,
      pluginId,
      statusMessage,
    })
  }

  /**
   * The current revision of a plugin: the SHA-256 of its files and the immutable copy package
   * Agents install from. A plugin whose files cannot be read is installed from its directory.
   */
  async #revision(
    record: InstalledPluginRecord
  ): Promise<{ path: string | undefined; sha256: string | null }> {
    const sha256 = record.installPath ? await contentFingerprint(record.installPath) : null
    if (!record.installPath || !sha256) return { path: undefined, sha256: null }
    const { version } = await readPluginMetadata(record.installPath)
    return {
      path: await this.#store.snapshot(record.id, record.installPath, { sha256, version }),
      sha256,
    }
  }

  /** Removes the revisions of a plugin that no Agent holds any more. */
  async #pruneRevisions(pluginId: string): Promise<void> {
    const held = new Set<string>()
    for (const binding of await this.#db.bindings.list({ pluginId })) {
      if (binding.installedSha256) held.add(binding.installedSha256)
    }
    await this.#store.removeSnapshots(pluginId, held)
  }

  /** Records (or refreshes) the installed plugin, fetching its files when they live elsewhere. */
  async #recordPlugin(marketplaceName: string, pluginName: string): Promise<InstalledPluginRecord> {
    const pluginId = pluginIdOf(pluginName, marketplaceName)
    const existing = await this.#db.plugins.get(pluginId)
    if (marketplaceName === PI_PACKAGE_CATALOG) {
      const entry = (await this.#piCatalog?.list())?.find(
        (candidate) => npmPluginName(candidate.name) === pluginName
      )
      if (!entry) throw new Error(`${pluginName} is not in the Pi package catalog`)
      const installPath = await this.#store.fetchPluginSource(marketplaceName, pluginName, {
        kind: "npm",
        package: entry.name,
        version: entry.version,
      })
      return this.#savePlugin({
        description: entry.description,
        displayName: entry.name,
        installPath,
        marketplaceId: marketplaceName,
        pluginName,
        sourceType: "npm",
        sourceUrl: entry.name,
      })
    }
    if (marketplaceName === STANDALONE_MARKETPLACE) {
      if (!existing) throw new Error(`${pluginName} is not an installed standalone package`)
      return existing
    }
    const marketplace = await this.#db.marketplaces.get(marketplaceName)
    const localPath = marketplace?.localPath
    const entry =
      localPath && (await exists(localPath))
        ? (await readCatalog({ id: marketplaceName, localPath })).plugins.find(
            (plugin) => plugin.name === pluginName
          )
        : undefined
    let installPath: string | null = null
    let sourceType: InstalledPluginRecord["installSourceType"] = "local"
    let sourceUrl = pluginName
    const source: CatalogSource | null = entry?.source ?? null
    if (localPath && source?.kind === "local") {
      const path = join(localPath, source.path)
      if (isInside(localPath, path) && (await exists(path))) installPath = path
      sourceUrl = `./${source.path}`
    } else if (source && source.kind !== "local") {
      installPath = await this.#store.fetchPluginSource(marketplaceName, pluginName, source)
      sourceType = source.kind
      sourceUrl = source.kind === "git" ? source.url : source.package
    }
    if (installPath === null) {
      installPath = await this.#nativeCachePath(marketplaceName, pluginName)
      sourceType = installPath ? "agent_cache" : "remote"
    }
    return this.#savePlugin({
      description: entry?.description ?? null,
      displayName: entry?.displayName ?? pluginName,
      installPath,
      marketplaceId: marketplaceName,
      pluginName,
      sourceType,
      sourceUrl,
      version: entry?.version ?? null,
    })
  }

  /** Where Codex or Claude unpacked a plugin they installed from a catalog Cypheria cannot read. */
  async #nativeCachePath(marketplaceName: string, pluginName: string): Promise<string | null> {
    for (const agentId of ["codex", "claude"] as const) {
      const root = join(this.#agentHome(agentId), "plugins", "cache", marketplaceName, pluginName)
      const versions = await readdir(root, { withFileTypes: true }).catch(() => [])
      const directories = versions.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
      const newest = directories.sort((left, right) =>
        right.localeCompare(left, undefined, { numeric: true })
      )[0]
      if (newest) return join(root, newest)
    }
    return null
  }

  async #savePlugin(input: {
    description?: string | null
    displayName?: string
    installPath: string | null
    marketplaceId: string
    pluginName: string
    sourceType: InstalledPluginRecord["installSourceType"]
    sourceUrl: string
    version?: string | null
  }): Promise<InstalledPluginRecord> {
    if (!(await this.#db.marketplaces.get(input.marketplaceId))) {
      await this.#db.marketplaces.upsert({
        displayName: input.marketplaceId,
        id: input.marketplaceId,
        isBuiltin: false,
        localPath: input.installPath ? dirname(input.installPath) : "",
        ownerAgentId: this.#ownerOf(input.marketplaceId),
        refName: null,
        source: input.marketplaceId,
        sparsePaths: null,
      })
    }
    const formats: PluginFormat[] = input.installPath
      ? await detectPluginFormats(input.installPath)
      : []
    // Every Cline Official entry is a Cline plugin, with or without a package manifest.
    if (input.marketplaceId === "cline-official" && !formats.includes("cline"))
      formats.push("cline")
    const metadata = input.installPath
      ? await readPluginMetadata(input.installPath)
      : { description: null, displayName: null, name: null, version: null }
    return this.#db.plugins.upsert({
      description: input.description ?? metadata.description,
      detectedFormats: formats,
      displayName: input.displayName ?? metadata.displayName ?? input.pluginName,
      id: pluginIdOf(input.pluginName, input.marketplaceId),
      installPath: input.installPath,
      installSourceType: input.sourceType,
      installSourceUrl: input.sourceUrl,
      marketplaceId: input.marketplaceId,
      pluginName: input.pluginName,
      version: input.version ?? metadata.version,
    })
  }

  #ownerOf(marketplaceId: string): string | null {
    if (marketplaceId.startsWith("openai-")) return "codex"
    return null
  }

  // ---------------------------------------------------------------------------------------------
  // Enablement

  /**
   * Enables or disables a plugin in one Agent. A catalog or package Agent installs it natively
   * first when needed; an Agent that reads none of the plugin's formats does not support it.
   */
  async setEnabled(input: {
    acceptCommandSha256?: string
    agentId: AgentId
    enabled: boolean
    marketplaceName: string
    pluginName: string
    scope?: PluginScope
  }): Promise<PluginAgentResult> {
    await this.ensureBuiltins()
    const provider = this.#providers.get(input.agentId)
    if (provider && !provider.enabled) {
      const error = new Error(`Plugins are turned off for ${input.agentId}`)
      error.name = "INTEGRATION_DISABLED"
      throw error
    }
    const pluginId = pluginIdOf(input.pluginName, input.marketplaceName)
    const found = provider
      ? find(
          await provider.list({}).catch(() => undefined),
          input.marketplaceName,
          input.pluginName
        )
      : undefined
    if (provider && found) {
      if (input.enabled) {
        const result = await this.#installOne(provider, found, {
          acceptCommandSha256: input.acceptCommandSha256,
          scope: input.scope,
        })
        if (result.status === "failed") throw new Error(result.message)
        const record = await this.#recordPlugin(input.marketplaceName, input.pluginName).catch(
          () => undefined
        )
        if (record) await this.#bindNative(record.id, input.agentId, result.status === "done", null)
        return result
      }
      if (found.plugin.installed && found.plugin.enabled) {
        await provider.setEnabled({ enabled: false, id: found.plugin.id, scope: input.scope })
      }
      if (await this.#db.plugins.get(pluginId))
        await this.#bindNative(pluginId, input.agentId, false, null)
      return { agentId: input.agentId, appsNeedingAuth: [], reloadPending: false, status: "done" }
    }

    const record = await this.#db.plugins.get(pluginId)
    if (!record) {
      throw new Error(`Install ${input.pluginName} before turning it on for ${input.agentId}`)
    }
    const packages = await this.#packageFor(input.agentId, record)
    if (packages) {
      const binding = await this.#db.bindings.get(pluginId, input.agentId)
      // An Agent whose enable installs the plugin again does so like a first install: from the
      // current revision, and after the user confirms a command that runs package code.
      if (input.enabled && (!binding?.nativeInstallReceipt || packages.enableInstalls)) {
        const result = await this.#installPackage(packages, record, input.acceptCommandSha256)
        if (result.status === "failed") throw new Error(result.message)
        if (result.status === "done") await this.#pruneRevisions(pluginId)
        return result
      }
      await packages.setEnabled(
        await this.#packagePlugin(record),
        binding?.nativeInstallReceipt ?? null,
        input.enabled
      )
      await this.#bindNative(
        pluginId,
        input.agentId,
        input.enabled,
        binding?.nativeInstallReceipt ?? null
      )
      return { agentId: input.agentId, appsNeedingAuth: [], reloadPending: true, status: "done" }
    }
    throw unsupported(`${input.agentId} does not read any of ${record.displayName}'s formats`)
  }

  // ---------------------------------------------------------------------------------------------
  // Uninstall

  async uninstall(input: {
    keepData?: boolean
    marketplaceName: string
    pluginName: string
  }): Promise<AgentId[]> {
    const catalogs = await this.#catalogs()
    const removed: AgentId[] = []
    const failures: string[] = []
    for (const provider of this.#active()) {
      const found = find(catalogs.get(provider.agentId), input.marketplaceName, input.pluginName)
      if (!found?.plugin.installed) continue
      try {
        await this.#uninstallOne(provider, found.plugin, input.keepData)
        removed.push(provider.agentId)
      } catch (error) {
        failures.push(`${provider.agentId}: ${messageOf(error)}`)
      }
    }
    const pluginId = pluginIdOf(input.pluginName, input.marketplaceName)
    const record = await this.#db.plugins.get(pluginId)
    if (record) {
      for (const binding of await this.#db.bindings.list({ pluginId })) {
        const agentId = binding.agentId as AgentId
        try {
          if (!this.#providers.has(agentId)) {
            const provider = this.#packages.get(agentId)
            if (provider && binding.nativeInstallReceipt) {
              await provider.uninstall(
                await this.#packagePlugin(record),
                binding.nativeInstallReceipt
              )
              removed.push(agentId)
            }
          }
        } catch (error) {
          failures.push(`${agentId}: ${messageOf(error)}`)
        }
      }
      if (failures.length) throw new Error(failures.join("\n"))
      await this.#db.plugins.remove(pluginId)
      await this.#store.removeSnapshots(pluginId, new Set())
      if (
        record.installPath &&
        this.#store.owns(record.installPath) &&
        (record.marketplaceId === STANDALONE_MARKETPLACE ||
          isInside(join(this.#store.root, ".sources"), record.installPath))
      ) {
        await this.#store.remove(record.installPath)
      }
      await this.#audit({ eventType: "plugin.uninstalled", summary: pluginId })
    }
    if (failures.length) throw new Error(failures.join("\n"))
    return [...new Set(removed)]
  }

  async #uninstallOne(
    provider: PluginProvider,
    plugin: PluginView,
    keepData?: boolean
  ): Promise<void> {
    const scopes: (PluginScope | undefined)[] = plugin.installedScopes.length
      ? plugin.installedScopes
      : [undefined]
    for (const scope of scopes) {
      await provider.uninstall({ id: plugin.id, keepData, scope })
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Marketplaces

  /**
   * Adds a marketplace: Cypheria fetches the source into `$CYPHERIA_HOME/marketplaces/<name>/`
   * (a local directory is referenced in place) and registers that directory with every catalog
   * Agent whose marketplace file it ships. A failed check removes what this call created.
   */
  async addMarketplace(rawInput: {
    refName?: string
    source: string
    sparsePaths?: string[]
  }): Promise<{
    agents: { added: boolean; agentId: AgentId; message: string | null }[]
    marketplaceName: string | null
  }> {
    await this.ensureBuiltins()
    const input = await normalizeMarketplaceInput(rawInput)
    const staged = await this.#store.stage(input)
    let localPath = staged.path
    let committed = false
    const created: { agentId: AgentId; name: string }[] = []
    try {
      const catalog = await readMarketplaceCatalog(staged.path)
      if (!catalog.files.length) {
        throw invalid(
          "The source has no .agents/plugins/marketplace.json or .claude-plugin/marketplace.json"
        )
      }
      const name = catalog.name
      if (!name) throw invalid("The marketplace file has no name")
      assertMarketplaceName(name)
      if (name.startsWith("cypheria-") || CYPHERIA_ONLY.has(name) || AGENT_CATALOG_IDS.has(name)) {
        throw invalid(`${name} is a reserved marketplace name. Rename the marketplace in its file.`)
      }
      const recorded = await this.#db.marketplaces.get(name)
      if (recorded && (recorded.isBuiltin || !sameMarketplaceSource(recorded, input))) {
        throw invalid(
          `A marketplace named ${name} was already added from ${recorded.source}. Remove it before adding another source with that name.`
        )
      }
      if (staged.staged) {
        localPath = await this.#store.commit(staged.path, name)
        committed = true
      }

      const before = await this.#catalogs()
      const outcomes = await Promise.all(
        this.#active().map(async (provider) => {
          try {
            const { marketplaceName } = await provider.addMarketplace({ source: localPath })
            const state = marketplaceName
              ? await provider.marketplaceState(marketplaceName)
              : "missing"
            if (
              marketplaceName &&
              !before
                .get(provider.agentId)
                ?.marketplaces.some((entry) => entry.name === marketplaceName)
            ) {
              created.push({ agentId: provider.agentId, name: marketplaceName })
            }
            if (marketplaceName !== name || state !== "ok") {
              return {
                added: false,
                agentId: provider.agentId,
                message:
                  marketplaceName && marketplaceName !== name
                    ? `It read the marketplace as ${marketplaceName}, not ${name}`
                    : "The marketplace was registered but its file could not be read",
              }
            }
            return { added: true, agentId: provider.agentId, message: null }
          } catch (error) {
            return { added: false, agentId: provider.agentId, message: messageOf(error) }
          }
        })
      )
      const mismatched = outcomes.find((outcome) =>
        outcome.message?.startsWith("It read the marketplace as")
      )
      if (mismatched) {
        throw invalid(
          `The marketplace files use different names (${mismatched.agentId}: ${mismatched.message}). Give every marketplace file the same name.`
        )
      }
      await this.#db.marketplaces.upsert({
        displayName: name,
        id: name,
        isBuiltin: false,
        localPath,
        ownerAgentId: null,
        refName: input.refName ?? null,
        source: input.source,
        sparsePaths: input.sparsePaths ?? null,
      })
      await this.#audit({
        eventType: "plugin.marketplace.added",
        summary: `${name} from ${input.source}`,
      })
      return { agents: outcomes, marketplaceName: name }
    } catch (error) {
      for (const entry of created) {
        await this.provider(entry.agentId)
          .removeMarketplace({ confirmUninstall: true, name: entry.name })
          .catch(() => undefined)
      }
      if (committed) await this.#store.remove(localPath)
      else await this.#store.discard(staged)
      throw error
    }
  }

  /**
   * Refreshes a marketplace (or all of them): Cypheria-owned directories are updated from their
   * source, each Agent re-reads them, Agents that gained or lost the marketplace file are
   * registered or removed, and plugins that left an Agent's file are uninstalled there.
   */
  #updating: Promise<unknown> = Promise.resolve()
  #timers: NodeJS.Timeout[] = []
  /** Catalog Agents whose installed plugins wait for an update until they are idle. */
  readonly #catalogUpdates = new Set<AgentId>()

  /** Runs refreshes and updates one at a time, whether the user or the schedule starts them. */
  #serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#updating.then(task, task)
    this.#updating = run.catch(() => undefined)
    return run
  }

  /**
   * Refreshes every marketplace `firstRefreshMs` after it is called and then every `refreshMs`,
   * and applies waiting plugin updates to idle Agents every `applyMs`.
   */
  startAutoUpdate(options: { applyMs: number; firstRefreshMs: number; refreshMs: number }): void {
    if (this.#timers.length) return
    const refresh = () => {
      void this.upgradeMarketplace().catch(() => undefined)
    }
    const first = setTimeout(() => {
      refresh()
      const every = setInterval(refresh, options.refreshMs)
      every.unref()
      this.#timers.push(every)
    }, options.firstRefreshMs)
    first.unref()
    const apply = setInterval(() => {
      void this.#serial(() => this.#applyUpdates()).catch(() => undefined)
    }, options.applyMs)
    apply.unref()
    this.#timers.push(first, apply)
  }

  stopAutoUpdate(): void {
    for (const timer of this.#timers) clearTimeout(timer)
    this.#timers = []
  }

  /**
   * Refreshes marketplace catalogs and plugin sources, then applies plugin updates to the Agents
   * that have no running session; the others receive them once they are idle.
   */
  upgradeMarketplace(name?: string): Promise<{
    added: { agentId: AgentId; marketplaceName: string }[]
    errors: { agentId: AgentId; message: string }[]
    removed: { agentId: AgentId; marketplaceName: string }[]
  }> {
    return this.#serial(() => this.#upgrade(name))
  }

  async #upgrade(name?: string): Promise<{
    added: { agentId: AgentId; marketplaceName: string }[]
    errors: { agentId: AgentId; message: string }[]
    removed: { agentId: AgentId; marketplaceName: string }[]
  }> {
    await this.ensureBuiltins()
    const before = await this.#catalogs()
    const errors: { agentId: AgentId; message: string }[] = []
    const added: { agentId: AgentId; marketplaceName: string }[] = []
    const removed: { agentId: AgentId; marketplaceName: string }[] = []
    const records = (await this.#db.marketplaces.list()).filter(
      (record) =>
        (name === undefined || record.id === name) &&
        !record.ownerAgentId &&
        (!record.isBuiltin || AGENT_CATALOG_IDS.has(record.id))
    )
    for (const record of records) {
      try {
        await this.#store.refresh(record)
      } catch (error) {
        errors.push({ agentId: "codex", message: `${record.id}: ${messageOf(error)}` })
      }
    }

    for (const provider of this.#active()) {
      const registered = before
        .get(provider.agentId)
        ?.marketplaces.some((marketplace) => marketplace.name === name)
      if (name !== undefined && !registered) continue
      try {
        await provider.upgradeMarketplace(name)
      } catch (error) {
        errors.push({ agentId: provider.agentId, message: messageOf(error) })
      }
    }

    for (const record of records) {
      if (UNREGISTERED_CATALOG_IDS.has(record.id)) continue
      for (const provider of this.#active()) {
        try {
          const state = await provider.marketplaceState(record.id)
          if (state === "ok") continue
          if (state === "unsupported") {
            await this.#removeFromAgent(provider, record.id, before.get(provider.agentId))
            removed.push({ agentId: provider.agentId, marketplaceName: record.id })
            continue
          }
          const result = await provider.addMarketplace({ source: record.localPath })
          if (result.marketplaceName !== record.id) {
            if (result.marketplaceName) {
              await provider
                .removeMarketplace({ confirmUninstall: true, name: result.marketplaceName })
                .catch(() => undefined)
            }
            errors.push({
              agentId: provider.agentId,
              message: `Its marketplace file is named ${result.marketplaceName ?? "differently"}, not ${record.id}`,
            })
            continue
          }
          added.push({ agentId: provider.agentId, marketplaceName: record.id })
        } catch {
          // The marketplace does not ship this Agent's file: it is not offered here.
        }
      }
    }

    const after = await this.#catalogs()
    for (const provider of this.#active()) {
      const previous = before.get(provider.agentId)
      const current = after.get(provider.agentId)
      if (!previous || !current) continue
      for (const marketplace of previous.marketplaces) {
        if (name !== undefined && marketplace.name !== name) continue
        const remaining = current.marketplaces.find((entry) => entry.name === marketplace.name)
        if (!remaining) continue
        const listed = new Set(remaining.plugins.map((plugin) => plugin.name))
        for (const plugin of marketplace.plugins) {
          if (!plugin.installed || listed.has(plugin.name)) continue
          try {
            await this.#uninstallOne(provider, plugin)
          } catch (error) {
            errors.push({ agentId: provider.agentId, message: messageOf(error) })
          }
        }
      }
    }

    // Formats, version, and description can change with an update.
    for (const record of records) {
      for (const plugin of await this.#db.plugins.list(record.id)) {
        if (!plugin.installPath || !(await exists(plugin.installPath))) continue
        const metadata = await readPluginMetadata(plugin.installPath)
        await this.#db.plugins.upsert({
          ...plugin,
          description: metadata.description ?? plugin.description,
          version: metadata.version ?? plugin.version,
          detectedFormats: [
            ...(await detectPluginFormats(plugin.installPath)),
            ...(record.id === "cline-official" ? (["cline"] as const) : []),
          ].filter((format, index, all) => all.indexOf(format) === index),
        })
      }
    }
    errors.push(...(await this.#refetchSources(name)))
    for (const provider of this.#active()) this.#catalogUpdates.add(provider.agentId)
    errors.push(...(await this.#applyUpdates()))
    return { added, errors, removed }
  }

  /**
   * Fetches again the plugins whose files live in another repository or package, the packages
   * of the Pi catalog, and standalone Git and npm packages, of `name` or of every marketplace.
   */
  async #refetchSources(name?: string): Promise<{ agentId: AgentId; message: string }[]> {
    const errors: { agentId: AgentId; message: string }[] = []
    const plugins = (await this.#db.plugins.list()).filter(
      (plugin) =>
        (name === undefined || plugin.marketplaceId === name) &&
        (plugin.installSourceType === "git" || plugin.installSourceType === "npm")
    )
    if (plugins.some((plugin) => plugin.marketplaceId === PI_PACKAGE_CATALOG)) {
      await this.#piCatalog?.list(true).catch(() => undefined)
    }
    for (const plugin of plugins) {
      try {
        if (plugin.marketplaceId === STANDALONE_MARKETPLACE) {
          const fetched = await this.#store.fetchStandalone({
            source: plugin.installSourceUrl,
            sourceType: plugin.installSourceType as "git" | "npm",
          })
          await this.#store.renameStandalone(fetched.path, plugin.pluginName)
        } else {
          await this.#recordPlugin(plugin.marketplaceId, plugin.pluginName)
        }
      } catch (error) {
        errors.push({ agentId: "codex", message: `${plugin.id}: ${messageOf(error)}` })
      }
    }
    return errors
  }

  /**
   * Applies waiting plugin updates to every Agent that has no running session, so a session
   * keeps the plugins it started with and the next one receives the update. Codex and Claude
   * update their own copies; a package Agent receives the plugin's current revision when it holds
   * an older one. An Agent whose update needs the user's review keeps its version and is told how
   * to install the new one.
   */
  async #applyUpdates(): Promise<{ agentId: AgentId; message: string }[]> {
    const errors: { agentId: AgentId; message: string }[] = []
    const busy = new Map<AgentId, boolean>()
    const isBusy = async (agentId: AgentId): Promise<boolean> => {
      if (!busy.has(agentId)) {
        busy.set(agentId, await this.#isAgentBusy(agentId).catch(() => true))
      }
      return busy.get(agentId) ?? true
    }
    for (const provider of this.#active()) {
      if (!this.#catalogUpdates.has(provider.agentId)) continue
      if (!provider.updateInstalled) {
        this.#catalogUpdates.delete(provider.agentId)
        continue
      }
      if (await isBusy(provider.agentId)) continue
      this.#catalogUpdates.delete(provider.agentId)
      try {
        for (const id of await provider.updateInstalled()) {
          await this.#audit({
            eventType: "plugin.native.updated",
            summary: `${id} for ${provider.agentId}`,
          })
        }
      } catch (error) {
        errors.push({ agentId: provider.agentId, message: messageOf(error) })
      }
    }
    for (const plugin of await this.#db.plugins.list()) {
      if (!plugin.installPath) continue
      const bindings = (await this.#db.bindings.list({ pluginId: plugin.id })).filter(
        (binding) =>
          binding.nativeInstallReceipt &&
          this.#packages.has(binding.agentId as AgentId) &&
          !this.#providers.has(binding.agentId as AgentId)
      )
      if (!bindings.length) continue
      const current = await contentFingerprint(plugin.installPath)
      if (!current) continue
      for (const binding of bindings) {
        const agentId = binding.agentId as AgentId
        const provider = this.#packages.get(agentId)
        if (!provider || binding.installedSha256 === current) continue
        // An installation from before revisions were recorded starts from the current one.
        if (binding.installedSha256 === null) {
          await this.#bindNative(
            plugin.id,
            agentId,
            binding.enabled,
            binding.nativeInstallReceipt,
            binding.statusMessage,
            current
          )
          continue
        }
        if (await isBusy(agentId)) continue
        if (!binding.enabled && provider.enableInstalls) continue
        if (!provider.update || provider.updateNeedsReview?.(await this.#packagePlugin(plugin))) {
          if (binding.enabled) {
            await this.#bindNative(
              plugin.id,
              agentId,
              true,
              binding.nativeInstallReceipt,
              "A newer version is available. Turn the plugin off and on again to review and install it."
            )
          }
          continue
        }
        try {
          const revision = await this.#revision(plugin)
          const receipt = await provider.update(
            await this.#packagePlugin(plugin, revision.path),
            binding.nativeInstallReceipt,
            binding.enabled
          )
          await this.#bindNative(
            plugin.id,
            agentId,
            binding.enabled,
            receipt,
            null,
            revision.sha256
          )
          await this.#audit({
            eventType: "plugin.native.updated",
            payloadHash: revision.sha256,
            summary: `${plugin.id} for ${agentId}`,
          })
        } catch (error) {
          await this.#bindNative(
            plugin.id,
            agentId,
            binding.enabled,
            binding.nativeInstallReceipt,
            `The update failed: ${messageOf(error)}`
          )
          errors.push({ agentId, message: `${plugin.id}: ${messageOf(error)}` })
        }
      }
      await this.#pruneRevisions(plugin.id)
    }
    return errors
  }

  async #removeFromAgent(provider: PluginProvider, name: string, catalog: Catalog): Promise<void> {
    const marketplace = catalog?.marketplaces.find((entry) => entry.name === name)
    for (const plugin of marketplace?.plugins.filter((entry) => entry.installed) ?? []) {
      await this.#uninstallOne(provider, plugin)
    }
    await provider.removeMarketplace({ confirmUninstall: true, name })
  }

  async removeMarketplace(input: {
    confirmUninstall?: boolean
    name: string
  }): Promise<
    | { succeeded: true; uninstalledPlugins: string[] }
    | { affectedPlugins: string[]; succeeded: false }
  > {
    await this.ensureBuiltins()
    const record = await this.#db.marketplaces.get(input.name)
    if (record?.isBuiltin) throw new Error("Built-in marketplaces cannot be removed")
    const catalogs = await this.#catalogs()
    const holders = this.#active().filter((provider) =>
      catalogs.get(provider.agentId)?.marketplaces.some((entry) => entry.name === input.name)
    )
    if (!holders.length && !record) throw new Error(`Marketplace ${input.name} is not configured`)
    for (const provider of holders) {
      const marketplace = catalogs
        .get(provider.agentId)
        ?.marketplaces.find((entry) => entry.name === input.name)
      if (marketplace && marketplace.sourceKind !== "custom") {
        throw new Error("Official marketplaces cannot be removed")
      }
    }
    const installed = await this.#db.plugins.list(input.name)
    const affected = [
      ...new Set([
        ...holders.flatMap((provider) =>
          (
            catalogs
              .get(provider.agentId)
              ?.marketplaces.find((entry) => entry.name === input.name)
              ?.plugins.filter((plugin) => plugin.installed) ?? []
          ).map((plugin) => plugin.id)
        ),
        ...installed.map((plugin) => plugin.id),
      ]),
    ]
    if (affected.length && !input.confirmUninstall) {
      return { affectedPlugins: affected, succeeded: false }
    }
    for (const plugin of installed) {
      await this.uninstall({ marketplaceName: input.name, pluginName: plugin.pluginName })
    }
    for (const provider of holders) {
      await this.#removeFromAgent(provider, input.name, catalogs.get(provider.agentId))
    }
    if (record) {
      await this.#db.marketplaces.remove(input.name)
      await this.#store.remove(record.localPath)
      await rm(join(this.#store.root, ".sources", input.name), { force: true, recursive: true })
    }
    await this.#audit({ eventType: "plugin.marketplace.removed", summary: input.name })
    return { succeeded: true, uninstalledPlugins: affected }
  }
}
