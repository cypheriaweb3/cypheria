export type RelayRole = "client" | "server"

export type RelayControlMessage =
  | { type: "sync"; connectionIds: string[] }
  | { type: "connected"; connectionId: string }
  | { type: "disconnected"; connectionId: string }

export type RelaySessionAttachment = {
  connectionId?: string
  createdAt: number
  role: RelayRole
  serverId: string
  version: "2"
}
