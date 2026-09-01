import { z } from "zod"

import {
  timestampSchema,
  vaultIdSchema,
  walletFingerprintSchema,
  walletIdSchema,
} from "./primitives.js"

export const walletKinds = [
  "hd",
  "private-key",
  "private-key-group",
  "watch",
  "watch-group",
] as const
export type WalletKind = (typeof walletKinds)[number]

export const walletProviders = ["local-vault", "read-only"] as const
export type WalletProvider = (typeof walletProviders)[number]

export const walletStatuses = ["initializing", "ready", "error", "deleting"] as const
export type WalletStatus = (typeof walletStatuses)[number]

export const hdWalletMetadataSchema = z
  .object({
    notBackedUp: z.boolean().optional(),
  })
  .strict()

export const walletMetadataSchema = z.object({}).strict()

const walletBaseShape = {
  createdAt: timestampSchema,
  fingerprint: walletFingerprintSchema,
  id: walletIdSchema,
  name: z.string().trim().min(1).max(128),
  status: z.enum(walletStatuses),
  updatedAt: timestampSchema,
}

const localWalletSchema = <TKind extends "hd" | "private-key" | "private-key-group">(kind: TKind) =>
  z
    .object({
      ...walletBaseShape,
      kind: z.literal(kind),
      metadata: walletMetadataSchema.default({}),
      provider: z.literal("local-vault"),
      vaultId: vaultIdSchema,
    })
    .strict()

const watchWalletSchema = <TKind extends "watch" | "watch-group">(kind: TKind) =>
  z
    .object({
      ...walletBaseShape,
      kind: z.literal(kind),
      metadata: walletMetadataSchema.default({}),
      provider: z.literal("read-only"),
    })
    .strict()

export const walletSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...walletBaseShape,
      kind: z.literal("hd"),
      metadata: hdWalletMetadataSchema.default({}),
      provider: z.literal("local-vault"),
      vaultId: vaultIdSchema,
    })
    .strict(),
  localWalletSchema("private-key"),
  localWalletSchema("private-key-group"),
  watchWalletSchema("watch"),
  watchWalletSchema("watch-group"),
])

export type Wallet = z.infer<typeof walletSchema>
export type LocalWallet = Extract<Wallet, { provider: "local-vault" }>
export type WatchWallet = Extract<Wallet, { provider: "read-only" }>

export const parseWallet = (value: unknown): Wallet => walletSchema.parse(value)

export const isLocalWallet = (wallet: Wallet): wallet is LocalWallet =>
  wallet.provider === "local-vault"

export const isWatchWallet = (wallet: Wallet): wallet is WatchWallet =>
  wallet.provider === "read-only"

export const isGroupWallet = (
  wallet: Wallet
): wallet is Extract<Wallet, { kind: "private-key-group" | "watch-group" }> =>
  wallet.kind === "private-key-group" || wallet.kind === "watch-group"
