import { z } from "zod"

export const CYPHERIA_RELAY_PROTOCOL_VERSION = 2 as const
export const CYPHERIA_PAIRING_SCHEME = "cypheria://pair" as const

export const RelayEndpointSchema = z.strictObject({
  endpoint: z.string().trim().min(1).max(2048),
  useTls: z.boolean().optional(),
})
export type RelayEndpoint = z.infer<typeof RelayEndpointSchema>

export const ConnectionOfferV2Schema = z.strictObject({
  relay: RelayEndpointSchema,
  serverId: z.string().trim().min(1).max(256),
  serverPublicKeyB64: z.string().trim().min(1).max(128),
  v: z.literal(CYPHERIA_RELAY_PROTOCOL_VERSION),
})
export type ConnectionOfferV2 = z.infer<typeof ConnectionOfferV2Schema>

export const RelayPairingOfferResponseSchema = z.strictObject({
  offer: ConnectionOfferV2Schema,
  relayConnected: z.boolean(),
  url: z.string().url(),
})
export type RelayPairingOfferResponse = z.infer<typeof RelayPairingOfferResponseSchema>

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export const encodeConnectionOffer = (offer: ConnectionOfferV2): string => {
  const validated = ConnectionOfferV2Schema.parse(offer)
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(validated)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "")
}

export const decodeConnectionOffer = (encoded: string): ConnectionOfferV2 => {
  const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/")
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(base64ToBytes(padded)))
  } catch (error) {
    throw new Error("Invalid Cypheria relay connection offer", { cause: error })
  }
  return ConnectionOfferV2Schema.parse(parsed)
}

export const createConnectionOfferUrl = (offer: ConnectionOfferV2): string =>
  `${CYPHERIA_PAIRING_SCHEME}#offer=${encodeURIComponent(encodeConnectionOffer(offer))}`

export const parseConnectionOffer = (input: string): ConnectionOfferV2 => {
  const trimmed = input.trim()
  if (!trimmed.includes("://")) return decodeConnectionOffer(trimmed)

  let url: URL
  try {
    url = new URL(trimmed)
  } catch (error) {
    throw new Error("Invalid Cypheria pairing URL", { cause: error })
  }
  if (url.protocol !== "cypheria:" || url.hostname !== "pair") {
    throw new Error("Cypheria pairing URL must use cypheria://pair")
  }
  const fragment = new URLSearchParams(url.hash.slice(1))
  const encoded = fragment.get("offer")
  if (!encoded) throw new Error("Cypheria pairing URL is missing its offer")
  return decodeConnectionOffer(encoded)
}
