import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { resolve } from "node:path"

export const CYPHERIA_HOME_ENV = "CYPHERIA_HOME"
export const CODEX_HOME_ENV = "CODEX_HOME"
export const DEFAULT_CYPHERIA_HOME_BASENAME = ".cypheria"

export type RuntimeHomeEnv = Record<string, string | undefined>

export type RuntimeHomeOptions = {
  readonly env?: RuntimeHomeEnv
  readonly homeDir?: string
}

export type CypheriaRuntimeOptions = RuntimeHomeOptions & {
  readonly ensureDirectories?: boolean
  readonly requestHandlers?: readonly RuntimeRequestHandlerRegistration[]
  readonly services?: readonly RuntimeService[]
}

export type CypheriaRuntimePaths = {
  readonly cypheriaHome: string
  readonly codexHome: string
  readonly dbDir: string
  readonly vaultDir: string
  readonly logsDir: string
  readonly cacheDir: string
  readonly browserDir: string
  readonly automationDir: string
  readonly configDir: string
}

export type RuntimeDirectoryName =
  | "cypheriaHome"
  | "codexHome"
  | "dbDir"
  | "vaultDir"
  | "logsDir"
  | "cacheDir"
  | "browserDir"
  | "automationDir"
  | "configDir"

export const RUNTIME_DIRECTORY_NAMES = [
  "cypheriaHome",
  "codexHome",
  "dbDir",
  "vaultDir",
  "logsDir",
  "cacheDir",
  "browserDir",
  "automationDir",
  "configDir",
] as const satisfies readonly RuntimeDirectoryName[]

export const RUNTIME_METHOD_NAMESPACES = [
  "runtime",
  "wallet",
  "chain",
  "policy",
  "browser",
  "dapp",
  "automation",
  "audit",
  "settings",
] as const

export type RuntimeMethodNamespace = (typeof RUNTIME_METHOD_NAMESPACES)[number]
export type CypheriaRuntimeMethod = `${RuntimeMethodNamespace}.${string}`

export type CypheriaRuntimeLifecycleState =
  | "errored"
  | "ready"
  | "starting"
  | "stopped"
  | "stopping"

export type CypheriaRuntimeDirectories = {
  readonly automation: string
  readonly browser: string
  readonly cache: string
  readonly config: string
  readonly db: string
  readonly logs: string
  readonly vault: string
}

export type CypheriaRuntimeInfo = {
  readonly codexHome: string
  readonly cypheriaHome: string
  readonly directories: CypheriaRuntimeDirectories
  readonly lifecycleState: CypheriaRuntimeLifecycleState
}

export type CypheriaRuntimeHealth = {
  readonly checkedAt: string
  readonly status: "ok"
}

export type RuntimeRequestContext = {
  readonly method: CypheriaRuntimeMethod
  readonly runtime: CypheriaRuntime
  readonly service?: RuntimeService
}

export type RuntimeRequestHandler = (
  params: unknown,
  context: RuntimeRequestContext
) => Promise<unknown> | unknown

export type RuntimeRequestHandlerRegistration = {
  readonly handler: RuntimeRequestHandler
  readonly method: CypheriaRuntimeMethod
}

export type RuntimeServiceContext = {
  readonly paths: CypheriaRuntimePaths
  readonly runtime: CypheriaRuntime
}

export type RuntimeService = {
  readonly handlers?: readonly RuntimeRequestHandlerRegistration[]
  readonly name: string
  readonly namespace: RuntimeMethodNamespace
  readonly start?: (context: RuntimeServiceContext) => Promise<void> | void
  readonly stop?: (context: RuntimeServiceContext) => Promise<void> | void
}

export type RuntimeServiceInfo = {
  readonly methods: readonly CypheriaRuntimeMethod[]
  readonly name: string
  readonly namespace: RuntimeMethodNamespace
}

export type RuntimeErrorCode =
  | "HANDLER_ALREADY_REGISTERED"
  | "INVALID_METHOD"
  | "LIFECYCLE_ERROR"
  | "METHOD_NOT_FOUND"
  | "SERVICE_ALREADY_REGISTERED"
  | "REQUEST_FAILED"

export type CypheriaRuntimeEvent =
  | {
      readonly state: CypheriaRuntimeLifecycleState
      readonly timestamp: string
      readonly type: "runtime.lifecycle"
    }
  | {
      readonly method: CypheriaRuntimeMethod
      readonly timestamp: string
      readonly type: "runtime.request"
    }
  | {
      readonly error: {
        readonly code: RuntimeErrorCode
        readonly message: string
      }
      readonly timestamp: string
      readonly type: "runtime.error"
    }
  | {
      readonly name: string
      readonly namespace: RuntimeMethodNamespace
      readonly timestamp: string
      readonly type: "runtime.service.started" | "runtime.service.stopped"
    }

export class CypheriaRuntimeError extends Error {
  readonly code: RuntimeErrorCode

  constructor(code: RuntimeErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "CypheriaRuntimeError"
    this.code = code
  }
}

type RuntimeEventSubscriber = {
  readonly close: () => void
  readonly enqueue: (event: CypheriaRuntimeEvent) => void
}

type RegisteredRuntimeHandler = {
  readonly handler: RuntimeRequestHandler
  readonly service?: RuntimeService
}

const getConfiguredHome = (env: RuntimeHomeEnv): string | undefined => {
  const value = env[CYPHERIA_HOME_ENV]?.trim()
  return value ? value : undefined
}

export const resolveCypheriaHome = (options: RuntimeHomeOptions = {}): string => {
  const env = options.env ?? process.env
  const configuredHome = getConfiguredHome(env)

  if (configuredHome) {
    return resolve(configuredHome)
  }

  return resolve(options.homeDir ?? homedir(), DEFAULT_CYPHERIA_HOME_BASENAME)
}

export const buildRuntimePaths = (options: RuntimeHomeOptions = {}): CypheriaRuntimePaths => {
  const cypheriaHome = resolveCypheriaHome(options)
  const pathInHome = (name: string) => resolve(cypheriaHome, name)

  return {
    cypheriaHome,
    codexHome: pathInHome("codex"),
    dbDir: pathInHome("db"),
    vaultDir: pathInHome("vault"),
    logsDir: pathInHome("logs"),
    cacheDir: pathInHome("cache"),
    browserDir: pathInHome("browser"),
    automationDir: pathInHome("automation"),
    configDir: pathInHome("config"),
  }
}

export const buildCodexEnvironment = (
  paths: Pick<CypheriaRuntimePaths, "codexHome">,
  baseEnv: RuntimeHomeEnv = process.env
): RuntimeHomeEnv => ({
  ...baseEnv,
  [CODEX_HOME_ENV]: paths.codexHome,
})

export const listRuntimeDirectories = (
  paths: CypheriaRuntimePaths
): readonly [RuntimeDirectoryName, string][] =>
  RUNTIME_DIRECTORY_NAMES.map((name) => [name, paths[name]])

export const ensureRuntimeDirectories = async (paths: CypheriaRuntimePaths): Promise<void> => {
  await Promise.all(
    listRuntimeDirectories(paths).map(([, directory]) => mkdir(directory, { recursive: true }))
  )
}

const nowIso = (): string => new Date().toISOString()

const getRuntimeMethodNamespace = (method: string): string | undefined => method.split(".")[0]

const isRuntimeMethod = (method: string): method is CypheriaRuntimeMethod =>
  method.includes(".") &&
  RUNTIME_METHOD_NAMESPACES.includes(getRuntimeMethodNamespace(method) as RuntimeMethodNamespace)

function assertRuntimeMethod(method: string): asserts method is CypheriaRuntimeMethod {
  if (!isRuntimeMethod(method)) {
    throw new CypheriaRuntimeError(
      "INVALID_METHOD",
      `Runtime method must use a known namespace: ${method}`
    )
  }
}

const toRuntimeInfo = (
  paths: CypheriaRuntimePaths,
  lifecycleState: CypheriaRuntimeLifecycleState
): CypheriaRuntimeInfo => ({
  codexHome: paths.codexHome,
  cypheriaHome: paths.cypheriaHome,
  directories: {
    automation: paths.automationDir,
    browser: paths.browserDir,
    cache: paths.cacheDir,
    config: paths.configDir,
    db: paths.dbDir,
    logs: paths.logsDir,
    vault: paths.vaultDir,
  },
  lifecycleState,
})

export class CypheriaRuntime {
  readonly paths: CypheriaRuntimePaths

  #ensureDirectories: boolean
  #handlers = new Map<CypheriaRuntimeMethod, RegisteredRuntimeHandler>()
  #lifecycleState: CypheriaRuntimeLifecycleState = "stopped"
  #services = new Map<RuntimeMethodNamespace, RuntimeService>()
  #startPromise: Promise<void> | undefined
  #subscribers = new Set<RuntimeEventSubscriber>()

  constructor(options: CypheriaRuntimeOptions = {}) {
    this.paths = buildRuntimePaths(options)
    this.#ensureDirectories = options.ensureDirectories ?? true

    this.registerHandler("runtime.info", () => this.getInfo())
    this.registerHandler("runtime.health", () => ({
      checkedAt: nowIso(),
      status: "ok",
    }))
    this.registerHandler("runtime.services", () => this.listServices())

    for (const service of options.services ?? []) {
      this.registerService(service)
    }

    for (const registration of options.requestHandlers ?? []) {
      this.registerHandler(registration.method, registration.handler)
    }
  }

  get lifecycleState(): CypheriaRuntimeLifecycleState {
    return this.#lifecycleState
  }

  getInfo(): CypheriaRuntimeInfo {
    return toRuntimeInfo(this.paths, this.#lifecycleState)
  }

  registerHandler(method: CypheriaRuntimeMethod, handler: RuntimeRequestHandler): void {
    this.#registerHandler(method, handler)
  }

  unregisterHandler(method: CypheriaRuntimeMethod): boolean {
    assertRuntimeMethod(method)
    return this.#handlers.delete(method)
  }

  registerService(service: RuntimeService): void {
    if (this.#services.has(service.namespace)) {
      throw new CypheriaRuntimeError(
        "SERVICE_ALREADY_REGISTERED",
        `Runtime service is already registered for namespace: ${service.namespace}`
      )
    }

    this.#services.set(service.namespace, service)

    for (const registration of service.handlers ?? []) {
      const namespace = getRuntimeMethodNamespace(registration.method)
      if (namespace !== service.namespace) {
        throw new CypheriaRuntimeError(
          "INVALID_METHOD",
          `Service ${service.name} cannot register method outside namespace ${service.namespace}: ${registration.method}`
        )
      }

      this.#registerHandler(registration.method, registration.handler, service)
    }
  }

  unregisterService(namespace: RuntimeMethodNamespace): boolean {
    const service = this.#services.get(namespace)
    if (!service) {
      return false
    }

    for (const registration of service.handlers ?? []) {
      this.#handlers.delete(registration.method)
    }

    return this.#services.delete(namespace)
  }

  listServices(): RuntimeServiceInfo[] {
    return [...this.#services.values()].map((service) => ({
      methods: (service.handlers ?? []).map((registration) => registration.method),
      name: service.name,
      namespace: service.namespace,
    }))
  }

  #registerHandler(
    method: CypheriaRuntimeMethod,
    handler: RuntimeRequestHandler,
    service?: RuntimeService
  ): void {
    assertRuntimeMethod(method)
    if (this.#handlers.has(method)) {
      throw new CypheriaRuntimeError(
        "HANDLER_ALREADY_REGISTERED",
        `Runtime handler is already registered: ${method}`
      )
    }

    this.#handlers.set(method, { handler, service })
  }

  async start(): Promise<void> {
    if (this.#lifecycleState === "ready") {
      return
    }

    if (this.#startPromise) {
      return this.#startPromise
    }

    this.#startPromise = this.#start()

    try {
      await this.#startPromise
    } finally {
      this.#startPromise = undefined
    }
  }

  async stop(): Promise<void> {
    if (this.#lifecycleState === "stopped") {
      return
    }

    this.#setLifecycleState("stopping")
    try {
      await this.#stopServices()
      this.#setLifecycleState("stopped")
    } catch (error) {
      this.#setLifecycleState("errored")
      throw new CypheriaRuntimeError("LIFECYCLE_ERROR", "Failed to stop Cypheria runtime", {
        cause: error,
      })
    } finally {
      this.#closeSubscribers()
    }
  }

  async request(method: CypheriaRuntimeMethod, params?: unknown): Promise<unknown> {
    assertRuntimeMethod(method)

    if (this.#lifecycleState !== "ready") {
      throw new CypheriaRuntimeError(
        "LIFECYCLE_ERROR",
        `Runtime must be ready before handling requests: ${method}`
      )
    }

    const registration = this.#handlers.get(method)
    if (!registration) {
      throw new CypheriaRuntimeError("METHOD_NOT_FOUND", `Runtime method not found: ${method}`)
    }

    this.#publish({
      method,
      timestamp: nowIso(),
      type: "runtime.request",
    })

    try {
      return await registration.handler(params, {
        method,
        runtime: this,
        service: registration.service,
      })
    } catch (error) {
      const runtimeError =
        error instanceof CypheriaRuntimeError
          ? error
          : new CypheriaRuntimeError("REQUEST_FAILED", `Runtime request failed: ${method}`, {
              cause: error,
            })

      this.#publish({
        error: {
          code: runtimeError.code,
          message: runtimeError.message,
        },
        timestamp: nowIso(),
        type: "runtime.error",
      })

      throw runtimeError
    }
  }

  async *events(): AsyncIterable<CypheriaRuntimeEvent> {
    const queue: CypheriaRuntimeEvent[] = []
    let resolveNext: (() => void) | undefined
    let closed = false

    const subscriber: RuntimeEventSubscriber = {
      close: () => {
        closed = true
        resolveNext?.()
      },
      enqueue: (event) => {
        queue.push(event)
        resolveNext?.()
      },
    }

    this.#subscribers.add(subscriber)

    try {
      while (!closed || queue.length > 0) {
        if (queue.length === 0) {
          await new Promise<void>((resolveNextEvent) => {
            resolveNext = resolveNextEvent
          })
          resolveNext = undefined
          continue
        }

        const event = queue.shift()
        if (event) {
          yield event
        }
      }
    } finally {
      this.#subscribers.delete(subscriber)
    }
  }

  async #start(): Promise<void> {
    this.#setLifecycleState("starting")

    try {
      if (this.#ensureDirectories) {
        await ensureRuntimeDirectories(this.paths)
      }
      await this.#startServices()
      this.#setLifecycleState("ready")
    } catch (error) {
      this.#setLifecycleState("errored")
      throw new CypheriaRuntimeError("LIFECYCLE_ERROR", "Failed to start Cypheria runtime", {
        cause: error,
      })
    }
  }

  #setLifecycleState(state: CypheriaRuntimeLifecycleState): void {
    this.#lifecycleState = state
    this.#publish({
      state,
      timestamp: nowIso(),
      type: "runtime.lifecycle",
    })
  }

  #publish(event: CypheriaRuntimeEvent): void {
    for (const subscriber of this.#subscribers) {
      subscriber.enqueue(event)
    }
  }

  #closeSubscribers(): void {
    for (const subscriber of this.#subscribers) {
      subscriber.close()
    }
    this.#subscribers.clear()
  }

  async #startServices(): Promise<void> {
    for (const service of this.#services.values()) {
      await service.start?.({ paths: this.paths, runtime: this })
      this.#publish({
        name: service.name,
        namespace: service.namespace,
        timestamp: nowIso(),
        type: "runtime.service.started",
      })
    }
  }

  async #stopServices(): Promise<void> {
    const services = [...this.#services.values()].reverse()
    for (const service of services) {
      await service.stop?.({ paths: this.paths, runtime: this })
      this.#publish({
        name: service.name,
        namespace: service.namespace,
        timestamp: nowIso(),
        type: "runtime.service.stopped",
      })
    }
  }
}
