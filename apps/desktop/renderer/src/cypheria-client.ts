import { createCypheriaClient } from "@cypheria/client"

export const cypheriaClient = createCypheriaClient({
  appVersion: "0.0.0",
  // Every window and Electron main use the Desktop's one client ID, so the Server joins their
  // connections into one session and one device. Each window registers its own browser host for
  // its tabs and MCP Apps; Electron main registers the device's computer host.
  ...(globalThis.window?.cypheria?.bootstrap.clientId
    ? { clientId: globalThis.window.cypheria.bootstrap.clientId }
    : {}),
  clientType: "desktop",
  reconnect: { enabled: true },
})

export const ensureCypheriaClient = async () => {
  await cypheriaClient.ensureConnected()
  return cypheriaClient
}
