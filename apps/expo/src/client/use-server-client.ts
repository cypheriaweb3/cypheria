import { useEffect, useSyncExternalStore } from "react"

import { CypheriaServerClient } from "./server-client"

const client = new CypheriaServerClient()
const serverSnapshot = { state: "disconnected" as const }

export const useServerClient = () => {
  const snapshot = useSyncExternalStore(
    client.subscribe,
    () => client.snapshot,
    () => serverSnapshot
  )

  useEffect(() => {
    client.connect()
    return () => client.disconnect()
  }, [])

  return snapshot
}
