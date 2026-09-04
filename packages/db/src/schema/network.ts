import type {
  NativeCurrency,
  NetworkCredentialRef,
  NetworkExplorer,
  NetworkId,
  NetworkVerification,
  RpcEndpointId,
} from "@cypheria/network-core"
import { sql } from "drizzle-orm"
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { dappOrigins } from "./browser.js"

export const networks = sqliteTable(
  "networks",
  {
    id: text("id").$type<NetworkId>().primaryKey(),
    namespace: text("namespace", { enum: ["eip155", "solana"] }).notNull(),
    reference: text("reference").notNull(),
    name: text("name").notNull(),
    nativeCurrency: text("native_currency", { mode: "json" }).$type<NativeCurrency>().notNull(),
    explorers: text("explorers", { mode: "json" }).$type<NetworkExplorer[]>().notNull(),
    verification: text("verification", { mode: "json" }).$type<NetworkVerification>().notNull(),
    testnet: integer("testnet", { mode: "boolean" }).notNull(),
    source: text("source", { enum: ["builtin", "custom"] }).notNull(),
    catalogKey: text("catalog_key"),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    deprecated: integer("deprecated", { mode: "boolean" }).notNull().default(false),
    position: integer("position").notNull(),
    revision: integer("revision").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("networks_chain_unique").on(table.namespace, table.reference),
    uniqueIndex("networks_catalog_key_unique").on(table.catalogKey),
    index("networks_position_idx").on(table.position),
    index("networks_enabled_idx").on(table.enabled),
    check("networks_position_check", sql`${table.position} >= 0`),
    check("networks_revision_check", sql`${table.revision} > 0`),
    check("networks_enabled_check", sql`${table.enabled} IN (0, 1)`),
    check("networks_deprecated_check", sql`${table.deprecated} IN (0, 1)`),
    check("networks_namespace_check", sql`${table.namespace} IN ('eip155', 'solana')`),
    check("networks_source_check", sql`${table.source} IN ('builtin', 'custom')`),
    check(
      "networks_catalog_ownership_check",
      sql`((${table.source} = 'builtin' AND ${table.catalogKey} IS NOT NULL) OR (${table.source} = 'custom' AND ${table.catalogKey} IS NULL))`
    ),
  ]
)

export const networkRpcEndpoints = sqliteTable(
  "network_rpc_endpoints",
  {
    id: text("id").$type<RpcEndpointId>().primaryKey(),
    networkId: text("network_id")
      .$type<NetworkId>()
      .notNull()
      .references(() => networks.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    transport: text("transport", { enum: ["http", "websocket"] }).notNull(),
    connectionKind: text("connection_kind", { enum: ["public", "protected"] }).notNull(),
    url: text("url"),
    displayUrl: text("display_url"),
    credentialRef: text("credential_ref").$type<NetworkCredentialRef>(),
    source: text("source", { enum: ["builtin", "custom"] }).notNull(),
    localDevelopment: integer("local_development", { mode: "boolean" }).notNull().default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    deprecated: integer("deprecated", { mode: "boolean" }).notNull().default(false),
    position: integer("position").notNull(),
    revision: integer("revision").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("network_rpc_endpoints_network_position_unique").on(
      table.networkId,
      table.position
    ),
    uniqueIndex("network_rpc_endpoints_credential_ref_unique").on(table.credentialRef),
    index("network_rpc_endpoints_network_idx").on(table.networkId),
    index("network_rpc_endpoints_enabled_idx").on(table.enabled),
    check("network_rpc_endpoints_position_check", sql`${table.position} >= 0`),
    check("network_rpc_endpoints_revision_check", sql`${table.revision} > 0`),
    check("network_rpc_endpoints_enabled_check", sql`${table.enabled} IN (0, 1)`),
    check(
      "network_rpc_endpoints_local_development_check",
      sql`${table.localDevelopment} IN (0, 1)`
    ),
    check("network_rpc_endpoints_deprecated_check", sql`${table.deprecated} IN (0, 1)`),
    check(
      "network_rpc_endpoints_transport_check",
      sql`${table.transport} IN ('http', 'websocket')`
    ),
    check("network_rpc_endpoints_source_check", sql`${table.source} IN ('builtin', 'custom')`),
    check(
      "network_rpc_endpoints_connection_check",
      sql`(
        (${table.connectionKind} = 'public' AND ${table.url} IS NOT NULL AND ${table.displayUrl} IS NULL AND ${table.credentialRef} IS NULL)
        OR
        (${table.connectionKind} = 'protected' AND ${table.url} IS NULL AND ${table.displayUrl} IS NOT NULL AND ${table.credentialRef} IS NOT NULL)
      )`
    ),
  ]
)

export const dappNetworkContexts = sqliteTable(
  "dapp_network_contexts",
  {
    origin: text("origin")
      .notNull()
      .references(() => dappOrigins.origin, { onDelete: "cascade" }),
    protocol: text("protocol", { enum: ["eip155", "solana"] }).notNull(),
    networkId: text("network_id")
      .$type<NetworkId>()
      .notNull()
      .references(() => networks.id, { onDelete: "cascade" }),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("dapp_network_contexts_origin_protocol_unique").on(table.origin, table.protocol),
    index("dapp_network_contexts_network_idx").on(table.networkId),
    check("dapp_network_contexts_protocol_check", sql`${table.protocol} IN ('eip155', 'solana')`),
  ]
)
