import { CYPHERIA_WEBSOCKET_PATH } from "@cypheria/protocol"
import { Platform } from "react-native"

import { normalizeServerWebSocketUrl } from "./server-url-core"

export const resolveServerWebSocketUrl = (
  configuredUrl = process.env.EXPO_PUBLIC_CYPHERIA_SERVER_URL
): string => {
  if (configuredUrl) return normalizeServerWebSocketUrl(configuredUrl)

  if (Platform.OS === "web" && typeof location !== "undefined") {
    return normalizeServerWebSocketUrl(location.origin)
  }

  return `ws://127.0.0.1:6768${CYPHERIA_WEBSOCKET_PATH}`
}
