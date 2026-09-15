import type {
  PiBlockingExtensionUIMethod,
  PiExtensionUIRequest,
  PiRpcCommandName,
  PiRpcParams,
  PiRpcResult,
  PiServerEvent,
} from "@cypheria/protocol"
import type { CypheriaApi } from "./index.js"
import { observePiEndpoint, type PiEndpoint, type PiExtensionUIAnswer } from "./pi-endpoint.js"
import type { RequestOptions } from "./request-options.js"

export type {
  PiBlockingExtensionUIMethod,
  PiExtensionUIRequest,
  PiRpcCommandName,
  PiRpcParams,
  PiRpcResult,
  PiServerEvent,
} from "@cypheria/protocol"
export type * from "@cypheria/protocol/pi-types"

export type PiRpcEventListener = (event: PiServerEvent) => void

type PiImages = PiRpcParams<"prompt">["images"]
type PiThinkingLevel = PiRpcParams<"set_thinking_level">["level"]
type PiQueueMode = PiRpcParams<"set_steering_mode">["mode"]

const asError = (value: unknown, fallback: string): Error =>
  value instanceof Error ? value : new Error(value === undefined ? fallback : String(value))

/**
 * Pi RPC API over a borrowed Cypheria connection.
 *
 * Unlike Pi's local RpcClient, this class never spawns or terminates a process. The Cypheria server
 * owns `pi --mode rpc`; this facade only maps typed commands, responses, events, and extension UI.
 */
export class RpcClient {
  readonly #endpoint: PiEndpoint

  constructor(endpoint: PiEndpoint) {
    this.#endpoint = endpoint
  }

  request<Command extends PiRpcCommandName>(
    command: Command,
    params: PiRpcParams<Command>,
    options?: RequestOptions
  ): Promise<PiRpcResult<Command>> {
    return this.#endpoint.request(command, params, options)
  }

  onEvent(listener: PiRpcEventListener): () => void {
    return this.#endpoint.subscribe((message) => {
      if (!("payload" in message)) return
      const payload: unknown = message.payload
      if (
        typeof payload === "object" &&
        payload !== null &&
        !Array.isArray(payload) &&
        "type" in payload
      ) {
        listener(payload as PiServerEvent)
      }
    })
  }

  respondToExtensionUI<Method extends PiBlockingExtensionUIMethod>(
    request: PiExtensionUIRequest<Method>,
    answer: PiExtensionUIAnswer<Method>
  ): Promise<void> {
    const correlation = request as { readonly id: string; readonly method: Method }
    return this.#endpoint.respondToExtensionUI(correlation.method, correlation.id, answer)
  }

  async prompt(
    message: string,
    images?: PiImages,
    streamingBehavior?: PiRpcParams<"prompt">["streamingBehavior"]
  ): Promise<void> {
    await this.request("prompt", {
      ...(images === undefined ? {} : { images }),
      message,
      ...(streamingBehavior === undefined ? {} : { streamingBehavior }),
    })
  }

  async steer(message: string, images?: PiImages): Promise<void> {
    await this.request("steer", { ...(images === undefined ? {} : { images }), message })
  }

  async followUp(message: string, images?: PiImages): Promise<void> {
    await this.request("follow_up", { ...(images === undefined ? {} : { images }), message })
  }

  async abort(): Promise<void> {
    await this.request("abort", {})
  }

  clearQueue(): Promise<PiRpcResult<"clear_queue">> {
    return this.request("clear_queue", {})
  }

  newSession(parentSession?: string): Promise<PiRpcResult<"new_session">> {
    return this.request("new_session", {
      ...(parentSession === undefined ? {} : { parentSession }),
    })
  }

  getState(): Promise<PiRpcResult<"get_state">> {
    return this.request("get_state", {})
  }

  setModel(provider: string, modelId: string): Promise<PiRpcResult<"set_model">> {
    return this.request("set_model", { modelId, provider })
  }

  cycleModel(): Promise<PiRpcResult<"cycle_model">> {
    return this.request("cycle_model", {})
  }

  async getAvailableModels(): Promise<PiRpcResult<"get_available_models">["models"]> {
    return (await this.request("get_available_models", {})).models
  }

  async setThinkingLevel(level: PiThinkingLevel): Promise<void> {
    await this.request("set_thinking_level", { level })
  }

  cycleThinkingLevel(): Promise<PiRpcResult<"cycle_thinking_level">> {
    return this.request("cycle_thinking_level", {})
  }

  async getAvailableThinkingLevels(): Promise<
    PiRpcResult<"get_available_thinking_levels">["levels"]
  > {
    return (await this.request("get_available_thinking_levels", {})).levels
  }

  async setSteeringMode(mode: PiQueueMode): Promise<void> {
    await this.request("set_steering_mode", { mode })
  }

  async setFollowUpMode(mode: PiRpcParams<"set_follow_up_mode">["mode"]): Promise<void> {
    await this.request("set_follow_up_mode", { mode })
  }

  compact(customInstructions?: string): Promise<PiRpcResult<"compact">> {
    return this.request("compact", {
      ...(customInstructions === undefined ? {} : { customInstructions }),
    })
  }

  async setAutoCompaction(enabled: boolean): Promise<void> {
    await this.request("set_auto_compaction", { enabled })
  }

  async setAutoRetry(enabled: boolean): Promise<void> {
    await this.request("set_auto_retry", { enabled })
  }

  async abortRetry(): Promise<void> {
    await this.request("abort_retry", {})
  }

  bash(command: string, excludeFromContext?: boolean): Promise<PiRpcResult<"bash">> {
    return this.request("bash", {
      command,
      ...(excludeFromContext === undefined ? {} : { excludeFromContext }),
    })
  }

  async abortBash(): Promise<void> {
    await this.request("abort_bash", {})
  }

  getSessionStats(): Promise<PiRpcResult<"get_session_stats">> {
    return this.request("get_session_stats", {})
  }

  exportHtml(outputPath?: string): Promise<PiRpcResult<"export_html">> {
    return this.request("export_html", { ...(outputPath === undefined ? {} : { outputPath }) })
  }

  switchSession(sessionPath: string): Promise<PiRpcResult<"switch_session">> {
    return this.request("switch_session", { sessionPath })
  }

  fork(entryId: string): Promise<PiRpcResult<"fork">> {
    return this.request("fork", { entryId })
  }

  clone(): Promise<PiRpcResult<"clone">> {
    return this.request("clone", {})
  }

  async getForkMessages(): Promise<PiRpcResult<"get_fork_messages">["messages"]> {
    return (await this.request("get_fork_messages", {})).messages
  }

  getEntries(since?: string): Promise<PiRpcResult<"get_entries">> {
    return this.request("get_entries", { ...(since === undefined ? {} : { since }) })
  }

  getTree(): Promise<PiRpcResult<"get_tree">> {
    return this.request("get_tree", {})
  }

  async getLastAssistantText(): Promise<string | null> {
    return (await this.request("get_last_assistant_text", {})).text
  }

  async setSessionName(name: string): Promise<void> {
    await this.request("set_session_name", { name })
  }

  async getMessages(): Promise<PiRpcResult<"get_messages">["messages"]> {
    return (await this.request("get_messages", {})).messages
  }

  async getCommands(): Promise<PiRpcResult<"get_commands">["commands"]> {
    return (await this.request("get_commands", {})).commands
  }

  waitForIdle(timeout = 60_000): Promise<void> {
    return this.#createEventCollection(timeout, "waiting for Pi agent to become idle").promise.then(
      () => undefined
    )
  }

  collectEvents(timeout = 60_000): Promise<PiServerEvent[]> {
    return this.#createEventCollection(timeout, "collecting Pi agent events").promise
  }

  async promptAndWait(
    message: string,
    images?: PiImages,
    timeout = 60_000,
    streamingBehavior?: PiRpcParams<"prompt">["streamingBehavior"]
  ): Promise<PiServerEvent[]> {
    const collection = this.#createEventCollection(timeout, "collecting Pi agent events")
    try {
      await this.prompt(message, images, streamingBehavior)
    } catch (error) {
      const failure = asError(error, "Pi prompt failed")
      collection.cancel(failure)
      void collection.promise.catch(() => undefined)
      throw failure
    }
    return collection.promise
  }

  #createEventCollection(
    timeout: number,
    timeoutDescription: string
  ): { cancel: (error: Error) => void; promise: Promise<PiServerEvent[]> } {
    let cancel = (_error: Error): void => undefined
    const promise = new Promise<PiServerEvent[]>((resolve, reject) => {
      const events: PiServerEvent[] = []
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      let unsubscribe = (): void => undefined
      let removeConnectionObserver = (): void => undefined
      const cleanup = (): void => {
        if (timer) clearTimeout(timer)
        unsubscribe()
        removeConnectionObserver()
      }
      const finish = (action: () => void): void => {
        if (settled) return
        settled = true
        cleanup()
        action()
      }
      cancel = (error) => finish(() => reject(error))
      timer = setTimeout(() => cancel(new Error(`Timeout ${timeoutDescription}`)), timeout)
      unsubscribe = this.onEvent((event) => {
        events.push(event)
        if (event.type === "agent_settled") finish(() => resolve(events))
      })
      removeConnectionObserver = observePiEndpoint(this.#endpoint, cancel)
      if (settled) removeConnectionObserver()
    })
    return { cancel, promise }
  }
}

/** Binds Pi's RPC-shaped client to an existing, borrowed Cypheria API connection. */
export const client = (cypheria: CypheriaApi): RpcClient => new RpcClient(cypheria.agent.pi)
