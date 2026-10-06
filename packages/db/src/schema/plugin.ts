import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"

/** Package formats Server detects in a plugin directory; see Polyglot Plugins. */
export const PLUGIN_FORMATS = [
  "agent_plugin",
  "codex",
  "claude",
  "cline",
  "copilot",
  "cursor",
  "devin",
  "goose",
  "gemini",
  "grok",
  "pi",
] as const
export type PluginFormat = (typeof PLUGIN_FORMATS)[number]

/**
 * Where an installed plugin's files came from: `local` inside its marketplace or a local
 * directory, `git` from another repository, `npm` from a package, `agent_cache` from the copy
 * Codex or Claude installed from a catalog Cypheria cannot read, or `remote` when Server holds
 * no files because only Codex or Claude fetched them and kept no copy it can find.
 */
export const PLUGIN_INSTALL_SOURCE_TYPES = ["local", "git", "npm", "agent_cache", "remote"] as const
export type PluginInstallSourceType = (typeof PLUGIN_INSTALL_SOURCE_TYPES)[number]

/** What an Agent's own installation reported, used to switch and remove it later. */
export type PluginNativeInstallReceipt = {
  /** The command Server ran, kept for display and audit. */
  command?: string
  /**
   * The Agent's identifier for the installation: a name such as `review@team`, a path such as
   * Cline's install directory or Goose's link, or a Pi source.
   */
  nativeId?: string
}

/**
 * Registered marketplaces: the predefined catalogs, the user's custom marketplaces, and the
 * system `standalone-plugins` marketplace; see Plugin Marketplaces.
 */
export const pluginMarketplaces = sqliteTable("plugin_marketplaces", {
  /** The marketplace name its marketplace files use, such as `cypheria-bundled`. */
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  /**
   * Where the marketplace comes from: GitHub shorthand, a Git URL, an absolute local path, or a
   * hosted marketplace file URL. Built-in records use their own forms, such as
   * `bundled://plugins`, `virtual://standalone`, or `npm:keywords:pi-package`.
   */
  source: text("source").notNull(),
  /** Git ref to check out, when the source is a Git repository. */
  refName: text("ref_name"),
  /** Paths of a sparse Git checkout, when only part of the repository is fetched. */
  sparsePaths: text("sparse_paths", { mode: "json" }).$type<string[]>(),
  /** The Agent that fetches and refreshes the marketplace itself; Cypheria never writes it. */
  ownerAgentId: text("owner_agent_id"),
  /**
   * The directory holding the marketplace files: under `$CYPHERIA_HOME/marketplaces/`, inside the
   * owning Agent's home, or a local directory the user named.
   */
  localPath: text("local_path").notNull(),
  /** Recorded by Server at start and not removable by the user. */
  isBuiltin: integer("is_builtin", { mode: "boolean" }).notNull().default(false),
  /** ISO 8601 time the record was created. */
  createdAt: text("created_at").notNull(),
  /** ISO 8601 time the record last changed; refreshing the marketplace files does not change it. */
  updatedAt: text("updated_at").notNull(),
})

/** Plugins installed from any registered marketplace, identified as `<pluginName>@<marketplaceId>`. */
export const installedPlugins = sqliteTable("installed_plugins", {
  /** `<pluginName>@<marketplaceId>`. */
  id: text("id").primaryKey(),
  marketplaceId: text("marketplace_id")
    .notNull()
    .references(() => pluginMarketplaces.id, { onDelete: "cascade" }),
  /** The plugin's name in its marketplace. */
  pluginName: text("plugin_name").notNull(),
  displayName: text("display_name").notNull(),
  /** Version from the plugin's manifest or catalog entry, when it declares one. */
  version: text("version"),
  description: text("description"),
  installSourceType: text("install_source_type", { enum: PLUGIN_INSTALL_SOURCE_TYPES }).notNull(),
  /**
   * The source as the catalog or user gave it: a path relative to the marketplace such as
   * `./review`, a Git URL, an npm package name, or the standalone source.
   */
  installSourceUrl: text("install_source_url").notNull(),
  /**
   * The directory holding the plugin files, which revisions are copied from: inside its
   * marketplace, under `$CYPHERIA_HOME/marketplaces/.sources/` or `standalone-plugins/`, in Codex's
   * or Claude's cache, or a local directory. Null when `installSourceType` is `remote`.
   */
  installPath: text("install_path"),
  /** The formats found in `installPath` when the plugin was recorded or last refreshed. */
  detectedFormats: text("detected_formats", { mode: "json" }).$type<PluginFormat[]>().notNull(),
  /** ISO 8601 time the plugin was first recorded. */
  createdAt: text("created_at").notNull(),
  /** ISO 8601 time the record last changed. */
  updatedAt: text("updated_at").notNull(),
})

/**
 * Each Agent's native installation and enablement of an installed plugin. An Agent that does not
 * support the plugin has no row.
 */
export const pluginAgentBindings = sqliteTable(
  "plugin_agent_bindings",
  {
    pluginId: text("plugin_id")
      .notNull()
      .references(() => installedPlugins.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    /** Whether the plugin is on for the Agent. */
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    /**
     * What a package Agent's installation reported; null for Codex and Claude, which report their
     * installations themselves, and before a package Agent installed the plugin.
     */
    nativeInstallReceipt: text("native_install_receipt", {
      mode: "json",
    }).$type<PluginNativeInstallReceipt>(),
    /**
     * SHA-256 of the plugin files a package Agent holds, compared with the current files to find
     * updates; null for Codex and Claude, and for an installation from before it was recorded.
     */
    installedSha256: text("installed_sha256"),
    /** Why the Agent's copy needs attention, such as a failed or reviewed update; shown to the user. */
    statusMessage: text("status_message"),
    /** ISO 8601 time the row last changed. */
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.pluginId, table.agentId] })]
)
