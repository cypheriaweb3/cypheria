#!/usr/bin/env node
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

import { buildRuntimePaths } from "@cypheria/runtime"

import { isProcessAlive, readPidRecord } from "./pid-lock.js"

const paths = buildRuntimePaths()
const supervisorPath = fileURLToPath(new URL("./supervisor.mjs", import.meta.url))

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

async function waitForReady(timeoutMs = 10_000, previousWorkerPid?: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const record = await readPidRecord(paths.configDir)
    if (
      record?.address &&
      record.workerPid !== previousWorkerPid &&
      isProcessAlive(record.supervisorPid)
    ) {
      try {
        const response = await fetch(`${record.address.url}/api/v1/ready`)
        if (response.ok) return true
      } catch {
        // The worker may still be starting.
      }
    }
    await delay(100)
  }
  return false
}

async function start(foreground: boolean): Promise<number> {
  const running = await readPidRecord(paths.configDir)
  if (running && isProcessAlive(running.supervisorPid)) {
    console.log(`Cypheria server is already running (pid ${running.supervisorPid})`)
    return 0
  }

  const child = spawn(process.execPath, [supervisorPath], {
    detached: !foreground,
    env: process.env,
    stdio: foreground ? "inherit" : "ignore",
  })
  if (foreground) {
    return new Promise((resolve) => child.once("exit", (code) => resolve(code ?? 1)))
  }
  child.unref()
  if (!(await waitForReady())) {
    console.error("Cypheria server did not become ready in time")
    return 1
  }
  const record = await readPidRecord(paths.configDir)
  console.log(`Cypheria server started at ${record?.address?.url}`)
  return 0
}

async function stop(): Promise<number> {
  const record = await readPidRecord(paths.configDir)
  if (!record || !isProcessAlive(record.supervisorPid)) {
    console.log("Cypheria server is not running")
    return 0
  }
  process.kill(record.supervisorPid, "SIGTERM")
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline && isProcessAlive(record.supervisorPid)) await delay(100)
  if (isProcessAlive(record.supervisorPid)) {
    console.error(`Cypheria server did not stop (pid ${record.supervisorPid})`)
    return 1
  }
  console.log("Cypheria server stopped")
  return 0
}

async function status(): Promise<number> {
  const record = await readPidRecord(paths.configDir)
  if (!record || !isProcessAlive(record.supervisorPid)) {
    console.log("Cypheria server is stopped")
    return 1
  }
  const ready = record.address ? await waitForReady(1_000) : false
  console.log(JSON.stringify({ ...record, state: ready ? "ready" : "starting" }, undefined, 2))
  return ready ? 0 : 1
}

async function restart(): Promise<number> {
  const record = await readPidRecord(paths.configDir)
  if (!record || !isProcessAlive(record.supervisorPid)) return start(false)
  process.kill(record.supervisorPid, "SIGUSR2")
  return (await waitForReady(10_000, record.workerPid)) ? 0 : 1
}

const [command = "help", ...args] = process.argv.slice(2)
let exitCode = 0
switch (command) {
  case "start":
    exitCode = await start(args.includes("--foreground"))
    break
  case "stop":
    exitCode = await stop()
    break
  case "restart":
    exitCode = await restart()
    break
  case "status":
    exitCode = await status()
    break
  case "help":
  case "--help":
  case "-h":
    console.log("Usage: cypheria-server <start [--foreground]|stop|restart|status>")
    break
  default:
    console.error(`Unknown command: ${command}`)
    exitCode = 2
}
process.exitCode = exitCode
