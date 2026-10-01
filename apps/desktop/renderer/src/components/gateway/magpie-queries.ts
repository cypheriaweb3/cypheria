import type { MagpieServiceView } from "@cypheria/protocol"
import { useQuery } from "@tanstack/react-query"

import { ensureCypheriaClient } from "../../cypheria-client.js"

export const magpieKeys = {
  agents: ["cypheria", "magpie", "agents"] as const,
  groups: ["cypheria", "magpie", "groups"] as const,
  providers: ["cypheria", "magpie", "providers"] as const,
  status: ["cypheria", "magpie", "status"] as const,
  usage: (period: string) => ["cypheria", "magpie", "usage", period] as const,
}

/** The gateway's status; polled while it is on its way between states. */
export function useMagpieStatus() {
  return useQuery({
    queryFn: async () => (await ensureCypheriaClient()).magpie.getStatus(),
    queryKey: magpieKeys.status,
    refetchInterval: (query) => {
      const status = (query.state.data as MagpieServiceView | undefined)?.status
      return status === "installing" || status === "starting" ? 1_000 : 5_000
    },
  })
}

/** Whether magpie answers, for the queries of its own data. */
export function useMagpieReady(): boolean {
  return useMagpieStatus().data?.status === "ready"
}

export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
