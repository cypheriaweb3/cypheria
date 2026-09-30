import type {
  AgentId,
  MarketplaceView,
  PluginAgentResult,
  PluginAgentState,
  PluginScope,
  PluginView,
} from "@cypheria/protocol"

import {
  assertMarketplaceName,
  normalizeMarketplaceInput,
  sameMarketplaceSource,
} from "./marketplace-source.js"
import type { PluginListValue, PluginProvider } from "./plugin-provider.js"

export type PluginMarketplaceRecord = {
  name: string
  refName?: string | null
  source: string
  sparsePaths?: readonly string[] | null
}

/** Remembers the source a marketplace was added from so it can be replayed for another Agent. */
export interface PluginMarketplaceRegistry {
  list(): Promise<PluginMarketplaceRecord[]>
  remove(name: string): Promise<unknown>
  upsert(record: PluginMarketplaceRecord): Promise<unknown>
}

export class InMemoryPluginMarketplaceRegistry implements PluginMarketplaceRegistry {
  readonly #records = new Map<string, PluginMarketplaceRecord>()

  async list(): Promise<PluginMarketplaceRecord[]> {
    return [...this.#records.values()]
  }
  async remove(name: string): Promise<boolean> {
    return this.#records.delete(name)
  }
  async upsert(record: PluginMarketplaceRecord): Promise<void> {
    this.#records.set(record.name, record)
  }
}

type Catalog = PluginListValue | undefined
type Found = { marketplace: MarketplaceView; plugin: PluginView }

const invalid = (message: string): Error => {
  const error = new Error(message)
  error.name = "INTEGRATION_INVALID"
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

/**
 * Presents one plugin identity (marketplace name plus plugin name) across
 * Agents. A marketplace is offered to every Agent whose marketplace file it
 * ships, a plugin is installed and enabled for every Agent that lists it, and
 * each Agent can then enable or disable it on its own.
 */
export class PluginHub {
  readonly #providers: ReadonlyMap<AgentId, PluginProvider>
  readonly #registry: PluginMarketplaceRegistry

  constructor(
    providers: ReadonlyMap<AgentId, PluginProvider>,
    registry: PluginMarketplaceRegistry
  ) {
    this.#providers = providers
    this.#registry = registry
  }

  /** Agents that have plugins turned on; the others take no part in cross-Agent operations. */
  #active(): PluginProvider[] {
    return [...this.#providers.values()].filter((provider) => provider.enabled)
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

  async #catalogs(): Promise<Map<AgentId, Catalog>> {
    const entries = await Promise.all(
      this.#active().map(
        async (provider) =>
          [provider.agentId, await provider.list({}).catch(() => undefined)] as const
      )
    )
    return new Map(entries)
  }

  /** Where one plugin is offered, installed and enabled, per Agent. */
  async agents(locator: {
    marketplaceName: string
    pluginName: string
  }): Promise<PluginAgentState[]> {
    const catalogs = await this.#catalogs()
    const states: PluginAgentState[] = []
    for (const provider of this.#active()) {
      const found = find(
        catalogs.get(provider.agentId),
        locator.marketplaceName,
        locator.pluginName
      )
      if (!found) continue
      states.push({
        agentId: provider.agentId,
        enabled: found.plugin.installed && found.plugin.enabled,
        id: found.plugin.id,
        installed: found.plugin.installed,
        installedScopes: found.plugin.installedScopes,
        marketplacePath: found.plugin.marketplacePath,
      })
    }
    return states
  }

  async install(input: {
    acceptCommands?: Record<string, string>
    agentIds?: AgentId[]
    marketplaceName: string
    pluginName: string
    scope?: PluginScope
  }): Promise<PluginAgentResult[]> {
    const catalogs = await this.#catalogs()
    const results = await Promise.all(
      this.#active()
        .filter((provider) => !input.agentIds || input.agentIds.includes(provider.agentId))
        .map(async (provider) => {
          const found = find(
            catalogs.get(provider.agentId),
            input.marketplaceName,
            input.pluginName
          )
          return found
            ? this.#installOne(provider, found, {
                acceptCommandSha256: input.acceptCommands?.[provider.agentId],
                scope: input.scope,
              })
            : undefined
        })
    )
    const offered = results.filter((result) => result !== undefined)
    if (!offered.length) {
      throw new Error(`${input.pluginName} is not listed in ${input.marketplaceName} for any Agent`)
    }
    return offered
  }

  /** Enables the plugin in `provider`, installing it there first when needed. */
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

  /** Enables or disables a plugin in one Agent; enabling installs it there first if needed. */
  async setEnabled(input: {
    acceptCommandSha256?: string
    agentId: AgentId
    enabled: boolean
    marketplaceName: string
    pluginName: string
    scope?: PluginScope
  }): Promise<PluginAgentResult> {
    const provider = this.provider(input.agentId)
    if (!provider.enabled) {
      const error = new Error(`Plugins are turned off for ${input.agentId}`)
      error.name = "INTEGRATION_DISABLED"
      throw error
    }
    const found = find(
      await provider.list({}).catch(() => undefined),
      input.marketplaceName,
      input.pluginName
    )
    if (!found) {
      throw new Error(
        `${input.pluginName} is not listed in ${input.marketplaceName} for ${input.agentId}`
      )
    }
    if (input.enabled) {
      const result = await this.#installOne(provider, found, {
        acceptCommandSha256: input.acceptCommandSha256,
        scope: input.scope,
      })
      if (result.status === "failed") throw new Error(result.message)
      return result
    }
    if (found.plugin.installed && found.plugin.enabled) {
      await provider.setEnabled({ enabled: false, id: found.plugin.id, scope: input.scope })
    }
    return { agentId: input.agentId, appsNeedingAuth: [], reloadPending: false, status: "done" }
  }

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
    if (failures.length) throw new Error(failures.join("\n"))
    return removed
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

  /**
   * Adds a marketplace for every Agent that can read it. Everything the
   * Agents accepted is checked together: each registration must be readable,
   * the names must agree across Agents and be ones a source may take, and a
   * name already added from a different source is refused. A failed check
   * removes the registrations this call created.
   */
  async addMarketplace(rawInput: {
    refName?: string
    source: string
    sparsePaths?: string[]
  }): Promise<{
    agents: { added: boolean; agentId: AgentId; message: string | null }[]
    marketplaceName: string | null
  }> {
    const input = await normalizeMarketplaceInput(rawInput)
    const active = this.#active()
    const before = await this.#catalogs()
    const registeredBefore = (agentId: AgentId, name: string): boolean =>
      before.get(agentId)?.marketplaces.some((entry) => entry.name === name) ?? false

    const outcomes = await Promise.all(
      active.map(async (provider) => {
        try {
          const { marketplaceName } = await provider.addMarketplace(input)
          const state = marketplaceName
            ? await provider.marketplaceState(marketplaceName)
            : "missing"
          if (!marketplaceName || state !== "ok") {
            return {
              added: false,
              agentId: provider.agentId,
              marketplaceName,
              message: "The marketplace was registered but its file could not be read",
            }
          }
          return { added: true, agentId: provider.agentId, marketplaceName, message: null }
        } catch (error) {
          return {
            added: false,
            agentId: provider.agentId,
            marketplaceName: null as string | null,
            message: messageOf(error),
          }
        }
      })
    )
    const accepted = outcomes.filter((outcome) => outcome.added)
    const rollback = async (): Promise<void> => {
      for (const outcome of accepted) {
        const name = outcome.marketplaceName
        if (!name || registeredBefore(outcome.agentId, name)) continue
        await this.provider(outcome.agentId)
          .removeMarketplace({ confirmUninstall: true, name })
          .catch(() => undefined)
      }
    }
    if (!accepted.length) {
      throw invalid(outcomes.map((outcome) => `${outcome.agentId}: ${outcome.message}`).join("\n"))
    }

    const names = [...new Set(accepted.flatMap((outcome) => outcome.marketplaceName ?? []))]
    try {
      if (names.length > 1) {
        const detail = accepted.map((outcome) => `${outcome.agentId}: ${outcome.marketplaceName}`)
        throw invalid(
          `The marketplace files use different names (${detail.join(", ")}). Give every marketplace file the same name.`
        )
      }
      const [name] = names
      if (name) {
        assertMarketplaceName(name)
        const recorded = (await this.#registry.list()).find((record) => record.name === name)
        if (recorded && !sameMarketplaceSource(recorded, input)) {
          throw invalid(
            `A marketplace named ${name} was already added from ${recorded.source}. Remove it before adding another source with that name.`
          )
        }
      }
    } catch (error) {
      await rollback()
      throw error
    }

    const [name] = names
    const createdHere = accepted.some(
      (outcome) =>
        outcome.marketplaceName && !registeredBefore(outcome.agentId, outcome.marketplaceName)
    )
    const known = (await this.#registry.list()).some((record) => record.name === name)
    // Only remember a source this call registered (or one already remembered): a
    // marketplace that was already present came from somewhere Cypheria cannot vouch for.
    if (name && (createdHere || known)) {
      await this.#registry.upsert({
        name,
        refName: input.refName,
        source: input.source,
        sparsePaths: input.sparsePaths,
      })
    }
    return {
      agents: outcomes.map(({ added, agentId, message }) => ({ added, agentId, message })),
      marketplaceName: name ?? null,
    }
  }

  /**
   * Refreshes a marketplace (or all of them), then makes each Agent's
   * registration match what the marketplace now ships: an Agent that gained a
   * marketplace file gets it, one that lost it is removed with its plugins,
   * and plugins that left an Agent's marketplace file are uninstalled there.
   */
  async upgradeMarketplace(name?: string): Promise<{
    added: { agentId: AgentId; marketplaceName: string }[]
    errors: { agentId: AgentId; message: string }[]
    removed: { agentId: AgentId; marketplaceName: string }[]
  }> {
    const before = await this.#catalogs()
    const errors: { agentId: AgentId; message: string }[] = []
    const added: { agentId: AgentId; marketplaceName: string }[] = []
    const removed: { agentId: AgentId; marketplaceName: string }[] = []

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

    const records = (await this.#registry.list()).filter(
      (record) => name === undefined || record.name === name
    )
    for (const record of records) {
      for (const provider of this.#active()) {
        try {
          const state = await provider.marketplaceState(record.name)
          if (state === "ok") continue
          if (state === "unsupported") {
            await this.#removeFromAgent(provider, record.name, before.get(provider.agentId))
            removed.push({ agentId: provider.agentId, marketplaceName: record.name })
            continue
          }
          const result = await provider.addMarketplace({
            refName: record.refName ?? undefined,
            source: record.source,
            sparsePaths: record.sparsePaths ? [...record.sparsePaths] : undefined,
          })
          if (result.marketplaceName !== record.name) {
            // The marketplace file now names itself differently: undo the registration.
            if (result.marketplaceName) {
              await provider
                .removeMarketplace({ confirmUninstall: true, name: result.marketplaceName })
                .catch(() => undefined)
            }
            errors.push({
              agentId: provider.agentId,
              message: `Its marketplace file is named ${result.marketplaceName ?? "differently"}, not ${record.name}`,
            })
            continue
          }
          added.push({ agentId: provider.agentId, marketplaceName: record.name })
        } catch {
          // The marketplace does not ship this Agent's file (or the source is unreachable): not offered here.
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
    return { added, errors, removed }
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
    const catalogs = await this.#catalogs()
    const holders = this.#active().filter((provider) =>
      catalogs.get(provider.agentId)?.marketplaces.some((entry) => entry.name === input.name)
    )
    if (!holders.length) throw new Error(`Marketplace ${input.name} is not configured`)
    for (const provider of holders) {
      const marketplace = catalogs
        .get(provider.agentId)
        ?.marketplaces.find((entry) => entry.name === input.name)
      if (marketplace && marketplace.sourceKind !== "custom") {
        throw new Error("Official marketplaces cannot be removed")
      }
    }
    const affected = [
      ...new Set(
        holders.flatMap((provider) =>
          (
            catalogs
              .get(provider.agentId)
              ?.marketplaces.find((entry) => entry.name === input.name)
              ?.plugins.filter((plugin) => plugin.installed) ?? []
          ).map((plugin) => plugin.id)
        )
      ),
    ]
    if (affected.length && !input.confirmUninstall) {
      return { affectedPlugins: affected, succeeded: false }
    }
    for (const provider of holders) {
      await this.#removeFromAgent(provider, input.name, catalogs.get(provider.agentId))
    }
    await this.#registry.remove(input.name)
    return { succeeded: true, uninstalledPlugins: affected }
  }
}
