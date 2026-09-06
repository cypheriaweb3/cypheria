import process from "node:process"

export function extractBase64Data(data: string): string {
  return data.includes(",") ? (data.split(",")[1] ?? data) : data
}

function isDebugEnabled(debug?: boolean): boolean {
  if (typeof debug === "boolean") {
    return debug
  }
  const value = process.env.ACP_AI_PROVIDER_DEBUG
  return value === "1" || value === "true"
}

interface LoggableChunk {
  type?: unknown
  rawValue?: unknown
  text?: unknown
  input?: unknown
  output?: unknown
  error?: unknown
}

export function logChunkToConsole(chunk: LoggableChunk, options?: { debug?: boolean }): void {
  const debug = isDebugEnabled(options?.debug)

  switch (chunk.type) {
    case "raw":
      if (!debug) break
      // eslint-disable-next-line no-console
      console.log(`\n[acp-ai-provider] [Raw Plan Update]: ${chunk.rawValue}`)
      break
    case "text-delta":
      // Write directly to stdout for streaming text
      // Using process.stdout.write so callers can stream partial text
      // eslint-disable-next-line no-console
      process.stdout.write(String(chunk.text ?? ""))
      break
    case "tool-call":
      if (!debug) break
      // eslint-disable-next-line no-console
      console.log(`\n[acp-ai-provider] [Tool Call Initiated]`, JSON.stringify(chunk.input, null, 2))
      break
    case "tool-result":
      if (!debug) break
      // eslint-disable-next-line no-console
      console.log(
        `\n[acp-ai-provider] [Tool Call Result Received]`,
        JSON.stringify(chunk.output, null, 2)
      )
      break
    case "tool-error":
      if (!debug) break
      // eslint-disable-next-line no-console
      console.log(`\n[acp-ai-provider] [Tool Call Error]`, JSON.stringify(chunk.error, null, 2))
      break
    case "reasoning-delta":
      if (!debug) break
      // eslint-disable-next-line no-console
      process.stdout.write(`\n[Reasoning]: ${String(chunk.text ?? "")}`)
      break
    default:
      if (!debug) break
      // Unknown chunk type: log it for debugging
      // eslint-disable-next-line no-console
      console.log("\n[acp-ai-provider] [Unknown chunk]:", JSON.stringify(chunk, null, 2))
  }
}
