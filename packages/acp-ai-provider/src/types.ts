import type {
  ClientCapabilities,
  CompleteElicitationNotification,
  ConnectMcpRequest,
  ConnectMcpResponse,
  CreateElicitationRequest,
  CreateElicitationResponse,
  CreateTerminalRequest,
  CreateTerminalResponse,
  DisconnectMcpRequest,
  DisconnectMcpResponse,
  InitializeRequest,
  InitializeResponse,
  KillTerminalRequest,
  KillTerminalResponse,
  MessageMcpNotification,
  MessageMcpRequest,
  MessageMcpResponse,
  NewSessionRequest,
  PositionEncodingKind,
  ReadTextFileRequest,
  ReadTextFileResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  Stream,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from "@agentclientprotocol/sdk"

export type ACPSessionConfig = NewSessionRequest
export type ACPInitializeConfig = InitializeRequest

export interface ACPFileSystemHandlers {
  readTextFile?: (request: ReadTextFileRequest) => Promise<ReadTextFileResponse>
  writeTextFile?: (request: WriteTextFileRequest) => Promise<WriteTextFileResponse | undefined>
}

export interface ACPTerminalHandlers {
  create: (request: CreateTerminalRequest) => Promise<CreateTerminalResponse>
  output: (request: TerminalOutputRequest) => Promise<TerminalOutputResponse>
  release: (request: ReleaseTerminalRequest) => Promise<ReleaseTerminalResponse | undefined>
  waitForExit: (request: WaitForTerminalExitRequest) => Promise<WaitForTerminalExitResponse>
  kill: (request: KillTerminalRequest) => Promise<KillTerminalResponse | undefined>
}

export interface ACPElicitationHandlers {
  create: (request: CreateElicitationRequest) => Promise<CreateElicitationResponse>
  complete?: (notification: CompleteElicitationNotification) => Promise<void> | void
  form?: boolean
  url?: boolean
}

export interface ACPMcpHandlers {
  connect: (request: ConnectMcpRequest) => Promise<ConnectMcpResponse>
  message: (request: MessageMcpRequest) => Promise<MessageMcpResponse>
  notification?: (notification: MessageMcpNotification) => Promise<void> | void
  disconnect: (request: DisconnectMcpRequest) => Promise<DisconnectMcpResponse | undefined>
}

export interface ACPClientHandlers {
  /** Defaults to a safe `cancelled` response when omitted. */
  requestPermission?: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>
  fileSystem?: ACPFileSystemHandlers
  terminal?: ACPTerminalHandlers
  elicitation?: ACPElicitationHandlers
  mcp?: ACPMcpHandlers
  sessionUpdate?: (notification: SessionNotification) => Promise<void> | void
}

export interface ACPExperimentalFeatures {
  /** Advertise unstable v1 plan/compaction updates. */
  sessionUpdates?: boolean
  /** Expose providers/*, NES and document synchronization controls. */
  controls?: boolean
  /** Client-side NES suggestion kinds and position encodings to negotiate. */
  nes?: {
    jump?: boolean
    rename?: boolean
    searchAndReplace?: boolean
    positionEncodings?: PositionEncodingKind[]
  }
  /** Explicit opt-in marker required by the separate draft ACP v2 entry point. */
  protocolV2?: boolean
}

export interface ACPStreamTransport {
  type: "stream"
  connect: () => Stream | Promise<Stream>
  close?: () => void | Promise<void>
}

export interface ACPProviderSettings {
  command?: string
  args?: string[]
  env?: Record<string, string>
  /**
   * Environment inherited by a spawned ACP agent. Defaults to a small
   * process-launch allowlist. Use true only for trusted agents, or provide an
   * explicit list of variable names.
   */
  inheritEnv?: boolean | string[]
  transport?: ACPStreamTransport
  session: ACPSessionConfig
  initialize?: ACPInitializeConfig
  authMethodId?: string
  existingSessionId?: string
  persistSession?: boolean
  sessionDelayMs?: number
  handlers?: ACPClientHandlers
  terminalAuth?: boolean
  experimental?: ACPExperimentalFeatures
}

export interface ACPConnectionInfo {
  initialize: InitializeResponse
  clientCapabilities: ClientCapabilities
}

export type ACPEvent =
  | { type: "initialized"; value: ACPConnectionInfo }
  | { type: "session-update"; value: SessionNotification }
  | { type: "elicitation-complete"; value: CompleteElicitationNotification }
  | { type: "client-operation"; method: string; params: unknown }
  | { type: "transport-closed"; error?: unknown }

export type ACPEventListener = (event: ACPEvent) => void
