export {
  type AppendAuditLogInput,
  type AuditLogRecord,
  type AuditLogService,
  createAuditLogService,
} from "./audit.js"
export {
  type AutomationPersistenceService,
  type AutomationRunRecord,
  type AutomationTaskRecord,
  createAutomationPersistenceService,
} from "./automation.js"
export {
  type CypheriaDatabase,
  createInMemoryDatabase,
  type OpenDatabaseOptions,
  type OpenDatabaseResult,
  openCypheriaDatabase,
} from "./client.js"
export { ensureDatabaseSchema, initialSchemaStatements } from "./migrations.js"
export {
  buildDatabasePaths,
  type DatabasePathOptions,
  type DatabasePaths,
  DEFAULT_DATABASE_FILENAME,
  DEFAULT_MIGRATIONS_DIRNAME,
} from "./paths.js"

export * from "./schema.js"
