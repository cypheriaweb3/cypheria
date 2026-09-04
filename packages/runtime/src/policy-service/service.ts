import { createHash, randomUUID } from "node:crypto"

import type {
  AuditLogService,
  SigningPolicyPersistenceService,
  SigningPolicyRecord,
  WalletPublicStatePersistenceService,
} from "@cypheria/db"
import {
  evaluateSigningPolicies,
  type PolicyEvaluationInput,
  PolicyEvaluationInputSchema,
  type PolicyEvaluationResult,
  type SigningPolicy,
  SigningPolicyObjectSchema,
  SigningPolicySchema,
  signingPolicyIdSchema,
} from "@cypheria/policy-engine"
import { walletIdSchema } from "@cypheria/wallet-core"
import { z } from "zod"

const createPolicyInputSchema = SigningPolicyObjectSchema.omit({ id: true })
  .extend({ enabled: z.boolean().default(true), id: signingPolicyIdSchema.optional() })
  .strict()

const updatePolicyInputSchema = SigningPolicyObjectSchema.omit({ id: true, walletId: true })
  .partial()
  .extend({ expectedRevision: z.number().int().positive() })
  .strict()
  .refine(
    (input) => Object.keys(input).some((key) => key !== "expectedRevision"),
    "At least one policy field must be updated."
  )

const listPolicyInputSchema = z
  .object({ enabled: z.boolean().optional(), walletId: walletIdSchema.optional() })
  .strict()

const evaluatePolicyInputSchema = PolicyEvaluationInputSchema.extend({
  correlationId: z.string().min(1),
  policyIds: z.array(signingPolicyIdSchema).min(1).optional(),
})
  .strict()
  .superRefine((input, context) => {
    if (input.policyIds && new Set(input.policyIds).size !== input.policyIds.length) {
      context.addIssue({ code: "custom", message: "Policy IDs must be unique." })
    }
  })

export type CreateSigningPolicyInput = z.input<typeof createPolicyInputSchema>
export type UpdateSigningPolicyInput = z.input<typeof updatePolicyInputSchema>
export type ListSigningPoliciesInput = z.input<typeof listPolicyInputSchema>
export type EvaluateSigningPolicyInput = z.input<typeof evaluatePolicyInputSchema>

export type PolicyRuntimeEvaluationResult = PolicyEvaluationResult & {
  readonly decisionId: string
}

export type SigningPolicyRuntimeService = {
  readonly create: (input: CreateSigningPolicyInput) => Promise<SigningPolicyRecord>
  readonly disable: (policyId: string, expectedRevision: number) => Promise<SigningPolicyRecord>
  readonly evaluate: (input: EvaluateSigningPolicyInput) => Promise<PolicyRuntimeEvaluationResult>
  readonly get: (policyId: string) => Promise<SigningPolicyRecord | undefined>
  readonly list: (input?: ListSigningPoliciesInput) => Promise<SigningPolicyRecord[]>
  readonly update: (
    policyId: string,
    input: UpdateSigningPolicyInput
  ) => Promise<SigningPolicyRecord>
}

export type PolicyRuntimeIdFactory = {
  readonly decisionId: () => string
  readonly policyId: () => string
}

export type SigningPolicyRuntimeServiceOptions = {
  readonly audit: Pick<AuditLogService, "append">
  readonly idFactory?: PolicyRuntimeIdFactory
  readonly now?: () => string
  readonly persistence: SigningPolicyPersistenceService
  readonly wallets: Pick<WalletPublicStatePersistenceService, "get">
}

export type SigningPolicyRuntimeErrorCode =
  | "INVALID_INPUT"
  | "POLICY_ALREADY_EXISTS"
  | "POLICY_CONFLICT"
  | "POLICY_NOT_FOUND"
  | "PERSISTENCE_ERROR"
  | "WALLET_NOT_FOUND"

export class SigningPolicyRuntimeError extends Error {
  readonly code: SigningPolicyRuntimeErrorCode

  constructor(code: SigningPolicyRuntimeErrorCode, message: string) {
    super(message)
    this.name = "SigningPolicyRuntimeError"
    this.code = code
  }
}

const defaultIdFactory: PolicyRuntimeIdFactory = {
  decisionId: () => `policy_decision_${randomUUID()}`,
  policyId: () => `policy_${randomUUID()}`,
}

const hashValue = (value: unknown): string =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`

const parseInput = <T>(schema: z.ZodType<T>, value: unknown): T => {
  try {
    return schema.parse(value)
  } catch {
    throw new SigningPolicyRuntimeError("INVALID_INPUT", "The policy input is invalid.")
  }
}

export const createSigningPolicyRuntimeService = (
  options: SigningPolicyRuntimeServiceOptions
): SigningPolicyRuntimeService => {
  const idFactory = options.idFactory ?? defaultIdFactory
  const now = options.now ?? (() => new Date().toISOString())

  const requireWallet = async (walletId: SigningPolicy["walletId"]): Promise<void> => {
    if (!(await options.wallets.get(walletId))) {
      throw new SigningPolicyRuntimeError("WALLET_NOT_FOUND", "The wallet does not exist.")
    }
  }

  const requirePolicy = async (policyIdValue: string): Promise<SigningPolicyRecord> => {
    const policyId = parseInput(signingPolicyIdSchema, policyIdValue)
    const record = await options.persistence.get(policyId)
    if (!record) {
      throw new SigningPolicyRuntimeError("POLICY_NOT_FOUND", "The policy does not exist.")
    }
    return record
  }

  const appendMutationAudit = async (
    eventType: string,
    record: SigningPolicyRecord
  ): Promise<void> => {
    await options.audit.append({
      actor: "user",
      correlationId: record.policy.id,
      createdAt: now(),
      eventType,
      payloadHash: hashValue(record.policy),
      payloadSummary: `${eventType} ${record.policy.id} at revision ${record.revision}.`,
      source: "runtime.policy-service",
    })
  }

  const updateRecord = async (
    policyIdValue: string,
    inputValue: UpdateSigningPolicyInput,
    eventType: "policy.disabled" | "policy.updated"
  ): Promise<SigningPolicyRecord> => {
    const input = parseInput(updatePolicyInputSchema, inputValue)
    const current = await requirePolicy(policyIdValue)
    const { expectedRevision, ...updates } = input
    if (current.revision !== expectedRevision) {
      throw new SigningPolicyRuntimeError(
        "POLICY_CONFLICT",
        "The policy was changed by another operation."
      )
    }
    const policy = parseInput(SigningPolicySchema, { ...current.policy, ...updates })
    const updated = await options.persistence.update(policy, expectedRevision, now())
    if (!updated) {
      throw new SigningPolicyRuntimeError(
        "POLICY_CONFLICT",
        "The policy was changed by another operation."
      )
    }
    await appendMutationAudit(eventType, updated)
    return updated
  }

  return {
    create: async (inputValue) => {
      const input = parseInput(createPolicyInputSchema, inputValue)
      const policy = parseInput(SigningPolicySchema, {
        ...input,
        id: input.id ?? idFactory.policyId(),
      })
      await requireWallet(policy.walletId)
      if (await options.persistence.get(policy.id)) {
        throw new SigningPolicyRuntimeError("POLICY_ALREADY_EXISTS", "The policy already exists.")
      }
      let created: SigningPolicyRecord
      try {
        created = await options.persistence.create(policy, now())
      } catch {
        throw new SigningPolicyRuntimeError("PERSISTENCE_ERROR", "The policy could not be created.")
      }
      await appendMutationAudit("policy.created", created)
      return created
    },
    disable: async (policyId, expectedRevision) =>
      updateRecord(policyId, { enabled: false, expectedRevision }, "policy.disabled"),
    evaluate: async (inputValue) => {
      const input = parseInput(evaluatePolicyInputSchema, inputValue)
      await requireWallet(input.walletId)
      const records = await options.persistence.list({ enabled: true, walletId: input.walletId })
      const evaluationInput: PolicyEvaluationInput = {
        chainKey: input.chainKey,
        ...(input.contractAddress ? { contractAddress: input.contractAddress } : {}),
        method: input.method,
        mode: input.mode,
        ...(input.nativeValue ? { nativeValue: input.nativeValue } : {}),
        now: input.now ?? now(),
        ...(input.origin ? { origin: input.origin } : {}),
        walletId: input.walletId,
      }
      const result = evaluateSigningPolicies(
        records
          .filter((record) => !input.policyIds || input.policyIds.includes(record.policy.id))
          .map((record) => record.policy),
        evaluationInput
      )
      const decisionId = idFactory.decisionId()
      await options.audit.append({
        actor: input.origin ?? "runtime",
        correlationId: input.correlationId,
        createdAt: now(),
        eventType: "policy.decision",
        payloadHash: hashValue(evaluationInput),
        payloadSummary: `Policy decision ${decisionId}: ${result.decision}.`,
        source: "runtime.policy-service",
      })
      return { ...result, decisionId }
    },
    get: async (policyId) => options.persistence.get(parseInput(signingPolicyIdSchema, policyId)),
    list: async (inputValue = {}) => {
      const input = parseInput(listPolicyInputSchema, inputValue)
      return options.persistence.list(input)
    },
    update: (policyId, input) => updateRecord(policyId, input, "policy.updated"),
  }
}
