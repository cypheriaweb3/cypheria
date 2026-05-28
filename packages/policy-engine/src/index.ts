import { walletModes } from "@cypheria/wallet-core"
import { z } from "zod"

export const policyDecisions = ["allow", "deny", "require-human-approval"] as const
export type PolicyDecision = (typeof policyDecisions)[number]

export const SigningPolicyEffectSchema = z.enum(policyDecisions)
export type SigningPolicyEffect = z.infer<typeof SigningPolicyEffectSchema>

export const SigningPolicySchema = z
  .object({
    chainIds: z.array(z.number().int().positive()).min(1),
    contractAllowlist: z.array(z.string().regex(/^0x[a-fA-F0-9]{40}$/u)).optional(),
    effect: SigningPolicyEffectSchema.default("allow"),
    enabled: z.boolean(),
    expiresAt: z.string().datetime().optional(),
    id: z.string().min(1),
    maxNativeValue: z
      .string()
      .regex(/^(0x[a-fA-F0-9]+|\d+)$/u)
      .optional(),
    methods: z.array(z.string().min(1)).min(1),
    origins: z.array(z.string().min(1)).min(1),
    requireHumanApproval: z.boolean().default(false),
    walletId: z.string().min(1),
  })
  .strict()

export type SigningPolicy = z.infer<typeof SigningPolicySchema>

export const PolicyEvaluationInputSchema = z
  .object({
    chainId: z.number().int().positive(),
    contractAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/u)
      .optional(),
    method: z.string().min(1),
    mode: z.enum(walletModes),
    nativeValue: z
      .string()
      .regex(/^(0x[a-fA-F0-9]+|\d+)$/u)
      .optional(),
    now: z.string().datetime().optional(),
    origin: z.string().min(1).optional(),
    walletId: z.string().min(1),
  })
  .strict()

export type PolicyEvaluationInput = z.infer<typeof PolicyEvaluationInputSchema>

export type PolicyEvaluationResult = {
  readonly decision: PolicyDecision
  readonly matchedPolicyId?: string
  readonly reason: string
}

const readOnlyMethods = new Set(["eth_accounts", "eth_chainId"])

const parseQuantity = (value: string | undefined): bigint | undefined => {
  if (!value) {
    return undefined
  }

  return value.startsWith("0x") ? BigInt(value) : BigInt(value)
}

const matchesStringScope = (scope: readonly string[], value: string | undefined): boolean =>
  scope.includes("*") || (value ? scope.includes(value) : false)

const isExpired = (policy: SigningPolicy, now: string): boolean =>
  policy.expiresAt ? Date.parse(policy.expiresAt) <= Date.parse(now) : false

const matchesPolicy = (policy: SigningPolicy, input: PolicyEvaluationInput): boolean => {
  if (!policy.enabled) {
    return false
  }

  if (isExpired(policy, input.now ?? new Date().toISOString())) {
    return false
  }

  if (policy.walletId !== input.walletId) {
    return false
  }

  if (!policy.chainIds.includes(input.chainId)) {
    return false
  }

  if (!matchesStringScope(policy.origins, input.origin)) {
    return false
  }

  if (!matchesStringScope(policy.methods, input.method)) {
    return false
  }

  if (policy.contractAllowlist?.length) {
    const contractAddress = input.contractAddress?.toLowerCase()
    const allowlist = policy.contractAllowlist.map((address) => address.toLowerCase())
    if (!contractAddress || !allowlist.includes(contractAddress)) {
      return false
    }
  }

  const maxNativeValue = parseQuantity(policy.maxNativeValue)
  const nativeValue = parseQuantity(input.nativeValue)
  if (maxNativeValue !== undefined && nativeValue !== undefined && nativeValue > maxNativeValue) {
    return false
  }

  return true
}

export const parseSigningPolicy = (value: unknown): SigningPolicy =>
  SigningPolicySchema.parse(value)

export const evaluateSigningPolicies = (
  policies: readonly SigningPolicy[],
  inputValue: PolicyEvaluationInput
): PolicyEvaluationResult => {
  const input = PolicyEvaluationInputSchema.parse(inputValue)

  if (input.mode === "read-only") {
    return readOnlyMethods.has(input.method)
      ? { decision: "allow", reason: "Read-only method is allowed." }
      : { decision: "deny", reason: "Read-only mode denies signing and transaction methods." }
  }

  if (input.mode === "human-approval") {
    return {
      decision: "require-human-approval",
      reason: "Wallet mode requires human approval.",
    }
  }

  const matchingPolicies = policies.filter((policy) => matchesPolicy(policy, input))
  const denyPolicy = matchingPolicies.find((policy) => policy.effect === "deny")
  if (denyPolicy) {
    return {
      decision: "deny",
      matchedPolicyId: denyPolicy.id,
      reason: "A matching policy explicitly denied the request.",
    }
  }

  const approvalPolicy = matchingPolicies.find(
    (policy) => policy.effect === "require-human-approval" || policy.requireHumanApproval
  )
  if (approvalPolicy) {
    return {
      decision: "require-human-approval",
      matchedPolicyId: approvalPolicy.id,
      reason: "A matching policy requires human approval.",
    }
  }

  const allowPolicy = matchingPolicies.find((policy) => policy.effect === "allow")
  if (allowPolicy) {
    return {
      decision: "allow",
      matchedPolicyId: allowPolicy.id,
      reason: "A matching policy allowed the request.",
    }
  }

  return {
    decision: "require-human-approval",
    reason: "No conditional auto-signing policy matched.",
  }
}
