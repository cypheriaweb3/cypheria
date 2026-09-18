import { sql } from "drizzle-orm"
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import { agentRegistry } from "./agent.js"

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    roots: text("roots", { mode: "json" }).$type<string[]>().notNull(),
    position: integer("position").notNull(),
    recencyAt: integer("recency_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("projects_position_unique").on(table.position),
    index("projects_recency_at_idx").on(table.recencyAt),
    check(
      "projects_id_uuidv7_check",
      sql`length(${table.id}) = 36 AND substr(${table.id}, 15, 1) = '7'`
    ),
    check("projects_name_check", sql`length(trim(${table.name})) > 0`),
    check("projects_position_check", sql`${table.position} >= 0`),
    check("projects_recency_at_check", sql`${table.recencyAt} IS NULL OR ${table.recencyAt} >= 0`),
    check("projects_created_at_check", sql`${table.createdAt} >= 0`),
    check("projects_updated_at_check", sql`${table.updatedAt} >= ${table.createdAt}`),
  ]
)

export const threads = sqliteTable(
  "threads",
  {
    archivedAt: integer("archived_at"),
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agentRegistry.id, { onDelete: "restrict" }),
    agentSessionId: text("agent_session_id"),
    forkedFromId: text("forked_from_id").references((): AnySQLiteColumn => threads.id, {
      onDelete: "set null",
    }),
    title: text("title"),
    cwd: text("cwd"),
    position: integer("position").notNull(),
    recencyAt: integer("recency_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("threads_position_unique").on(table.position),
    uniqueIndex("threads_agent_session_unique")
      .on(table.agentId, table.agentSessionId)
      .where(sql`${table.agentSessionId} IS NOT NULL`),
    index("threads_agent_id_idx").on(table.agentId),
    index("threads_archived_at_idx").on(table.archivedAt),
    index("threads_forked_from_id_idx").on(table.forkedFromId),
    index("threads_recency_at_idx").on(table.recencyAt),
    check(
      "threads_id_uuidv7_check",
      sql`length(${table.id}) = 36 AND substr(${table.id}, 15, 1) = '7'`
    ),
    check("threads_position_check", sql`${table.position} >= 0`),
    check(
      "threads_archived_at_check",
      sql`${table.archivedAt} IS NULL OR ${table.archivedAt} >= 0`
    ),
    check("threads_recency_at_check", sql`${table.recencyAt} IS NULL OR ${table.recencyAt} >= 0`),
    check("threads_created_at_check", sql`${table.createdAt} >= 0`),
    check("threads_updated_at_check", sql`${table.updatedAt} >= ${table.createdAt}`),
  ]
)

/**
 * Durable intent log for the provider/SQLite boundary. Timeline content remains provider-owned;
 * this table only lets the server finish or compensate interrupted create/delete operations.
 */
export const threadLifecycleOperations = sqliteTable(
  "thread_lifecycle_operations",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agentRegistry.id, { onDelete: "restrict" }),
    agentSessionId: text("agent_session_id"),
    kind: text("kind", { enum: ["create", "delete"] }).notNull(),
    status: text("status", {
      enum: ["pending", "provider-created", "provider-deleted", "failed"],
    }).notNull(),
    input: text("input", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("thread_lifecycle_operations_thread_id_idx").on(table.threadId),
    index("thread_lifecycle_operations_status_idx").on(table.status),
    check("thread_lifecycle_operations_kind_check", sql`${table.kind} IN ('create', 'delete')`),
    check(
      "thread_lifecycle_operations_status_check",
      sql`${table.status} IN ('pending', 'provider-created', 'provider-deleted', 'failed')`
    ),
    check("thread_lifecycle_operations_created_at_check", sql`${table.createdAt} >= 0`),
    check(
      "thread_lifecycle_operations_updated_at_check",
      sql`${table.updatedAt} >= ${table.createdAt}`
    ),
  ]
)

export const threadTimelineEpochs = sqliteTable(
  "thread_timeline_epochs",
  {
    threadId: text("thread_id")
      .primaryKey()
      .references(() => threads.id, { onDelete: "cascade" }),
    epoch: text("epoch").notNull(),
    nextSeq: integer("next_seq").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check("thread_timeline_epochs_epoch_check", sql`length(${table.epoch}) > 0`),
    check("thread_timeline_epochs_next_seq_check", sql`${table.nextSeq} >= 1`),
    check("thread_timeline_epochs_updated_at_check", sql`${table.updatedAt} >= 0`),
  ]
)

export const threadTimelineRows = sqliteTable(
  "thread_timeline_rows",
  {
    threadId: text("thread_id")
      .notNull()
      .references(() => threadTimelineEpochs.threadId, { onDelete: "cascade" }),
    epoch: text("epoch").notNull(),
    seq: integer("seq").notNull(),
    turnId: text("turn_id"),
    providerItemId: text("provider_item_id"),
    timestamp: text("timestamp").notNull(),
    item: text("item", { mode: "json" }).$type<unknown>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.threadId, table.epoch, table.seq] }),
    index("thread_timeline_rows_thread_epoch_seq_idx").on(table.threadId, table.epoch, table.seq),
    index("thread_timeline_rows_turn_id_idx").on(table.turnId),
    check("thread_timeline_rows_epoch_check", sql`length(${table.epoch}) > 0`),
    check("thread_timeline_rows_seq_check", sql`${table.seq} >= 1`),
    check("thread_timeline_rows_timestamp_check", sql`length(${table.timestamp}) > 0`),
  ]
)

export const projectItems = sqliteTable(
  "project_items",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.threadId] }),
    uniqueIndex("project_items_thread_id_unique").on(table.threadId),
    uniqueIndex("project_items_project_position_unique").on(table.projectId, table.position),
    index("project_items_project_id_idx").on(table.projectId),
    check("project_items_position_check", sql`${table.position} >= 0`),
    check("project_items_created_at_check", sql`${table.createdAt} >= 0`),
    check("project_items_updated_at_check", sql`${table.updatedAt} >= ${table.createdAt}`),
  ]
)

export const sections = sqliteTable(
  "sections",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    icon: text("icon"),
    color: text("color"),
    position: integer("position").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("sections_position_unique").on(table.position),
    check(
      "sections_id_uuidv7_check",
      sql`length(${table.id}) = 36 AND substr(${table.id}, 15, 1) = '7'`
    ),
    check("sections_name_check", sql`length(trim(${table.name})) > 0`),
    check("sections_position_check", sql`${table.position} >= 0`),
    check("sections_created_at_check", sql`${table.createdAt} >= 0`),
    check("sections_updated_at_check", sql`${table.updatedAt} >= ${table.createdAt}`),
  ]
)

export const sectionItems = sqliteTable(
  "section_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sectionId: text("section_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    itemType: text("item_type", { enum: ["thread", "project"] }).notNull(),
    threadId: text("thread_id").references(() => threads.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("section_items_thread_id_unique")
      .on(table.threadId)
      .where(sql`${table.threadId} IS NOT NULL`),
    uniqueIndex("section_items_project_id_unique")
      .on(table.projectId)
      .where(sql`${table.projectId} IS NOT NULL`),
    uniqueIndex("section_items_section_position_unique").on(table.sectionId, table.position),
    index("section_items_section_id_idx").on(table.sectionId),
    check(
      "section_items_target_check",
      sql`(
        (${table.itemType} = 'thread' AND ${table.threadId} IS NOT NULL AND ${table.projectId} IS NULL)
        OR
        (${table.itemType} = 'project' AND ${table.projectId} IS NOT NULL AND ${table.threadId} IS NULL)
      )`
    ),
    check("section_items_position_check", sql`${table.position} >= 0`),
    check("section_items_created_at_check", sql`${table.createdAt} >= 0`),
    check("section_items_updated_at_check", sql`${table.updatedAt} >= ${table.createdAt}`),
  ]
)
