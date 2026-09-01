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
import { approvalRequests, signingIntents } from "./schema.js"

export const signingIntentSources = ["agent", "automation", "dapp"] as const
export type SigningIntentSource = (typeof signingIntentSources)[number]
export const signingIntentStatuses = [
  "approved",
  "expired",
  "pending-approval",
  "rejected",
] as const
export type SigningIntentStatus = (typeof signingIntentStatuses)[number]
export const approvalRequestStatuses = ["approved", "expired", "pending", "rejected"] as const
export type ApprovalRequestStatus = (typeof approvalRequestStatuses)[number]

export type SigningIntentRecord = {
  readonly approvalId?: string
  readonly decision: PolicyDecision
  readonly decisionId: string
  readonly expiresAt: string
  readonly intent: SigningIntent
  readonly matchedPolicyId?: string
  readonly mode: WalletMode
  readonly payloadHash: string
  readonly revision: number
  readonly source: SigningIntentSource
  readonly status: SigningIntentStatus
  readonly updatedAt: string
}

export type ApprovalRequestRecord = {
  readonly expiresAt: string
  readonly id: string
  readonly intentId: string
  readonly requestedAt: string
  readonly resolvedAt?: string
  readonly reviewer?: string
  readonly revision: number
  readonly status: ApprovalRequestStatus
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
  ...(row.approvalId ? { approvalId: row.approvalId } : {}),
  decision: z.enum(["allow", "deny", "require-human-approval"]).parse(row.decision),
  decisionId: row.decisionId,
  expiresAt: timestamp(row.expiresAt),
  intent: deserializeSigningIntent(row.payload),
  ...(row.matchedPolicyId ? { matchedPolicyId: row.matchedPolicyId } : {}),
  mode: z.enum(["conditional-auto-signing", "human-approval", "read-only"]).parse(row.mode),
  payloadHash: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/u)
    .parse(row.payloadHash),
  revision: positive(row.revision),
  source: z.enum(signingIntentSources).parse(row.source),
  status: z.enum(signingIntentStatuses).parse(row.status),
  updatedAt: timestamp(row.updatedAt),
})

const fromApprovalRow = (row: typeof approvalRequests.$inferSelect): ApprovalRequestRecord => ({
  expiresAt: timestamp(row.expiresAt),
  id: row.id,
  intentId: row.intentId,
  requestedAt: timestamp(row.requestedAt),
  ...(row.resolvedAt ? { resolvedAt: timestamp(row.resolvedAt) } : {}),
  ...(row.reviewer ? { reviewer: row.reviewer } : {}),
  revision: positive(row.revision),
  status: z.enum(approvalRequestStatuses).parse(row.status),
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
        approvalId: record.approvalId ?? null,
        createdAt: timestamp(record.intent.createdAt),
        decision: record.decision,
        decisionId: record.decisionId,
        expiresAt: timestamp(record.expiresAt),
        id: record.intent.id,
        matchedPolicyId: record.matchedPolicyId ?? null,
        mode: record.mode,
        payload: serializeSigningIntent(record.intent),
        payloadHash: z
          .string()
          .regex(/^sha256:[a-f0-9]{64}$/u)
          .parse(record.payloadHash),
        revision: positive(record.revision),
        source: record.source,
        status: record.status,
        updatedAt: timestamp(record.updatedAt),
        walletId: record.intent.account.walletId,
      }),
      ...(approval
        ? [
            db.insert(approvalRequests).values({
              expiresAt: timestamp(approval.expiresAt),
              id: approvalId(approval.id),
              intentId: intentId(approval.intentId),
              requestedAt: timestamp(approval.requestedAt),
              resolvedAt: approval.resolvedAt ?? null,
              reviewer: approval.reviewer ?? null,
              revision: positive(approval.revision),
              status: approval.status,
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
        resolvedAt,
        reviewer: z.string().min(1).parse(input.reviewer),
        revision: expectedRevision + 1,
        status: resolution,
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
        updatedAt: resolvedAt,
        revision: sql`${signingIntents.revision} + 1`,
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
