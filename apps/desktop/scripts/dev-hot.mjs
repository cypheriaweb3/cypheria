import { spawn, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, open, readFile, unlink } from "node:fs/promises"
import { connect, createServer } from "node:net"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const desktopDirectory = resolve(scriptDirectory, "..")
const workspaceDirectory = resolve(desktopDirectory, "../..")
const pnpmExecutable = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
const rendererOrigin = "http://127.0.0.1:5173"
const serverUrl = "http://127.0.0.1:6768"
const stateDirectory = resolve(desktopDirectory, ".dev-app")
const statePath = resolve(stateDirectory, "hot-dev.json")
const children = new Map()

let controller
let controllerToken
let shuttingDown = false

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))

const readState = async () => {
  try {
    const value = JSON.parse(await readFile(statePath, "utf8"))
    if (
      typeof value?.pid !== "number" ||
      typeof value?.port !== "number" ||
      typeof value?.startedAt !== "string" ||
      typeof value?.token !== "string"
    ) {
      return undefined
    }
    return value
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return undefined
    throw error
  }
}

const removeState = async (token) => {
  const state = await readState()
  if (state?.token !== token) return
  await unlink(statePath).catch((error) => {
    if (error?.code !== "ENOENT") throw error
  })
}

const sendControlRequest = (state, action, timeoutMs = 2_000) =>
  new Promise((resolveRequest, rejectRequest) => {
    const socket = connect({ host: "127.0.0.1", port: state.port })
    let response = ""
    let settled = false
    const timer = setTimeout(() => {
      socket.destroy()
      rejectRequest(new Error("Desktop development controller did not respond"))
    }, timeoutMs)

    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (error) rejectRequest(error)
      else resolveRequest(value)
    }

    socket.setEncoding("utf8")
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ action, token: state.token })}\n`)
    })
    socket.on("data", (chunk) => {
      response += chunk
      const newline = response.indexOf("\n")
      if (newline === -1) return
      try {
        const result = JSON.parse(response.slice(0, newline))
        if (result?.ok !== true) throw new Error(result?.error ?? "Controller rejected the request")
        finish(undefined, result)
      } catch (error) {
        finish(error)
      }
    })
    socket.once("error", (error) => finish(error))
    socket.once("end", () => {
      if (!response.includes("\n")) finish(new Error("Desktop development controller closed"))
    })
  })

const stopExisting = async () => {
  const state = await readState()
  if (!state) {
    console.log("[dev:desktop] Desktop development stack is not running")
    return
  }

  try {
    await sendControlRequest(state, "stop", 5_000)
  } catch (error) {
    await removeState(state.token)
    console.log(
      `[dev:desktop] Removed a stale development state file (${error instanceof Error ? error.message : String(error)})`
    )
    return
  }

  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if ((await readState())?.token !== state.token) {
      console.log("[dev:desktop] Desktop development stack stopped")
      return
    }
    await delay(100)
  }
  throw new Error("Desktop development stack did not stop within 10 seconds")
}

const mergeAllowedOrigins = (value, origin) =>
  [
    ...new Set([
      ...(value ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
      origin,
    ]),
  ].join(",")

const run = (name, args) => {
  console.log(`\n[dev:desktop] ${name}`)
  const result = spawnSync(pnpmExecutable, args, {
    cwd: workspaceDirectory,
    env: process.env,
    stdio: "inherit",
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${name} exited with status ${result.status ?? "unknown"}`)
  }
}

const stopProcessTree = (child, signal) => {
  if (child.exitCode !== null || child.signalCode !== null) return

  if (process.platform === "win32") {
    spawnSync(
      "taskkill",
      ["/pid", String(child.pid), "/t", ...(signal === "SIGKILL" ? ["/f"] : [])],
      {
        stdio: "ignore",
        windowsHide: true,
      }
    )
    return
  }

  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if (error?.code !== "ESRCH") throw error
  }
}

const waitForExit = (child) =>
  child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve()
    : new Promise((resolveExit) => child.once("exit", resolveExit))

const shutdown = async (exitCode = 0, reason) => {
  if (shuttingDown) return
  shuttingDown = true
  if (reason) console.error(`\n[dev:desktop] ${reason}`)

  const running = [...children.values()]
  for (const child of running) stopProcessTree(child, "SIGTERM")

  const forceTimer = setTimeout(() => {
    for (const child of running) stopProcessTree(child, "SIGKILL")
  }, 5_000)
  forceTimer.unref()

  await Promise.all(running.map(waitForExit))
  clearTimeout(forceTimer)
  await new Promise((resolveClose) => {
    if (!controller?.listening) {
      resolveClose()
      return
    }
    controller.close(resolveClose)
  })
  if (controllerToken) await removeState(controllerToken)
  process.exitCode = exitCode
}

const acquireController = async () => {
  await mkdir(stateDirectory, { mode: 0o700, recursive: true })
  const token = randomUUID()
  const server = createServer((socket) => {
    socket.setEncoding("utf8")
    let request = ""
    socket.on("data", (chunk) => {
      request += chunk
      const newline = request.indexOf("\n")
      if (newline === -1) return

      try {
        const message = JSON.parse(request.slice(0, newline))
        if (message?.token !== token) throw new Error("Invalid controller token")
        if (message.action === "status") {
          socket.end(`${JSON.stringify({ ok: true, status: "running" })}\n`)
          return
        }
        if (message.action === "stop") {
          socket.end(`${JSON.stringify({ ok: true })}\n`, () => void shutdown())
          return
        }
        throw new Error("Unknown controller action")
      } catch (error) {
        socket.end(
          `${JSON.stringify({ error: error instanceof Error ? error.message : String(error), ok: false })}\n`
        )
      }
    })
  })

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen)
    server.listen(0, "127.0.0.1", resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    server.close()
    throw new Error("Unable to create Desktop development controller")
  }

  const record = {
    pid: process.pid,
    port: address.port,
    startedAt: new Date().toISOString(),
    token,
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const file = await open(statePath, "wx", 0o600)
      try {
        await file.writeFile(`${JSON.stringify(record)}\n`)
      } finally {
        await file.close()
      }
      controller = server
      controllerToken = token
      return
    } catch (error) {
      if (error?.code !== "EEXIST") {
        server.close()
        throw error
      }
      const existing = await readState()
      if (existing) {
        try {
          await sendControlRequest(existing, "status")
          server.close()
          throw new Error(`Desktop development stack is already running (pid ${existing.pid})`)
        } catch (controlError) {
          if (
            controlError instanceof Error &&
            controlError.message.startsWith("Desktop development stack is already running")
          ) {
            throw controlError
          }
        }
      }
      await unlink(statePath).catch((unlinkError) => {
        if (unlinkError?.code !== "ENOENT") throw unlinkError
      })
    }
  }

  server.close()
  throw new Error(`Unable to acquire Desktop development state at ${statePath}`)
}

const start = (name, args, env = process.env) => {
  console.log(`[dev:desktop] Starting ${name}`)
  const child = spawn(pnpmExecutable, args, {
    cwd: workspaceDirectory,
    detached: process.platform !== "win32",
    env,
    stdio: "inherit",
    windowsHide: true,
  })
  children.set(name, child)

  child.once("error", (error) => {
    void shutdown(1, `${name} failed to start: ${error.message}`)
  })
  child.once("exit", (code, signal) => {
    children.delete(name)
    if (shuttingDown) return
    const outcome = signal ? `signal ${signal}` : `status ${code ?? "unknown"}`
    void shutdown(code ?? 1, `${name} exited with ${outcome}`)
  })

  return child
}

const waitForUrl = async (name, url, child, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`${name} exited before becoming ready`)
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) {
        console.log(`[dev:desktop] ${name} is ready at ${url}`)
        return
      }
    } catch {
      // The watcher or development server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`${name} did not become ready at ${url}`)
}

const command = process.argv[2] ?? "start"

if (command === "stop") {
  await stopExisting()
} else if (command !== "start") {
  console.error("Usage: dev-hot.mjs <start|stop>")
  process.exitCode = 1
} else {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      void shutdown(signal === "SIGINT" ? 130 : 143)
    })
  }

  try {
    await acquireController()
    run("Building Electron main", ["--filter", "@cypheria/desktop", "run", "build:main"])
    run("Building Electron preload", ["--filter", "@cypheria/desktop", "run", "build:preload"])
    run("Building dApp preload", ["--filter", "@cypheria/desktop", "run", "build:dapp-preload"])
    run("Rebuilding native Desktop modules", [
      "--filter",
      "@cypheria/desktop",
      "run",
      "rebuild:native",
    ])

    const server = start("Server", ["--filter", "@cypheria/server", "run", "dev"], {
      ...process.env,
      CYPHERIA_SERVER_ALLOWED_ORIGINS: mergeAllowedOrigins(
        process.env.CYPHERIA_SERVER_ALLOWED_ORIGINS,
        rendererOrigin
      ),
      CYPHERIA_SERVER_WEB_ENABLED: "false",
    })
    const renderer = start("Vite renderer", [
      "--filter",
      "@cypheria/desktop",
      "run",
      "dev:renderer",
    ])

    await Promise.all([
      waitForUrl("Server", `${serverUrl}/api/v1/ready`, server),
      waitForUrl("Vite renderer", rendererOrigin, renderer),
    ])

    start("Electron", ["--filter", "@cypheria/desktop", "run", "dev:launch"], {
      ...process.env,
      CYPHERIA_RENDERER_URL: rendererOrigin,
    })
  } catch (error) {
    await shutdown(1, error instanceof Error ? error.message : String(error))
  }
}
