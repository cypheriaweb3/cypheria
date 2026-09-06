import {
  type ClientConnection,
  type ClientContext,
  type CompleteElicitationNotification,
  type ConnectMcpRequest,
  type ConnectMcpResponse,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  client,
  type DisconnectMcpRequest,
  type DisconnectMcpResponse,
  type InitializationSnapshot,
  type InitializeRequest,
  type MessageMcpNotification,
  type MessageMcpRequest,
  type MessageMcpResponse,
  methods,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type Stream,
  type UpdateSessionNotification,
} from "@agentclientprotocol/sdk/experimental/v2"

export type * from "@agentclientprotocol/sdk/experimental/v2"
export {
  batchNotification,
  batchRequest,
  methods as experimentalV2Methods,
  ndJsonStream as experimentalV2NdJsonStream,
  PROTOCOL_VERSION as EXPERIMENTAL_V2_PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk/experimental/v2"

export interface ACPExperimentalV2Handlers {
  requestPermission?: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>
  sessionUpdate?: (notification: UpdateSessionNotification) => Promise<void> | void
  createElicitation?: (request: CreateElicitationRequest) => Promise<CreateElicitationResponse>
  completeElicitation?: (notification: CompleteElicitationNotification) => Promise<void> | void
  mcp?: {
    connect: (request: ConnectMcpRequest) => Promise<ConnectMcpResponse>
    message: (request: MessageMcpRequest) => Promise<MessageMcpResponse>
    notification?: (notification: MessageMcpNotification) => Promise<void> | void
    disconnect: (request: DisconnectMcpRequest) => Promise<DisconnectMcpResponse | undefined>
  }
}

export interface ACPExperimentalV2ClientSettings {
  /** Mandatory acknowledgement that this wire protocol is an unstable draft. */
  protocolV2: true
  stream: Stream
  initialize: InitializeRequest
  handlers?: ACPExperimentalV2Handlers
}

export class ACPExperimentalV2Client {
  private connection: ClientConnection | null = null
  private context: ClientContext | null = null

  constructor(private readonly settings: ACPExperimentalV2ClientSettings) {
    if (settings.protocolV2 !== true) {
      throw new Error("ACP v2 requires protocolV2: true")
    }
  }

  async connect(): Promise<InitializationSnapshot> {
    const handlers = this.settings.handlers ?? {}
    const app = client({ name: "cypheria-acp-ai-provider-v2" })
      .onRequest(methods.client.session.requestPermission, ({ params }) =>
        handlers.requestPermission
          ? handlers.requestPermission(params)
          : Promise.resolve({ outcome: { outcome: "cancelled" as const } })
      )
      .onNotification(methods.client.session.update, async ({ params }) => {
        await handlers.sessionUpdate?.(params)
      })

    const createElicitation = handlers.createElicitation
    if (createElicitation) {
      app.onRequest(methods.client.elicitation.create, ({ params }) => createElicitation(params))
    }
    app.onNotification(methods.client.elicitation.complete, async ({ params }) => {
      await handlers.completeElicitation?.(params)
    })

    const mcp = handlers.mcp
    if (mcp) {
      app
        .onRequest(methods.client.mcp.connect, ({ params }) => mcp.connect(params))
        .onRequest(methods.client.mcp.message, ({ params }) => mcp.message(params))
        .onRequest(
          methods.client.mcp.disconnect,
          async ({ params }) => (await mcp.disconnect(params)) ?? {}
        )
      const notification = mcp.notification
      if (notification) {
        app.onNotification(methods.client.mcp.message, ({ params }) => notification(params))
      }
    }

    this.connection = app.connect(this.settings.stream)
    this.context = this.connection.agent
    await this.context.request(methods.agent.initialize, this.settings.initialize)
    return this.connection.initialized
  }

  get agent(): ClientContext {
    if (!this.context) throw new Error("Call connect() before using the ACP v2 client")
    return this.context
  }

  close(error?: unknown): void {
    this.connection?.close(error)
    this.connection = null
    this.context = null
  }
}

export async function createExperimentalACPV2Client(
  settings: ACPExperimentalV2ClientSettings
): Promise<ACPExperimentalV2Client> {
  const value = new ACPExperimentalV2Client(settings)
  await value.connect()
  return value
}
