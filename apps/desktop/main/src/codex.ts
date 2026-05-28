import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"

import {
  type CodexLifecycleState,
  type CodexNormalizedEvent,
  type CodexTransport,
  createCodexJsonlMessageBuffer,
  createCodexLifecycleEvent,
  createCodexNotification,
  createCodexRequest,
  createCodexRequestIdGenerator,
  normalizeCodexJsonlLine,
  stringifyCodexWireMessage,
} from "@cypheria/codex-bridge"

import type { DesktopRuntimeContext } from "./runtime.js"

export type CodexProcessExitState = {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly timestamp: string
}

export type CodexProcessSupervisorOptions = {
  readonly args?: readonly string[]
  readonly command?: string
  readonly context: DesktopRuntimeContext
  readonly onEvent?: (event: CodexNormalizedEvent) => void
  readonly onStderrLine?: (line: string) => void
}

export type CodexProcessSupervisor = CodexTransport & {
  readonly getLastExit: () => CodexProcessExitState | undefined
  readonly shouldRestart: (exitState: CodexProcessExitState) => boolean
  readonly start: () => Promise<void>
  readonly stop: () => Promise<CodexProcessExitState | undefined>
}

const DEFAULT_CODEX_COMMAND = "codex"
const DEFAULT_CODEX_APP_SERVER_ARGS = ["app-server", "--listen", "stdio://"] as const

const splitCompleteLines = (value: string): readonly [readonly string[], string] => {
  const lines = value.split(/\r?\n/u)
  return [lines.slice(0, -1), lines.at(-1) ?? ""]
}

export const createCodexProcessSupervisor = (
  options: CodexProcessSupervisorOptions
): CodexProcessSupervisor => {
  const command = options.command ?? DEFAULT_CODEX_COMMAND
  const args = [...(options.args ?? DEFAULT_CODEX_APP_SERVER_ARGS)]
  const nextRequestId = createCodexRequestIdGenerator("codex")
  const stdoutBuffer = createCodexJsonlMessageBuffer()
  let stderrBuffer = ""
  let child: ChildProcessWithoutNullStreams | undefined
  let state: CodexLifecycleState = "stopped"
  let lastExit: CodexProcessExitState | undefined

  const emit = (event: CodexNormalizedEvent): void => {
    options.onEvent?.(event)
  }

  const setState = (nextState: CodexLifecycleState): void => {
    state = nextState
    emit(createCodexLifecycleEvent(nextState))
  }

  const handleStdoutChunk = (chunk: Buffer): void => {
    for (const parsed of stdoutBuffer.append(chunk.toString("utf8"))) {
      const event = normalizeCodexJsonlLine(parsed)
      if (event) {
        emit(event)
      }
    }
  }

  const flushStdout = (): void => {
    const parsed = stdoutBuffer.flush()
    if (!parsed) {
      return
    }

    const event = normalizeCodexJsonlLine(parsed)
    if (event) {
      emit(event)
    }
  }

  const handleStderrChunk = (chunk: Buffer): void => {
    const [lines, remaining] = splitCompleteLines(`${stderrBuffer}${chunk.toString("utf8")}`)
    stderrBuffer = remaining

    for (const line of lines) {
      if (line) {
        options.onStderrLine?.(line)
      }
    }
  }

  const writeToStdin = (value: string): void => {
    if (!child?.stdin.writable) {
      throw new Error("Codex App Server transport is not writable")
    }

    child.stdin.write(value)
  }

  const stop = async (): Promise<CodexProcessExitState | undefined> => {
    if (!child) {
      return lastExit
    }

    const currentChild = child
    setState("closing")

    return await new Promise<CodexProcessExitState | undefined>((resolve) => {
      const timeout = setTimeout(() => {
        currentChild.kill("SIGKILL")
      }, 3000)

      currentChild.once("exit", () => {
        clearTimeout(timeout)
        resolve(lastExit)
      })

      currentChild.kill("SIGTERM")
    })
  }

  return {
    close: async () => {
      await stop()
    },
    getLastExit: () => lastExit,
    getState: () => state,
    sendNotification: (method, params) => {
      writeToStdin(stringifyCodexWireMessage(createCodexNotification(method, params)))
    },
    sendRequest: (method, params, id = nextRequestId()) => {
      writeToStdin(stringifyCodexWireMessage(createCodexRequest(method, params, id)))
      return id
    },
    shouldRestart: () => false,
    start: async () => {
      if (child) {
        return
      }

      setState("starting")

      const spawned = spawn(command, args, {
        env: options.context.codexEnv,
        stdio: "pipe",
      })
      child = spawned

      spawned.stdout.on("data", handleStdoutChunk)
      spawned.stderr.on("data", handleStderrChunk)

      spawned.once("exit", (code, signal) => {
        flushStdout()

        if (stderrBuffer) {
          options.onStderrLine?.(stderrBuffer)
          stderrBuffer = ""
        }

        lastExit = {
          code,
          signal,
          timestamp: new Date().toISOString(),
        }
        child = undefined
        setState(code === 0 ? "closed" : "errored")
      })

      await new Promise<void>((resolve, reject) => {
        spawned.once("spawn", () => {
          setState("ready")
          resolve()
        })

        spawned.once("error", (error) => {
          child = undefined
          setState("errored")
          emit({
            error: {
              cause: error,
              code: "TRANSPORT_ERROR",
              message: error.message,
            },
            timestamp: new Date().toISOString(),
            type: "codex.transport.error",
          })
          reject(error)
        })
      })
    },
    stop,
  }
}
