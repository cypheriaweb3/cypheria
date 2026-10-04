// Trusted-only Node REPL host bridge and privileged capabilities.

import { Buffer } from "node:buffer"
import {
  type ExecContext,
  type ExecState,
  type HostMessage,
  type HostResponse,
  isPlainObject,
  makeRejectedThenable,
  type NodeReplBridge,
  type ResponseResolver,
  requestHost,
  type Send,
  type TrackedThenable,
  toByteArray,
  trackExecBackgroundOperation,
  type WorkerRuntime,
} from "../worker-runtime.ts"
import { createPrivilegedNodeReplConfig } from "./privileged-config.ts"
import type { TelemetryBridge } from "./tracing.ts"

interface LifecycleHook {
  run: (event?: unknown) => unknown
  timeoutMs: number
}

export interface LifecycleHandlers {
  add(options: unknown): () => boolean
  run(event?: unknown): Promise<void>
}

function createLifecycleHandlers(name: string, concurrent = false): LifecycleHandlers {
  const hooks = new Set<LifecycleHook>()
  return {
    add(options) {
      if (
        !isPlainObject(options) ||
        typeof options.run !== "function" ||
        !Number.isSafeInteger(options.timeoutMs) ||
        (options.timeoutMs as number) <= 0
      ) {
        throw new Error(`nodeRepl.${name} expected { run: function, timeoutMs: positive integer }`)
      }
      const hook: LifecycleHook = {
        run: options.run as LifecycleHook["run"],
        timeoutMs: options.timeoutMs as number,
      }
      hooks.add(hook)
      return () => hooks.delete(hook)
    },
    async run(event) {
      const runHandler = async ({ run, timeoutMs }: LifecycleHook) => {
        let timer: NodeJS.Timeout | undefined
        try {
          await Promise.race([
            Promise.resolve().then(() => run(event)),
            new Promise((resolve) => {
              timer = setTimeout(resolve, timeoutMs)
            }),
          ])
        } catch {
          // Hooks are best-effort side effects.
        } finally {
          clearTimeout(timer)
        }
      }
      if (concurrent) {
        await Promise.all([...hooks].map(runHandler))
      } else {
        for (const hook of [...hooks]) await runHandler(hook)
      }
    },
  }
}

interface HeaderEntry {
  name: string
  value: string
}

interface AuthenticatedFetchResponse {
  status?: unknown
  status_text?: string
  headers?: HeaderEntry[]
  body_base64?: string
}

function createPrivilegedHostOperations({
  execContext,
  pendingRequests,
  send,
}: {
  execContext: ExecContext
  pendingRequests: Map<string, ResponseResolver>
  send: Send
}) {
  let elicitationCounter = 0
  let authenticatedFetchCounter = 0

  function createElicitation(request: unknown): TrackedThenable<unknown> {
    let execState: ExecState
    try {
      execState = execContext.getCurrent()
      if (!execState.formElicitationSupported) {
        throw new Error(
          "nodeRepl.createElicitation is unavailable because the MCP client does not support form elicitation"
        )
      }
    } catch (error) {
      return makeRejectedThenable(error)
    }
    const operation = (async () => {
      const value = await request
      if (!isPlainObject(value)) {
        throw new Error("nodeRepl.createElicitation expected a request object")
      }
      if (
        Object.keys(value).some(
          (key) => key !== "message" && key !== "meta" && key !== "requestedSchema"
        )
      ) {
        throw new Error("nodeRepl.createElicitation received an unsupported value")
      }
      if (typeof value.message !== "string" || value.message.trim().length === 0) {
        throw new Error("nodeRepl.createElicitation expected a non-empty message")
      }
      if (value.meta != null && !isPlainObject(value.meta)) {
        throw new Error("nodeRepl.createElicitation meta must be an object")
      }
      const id = `${execState.id}-elicitation-${elicitationCounter++}`
      const response = await requestHost(
        pendingRequests,
        send,
        {
          type: "elicit",
          id,
          exec_id: execState.id,
          message: value.message,
          requested_schema:
            value.requestedSchema == null
              ? { type: "object", properties: {} }
              : structuredClone(value.requestedSchema),
          meta: value.meta == null ? null : structuredClone(value.meta),
        },
        "createElicitation failed"
      )
      return {
        action: response.action,
        content: response.content ?? null,
        _meta: response._meta ?? null,
      }
    })()
    return trackExecBackgroundOperation(execState, operation)
  }

  function authenticatedFetch(
    input: unknown,
    init: unknown
  ): Promise<Response> | TrackedThenable<Response> {
    let execState: ExecState
    try {
      execState = execContext.getAsync()
    } catch (error) {
      return makeRejectedThenable(error)
    }
    const operation = (async () => {
      if (typeof Request !== "function" || typeof Response !== "function") {
        throw new Error("nodeRepl.fetch requires Request and Response globals")
      }
      const request = new Request(
        (await input) as ConstructorParameters<typeof Request>[0],
        init as RequestInit
      )
      const body = Buffer.from(await request.arrayBuffer())
      const id = `${execState.id}-authenticated-fetch-${authenticatedFetchCounter++}`
      const payload: Record<string, unknown> = {
        method: request.method,
        url: request.url,
        headers: Array.from(request.headers.entries()).map(([name, value]) => ({ name, value })),
      }
      if (body.length > 0) {
        payload.body_base64 = body.toString("base64")
      }
      const result = await requestHost(
        pendingRequests,
        send,
        { type: "authenticated_fetch", id, exec_id: execState.id, request: payload },
        "nodeRepl.fetch failed"
      )
      const response = result.response as AuthenticatedFetchResponse | undefined
      if (!response) {
        throw new Error("nodeRepl.fetch did not return a response")
      }
      const status = Number(response.status)
      const responseBody =
        response.body_base64 && ![204, 205, 304].includes(status)
          ? Buffer.from(response.body_base64, "base64")
          : null
      return new Response(responseBody, {
        headers: (response.headers ?? []).map((header): [string, string] => [
          header.name,
          header.value,
        ]),
        status,
        statusText: response.status_text ?? "",
      })
    })()
    // Trusted libraries issue best-effort background fetches without awaiting
    // them, so fetches must not extend the current exec's drain set.
    void operation.catch(() => {})
    return operation
  }

  return { authenticatedFetch, createElicitation }
}

type NativePipeEvent = "data" | "close" | "error"

interface NativePipeConnectionState {
  execState: ExecState
  listeners: Record<NativePipeEvent, Set<(...args: unknown[]) => unknown>>
  closed: boolean
  error: Error | null
}

function isNativePipeEvent(event: unknown): event is NativePipeEvent {
  return event === "data" || event === "close" || event === "error"
}

export interface NativePipeBridge {
  handleMessage(message: HostMessage): boolean
  nativePipe: Readonly<{ createConnection(pipePath: unknown): Promise<unknown> }>
}

function createNativePipeBridge({
  execContext,
  send,
}: {
  execContext: ExecContext
  send: Send
}): NativePipeBridge {
  const pendingRequests = new Map<string, ResponseResolver>()
  const connections = new Map<string, NativePipeConnectionState>()
  // A peer may close before its connect response resumes in JavaScript.
  const pendingClosures = new Map<string, Error | null>()
  let requestCounter = 0

  async function request(op: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    const id = `native-pipe-${requestCounter++}`
    const response = await requestHost(
      pendingRequests,
      send,
      { type: "native_pipe_request", id, op, ...payload },
      "native pipe request failed"
    )
    return response.result
  }

  function queueListener(listener: (...args: unknown[]) => unknown, ...args: unknown[]): void {
    void Promise.resolve()
      .then(() => listener(...args))
      .catch(() => {})
  }

  function closeConnection(connection: NativePipeConnectionState, error: Error | null): void {
    if (connection.closed) {
      return
    }
    connection.closed = true
    connection.error = error
    execContext.run(connection.execState, () => {
      if (error) {
        for (const listener of connection.listeners.error) {
          queueListener(listener, error)
        }
      }
      for (const listener of connection.listeners.close) {
        queueListener(listener)
      }
    })
  }

  const nativePipe = Object.freeze({
    async createConnection(pipePath: unknown) {
      if (typeof pipePath !== "string" || pipePath.length === 0) {
        throw new Error("native pipe path must be a non-empty string")
      }
      const result = await request("connect", { path: pipePath })
      const connectionId =
        isPlainObject(result) && typeof result.connection_id === "string"
          ? result.connection_id
          : null
      if (!connectionId) {
        throw new Error("native pipe connect returned an invalid connection id")
      }
      const connection: NativePipeConnectionState = {
        execState: execContext.getAsync(),
        listeners: { data: new Set(), close: new Set(), error: new Set() },
        closed: pendingClosures.has(connectionId),
        error: pendingClosures.get(connectionId) ?? null,
      }
      pendingClosures.delete(connectionId)
      if (!connection.closed) {
        connections.set(connectionId, connection)
      }
      return Object.freeze({
        write(data: unknown) {
          if (connection.closed) {
            return
          }
          const current = execContext.getOptional()
          if (current != null) {
            connection.execState = current
          }
          const bytes = toByteArray(data)
          if (!bytes) {
            throw new Error("native pipe write expected bytes")
          }
          void request("write", {
            connection_id: connectionId,
            data_base64: Buffer.from(bytes).toString("base64"),
          }).catch((error: unknown) => {
            // Either a rejected write or a close event is terminal.
            closeConnection(connection, error instanceof Error ? error : new Error(String(error)))
          })
        },
        on(event: unknown, listener: unknown) {
          if (!isNativePipeEvent(event)) {
            throw new Error(`unsupported native pipe event: ${String(event)}`)
          }
          if (typeof listener !== "function") {
            throw new Error("native pipe event listener must be a function")
          }
          const typedListener = listener as (...args: unknown[]) => unknown
          if (connection.listeners[event].has(typedListener)) {
            return
          }
          connection.listeners[event].add(typedListener)
          // Terminal events remain observable to listeners attached late.
          if (event === "error" && connection.error) {
            queueListener(typedListener, connection.error)
          }
          if (event === "close" && connection.closed) {
            queueListener(typedListener)
          }
        },
        off(event: unknown, listener: unknown) {
          if (!isNativePipeEvent(event)) {
            throw new Error(`unsupported native pipe event: ${String(event)}`)
          }
          connection.listeners[event].delete(listener as (...args: unknown[]) => unknown)
        },
        end() {
          void request("close", { connection_id: connectionId }).catch(() => {})
        },
      })
    },
  })

  function handleMessage(message: HostMessage): boolean {
    if (message.type === "native_pipe_response") {
      const resolver = typeof message.id === "string" ? pendingRequests.get(message.id) : undefined
      if (resolver && typeof message.id === "string") {
        pendingRequests.delete(message.id)
        resolver(message as HostResponse)
      }
      return true
    }
    if (message.type === "native_pipe_data") {
      const connection = connections.get(message.connection_id as string)
      if (connection) {
        const data = Buffer.from(message.data_base64 as string, "base64")
        execContext.run(connection.execState, () => {
          for (const listener of connection.listeners.data) {
            listener(data)
          }
        })
      }
      return true
    }
    if (message.type === "native_pipe_closed") {
      const connectionId = message.connection_id as string
      const connection = connections.get(connectionId)
      const error = message.error ? new Error(message.error as string) : null
      if (!connection) {
        pendingClosures.set(connectionId, error)
      } else {
        connections.delete(connectionId)
        closeConnection(connection, error)
      }
      return true
    }
    return false
  }

  return { handleMessage, nativePipe }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function normalizeLaunchServicesTarget(target: unknown): {
  applicationPath: string | undefined
  bundleIdentifier: string | undefined
} {
  if (!isPlainObject(target)) {
    throw new Error("nodeRepl.launchServices.openApplication expected a target object")
  }
  const unexpectedKeys = Object.keys(target).filter(
    (key) => key !== "applicationPath" && key !== "bundleIdentifier"
  )
  if (unexpectedKeys.length > 0) {
    throw new Error("nodeRepl.launchServices.openApplication received an unsupported target")
  }
  const applicationPath = nonEmptyString(target.applicationPath)
  const bundleIdentifier = nonEmptyString(target.bundleIdentifier)
  if ((applicationPath == null) === (bundleIdentifier == null)) {
    throw new Error(
      "nodeRepl.launchServices.openApplication expected exactly one of applicationPath or bundleIdentifier"
    )
  }
  return { applicationPath, bundleIdentifier }
}

function createPrivilegedNodeReplBridge({
  addAfterSubmittedCodeHook,
  addTurnEndedHandler,
  authenticatedFetch,
  createElicitation,
  env,
  getCurrentExecState,
  nativePipe,
  nodeRepl,
  pendingRequests,
  send,
  telemetryBridge,
}: {
  addAfterSubmittedCodeHook: LifecycleHandlers["add"]
  addTurnEndedHandler: LifecycleHandlers["add"]
  authenticatedFetch: (
    input: unknown,
    init: unknown
  ) => Promise<Response> | TrackedThenable<Response>
  createElicitation: (request: unknown) => TrackedThenable<unknown>
  env: Readonly<Record<string, string>>
  getCurrentExecState: () => ExecState
  nativePipe: NativePipeBridge["nativePipe"]
  nodeRepl: NodeReplBridge
  pendingRequests: Map<string, ResponseResolver>
  send: Send
  telemetryBridge: TelemetryBridge | null
}): NodeReplBridge {
  let privilegedNodeReplRequestCounter = 0

  function sendPrivileged(execState: ExecState, message: HostMessage): void {
    send({ ...message, exec_id: execState.id })
  }

  function handlePrivilegedNodeReplOperation(
    operationName: string,
    buildPayload: () => Promise<HostMessage>
  ): TrackedThenable<unknown> {
    let execState: ExecState
    try {
      execState = getCurrentExecState()
    } catch (error) {
      return makeRejectedThenable(error)
    }

    const operation = (async () => {
      const payload = await buildPayload()
      const id = `${execState.id}-privileged-node-repl-${privilegedNodeReplRequestCounter++}`
      const response = await requestHost(
        pendingRequests,
        send,
        { ...payload, id, exec_id: execState.id },
        `${operationName} failed`
      )
      return Object.hasOwn(response, "value") ? response.value : {}
    })()

    return trackExecBackgroundOperation(execState, operation)
  }

  function withSuspendedTimeout(fn: unknown): TrackedThenable<unknown> {
    let execState: ExecState
    try {
      execState = getCurrentExecState()
      if (typeof fn !== "function") {
        throw new Error("nodeRepl.withSuspendedTimeout expected a function")
      }
    } catch (error) {
      return makeRejectedThenable(error)
    }

    const operation = (async () => {
      sendPrivileged(execState, { type: "suspend_timeout" })
      try {
        return await fn()
      } finally {
        sendPrivileged(execState, { type: "resume_timeout" })
      }
    })()

    return trackExecBackgroundOperation(execState, operation)
  }

  const launchServices = Object.freeze({
    openApplication(target: unknown) {
      return handlePrivilegedNodeReplOperation(
        "nodeRepl.launchServices.openApplication",
        async () => {
          const normalized = normalizeLaunchServicesTarget(await target)
          return {
            type: "launch_services_action",
            action: "open_application",
            application_path: normalized.applicationPath,
            bundle_identifier: normalized.bundleIdentifier,
          }
        }
      )
    },
  })

  const locked = (value: unknown): PropertyDescriptor => ({
    configurable: false,
    enumerable: true,
    value,
    writable: false,
  })

  const privilegedNodeReplProperties: PropertyDescriptorMap = {
    addTurnEndedHandler: locked(addTurnEndedHandler),
    addAfterSubmittedCodeHook: locked(addAfterSubmittedCodeHook),
    gaasBrowserConfig: {
      configurable: false,
      enumerable: true,
      get() {
        return getCurrentExecState().gaasBrowserConfig
      },
    },
    launchServices: locked(launchServices),
    config: locked(createPrivilegedNodeReplConfig(handlePrivilegedNodeReplOperation)),
    env: locked(env),
    createElicitation: locked((request: unknown) => createElicitation(request)),
    fetch: locked((input: unknown, init: unknown) => authenticatedFetch(input, init)),
    setResponseMeta: locked((meta: unknown) => {
      const execState = getCurrentExecState()
      if (!isPlainObject(meta)) {
        throw new Error("nodeRepl.setResponseMeta expected a plain object")
      }
      const previous = execState.responseMeta
      const responseMeta = previous
        ? { ...previous, ...structuredClone(meta) }
        : structuredClone(meta)
      execState.responseMeta = responseMeta
      send({ type: "response_meta", id: execState.id, response_meta: responseMeta })
    }),
    nativePipe: locked(nativePipe),
    otel: locked(
      Object.freeze({
        log(name: unknown, attributes: unknown = {}) {
          try {
            sendPrivileged(getCurrentExecState(), { type: "otel_log", name, attributes })
          } catch {
            // Audit export is best effort and must not affect the operation.
          }
        },
      })
    ),
    emitContentItem: locked((text: unknown) => {
      if (typeof text !== "string") {
        throw new Error("nodeRepl.emitContentItem expected a string")
      }
      getCurrentExecState().contentItems.push(text)
    }),
    withSuspendedTimeout: locked(withSuspendedTimeout),
  }
  if (telemetryBridge !== null) {
    privilegedNodeReplProperties.telemetry = locked(telemetryBridge)
  }
  return Object.freeze(Object.create(nodeRepl, privilegedNodeReplProperties))
}

export interface PrivilegedWorkerRuntime {
  afterSubmittedCodeHooks: LifecycleHandlers
  turnEndedHandlers: LifecycleHandlers
  nativePipeBridge: NativePipeBridge
  nodeRepl: NodeReplBridge
}

export function createPrivilegedWorkerRuntime({
  env,
  runtime,
  telemetryBridge = null,
}: {
  env: Readonly<Record<string, string>>
  runtime: WorkerRuntime
  telemetryBridge?: TelemetryBridge | null
}): PrivilegedWorkerRuntime {
  const { execContext, pendingRequests, send } = runtime
  const afterSubmittedCodeHooks = createLifecycleHandlers("addAfterSubmittedCodeHook")
  const turnEndedHandlers = createLifecycleHandlers("addTurnEndedHandler", true)
  const nativePipeBridge = createNativePipeBridge({ execContext, send })
  const { authenticatedFetch, createElicitation } = createPrivilegedHostOperations({
    execContext,
    pendingRequests,
    send,
  })

  return {
    afterSubmittedCodeHooks,
    turnEndedHandlers,
    nativePipeBridge,
    nodeRepl: createPrivilegedNodeReplBridge({
      addAfterSubmittedCodeHook: afterSubmittedCodeHooks.add,
      addTurnEndedHandler: turnEndedHandlers.add,
      authenticatedFetch,
      createElicitation,
      env,
      getCurrentExecState: execContext.getCurrent,
      nativePipe: nativePipeBridge.nativePipe,
      nodeRepl: runtime.nodeRepl,
      pendingRequests,
      send,
      telemetryBridge,
    }),
  }
}
