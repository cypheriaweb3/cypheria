import { randomUUID } from "node:crypto"

import { desc, eq } from "drizzle-orm"

import type { CypheriaDatabase } from "./client.js"
import { auditLogs } from "./schema/index.js"

export type AuditLogRecord = typeof auditLogs.$inferSelect

export type AppendAuditLogInput = {
  readonly id?: string
  readonly correlationId?: string | null
  readonly actor: string
  readonly eventType: string
  readonly source: string
  readonly payloadHash?: string | null
  readonly payloadSummary?: string | null
  readonly createdAt?: Date | string
}

export type ListAuditLogsOptions = {
  readonly limit?: number
}

export type AuditLogService = {
  readonly append: (input: AppendAuditLogInput) => Promise<AuditLogRecord>
  readonly getById: (id: string) => Promise<AuditLogRecord | undefined>
  readonly list: (options?: ListAuditLogsOptions) => Promise<AuditLogRecord[]>
}

const toIsoString = (value: Date | string | undefined): string => {
  if (!value) {
    return new Date().toISOString()
  }

  return value instanceof Date ? value.toISOString() : value
}

export const createAuditLogService = (db: CypheriaDatabase): AuditLogService => ({
  append: async (input) => {
    const record: AuditLogRecord = {
      id: input.id ?? randomUUID(),
      correlationId: input.correlationId ?? null,
      actor: input.actor,
      eventType: input.eventType,
      source: input.source,
      payloadHash: input.payloadHash ?? null,
      payloadSummary: input.payloadSummary ?? null,
      createdAt: toIsoString(input.createdAt),
    }

    await db.insert(auditLogs).values(record)
    return record
  },
  getById: async (id) => {
    const records = await db.select().from(auditLogs).where(eq(auditLogs.id, id)).limit(1)
    return records[0]
  },
  list: async (options = {}) =>
    db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(options.limit ?? 100),
})
