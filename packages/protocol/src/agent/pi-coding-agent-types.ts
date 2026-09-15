/**
 * Type-only access to the pinned Pi coding-agent RPC surface.
 *
 * Runtime process ownership remains a server concern. Protocol clients can consume the official
 * RPC, session, event, model, and message types without importing Pi's process-spawning client.
 */
export type * from "@earendil-works/pi-coding-agent"

export type {
  AgentPiClientMessage,
  AgentPiClientRequest,
  AgentPiClientResponse,
  AgentPiServerMessage,
  AgentPiServerRequest,
  AgentPiServerResponse,
  PiRpcCommandName,
  PiRpcParams,
  PiRpcResult,
  PiServerEvent,
} from "./pi.ts"
