import {
  type AuditLogService,
  applyDatabaseMigrations,
  createAuditLogService,
  openCypheriaDatabase,
} from "@cypheria/db"

import type { DesktopRuntimeContext } from "./runtime.js"

export type DesktopAuditLogService = {
  readonly auditLog: AuditLogService
  readonly close: () => void
  readonly databaseFile: string
}

export const openDesktopAuditLogService = async (
  context: DesktopRuntimeContext
): Promise<DesktopAuditLogService> => {
  const database = openCypheriaDatabase({ dbDir: context.paths.dbDir })
  await applyDatabaseMigrations(database.client)

  return {
    auditLog: createAuditLogService(database.db),
    close: database.close,
    databaseFile: database.databaseFile,
  }
}
