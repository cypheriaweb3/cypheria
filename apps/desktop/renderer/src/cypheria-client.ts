import { createCypheriaClient } from "@cypheria/client"

export const cypheriaClient = createCypheriaClient({
  appVersion: "0.0.0",
  clientType: "desktop",
  reconnect: { enabled: true },
})

export const ensureCypheriaClient = async () => {
  await cypheriaClient.ensureConnected()
  return cypheriaClient
}
