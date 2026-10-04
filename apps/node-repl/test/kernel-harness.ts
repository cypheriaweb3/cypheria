import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import readline from "node:readline"

export type KernelMessage = Record<string, unknown> & { type?: string; id?: string }

export interface ExecOutcome {
  result: KernelMessage
  messages: KernelMessage[]
}

/** Drives a kernel process over its JSONL stdio protocol. */
export class KernelHarness {
  readonly workingDir: string
  private readonly child: ChildProcessWithoutNullStreams
  private readonly messages: KernelMessage[] = []
  private readonly waiters = new Set<() => void>()
  private execCounter = 0

  constructor(kernelPath: string, env: NodeJS.ProcessEnv = {}) {
    this.workingDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "node-repl-test-")))
    this.child = spawn(
      process.execPath,
      [
        "--experimental-vm-modules",
        "--no-warnings",
        kernelPath,
        "--session-id",
        "test-session",
        "--working-dir",
        this.workingDir,
      ],
      { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] }
    )
    readline.createInterface({ input: this.child.stdout }).on("line", (line) => {
      const message = JSON.parse(line) as KernelMessage
      if (message.type === "emit_image" || message.type === "emit_audio") {
        this.write({ id: message.id, ok: true })
      }
      this.messages.push(message)
      for (const waiter of this.waiters) waiter()
    })
  }

  write(message: KernelMessage): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  async exec(code: string): Promise<ExecOutcome> {
    const id = `exec-${++this.execCounter}`
    const start = this.messages.length
    this.write({ type: "exec", id, code })
    const result = await this.waitFor(
      (message) => message.type === "exec_result" && message.id === id
    )
    return { result, messages: this.messages.slice(start) }
  }

  private waitFor(predicate: (message: KernelMessage) => boolean): Promise<KernelMessage> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const found = this.messages.find(predicate)
        if (found) {
          this.waiters.delete(check)
          clearTimeout(timer)
          resolve(found)
        }
      }
      const timer = setTimeout(() => {
        this.waiters.delete(check)
        reject(new Error("timed out waiting for kernel message"))
      }, 10_000)
      this.waiters.add(check)
      check()
    })
  }

  close(): void {
    this.child.stdin.end()
    this.child.kill()
    fs.rmSync(this.workingDir, { force: true, recursive: true })
  }
}
