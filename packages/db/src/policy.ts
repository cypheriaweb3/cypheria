import {
  type SigningPolicy,
  SigningPolicySchema,
  signingPolicyIdSchema,
} from "@cypheria/policy-engine"
import type { WalletId } from "@cypheria/wallet-core"
import { and, asc, eq } from "drizzle-orm"
import { z } from "zod"

import type { CypheriaDatabase } from "./client.js"
import { signingPolicies } from "./schema.js"

export type SigningPolicyRecord = {
  readonly createdAt: string
  readonly policy: SigningPolicy
  readonly revision: number
  readonly updatedAt: string
}

export type ListSigningPolicyOptions = {
  readonly enabled?: boolean
  readonly walletId?: WalletId
}

export type SigningPolicyPersistenceService = {
  readonly create: (policy: SigningPolicy, timestamp: string) => Promise<SigningPolicyRecord>
  readonly get: (policyId: string) => Promise<SigningPolicyRecord | undefined>
  readonly list: (options?: ListSigningPolicyOptions) => Promise<SigningPolicyRecord[]>
  readonly update: (
    policy: SigningPolicy,
    expectedRevision: number,
    timestamp: string
  ) => Promise<SigningPolicyRecord | undefined>
}

type SigningPolicyRow = typeof signingPolicies.$inferSelect

const parseJson = (value: string): unknown => JSON.parse(value) as unknown

const fromRow = (row: SigningPolicyRow): SigningPolicyRecord => ({
  createdAt: z.iso.datetime().parse(row.createdAt),
  policy: SigningPolicySchema.parse({
    chainIds: parseJson(row.chainIds),
    ...(row.contractAllowlist ? { contractAllowlist: parseJson(row.contractAllowlist) } : {}),
    effect: row.effect,
    enabled: row.enabled,
    ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}),
    id: row.id,
    ...(row.maxNativeValue ? { maxNativeValue: row.maxNativeValue } : {}),
    methods: parseJson(row.methods),
    origins: parseJson(row.origins),
    requireHumanApproval: row.requireHumanApproval,
    walletId: row.walletId,
  }),
  revision: z.number().int().positive().parse(row.revision),
  updatedAt: z.iso.datetime().parse(row.updatedAt),
})

const toValues = (policyValue: SigningPolicy, timestampValue: string) => {
  const policy = SigningPolicySchema.parse(policyValue)
  const timestamp = z.iso.datetime().parse(timestampValue)
  return {
    chainIds: JSON.stringify(policy.chainIds),
    contractAllowlist: policy.contractAllowlist ? JSON.stringify(policy.contractAllowlist) : null,
    effect: policy.effect,
    enabled: policy.enabled,
    expiresAt: policy.expiresAt ?? null,
    id: policy.id,
    maxNativeValue: policy.maxNativeValue ?? null,
    methods: JSON.stringify(policy.methods),
    origins: JSON.stringify(policy.origins),
    requireHumanApproval: policy.requireHumanApproval,
    timestamp,
    walletId: policy.walletId,
  }
}

export const createSigningPolicyPersistenceService = (
  db: CypheriaDatabase
): SigningPolicyPersistenceService => ({
  create: async (policyValue, timestampValue) => {
    const values = toValues(policyValue, timestampValue)
    const { timestamp, ...columns } = values
    const [created] = await db
      .insert(signingPolicies)
      .values({
        ...columns,
        createdAt: timestamp,
        revision: 1,
        updatedAt: timestamp,
      })
      .returning()
    if (!created) {
      throw new Error("The signing policy was not created.")
    }
    return fromRow(created)
  },
  get: async (policyId) => {
    const [record] = await db
      .select()
      .from(signingPolicies)
      .where(eq(signingPolicies.id, signingPolicyIdSchema.parse(policyId)))
      .limit(1)
    return record ? fromRow(record) : undefined
  },
  list: async (options = {}) => {
    const conditions = [
      ...(options.walletId ? [eq(signingPolicies.walletId, options.walletId)] : []),
      ...(options.enabled === undefined ? [] : [eq(signingPolicies.enabled, options.enabled)]),
    ]
    const records = await db
      .select()
      .from(signingPolicies)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(signingPolicies.createdAt), asc(signingPolicies.id))
    return records.map(fromRow)
  },
  update: async (policyValue, expectedRevisionValue, timestampValue) => {
    const values = toValues(policyValue, timestampValue)
    const expectedRevision = z.number().int().positive().parse(expectedRevisionValue)
    const [updated] = await db
      .update(signingPolicies)
      .set({
        chainIds: values.chainIds,
        contractAllowlist: values.contractAllowlist,
        effect: values.effect,
        enabled: values.enabled,
        expiresAt: values.expiresAt,
        maxNativeValue: values.maxNativeValue,
        methods: values.methods,
        origins: values.origins,
        requireHumanApproval: values.requireHumanApproval,
        revision: expectedRevision + 1,
        updatedAt: values.timestamp,
      })
      .where(and(eq(signingPolicies.id, values.id), eq(signingPolicies.revision, expectedRevision)))
      .returning()
    return updated ? fromRow(updated) : undefined
  },
})
