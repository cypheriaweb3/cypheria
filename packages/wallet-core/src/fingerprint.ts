import { sha256, stringToHex } from "viem"

import type { ChainNamespace } from "./account.js"
import type { HexAddress, WalletFingerprint, WalletId } from "./primitives.js"

const fingerprint = (identity: string): WalletFingerprint =>
  `sha256:${sha256(stringToHex(identity)).slice(2)}`

// Checksummed and lowercase spellings of the same EVM address must deduplicate.
const normalizeAddress = (address: HexAddress): string => address.toLowerCase()

/**
 * Fingerprints are deterministic deduplication keys, not authentication secrets.
 * The versioned wallet domain cannot collide with account fingerprints.
 */
export const createHdWalletFingerprint = (probeAddress: HexAddress): WalletFingerprint =>
  fingerprint(`cypheria:wallet:v1:hd:secp256k1:eip155:${normalizeAddress(probeAddress)}`)

/** Creates the account-domain fingerprint for an address derived from an HD source. */
export const createHdAccountFingerprint = (address: HexAddress): WalletFingerprint =>
  fingerprint(`cypheria:account:v1:hd:secp256k1:eip155:${normalizeAddress(address)}`)

/** Fingerprints a single-address wallet while preserving its secret/watch kind. */
export const createAddressWalletFingerprint = (
  kind: "private-key" | "watch",
  namespace: ChainNamespace,
  address: HexAddress
): WalletFingerprint =>
  fingerprint(`cypheria:wallet:v1:${kind}:${namespace}:${normalizeAddress(address)}`)

/** Fingerprints a member account independently of its containing wallet. */
export const createAccountFingerprint = (
  kind: "private-key" | "watch",
  namespace: ChainNamespace,
  address: HexAddress
): WalletFingerprint =>
  fingerprint(`cypheria:account:v1:${kind}:${namespace}:${normalizeAddress(address)}`)

/**
 * Group membership is mutable, so the stable container ID—not the current member
 * set—defines the container fingerprint.
 */
export const createGroupWalletFingerprint = (
  kind: "private-key-group" | "watch-group",
  walletId: WalletId
): WalletFingerprint => fingerprint(`cypheria:wallet:v1:${kind}:${walletId}`)
