import { createHash, randomUUID } from "node:crypto"
import type {
  ApprovalRequestRecord,
  ApprovalRequestStatus,
  AuditLogService,
  SigningIntentPersistenceService,
  SigningIntentRecord,
} from "@cypheria/db"
import { signingPolicyIdSchema } from "@cypheria/policy-engine"
import {
  parseSigningIntent,
  personalSignIntentSchema,
  type SigningIntent,
  serializeSigningIntent,
  solanaSigningIntentDraftSchema,
  transactionIntentSchema,
  typedDataSignIntentSchema,
} from "@cypheria/wallet-core"
import { z } from "zod"
import type { SigningPolicyRuntimeService } from "../policy-service/index.js"
import type { SigningAuthorization, SigningIntentAuthorizer } from "../wallet-signing/index.js"

const intentDraftSchema = z.discriminatedUnion("kind", [
  personalSignIntentSchema.omit({ createdAt: true, id: true }),
  transactionIntentSchema.omit({ createdAt: true, id: true }),
  typedDataSignIntentSchema.omit({ createdAt: true, id: true }),
  solanaSigningIntentDraftSchema,
])

const createInputSchema = z
  .object({
    expiresAt: z.iso.datetime().optional(),
    intent: intentDraftSchema,
    mode: z.enum(["conditional-auto-signing", "human-approval", "read-only"]),
    policyIds: z.array(signingPolicyIdSchema).min(1).optional(),
    source: z.enum(["agent", "automation", "dapp"]),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.source === "dapp" && !input.intent.origin) {
      context.addIssue({ code: "custom", message: "A dApp intent requires an origin." })
    }
  })

const decideInputSchema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    expectedRevision: z.number().int().positive(),
    reviewer: z.string().min(1).max(256),
  })
  .strict()

const approvalIdSchema = z.string().regex(/^approval_[A-Za-z0-9][A-Za-z0-9_-]*$/u)
const signingIntentIdSchema = z.string().regex(/^signing_intent_[A-Za-z0-9][A-Za-z0-9_-]*$/u)
const approvalStatusSchema = z.enum(["approved", "expired", "pending", "rejected"])

export type CreateSigningIntentInput = z.input<typeof createInputSchema>
export type DecideApprovalInput = z.input<typeof decideInputSchema>

export type ApprovalRequestView = {
  readonly approval: ApprovalRequestRecord
  readonly intent: SigningIntentRecord
}

export type SigningIntentRuntimeService = {
  readonly authorize: SigningIntentAuthorizer
  readonly create: (input: CreateSigningIntentInput) => Promise<SigningIntentRecord>
  readonly decide: (approvalId: string, input: DecideApprovalInput) => Promise<ApprovalRequestView>
  readonly get: (intentId: string) => Promise<SigningIntentRecord | undefined>
  readonly listApprovals: (status?: ApprovalRequestStatus) => Promise<ApprovalRequestView[]>
}

export type SigningIntentRuntimeIdFactory = {
  readonly approvalId: () => string
  readonly intentId: () => string
}

export type SigningIntentRuntimeServiceOptions = {
  readonly approvalTtlMs?: number
  readonly audit: Pick<AuditLogService, "append">
  readonly idFactory?: SigningIntentRuntimeIdFactory
  readonly now?: () => string
  readonly persistence: SigningIntentPersistenceService
  readonly policies: Pick<SigningPolicyRuntimeService, "evaluate">
}

export type SigningIntentRuntimeErrorCode =
  | "APPROVAL_CONFLICT"
  | "APPROVAL_NOT_FOUND"
  | "INTENT_MISMATCH"
  | "INVALID_INPUT"

export class SigningIntentRuntimeError extends Error {
  readonly code: SigningIntentRuntimeErrorCode

  constructor(code: SigningIntentRuntimeErrorCode, message: string) {
    super(message)
    this.name = "SigningIntentRuntimeError"
    this.code = code
  }
}

const defaultIdFactory: SigningIntentRuntimeIdFactory = {
  approvalId: () => `approval_${randomUUID()}`,
  intentId: () => `signing_intent_${randomUUID()}`,
}

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  try {
    return schema.parse(value)
  } catch {
    throw new SigningIntentRuntimeError("INVALID_INPUT", "The signing intent input is invalid.")
  }
}

const hashIntent = (intent: SigningIntent): string =>
  `sha256:${createHash("sha256").update(serializeSigningIntent(intent)).digest("hex")}`

const policyMethod = (intent: SigningIntent): string => {
  if (intent.kind.startsWith("solana-")) return intent.kind
  if (intent.kind === "personal-sign") return "personal_sign"
  if (intent.kind === "typed-data") return "eth_signTypedData_v4"
  return intent.kind === "send-transaction" ? "eth_sendTransaction" : "eth_signTransaction"
}

export const createSigningIntentRuntimeService = (
  options: SigningIntentRuntimeServiceOptions
): SigningIntentRuntimeService => {
  const idFactory = options.idFactory ?? defaultIdFactory
  const now = options.now ?? (() => new Date().toISOString())
  const approvalTtlMs = options.approvalTtlMs ?? 5 * 60_000
  if (!Number.isSafeInteger(approvalTtlMs) || approvalTtlMs <= 0) {
    throw new SigningIntentRuntimeError("INVALID_INPUT", "The approval TTL is invalid.")
  }

  const appendAudit = async (eventType: string, record: SigningIntentRecord): Promise<void> => {
    await options.audit.append({
      actor: record.intent.origin ?? record.source,
      correlationId: record.intent.correlationId,
      createdAt: now(),
      eventType,
      payloadHash: record.payloadHash,
      payloadSummary: `${eventType} ${record.intent.id}: ${record.status}.`,
      source: "runtime.signing-intent-service",
    })
  }

  const authorize: SigningIntentAuthorizer = async (intent): Promise<SigningAuthorization> => {
    const record = await options.persistence.getIntent(intent.id)
    if (!record || record.payloadHash !== hashIntent(intent)) {
      throw new SigningIntentRuntimeError("INTENT_MISMATCH", "The signing intent does not match.")
    }
    const expired = Date.parse(record.expiresAt) <= Date.parse(now())
    return {
      ...(record.approvalId ? { approvalId: record.approvalId } : {}),
      approved: record.status === "approved" && !expired,
      decision: record.decision,
      decisionId: record.decisionId,
      ...(record.matchedPolicyId ? { matchedPolicyId: record.matchedPolicyId } : {}),
    }
  }

  return {
    authorize,
    create: async (inputValue) => {
      const input = parse(createInputSchema, inputValue)
      const createdAt = now()
      const expiresAt =
        input.expiresAt ?? new Date(Date.parse(createdAt) + approvalTtlMs).toISOString()
      if (Date.parse(expiresAt) <= Date.parse(createdAt)) {
        throw new SigningIntentRuntimeError(
          "INVALID_INPUT",
          "The signing intent expiry is invalid."
        )
      }
      let intent: SigningIntent
      try {
        intent = parseSigningIntent({
          ...input.intent,
          createdAt,
          id: idFactory.intentId(),
        })
      } catch {
        throw new SigningIntentRuntimeError("INVALID_INPUT", "The signing intent input is invalid.")
      }
      let payloadHash: string
      try {
        payloadHash = hashIntent(intent)
      } catch {
        throw new SigningIntentRuntimeError(
          "INVALID_INPUT",
          "The signing intent payload is invalid."
        )
      }
      const transaction =
        intent.kind === "sign-transaction" || intent.kind === "send-transaction"
          ? intent.transaction
          : undefined
      const evaluation = await options.policies.evaluate({
        chainKey: intent.account.chainKey,
        correlationId: intent.correlationId,
        ...(transaction?.to ? { contractAddress: transaction.to } : {}),
        method: policyMethod(intent),
        mode: input.mode,
        ...(input.policyIds ? { policyIds: input.policyIds } : {}),
        ...(transaction?.value === undefined ? {} : { nativeValue: transaction.value.toString() }),
        ...(intent.origin ? { origin: intent.origin } : {}),
        walletId: intent.account.walletId,
      })
      const approvalId =
        evaluation.decision === "require-human-approval" ? idFactory.approvalId() : undefined
      const status =
        evaluation.decision === "allow"
          ? "approved"
          : evaluation.decision === "deny"
            ? "rejected"
            : "pending-approval"
      const record: SigningIntentRecord = {
        ...(approvalId ? { approvalId } : {}),
        decision: evaluation.decision,
        decisionId: evaluation.decisionId,
        expiresAt,
        intent,
        ...(evaluation.matchedPolicyId ? { matchedPolicyId: evaluation.matchedPolicyId } : {}),
        mode: input.mode,
        payloadHash,
        revision: 1,
        source: input.source,
        status,
        updatedAt: createdAt,
      }
      const approval: ApprovalRequestRecord | undefined = approvalId
        ? {
            expiresAt,
            id: approvalId,
            intentId: intent.id,
            requestedAt: createdAt,
            revision: 1,
            status: "pending",
          }
        : undefined
      await options.persistence.create(record, approval)
      await appendAudit("signing-intent.created", record)
      return record
    },
    decide: async (approvalId, inputValue) => {
      const parsedApprovalId = parse(approvalIdSchema, approvalId)
      const input = parse(decideInputSchema, inputValue)
      const current = await options.persistence.getApproval(parsedApprovalId)
      if (!current) {
        throw new SigningIntentRuntimeError("APPROVAL_NOT_FOUND", "The approval does not exist.")
      }
      const resolvedAt = now()
      const resolution =
        Date.parse(current.expiresAt) <= Date.parse(resolvedAt) ? "expired" : input.decision
      const resolved = await options.persistence.resolveApproval({
        approvalId: parsedApprovalId,
        expectedRevision: input.expectedRevision,
        resolution,
        reviewer: input.reviewer,
        timestamp: resolvedAt,
      })
      if (!resolved) {
        throw new SigningIntentRuntimeError(
          "APPROVAL_CONFLICT",
          "The approval was already resolved."
        )
      }
      await appendAudit(`approval.${resolution}`, resolved.intent)
      return resolved
    },
    get: async (intentId) => options.persistence.getIntent(parse(signingIntentIdSchema, intentId)),
    listApprovals: async (status) => {
      const parsedStatus = status === undefined ? undefined : parse(approvalStatusSchema, status)
      const approvals = await options.persistence.listApprovals(parsedStatus)
      const views = await Promise.all(
        approvals.map(async (approval) => {
          const intent = await options.persistence.getIntent(approval.intentId)
          if (!intent) throw new Error("The approval signing intent does not exist.")
          return { approval, intent }
        })
      )
      return views
    },
  }
}
