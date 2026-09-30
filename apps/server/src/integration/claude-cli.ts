import { z } from "zod"

/**
 * Typed wrapper over `claude plugin … --json`. The CLI is pinned by
 * NATIVE_AGENT_MANIFEST, so a shape mismatch is a Server defect and is
 * reported rather than tolerated.
 */
export interface ClaudeCliRunner {
  run(
    args: string[],
    options?: { input?: string; timeoutMs?: number }
  ): Promise<{ exitCode: number; stderr: string; stdout: string }>
}

export class ClaudeCliError extends Error {
  constructor(message: string, code = "INTEGRATION_ERROR") {
    super(message)
    this.name = code
  }
}

const InstalledPluginSchema = z
  .object({
    enabled: z.boolean(),
    errors: z.array(z.string()).optional(),
    hasUserConfig: z.boolean().optional(),
    id: z.string().min(1),
    installPath: z.string(),
    mcpServers: z.record(z.string(), z.unknown()).optional(),
    notes: z.array(z.string()).optional(),
    scope: z.string(),
    version: z.string(),
  })
  .passthrough()
export type ClaudeInstalledPlugin = z.infer<typeof InstalledPluginSchema>

const PluginSourceSchema = z.union([z.string(), z.object({ source: z.string() }).passthrough()])
export type ClaudePluginSource = z.infer<typeof PluginSourceSchema>

const AvailablePluginSchema = z
  .object({
    description: z.string().optional(),
    installCount: z.number().optional(),
    marketplaceName: z.string().min(1),
    name: z.string().min(1),
    pluginId: z.string().min(1),
    source: PluginSourceSchema,
    version: z.string().optional(),
  })
  .passthrough()
export type ClaudeAvailablePlugin = z.infer<typeof AvailablePluginSchema>

const ListSchema = z.array(InstalledPluginSchema)
const ListAvailableSchema = z.object({
  available: z.array(AvailablePluginSchema),
  installed: z.array(InstalledPluginSchema),
})

const MarketplaceSchema = z
  .object({
    installLocation: z.string().optional(),
    name: z.string().min(1),
    path: z.string().optional(),
    ref: z.string().optional(),
    repo: z.string().optional(),
    source: z.string(),
    url: z.string().optional(),
  })
  .passthrough()
export type ClaudeMarketplace = z.infer<typeof MarketplaceSchema>
const MarketplaceListSchema = z.array(MarketplaceSchema)

const ShownCommandSchema = z
  .object({
    acceptCommandMatched: z.boolean().optional(),
    command: z.string(),
    pluginId: z.string(),
    sha256: z.string().length(64),
  })
  .passthrough()

const CommandResultSchema = z
  .object({
    command: z.string(),
    failureCode: z.string().optional(),
    keptData: z.boolean().optional(),
    message: z.string(),
    outcome: z.enum(["ok", "failed"]),
    pluginId: z.string().optional(),
    scope: z.string().optional(),
    shownCommand: ShownCommandSchema.optional(),
  })
  .passthrough()
export type ClaudeCommandResult = z.infer<typeof CommandResultSchema>

const ConfigOptionSchema = z
  .object({
    default: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
    description: z.string(),
    multiple: z.boolean().optional(),
    options: z.array(z.string()).optional(),
    required: z.boolean().optional(),
    sensitive: z.boolean().optional(),
    title: z.string(),
    type: z.enum(["string", "number", "boolean", "directory", "file"]),
  })
  .passthrough()
const ConfigureSchema = z
  .object({
    configured: z.array(z.string()),
    inputs: z.record(z.string(), z.unknown()),
    pluginId: z.string(),
    schema: z.record(z.string(), ConfigOptionSchema),
    unconfigured: z.array(z.string()),
  })
  .passthrough()
export type ClaudeConfigure = z.infer<typeof ConfigureSchema>
const ConfigureSaveSchema = z
  .object({ saved: z.array(z.string()), unconfigured: z.array(z.string()) })
  .passthrough()

const parseJson = <T>(schema: z.ZodType<T>, text: string, what: string): T => {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new ClaudeCliError(
      `Claude CLI returned invalid JSON for ${what}`,
      "INTEGRATION_PROTOCOL_ERROR"
    )
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new ClaudeCliError(
      `Claude CLI returned an unexpected ${what} shape: ${parsed.error.issues[0]?.message ?? "invalid"}`,
      "INTEGRATION_PROTOCOL_ERROR"
    )
  }
  return parsed.data
}

/** The CLI prints marketplace-declared commands before its result, so only the last line is JSON. */
const lastLine = (stdout: string): string => {
  const lines = stdout.split("\n").filter((line) => line.trim())
  return lines.at(-1) ?? ""
}

const failure = (result: { exitCode: number; stderr: string; stdout: string }): string =>
  (result.stderr.trim() || result.stdout.trim() || `Claude CLI exited ${result.exitCode}`).slice(
    0,
    2000
  )

export class ClaudeCli {
  readonly #runner: ClaudeCliRunner

  constructor(runner: ClaudeCliRunner) {
    this.#runner = runner
  }

  async listInstalled(): Promise<ClaudeInstalledPlugin[]> {
    const result = await this.#runner.run(["plugin", "list", "--json"])
    if (result.exitCode !== 0) throw new ClaudeCliError(failure(result))
    return parseJson(ListSchema, result.stdout, "plugin list")
  }

  async listAvailable(): Promise<z.infer<typeof ListAvailableSchema>> {
    const result = await this.#runner.run(["plugin", "list", "--json", "--available"])
    if (result.exitCode !== 0) throw new ClaudeCliError(failure(result))
    return parseJson(ListAvailableSchema, result.stdout, "plugin catalog")
  }

  async listMarketplaces(): Promise<ClaudeMarketplace[]> {
    const result = await this.#runner.run(["plugin", "marketplace", "list", "--json"])
    if (result.exitCode !== 0) throw new ClaudeCliError(failure(result))
    return parseJson(MarketplaceListSchema, result.stdout, "marketplace list")
  }

  /** Runs a `--json` mutation. A `failed` outcome is returned, not thrown, so callers can branch on `failureCode`. */
  async mutate(args: string[], timeoutMs?: number): Promise<ClaudeCommandResult> {
    const result = await this.#runner.run(["plugin", ...args, "--json"], { timeoutMs })
    const line = lastLine(result.stdout)
    if (!line.startsWith("{")) throw new ClaudeCliError(failure(result))
    return parseJson(CommandResultSchema, line, `plugin ${args[0]}`)
  }

  async marketplace(args: string[]): Promise<string> {
    const result = await this.#runner.run(["plugin", "marketplace", ...args], {
      timeoutMs: 300_000,
    })
    if (result.exitCode !== 0) throw new ClaudeCliError(failure(result))
    return result.stdout
  }

  async details(id: string): Promise<string | null> {
    const result = await this.#runner.run(["plugin", "details", id])
    return result.exitCode === 0 ? result.stdout : null
  }

  async readConfig(id: string): Promise<ClaudeConfigure> {
    const result = await this.#runner.run(["plugin", "configure", id, "--json"])
    if (result.exitCode !== 0) throw new ClaudeCliError(failure(result))
    return parseJson(ConfigureSchema, result.stdout, "plugin configuration")
  }

  async writeConfig(
    id: string,
    values: Record<string, string>
  ): Promise<z.infer<typeof ConfigureSaveSchema>> {
    const result = await this.#runner.run(["plugin", "configure", id, "--values-stdin", "--json"], {
      input: JSON.stringify(values),
    })
    if (result.exitCode !== 0)
      throw new ClaudeCliError("Claude CLI rejected the plugin configuration")
    return parseJson(ConfigureSaveSchema, result.stdout, "plugin configuration result")
  }
}

/** Reads the `details` text into token estimates; returns undefined when the layout is not recognised. */
export const parseTokenCost = (
  text: string
):
  | { alwaysOn: number; components: { alwaysOn: number; name: string; onInvoke: number }[] }
  | undefined => {
  const always = /Always-on:\s+~?\s*(\d+)/u.exec(text)
  if (!always) return undefined
  const components: { alwaysOn: number; name: string; onInvoke: number }[] = []
  const table = text.split("Per-component")[1]
  if (table) {
    for (const line of table.split("\n").slice(1)) {
      const row = /^\s{2}(\S+)\s+<?\s*(\d+)\s+<?\s*(\d+)\s*$/u.exec(line)
      if (row && row[1] !== "component") {
        components.push({
          alwaysOn: Number(row[2]),
          name: row[1] ?? "",
          onInvoke: Number(row[3]),
        })
      }
    }
  }
  return { alwaysOn: Number(always[1]), components }
}
