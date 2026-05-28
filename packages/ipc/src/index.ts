export type IpcNamespace =
  | "codex"
  | "wallet"
  | "chain"
  | "browser"
  | "dapp"
  | "policy"
  | "automation"
  | "approval"
  | "settings"
  | "audit"

export const CYPHERIA_IPC_CHANNELS = {
  appMetadataRead: "app.metadata.read",
  runtimeInfoRead: "runtime.info.read",
} as const

export type CypheriaIpcChannel = (typeof CYPHERIA_IPC_CHANNELS)[keyof typeof CYPHERIA_IPC_CHANNELS]

export type RuntimeInfo = {
  readonly cypheriaHome: string
  readonly codexHome: string
  readonly directories: {
    readonly automation: string
    readonly browser: string
    readonly cache: string
    readonly config: string
    readonly db: string
    readonly logs: string
    readonly vault: string
  }
}

export type AppMetadata = {
  readonly name: string
  readonly version: string
}

export type CypheriaPreloadApi = {
  readonly app: {
    readonly getMetadata: () => Promise<AppMetadata>
  }
  readonly runtime: {
    readonly getInfo: () => Promise<RuntimeInfo>
  }
}
