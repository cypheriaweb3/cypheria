import type {
  AcceptNesNotification,
  AuthenticateRequest,
  CloseNesRequest,
  CloseNesResponse,
  CloseSessionRequest,
  CloseSessionResponse,
  CompleteElicitationNotification,
  ConnectMcpRequest,
  DeleteSessionRequest,
  DeleteSessionResponse,
  DidChangeDocumentNotification,
  DidCloseDocumentNotification,
  DidFocusDocumentNotification,
  DidOpenDocumentNotification,
  DidSaveDocumentNotification,
  DisableProviderRequest,
  DisableProviderResponse,
  DisconnectMcpRequest,
  ForkSessionRequest,
  ForkSessionResponse,
  InitializeRequest,
  InitializeResponse,
  ListProvidersRequest,
  ListProvidersResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  MessageMcpNotification,
  MessageMcpRequest,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  RejectNesNotification,
  ResumeSessionRequest,
  ResumeSessionResponse,
  SessionNotification,
  SetProviderRequest,
  SetProviderResponse,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  SetSessionModeRequest,
  SetSessionModeResponse,
  StartNesRequest,
  StartNesResponse,
  SuggestNesRequest,
  SuggestNesResponse,
} from "@agentclientprotocol/sdk"
import {
  type ClientConnection,
  type ClientContext,
  client,
  methods,
  type Stream,
} from "@agentclientprotocol/sdk"
import type { ACPClientHandlers } from "./types.js"

export class ACPClientRuntime {
  private connection: ClientConnection | null = null
  private context: ClientContext | null = null
  private updateHandler: ((notification: SessionNotification) => void) | undefined

  constructor(
    private readonly handlers: ACPClientHandlers,
    private readonly onUpdate?: (notification: SessionNotification) => void,
    private readonly onElicitationComplete?: (
      notification: CompleteElicitationNotification
    ) => void,
    private readonly onClose?: (error?: unknown) => void,
    private readonly onClientOperation?: (method: string, params: unknown) => void
  ) {}

  private operation(method: string, params: unknown): void {
    this.onClientOperation?.(method, params)
  }

  setSessionUpdateHandler(handler: (notification: SessionNotification) => void): void {
    this.updateHandler = handler
  }

  connect(stream: Stream): void {
    const app = client({ name: "cypheria-acp-ai-provider" })
      .onRequest(methods.client.session.requestPermission, ({ params }) => {
        this.operation(methods.client.session.requestPermission, params)
        return this.handlers.requestPermission
          ? this.handlers.requestPermission(params)
          : Promise.resolve({ outcome: { outcome: "cancelled" as const } })
      })
      .onNotification(methods.client.session.update, async ({ params }) => {
        this.onUpdate?.(params)
        this.updateHandler?.(params)
        await this.handlers.sessionUpdate?.(params)
      })

    const fs = this.handlers.fileSystem
    const readTextFile = fs?.readTextFile
    if (readTextFile) {
      app.onRequest(methods.client.fs.readTextFile, ({ params }) => {
        this.operation(methods.client.fs.readTextFile, params)
        return readTextFile(params)
      })
    }
    const writeTextFile = fs?.writeTextFile
    if (writeTextFile) {
      app.onRequest(methods.client.fs.writeTextFile, async ({ params }) => {
        this.operation(methods.client.fs.writeTextFile, params)
        return (await writeTextFile(params)) ?? {}
      })
    }

    const terminal = this.handlers.terminal
    if (terminal) {
      app
        .onRequest(methods.client.terminal.create, ({ params }) => {
          this.operation(methods.client.terminal.create, params)
          return terminal.create(params)
        })
        .onRequest(methods.client.terminal.output, ({ params }) => {
          this.operation(methods.client.terminal.output, params)
          return terminal.output(params)
        })
        .onRequest(methods.client.terminal.release, async ({ params }) => {
          this.operation(methods.client.terminal.release, params)
          return (await terminal.release(params)) ?? {}
        })
        .onRequest(methods.client.terminal.waitForExit, ({ params }) => {
          this.operation(methods.client.terminal.waitForExit, params)
          return terminal.waitForExit(params)
        })
        .onRequest(methods.client.terminal.kill, async ({ params }) => {
          this.operation(methods.client.terminal.kill, params)
          return (await terminal.kill(params)) ?? {}
        })
    }

    const elicitation = this.handlers.elicitation
    if (elicitation) {
      app.onRequest(methods.client.elicitation.create, ({ params }) => {
        this.operation(methods.client.elicitation.create, params)
        return elicitation.create(params)
      })
      app.onNotification(methods.client.elicitation.complete, async ({ params }) => {
        this.onElicitationComplete?.(params)
        await elicitation.complete?.(params)
      })
    }

    const mcp = this.handlers.mcp
    if (mcp) {
      app
        .onRequest(
          "mcp/connect",
          (value) => value as ConnectMcpRequest,
          ({ params }) => {
            this.operation("mcp/connect", params)
            return mcp.connect(params)
          }
        )
        .onRequest(
          "mcp/message",
          (value) => value as MessageMcpRequest,
          ({ params }) => {
            this.operation("mcp/message", params)
            return mcp.message(params)
          }
        )
        .onRequest(
          "mcp/disconnect",
          (value) => value as DisconnectMcpRequest,
          async ({ params }) => {
            this.operation("mcp/disconnect", params)
            return (await mcp.disconnect(params)) ?? {}
          }
        )
      const notification = mcp.notification
      if (notification) {
        app.onNotification(
          "mcp/message",
          (value) => value as MessageMcpNotification,
          ({ params }) => notification(params)
        )
      }
    }

    this.connection = app.connect(stream)
    this.context = this.connection.agent
    void this.connection.closed.then(
      () => this.onClose?.(),
      (error) => this.onClose?.(error)
    )
  }

  private get agent(): ClientContext {
    if (!this.context) throw new Error("ACP client is not connected")
    return this.context
  }

  initialize(params: InitializeRequest): Promise<InitializeResponse> {
    return this.agent.request(methods.agent.initialize, params)
  }
  authenticate(params: AuthenticateRequest): Promise<void> {
    return this.agent.request(methods.agent.authenticate, params).then(() => undefined)
  }
  logout(): Promise<void> {
    return this.agent.request(methods.agent.logout, {}).then(() => undefined)
  }
  newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    return this.agent.request(methods.agent.session.new, params)
  }
  loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    return this.agent.request(methods.agent.session.load, params)
  }
  prompt(params: PromptRequest): Promise<PromptResponse> {
    return this.agent.request(methods.agent.session.prompt, params)
  }
  cancel(params: { sessionId: string }): Promise<void> {
    return this.agent.notify(methods.agent.session.cancel, params)
  }
  setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse> {
    return this.agent.request(methods.agent.session.setMode, params)
  }
  setSessionConfigOption(
    params: SetSessionConfigOptionRequest
  ): Promise<SetSessionConfigOptionResponse> {
    return this.agent.request(methods.agent.session.setConfigOption, params)
  }
  listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse> {
    return this.agent.request(methods.agent.session.list, params)
  }
  deleteSession(params: DeleteSessionRequest): Promise<DeleteSessionResponse> {
    return this.agent.request(methods.agent.session.delete, params)
  }
  forkSession(params: ForkSessionRequest): Promise<ForkSessionResponse> {
    return this.agent.request(methods.agent.session.fork, params)
  }
  resumeSession(params: ResumeSessionRequest): Promise<ResumeSessionResponse> {
    return this.agent.request(methods.agent.session.resume, params)
  }
  closeSession(params: CloseSessionRequest): Promise<CloseSessionResponse> {
    return this.agent.request(methods.agent.session.close, params)
  }
  listProviders(params: ListProvidersRequest): Promise<ListProvidersResponse> {
    return this.agent.request(methods.agent.providers.list, params)
  }
  setProvider(params: SetProviderRequest): Promise<SetProviderResponse> {
    return this.agent.request(methods.agent.providers.set, params)
  }
  disableProvider(params: DisableProviderRequest): Promise<DisableProviderResponse> {
    return this.agent.request(methods.agent.providers.disable, params)
  }
  startNes(params: StartNesRequest): Promise<StartNesResponse> {
    return this.agent.request(methods.agent.nes.start, params)
  }
  suggestNes(params: SuggestNesRequest): Promise<SuggestNesResponse> {
    return this.agent.request(methods.agent.nes.suggest, params)
  }
  closeNes(params: CloseNesRequest): Promise<CloseNesResponse> {
    return this.agent.request(methods.agent.nes.close, params)
  }
  acceptNes(params: AcceptNesNotification): Promise<void> {
    return this.agent.notify(methods.agent.nes.accept, params)
  }
  rejectNes(params: RejectNesNotification): Promise<void> {
    return this.agent.notify(methods.agent.nes.reject, params)
  }
  didOpen(params: DidOpenDocumentNotification): Promise<void> {
    return this.agent.notify(methods.agent.document.didOpen, params)
  }
  didChange(params: DidChangeDocumentNotification): Promise<void> {
    return this.agent.notify(methods.agent.document.didChange, params)
  }
  didClose(params: DidCloseDocumentNotification): Promise<void> {
    return this.agent.notify(methods.agent.document.didClose, params)
  }
  didSave(params: DidSaveDocumentNotification): Promise<void> {
    return this.agent.notify(methods.agent.document.didSave, params)
  }
  didFocus(params: DidFocusDocumentNotification): Promise<void> {
    return this.agent.notify(methods.agent.document.didFocus, params)
  }
  request<Response = unknown, Params = unknown>(
    method: string,
    params?: Params
  ): Promise<Response> {
    return this.agent.request<Response, Params>(method, params)
  }
  notify<Params = unknown>(method: string, params?: Params): Promise<void> {
    return this.agent.notify<Params>(method, params)
  }
  close(error?: unknown): void {
    this.connection?.close(error)
    this.connection = null
    this.context = null
  }
}
