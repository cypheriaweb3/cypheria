import type {
  AgentId,
  MarketplaceView,
  PluginCapabilities,
  PluginCommandConfirmation,
  PluginConfigOption,
  PluginDetailView,
  PluginScope,
} from "@cypheria/protocol"

export type PluginLocator = {
  marketplaceName: string
  marketplacePath: string | null
  pluginName: string
  scope?: PluginScope
}

export type PluginListValue = {
  capabilities: PluginCapabilities
  errors: { message: string; path: string }[]
  marketplaces: MarketplaceView[]
}

export type PluginInstallValue =
  | { appsNeedingAuth: string[]; installed: true; reloadPending: boolean }
  | { confirmation: PluginCommandConfirmation; installed: false }

export type MarketplaceRemoveValue =
  | { succeeded: true; uninstalledPlugins: string[] }
  | { affectedPlugins: string[]; succeeded: false }

/**
 * `missing`: the Agent has no working registration of the marketplace.
 * `unsupported`: it is registered but the marketplace no longer ships this Agent's marketplace file.
 */
export type MarketplaceState = "missing" | "ok" | "unsupported"

export type PluginConfigValue = { options: PluginConfigOption[] }
export type PluginConfigWriteValue = { saved: string[]; unconfigured: string[] }

/**
 * One Agent's plugin ecosystem. Mutations always execute through the owning
 * harness; the Server never converts a plugin from one ecosystem to another.
 */
export interface PluginProvider {
  readonly agentId: AgentId
  readonly capabilities: PluginCapabilities
  /** False when the user turned plugins off for this Agent; the hub then leaves it out of every operation. */
  readonly enabled: boolean
  /** Installs or updates the bundled `cypheria-app-tools` plugin, when plugins are on. */
  ensureBundledPlugin?(): Promise<void>
  addMarketplace(input: {
    refName?: string
    source: string
    sparsePaths?: string[]
  }): Promise<{ marketplaceName: string | null }>
  install(locator: PluginLocator & { acceptCommandSha256?: string }): Promise<PluginInstallValue>
  list(input: { cwd?: string; forceRefresh?: boolean }): Promise<PluginListValue>
  marketplaceState(name: string): Promise<MarketplaceState>
  read(locator: PluginLocator): Promise<PluginDetailView>
  readConfig?(id: string): Promise<PluginConfigValue>
  removeMarketplace(input: {
    confirmUninstall?: boolean
    name: string
  }): Promise<MarketplaceRemoveValue>
  setEnabled(input: { enabled: boolean; id: string; scope?: PluginScope }): Promise<void>
  setGlobalEnabled(enabled: boolean): Promise<void>
  uninstall(input: { id: string; keepData?: boolean; scope?: PluginScope }): Promise<void>
  upgradeMarketplace(name?: string): Promise<void>
  writeConfig?(id: string, values: Record<string, string>): Promise<PluginConfigWriteValue>
}
