import { type ChildProcess, fork } from "node:child_process"
import type { Logger } from "pino"

import {
  isWorkerMessage,
  type SupervisorToWorkerMessage,
  type WorkerToSupervisorMessage,
} from "./process-messages.js"
import type { ServerLifecycleAction } from "./server.js"

export type ServerSupervisorOptions = {
  logger: Logger
  onReady?: (message: Extract<WorkerToSupervisorMessage, { type: "ready" }>) => Promise<void> | void
  workerPath: string
}

const MAX_RESTARTS = 5
const RESTART_WINDOW_MS = 60_000
const HEARTBEAT_TIMEOUT_MS = 30_000

export class ServerSupervisor {
  #child: ChildProcess | undefined
  #lastHeartbeat = 0
  #options: ServerSupervisorOptions
  #requestedAction: ServerLifecycleAction | undefined
  #restartTimer: NodeJS.Timeout | undefined
  #restartTimes: number[] = []
  #settle: ((code: number) => void) | undefined
  #stopTimer: NodeJS.Timeout | undefined
  #watchdog: NodeJS.Timeout | undefined

  constructor(options: ServerSupervisorOptions) {
    this.#options = options
  }

  run(): Promise<number> {
    return new Promise((resolve) => {
      this.#settle = resolve
      this.#installSignals()
      this.#spawnWorker()
      this.#watchdog = setInterval(() => this.#checkHeartbeat(), 5_000)
      this.#watchdog.unref()
    })
  }

  request(action: ServerLifecycleAction, reason?: string): void {
    if (this.#requestedAction === "shutdown") return
    this.#requestedAction = action
    if (this.#restartTimer) clearTimeout(this.#restartTimer)
    this.#restartTimer = undefined
    const message: SupervisorToWorkerMessage = { action, reason, type: "stop" }
    if (this.#child?.connected) {
      const child = this.#child
      child.send(message)
      this.#stopTimer = setTimeout(() => {
        if (this.#child === child) {
          this.#options.logger.error({ pid: child.pid }, "Forcing an unresponsive worker to stop")
          child.kill("SIGKILL")
        }
      }, 10_000)
    } else if (this.#child) {
      this.#child.kill("SIGTERM")
    } else if (action === "restart") {
      this.#requestedAction = undefined
      this.#spawnWorker()
    } else this.#finish(0)
  }

  #spawnWorker(): void {
    this.#lastHeartbeat = Date.now()
    const child = fork(this.#options.workerPath, [], {
      env: process.env,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    })
    this.#child = child
    this.#options.logger.info({ pid: child.pid }, "Started Cypheria server worker")
    child.on("message", (message) => this.#handleMessage(message))
    child.once("exit", (code, signal) => this.#handleExit(code, signal))
    child.once("error", (error) =>
      this.#options.logger.error({ err: error }, "Server worker process failed")
    )
  }

  #handleMessage(value: unknown): void {
    if (!isWorkerMessage(value)) return
    const message = value as WorkerToSupervisorMessage
    if (message.type === "heartbeat") {
      this.#lastHeartbeat = message.timestamp
      return
    }
    if (message.type === "ready") {
      this.#lastHeartbeat = Date.now()
      Promise.resolve(this.#options.onReady?.(message)).catch((error) => {
        this.#options.logger.error({ err: error }, "Unable to persist worker readiness")
        this.request("shutdown", "Unable to persist worker readiness")
      })
      return
    }
    if (message.type === "lifecycle") {
      this.request(message.action, message.reason)
      return
    }
    this.#options.logger.error({ message: message.message }, "Server worker reported a fatal error")
  }

  #handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.#stopTimer) clearTimeout(this.#stopTimer)
    this.#stopTimer = undefined
    this.#options.logger.info({ code, signal }, "Cypheria server worker exited")
    this.#child = undefined
    const requestedAction = this.#requestedAction
    if (requestedAction === "shutdown") {
      this.#finish(code ?? 0)
      return
    }

    const shouldRestart = requestedAction === "restart" || code === 75 || code !== 0
    this.#requestedAction = undefined
    if (!shouldRestart) {
      this.#finish(0)
      return
    }

    if (requestedAction === "restart") {
      this.#restartTimer = setTimeout(() => {
        this.#restartTimer = undefined
        this.#spawnWorker()
      }, 0)
      return
    }

    const now = Date.now()
    this.#restartTimes = this.#restartTimes.filter((time) => now - time < RESTART_WINDOW_MS)
    if (this.#restartTimes.length >= MAX_RESTARTS) {
      this.#options.logger.fatal("Server worker exceeded the restart limit")
      this.#finish(1)
      return
    }
    this.#restartTimes.push(now)
    const delay = Math.min(5_000, 250 * 2 ** (this.#restartTimes.length - 1))
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = undefined
      this.#spawnWorker()
    }, delay)
  }

  #checkHeartbeat(): void {
    if (!this.#child || Date.now() - this.#lastHeartbeat <= HEARTBEAT_TIMEOUT_MS) return
    this.#options.logger.error({ pid: this.#child.pid }, "Server worker heartbeat timed out")
    this.#child.kill("SIGKILL")
  }

  #installSignals(): void {
    process.once("SIGINT", () => this.request("shutdown", "SIGINT"))
    process.once("SIGTERM", () => this.request("shutdown", "SIGTERM"))
    process.on("SIGUSR2", () => this.request("restart", "SIGUSR2"))
  }

  #finish(code: number): void {
    if (this.#watchdog) clearInterval(this.#watchdog)
    if (this.#restartTimer) clearTimeout(this.#restartTimer)
    if (this.#stopTimer) clearTimeout(this.#stopTimer)
    this.#settle?.(code)
    this.#settle = undefined
  }
}
