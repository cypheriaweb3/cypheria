import { randomUUID } from "node:crypto"

import { desc, eq } from "drizzle-orm"

import type { CypheriaDatabase } from "./client.js"
import { auditLogs } from "./schema.js"

export type AuditLogRecord = typeof auditLogs.$inferSelect

export type AppendAuditLogInput = {
  readonly actor: string
  readonly correlationId?: string | null
  readonly createdAt?: Date | string
  readonly eventType: string
  readonly id?: string
  readonly payloadHash?: string | null
  readonly payloadSummary?: string | null
  readonly source: string
}

export type ListAuditLogsOptions = {
  readonly limit?: number
}

export type AuditLogService = {
  readonly append: (input: AppendAuditLogInput) => AuditLogRecord
  readonly getById: (id: string) => AuditLogRecord | undefined
  readonly list: (options?: ListAuditLogsOptions) => AuditLogRecord[]
}

const toIsoString = (value: Date | string | undefined): string => {
  if (!value) {
    return new Date().toISOString()
  }

  return value instanceof Date ? value.toISOString() : value
}

export const createAuditLogService = (db: CypheriaDatabase): AuditLogService => ({
  append: (input) => {
    const record: AuditLogRecord = {
      actor: input.actor,
      correlationId: input.correlationId ?? null,
      createdAt: toIsoString(input.createdAt),
      eventType: input.eventType,
      id: input.id ?? randomUUID(),
      payloadHash: input.payloadHash ?? null,
      payloadSummary: input.payloadSummary ?? null,
      source: input.source,
    }

    db.insert(auditLogs).values(record).run()
    return record
  },
  getById: (id) => db.select().from(auditLogs).where(eq(auditLogs.id, id)).get(),
  list: (options = {}) =>
    db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(options.limit ?? 100)
      .all(),
})
