import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { resolve } from "node:path"
import { promisify } from "node:util"

import { type CypheriaClient, createCypheriaClient } from "@cypheria/client"

const execFileAsync = promisify(execFile)

export type CliIo = {
  error(value: string): void
  log(value: string): void
}

export type CliDependencies = {
  createClient?: () => CypheriaClient
  env?: NodeJS.ProcessEnv
  invokeServerCli?: (command: "start" | "stop") => Promise<string>
  readLog?: (lines: number) => Promise<string>
}

const usage = `Usage:
  cypheria server <start|stop|status|logs> [--lines N]
  cypheria agents list
  cypheria projects list
  cypheria threads list
  cypheria schedules list`

const print = (io: CliIo, value: unknown): void => io.log(JSON.stringify(value, undefined, 2))

const resolveHome = (env: NodeJS.ProcessEnv): string =>
  env.CYPHERIA_HOME ? resolve(env.CYPHERIA_HOME) : resolve(homedir(), ".cypheria")

const defaultServerCli = (env: NodeJS.ProcessEnv) => async (command: "start" | "stop") => {
  const executable = env.CYPHERIA_SERVER_BIN ?? "cypheria-server"
  const { stderr, stdout } = await execFileAsync(executable, [command], { env })
  return stdout.trim() || stderr.trim()
}

const defaultReadLog = (env: NodeJS.ProcessEnv) => async (lines: number) => {
  const content = await readFile(resolve(resolveHome(env), "logs", "server.log"), "utf8")
  return content.trimEnd().split("\n").slice(-lines).join("\n")
}

const parseLines = (args: readonly string[]): number => {
  const index = args.indexOf("--lines")
  if (index < 0) return 200
  const value = Number(args[index + 1])
  if (!Number.isInteger(value) || value < 1 || value > 10_000) {
    throw new Error("--lines must be an integer between 1 and 10000")
  }
  return value
}

export async function runCli(
  args: readonly string[],
  io: CliIo = console,
  dependencies: CliDependencies = {}
): Promise<number> {
  const env = dependencies.env ?? process.env
  const createClient =
    dependencies.createClient ??
    (() =>
      createCypheriaClient({
        clientType: "cli",
        token: env.CYPHERIA_TOKEN ?? env.CYPHERIA_SERVER_TOKEN,
        url: env.CYPHERIA_SERVER_URL ?? "http://127.0.0.1:6768",
      }))
  const invokeServerCli = dependencies.invokeServerCli ?? defaultServerCli(env)
  const readLog = dependencies.readLog ?? defaultReadLog(env)
  const [scope, command, ...rest] = args

  try {
    if (!scope || scope === "help" || scope === "--help" || scope === "-h") {
      io.log(usage)
      return 0
    }
    if (scope === "server" && (command === "start" || command === "stop")) {
      const output = await invokeServerCli(command)
      if (output) io.log(output)
      return 0
    }
    if (scope === "server" && command === "logs") {
      io.log(await readLog(parseLines(rest)))
      return 0
    }

    const client = createClient()
    try {
      await client.connect()
      if (scope === "server" && command === "status") print(io, await client.server.status())
      else if (scope === "agents" && command === "list") print(io, await client.agents.list())
      else if (scope === "projects" && command === "list") {
        print(io, await client.projects.list({ limit: 100 }))
      } else if (scope === "threads" && command === "list") {
        print(io, await client.threads.list({ limit: 100 }))
      } else if (scope === "schedules" && command === "list") {
        print(io, await client.schedules.list())
      } else {
        io.error(`Unknown command: ${args.join(" ")}\n\n${usage}`)
        return 2
      }
      return 0
    } finally {
      await client.close()
    }
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}
