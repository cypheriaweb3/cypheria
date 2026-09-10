import type { CypheriaServerAddress, ServerLifecycleAction } from "./server.js"

export type WorkerToSupervisorMessage =
  | { address: CypheriaServerAddress; pid: number; type: "ready" }
  | { timestamp: number; type: "heartbeat" }
  | { action: ServerLifecycleAction; reason?: string; type: "lifecycle" }
  | { message: string; type: "fatal" }

export type SupervisorToWorkerMessage = {
  action: ServerLifecycleAction
  reason?: string
  type: "stop"
}

export const isSupervisorMessage = (value: unknown): value is SupervisorToWorkerMessage => {
  if (!value || typeof value !== "object") return false
  const message = value as Record<string, unknown>
  return message.type === "stop" && (message.action === "restart" || message.action === "shutdown")
}

export const isWorkerMessage = (value: unknown): value is WorkerToSupervisorMessage => {
  if (!value || typeof value !== "object") return false
  const message = value as Record<string, unknown>
  return ["fatal", "heartbeat", "lifecycle", "ready"].includes(String(message.type))
}
