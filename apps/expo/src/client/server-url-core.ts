import { CYPHERIA_WEBSOCKET_PATH } from "@cypheria/protocol"

export const normalizeServerWebSocketUrl = (value: string): string => {
  const url = new URL(value)
  if (url.protocol === "http:") url.protocol = "ws:"
  if (url.protocol === "https:") url.protocol = "wss:"
  if (!["ws:", "wss:"].includes(url.protocol)) {
    throw new Error(`Unsupported Cypheria server protocol: ${url.protocol}`)
  }
  url.pathname = CYPHERIA_WEBSOCKET_PATH
  url.search = ""
  url.hash = ""
  return url.toString()
}
