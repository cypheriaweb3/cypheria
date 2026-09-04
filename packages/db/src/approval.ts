import type { PolicyDecision } from "@cypheria/policy-engine"
import {
  deserializeSigningIntent,
  type SigningIntent,
  serializeSigningIntent,
  type WalletMode,
} from "@cypheria/wallet-core"
import { and, asc, eq, exists, sql } from "drizzle-orm"
import { z } from "zod"

import type { CypheriaDatabase } from "./client.js"
import {
  approvalRequestStatuses,
  approvalRequests,
  signingIntentSources,
  signingIntentStatuses,
  signingIntents,
} from "./schema/index.js"

export { approvalRequestStatuses, signingIntentSources, signingIntentStatuses }
export type SigningIntentSource = (typeof signingIntentSources)[number]
export type SigningIntentStatus = (typeof signingIntentStatuses)[number]
export type ApprovalRequestStatus = (typeof approvalRequestStatuses)[number]

export type SigningIntentRecord = {
  readonly intent: SigningIntent
  readonly approvalId?: string
  readonly matchedPolicyId?: string
  readonly payloadHash: string
  readonly source: SigningIntentSource
  readonly mode: WalletMode
  readonly decision: PolicyDecision
  readonly decisionId: string
  readonly status: SigningIntentStatus
  readonly revision: number
  readonly updatedAt: string
  readonly expiresAt: string
}

export type ApprovalRequestRecord = {
  readonly id: string
  readonly intentId: string
  readonly status: ApprovalRequestStatus
  readonly reviewer?: string
  readonly revision: number
  readonly requestedAt: string
  readonly expiresAt: string
  readonly resolvedAt?: string
}

export type ApprovalResolution = "approved" | "expired" | "rejected"

export type SigningIntentPersistenceService = {
  readonly create: (
    intent: SigningIntentRecord,
    approval?: ApprovalRequestRecord
  ) => Promise<SigningIntentRecord>
  readonly getApproval: (approvalId: string) => Promise<ApprovalRequestRecord | undefined>
  readonly getIntent: (intentId: string) => Promise<SigningIntentRecord | undefined>
  readonly listApprovals: (status?: ApprovalRequestStatus) => Promise<ApprovalRequestRecord[]>
  readonly resolveApproval: (input: {
    approvalId: string
    expectedRevision: number
    resolution: ApprovalResolution
    reviewer: string
    timestamp: string
  }) => Promise<{ approval: ApprovalRequestRecord; intent: SigningIntentRecord } | undefined>
}

const timestamp = (value: string): string => z.iso.datetime().parse(value)
const positive = (value: number): number => z.number().int().positive().parse(value)
const approvalId = (value: string): string =>
  z
    .string()
    .regex(/^approval_[A-Za-z0-9][A-Za-z0-9_-]*$/u)
    .parse(value)
const intentId = (value: string): string =>
  z
    .string()
    .regex(/^signing_intent_[A-Za-z0-9][A-Za-z0-9_-]*$/u)
    .parse(value)

const fromIntentRow = (row: typeof signingIntents.$inferSelect): SigningIntentRecord => ({
  intent: deserializeSigningIntent(row.payload),
  ...(row.approvalId ? { approvalId: row.approvalId } : {}),
  ...(row.matchedPolicyId ? { matchedPolicyId: row.matchedPolicyId } : {}),
  payloadHash: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/u)
    .parse(row.payloadHash),
  source: z.enum(signingIntentSources).parse(row.source),
  mode: z.enum(["conditional-auto-signing", "human-approval", "read-only"]).parse(row.mode),
  decision: z.enum(["allow", "deny", "require-human-approval"]).parse(row.decision),
  decisionId: row.decisionId,
  status: z.enum(signingIntentStatuses).parse(row.status),
  revision: positive(row.revision),
  updatedAt: timestamp(row.updatedAt),
  expiresAt: timestamp(row.expiresAt),
})

const fromApprovalRow = (row: typeof approvalRequests.$inferSelect): ApprovalRequestRecord => ({
  id: row.id,
  intentId: row.intentId,
  status: z.enum(approvalRequestStatuses).parse(row.status),
  ...(row.reviewer ? { reviewer: row.reviewer } : {}),
  revision: positive(row.revision),
  requestedAt: timestamp(row.requestedAt),
  expiresAt: timestamp(row.expiresAt),
  ...(row.resolvedAt ? { resolvedAt: timestamp(row.resolvedAt) } : {}),
})

export const createSigningIntentPersistenceService = (
  db: CypheriaDatabase
): SigningIntentPersistenceService => ({
  create: async (record, approval) => {
    if (
      (record.status === "pending-approval") !== Boolean(approval) ||
      record.approvalId !== approval?.id ||
      (approval &&
        (approval.intentId !== record.intent.id ||
          approval.expiresAt !== record.expiresAt ||
          approval.status !== "pending"))
    ) {
      throw new Error("The signing intent approval does not match its persisted intent.")
    }
    const queries = [
      db.insert(signingIntents).values({
        id: record.intent.id,
        walletId: record.intent.account.walletId,
        approvalId: record.approvalId ?? null,
        matchedPolicyId: record.matchedPolicyId ?? null,
        payload: serializeSigningIntent(record.intent),
        payloadHash: z
          .string()
          .regex(/^sha256:[a-f0-9]{64}$/u)
          .parse(record.payloadHash),
        source: record.source,
        mode: record.mode,
        decision: record.decision,
        decisionId: record.decisionId,
        status: record.status,
        revision: positive(record.revision),
        createdAt: timestamp(record.intent.createdAt),
        updatedAt: timestamp(record.updatedAt),
        expiresAt: timestamp(record.expiresAt),
      }),
      ...(approval
        ? [
            db.insert(approvalRequests).values({
              id: approvalId(approval.id),
              intentId: intentId(approval.intentId),
              status: approval.status,
              reviewer: approval.reviewer ?? null,
              revision: positive(approval.revision),
              requestedAt: timestamp(approval.requestedAt),
              expiresAt: timestamp(approval.expiresAt),
              resolvedAt: approval.resolvedAt ?? null,
            }),
          ]
        : []),
    ] as const
    await db.batch(queries)
    return record
  },
  getApproval: async (approvalId) => {
    const [row] = await db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, z.string().min(1).parse(approvalId)))
      .limit(1)
    return row ? fromApprovalRow(row) : undefined
  },
  getIntent: async (intentId) => {
    const [row] = await db
      .select()
      .from(signingIntents)
      .where(eq(signingIntents.id, z.string().min(1).parse(intentId)))
      .limit(1)
    return row ? fromIntentRow(row) : undefined
  },
  listApprovals: async (status) => {
    const parsedStatus =
      status === undefined ? undefined : z.enum(approvalRequestStatuses).parse(status)
    const rows = await db
      .select()
      .from(approvalRequests)
      .where(parsedStatus ? eq(approvalRequests.status, parsedStatus) : undefined)
      .orderBy(asc(approvalRequests.requestedAt), asc(approvalRequests.id))
    return rows.map(fromApprovalRow)
  },
  resolveApproval: async (input) => {
    const resolvedAt = timestamp(input.timestamp)
    const expectedRevision = positive(input.expectedRevision)
    const resolution = z.enum(["approved", "expired", "rejected"]).parse(input.resolution)
    const parsedApprovalId = approvalId(input.approvalId)
    const intentStatus: SigningIntentStatus = resolution === "approved" ? "approved" : resolution
    const approvalUpdate = db
      .update(approvalRequests)
      .set({
        status: resolution,
        reviewer: z.string().min(1).parse(input.reviewer),
        revision: expectedRevision + 1,
        resolvedAt,
      })
      .where(
        and(
          eq(approvalRequests.id, parsedApprovalId),
          eq(approvalRequests.revision, expectedRevision),
          eq(approvalRequests.status, "pending")
        )
      )
      .returning()
    const intentUpdate = db
      .update(signingIntents)
      .set({
        status: intentStatus,
        revision: sql`${signingIntents.revision} + 1`,
        updatedAt: resolvedAt,
      })
      .where(
        and(
          eq(signingIntents.approvalId, parsedApprovalId),
          eq(signingIntents.revision, expectedRevision),
          eq(signingIntents.status, "pending-approval"),
          exists(
            db
              .select({ id: approvalRequests.id })
              .from(approvalRequests)
              .where(
                and(
                  eq(approvalRequests.id, parsedApprovalId),
                  eq(approvalRequests.revision, expectedRevision + 1),
                  eq(approvalRequests.status, resolution),
                  eq(approvalRequests.resolvedAt, resolvedAt)
                )
              )
          )
        )
      )
      .returning()
    const [approvals, intents] = await db.batch([approvalUpdate, intentUpdate])
    const approval = approvals[0]
    const intent = intents[0]
    if (!approval && !intent) return undefined
    if (!approval || !intent) throw new Error("The signing intent approval state is inconsistent.")
    return { approval: fromApprovalRow(approval), intent: fromIntentRow(intent) }
  },
})
