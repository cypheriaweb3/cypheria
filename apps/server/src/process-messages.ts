import type { CypheriaServerAddress, ServerLifecycleAction } from "./server.js"

export type WorkerToSupervisorMessage =
  | { address: CypheriaServerAddress; pid: number; type: "ready" }
  | { timestamp: number; type: "heartbeat" }
  | { action: ServerLifecycleAction; reason?: string; type: "lifecycle" }
  | { message: string; type: "fatal" }

export type SupervisorToWorkerMessage =
  | { timestamp: number; type: "heartbeat" }
  | {
      action: ServerLifecycleAction
      reason?: string
      type: "stop"
    }

export const isSupervisorMessage = (value: unknown): value is SupervisorToWorkerMessage => {
  if (!value || typeof value !== "object") return false
  const message = value as Record<string, unknown>
  if (message.type === "heartbeat") {
    return typeof message.timestamp === "number" && Number.isFinite(message.timestamp)
  }
  return message.type === "stop" && (message.action === "restart" || message.action === "shutdown")
}

export const isWorkerMessage = (value: unknown): value is WorkerToSupervisorMessage => {
  if (!value || typeof value !== "object") return false
  const message = value as Record<string, unknown>
  if (message.type === "heartbeat") {
    return typeof message.timestamp === "number" && Number.isFinite(message.timestamp)
  }
  if (message.type === "ready") {
    return typeof message.pid === "number" && typeof message.address === "object"
  }
  if (message.type === "lifecycle") {
    return message.action === "restart" || message.action === "shutdown"
  }
  return message.type === "fatal" && typeof message.message === "string"
}
