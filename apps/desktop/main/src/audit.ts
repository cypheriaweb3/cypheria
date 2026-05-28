import {
  type AuditLogService,
  createAuditLogService,
  ensureDatabaseSchema,
  openCypheriaDatabase,
} from "@cypheria/db"

import type { DesktopRuntimeContext } from "./runtime.js"

export type DesktopAuditLogService = {
  readonly auditLog: AuditLogService
  readonly close: () => void
  readonly databaseFile: string
}

export const openDesktopAuditLogService = (
  context: DesktopRuntimeContext
): DesktopAuditLogService => {
  const database = openCypheriaDatabase(context.paths)
  ensureDatabaseSchema(database.sqlite)

  return {
    auditLog: createAuditLogService(database.db),
    close: database.close,
    databaseFile: database.databaseFile,
  }
}
