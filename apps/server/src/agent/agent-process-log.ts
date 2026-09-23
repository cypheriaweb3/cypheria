import type { ChildProcessWithoutNullStreams } from "node:child_process"
import type { Logger } from "pino"

/** Capture process lifecycle without persisting untrusted Agent stderr content. */
export function monitorAgentProcess(child: ChildProcessWithoutNullStreams, logger?: Logger): void {
  let stderrBytes = 0
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.byteLength
  })
  logger?.info({ pid: child.pid }, "Agent process started")
  child.once("error", (error) => {
    logger?.error({ err: error, pid: child.pid }, "Agent process failed")
  })
  child.once("exit", (code, signal) => {
    logger?.info({ code, pid: child.pid, signal, stderrBytes }, "Agent process exited")
  })
}
