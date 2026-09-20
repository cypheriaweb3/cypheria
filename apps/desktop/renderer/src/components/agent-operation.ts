import type { AgentOperation } from "@cypheria/protocol"

import { ensureCypheriaClient } from "../cypheria-client.js"

export async function waitForAgentOperation(
  operation: AgentOperation,
  onProgress?: (operation: AgentOperation) => void
): Promise<AgentOperation> {
  let current = operation
  onProgress?.(current)
  for (;;) {
    if (current.status === "failed") {
      throw new Error(current.error ?? "Agent operation failed")
    }
    if (current.status === "succeeded") return current
    await new Promise<void>((resolve) => setTimeout(resolve, 250))
    current = await (await ensureCypheriaClient()).agents.getOperation(current.id)
    onProgress?.(current)
  }
}
