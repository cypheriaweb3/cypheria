import { z } from "zod"

import {
  timestampSchema,
  vaultIdSchema,
  walletFingerprintSchema,
  walletIdSchema,
} from "./primitives.js"

/**
 * Wallet kind is the capability discriminator. Secret-bearing kinds require a
 * vault; watch kinds are read-only and deliberately carry no vault reference.
 */
export const walletKinds = [
  "hd",
  "private-key",
  "private-key-group",
  "watch",
  "watch-group",
] as const
export type WalletKind = (typeof walletKinds)[number]

/**
 * Cross-storage lifecycle. Transitional and error states let recovery reconcile
 * public database records with vault files after interruption.
 */
export const walletStatuses = ["initializing", "ready", "error", "deleting"] as const
export type WalletStatus = (typeof walletStatuses)[number]

/** HD-only public metadata; secret recovery material never belongs here. */
export const hdWalletMetadataSchema = z
  .object({
    notBackedUp: z.boolean().optional(),
  })
  .strict()

/** Reserved metadata object for kinds with no public metadata in V1. */
export const walletMetadataSchema = z.object({}).strict()

const walletCoreShape = {
  name: z.string().trim().min(1).max(128),
  fingerprint: walletFingerprintSchema,
} as const

const walletLifecycleShape = {
  status: z.enum(walletStatuses),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
} as const

const vaultWalletSchema = <TKind extends "hd" | "private-key" | "private-key-group">(kind: TKind) =>
  z
    .object({
      id: walletIdSchema,
      kind: z.literal(kind),
      ...walletCoreShape,
      vaultId: vaultIdSchema,
      metadata: walletMetadataSchema.default({}),
      ...walletLifecycleShape,
    })
    .strict()

const watchWalletSchema = <TKind extends "watch" | "watch-group">(kind: TKind) =>
  z
    .object({
      id: walletIdSchema,
      kind: z.literal(kind),
      ...walletCoreShape,
      metadata: walletMetadataSchema.default({}),
      ...walletLifecycleShape,
    })
    .strict()

/**
 * Strict public wallet union. The kind determines whether `vaultId` is required
 * or forbidden, so invalid capability combinations cannot cross a boundary.
 */
export const walletSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: walletIdSchema,
      kind: z.literal("hd"),
      ...walletCoreShape,
      vaultId: vaultIdSchema,
      metadata: hdWalletMetadataSchema.default({}),
      ...walletLifecycleShape,
    })
    .strict(),
  vaultWalletSchema("private-key"),
  vaultWalletSchema("private-key-group"),
  watchWalletSchema("watch"),
  watchWalletSchema("watch-group"),
])

export type Wallet = z.infer<typeof walletSchema>
export type VaultWallet = Extract<Wallet, { kind: "hd" | "private-key" | "private-key-group" }>
export type WatchWallet = Extract<Wallet, { kind: "watch" | "watch-group" }>

/** Parses an untrusted value into the public wallet domain model. */
export const parseWallet = (value: unknown): Wallet => walletSchema.parse(value)

/** Narrows a wallet to a kind backed by Cypheria's encrypted vault. */
export const isVaultWallet = (wallet: Wallet): wallet is VaultWallet =>
  wallet.kind === "hd" || wallet.kind === "private-key" || wallet.kind === "private-key-group"

/** Narrows a wallet to a read-only watch kind. */
export const isWatchWallet = (wallet: Wallet): wallet is WatchWallet =>
  wallet.kind === "watch" || wallet.kind === "watch-group"

/** Identifies wallet containers that may own multiple logical accounts. */
export const isGroupWallet = (
  wallet: Wallet
): wallet is Extract<Wallet, { kind: "private-key-group" | "watch-group" }> =>
  wallet.kind === "private-key-group" || wallet.kind === "watch-group"
