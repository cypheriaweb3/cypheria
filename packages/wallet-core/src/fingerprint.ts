import { sha256, stringToHex } from "viem"

import type { ChainNamespace } from "./account.js"
import type { HexAddress, WalletFingerprint, WalletId } from "./primitives.js"

const fingerprint = (identity: string): WalletFingerprint =>
  `sha256:${sha256(stringToHex(identity)).slice(2)}`

const normalizeAddress = (address: HexAddress): string => address.toLowerCase()

export const createHdWalletFingerprint = (probeAddress: HexAddress): WalletFingerprint =>
  fingerprint(`cypheria:wallet:v1:hd:secp256k1:eip155:${normalizeAddress(probeAddress)}`)

export const createHdAccountFingerprint = (address: HexAddress): WalletFingerprint =>
  fingerprint(`cypheria:account:v1:hd:secp256k1:eip155:${normalizeAddress(address)}`)

export const createAddressWalletFingerprint = (
  kind: "private-key" | "watch",
  namespace: ChainNamespace,
  address: HexAddress
): WalletFingerprint =>
  fingerprint(`cypheria:wallet:v1:${kind}:${namespace}:${normalizeAddress(address)}`)

export const createAccountFingerprint = (
  kind: "private-key" | "watch",
  namespace: ChainNamespace,
  address: HexAddress
): WalletFingerprint =>
  fingerprint(`cypheria:account:v1:${kind}:${namespace}:${normalizeAddress(address)}`)

export const createGroupWalletFingerprint = (
  kind: "private-key-group" | "watch-group",
  walletId: WalletId
): WalletFingerprint => fingerprint(`cypheria:wallet:v1:${kind}:${walletId}`)
