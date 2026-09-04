import {
  type SigningPolicy,
  SigningPolicySchema,
  signingPolicyIdSchema,
} from "@cypheria/policy-engine"
import type { WalletId } from "@cypheria/wallet-core"
import { and, asc, eq } from "drizzle-orm"
import { z } from "zod"

import type { CypheriaDatabase } from "./client.js"
import { signingPolicies } from "./schema/index.js"

export type SigningPolicyRecord = {
  readonly policy: SigningPolicy
  readonly revision: number
  readonly createdAt: string
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

const fromRow = (row: SigningPolicyRow): SigningPolicyRecord => ({
  policy: SigningPolicySchema.parse({
    id: row.id,
    walletId: row.walletId,
    chainKeys: row.chainKeys,
    methods: row.methods,
    origins: row.origins,
    ...(row.contractAllowlist ? { contractAllowlist: row.contractAllowlist } : {}),
    ...(row.maxNativeValue ? { maxNativeValue: row.maxNativeValue } : {}),
    effect: row.effect,
    requireHumanApproval: row.requireHumanApproval,
    enabled: row.enabled,
    ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}),
  }),
  revision: z.number().int().positive().parse(row.revision),
  createdAt: z.iso.datetime().parse(row.createdAt),
  updatedAt: z.iso.datetime().parse(row.updatedAt),
})

const toValues = (policyValue: SigningPolicy, timestampValue: string) => {
  const policy = SigningPolicySchema.parse(policyValue)
  const timestamp = z.iso.datetime().parse(timestampValue)
  return {
    id: policy.id,
    walletId: policy.walletId,
    chainKeys: policy.chainKeys,
    methods: policy.methods,
    origins: policy.origins,
    contractAllowlist: policy.contractAllowlist ?? null,
    maxNativeValue: policy.maxNativeValue ?? null,
    effect: policy.effect,
    requireHumanApproval: policy.requireHumanApproval,
    enabled: policy.enabled,
    expiresAt: policy.expiresAt ?? null,
    timestamp,
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
        id: columns.id,
        walletId: columns.walletId,
        chainKeys: columns.chainKeys,
        methods: columns.methods,
        origins: columns.origins,
        contractAllowlist: columns.contractAllowlist,
        maxNativeValue: columns.maxNativeValue,
        effect: columns.effect,
        requireHumanApproval: columns.requireHumanApproval,
        enabled: columns.enabled,
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        expiresAt: columns.expiresAt,
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
        chainKeys: values.chainKeys,
        methods: values.methods,
        origins: values.origins,
        contractAllowlist: values.contractAllowlist,
        maxNativeValue: values.maxNativeValue,
        effect: values.effect,
        requireHumanApproval: values.requireHumanApproval,
        enabled: values.enabled,
        revision: expectedRevision + 1,
        updatedAt: values.timestamp,
        expiresAt: values.expiresAt,
      })
      .where(and(eq(signingPolicies.id, values.id), eq(signingPolicies.revision, expectedRevision)))
      .returning()
    return updated ? fromRow(updated) : undefined
  },
})
