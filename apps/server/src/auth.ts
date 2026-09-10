import { timingSafeEqual } from "node:crypto"

import { CYPHERIA_WEBSOCKET_PROTOCOL } from "@cypheria/protocol"

const TOKEN_PROTOCOL_PREFIX = "cypheria.bearer."

const safeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export const readBearerToken = (authorization: string | undefined): string | undefined => {
  const match = authorization?.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || undefined
}

export const readWebSocketToken = (protocolHeader: string | undefined): string | undefined =>
  protocolHeader
    ?.split(",")
    .map((protocol) => protocol.trim())
    .find((protocol) => protocol.startsWith(TOKEN_PROTOCOL_PREFIX))
    ?.slice(TOKEN_PROTOCOL_PREFIX.length)

export const hasCypheriaProtocol = (protocolHeader: string | undefined): boolean =>
  protocolHeader
    ?.split(",")
    .map((protocol) => protocol.trim())
    .includes(CYPHERIA_WEBSOCKET_PROTOCOL) ?? false

export const isAuthorized = (provided: string | undefined, expected: string | undefined): boolean =>
  expected === undefined || (provided !== undefined && safeEqual(provided, expected))

export const isOriginAllowed = (origin: string | undefined, allowedOrigins: readonly string[]) =>
  origin === undefined || allowedOrigins.includes(origin)
