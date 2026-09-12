import type { ConnectionOfferV2, RelayEndpoint } from "@cypheria/protocol"
import type { RelayRole } from "./types.js"

export type RelayWebSocketUrlOptions = {
  connectionId?: string
  endpoint: RelayEndpoint
  role: RelayRole
  serverId: string
}

export const resolveRelayWebSocketUrl = ({
  connectionId,
  endpoint,
  role,
  serverId,
}: RelayWebSocketUrlOptions): string => {
  const explicitScheme = /^[a-z][a-z\d+.-]*:\/\//iu.test(endpoint.endpoint)
  const input = explicitScheme
    ? endpoint.endpoint
    : `${endpoint.useTls === false ? "ws" : "wss"}://${endpoint.endpoint}`
  const url = new URL(input)
  if (url.protocol === "http:") url.protocol = "ws:"
  if (url.protocol === "https:") url.protocol = "wss:"
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("Relay endpoint must use http, https, ws, or wss")
  }
  if (!url.pathname || url.pathname === "/") url.pathname = "/ws"
  url.searchParams.set("serverId", serverId)
  url.searchParams.set("role", role)
  url.searchParams.set("v", "2")
  if (connectionId) url.searchParams.set("connectionId", connectionId)
  else url.searchParams.delete("connectionId")
  return url.toString()
}

export const resolveClientRelayWebSocketUrl = (offer: ConnectionOfferV2): string =>
  resolveRelayWebSocketUrl({ endpoint: offer.relay, role: "client", serverId: offer.serverId })
