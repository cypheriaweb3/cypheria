import type { DynamicToolUIPart, UIMessage } from "ai"

type JsonRecord = Record<string, unknown>

export type ChatFileArtifact = {
  diff: string
  id: string
  kind: "add" | "delete" | "update"
  path: string
  status: string
}

export type ChatCommandArtifact = {
  command: string
  cwd: string
  exitCode: number | null
  id: string
  output: string
  status: string
}

export type ChatWorkspaceArtifacts = {
  commands: ChatCommandArtifact[]
  files: ChatFileArtifact[]
}

export const displayChatArtifactPath = (path: string, projectRoot?: string): string => {
  if (!projectRoot) return path
  const normalizedPath = path.replaceAll("\\", "/")
  const normalizedRoot = projectRoot.replaceAll("\\", "/").replace(/\/+$/u, "")
  if (normalizedPath === normalizedRoot) return "."
  const rootPrefix = `${normalizedRoot}/`
  return normalizedPath.startsWith(rootPrefix) ? normalizedPath.slice(rootPrefix.length) : path
}

const asRecord = (value: unknown): JsonRecord | undefined => {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value))
    } catch {
      return undefined
    }
  }
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined
}

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback

const toolStatus = (part: DynamicToolUIPart, output: JsonRecord | undefined): string => {
  const status = asString(output?.status)
  if (status) return status
  if (part.state === "output-error") return "failed"
  if (part.state === "output-available") return "completed"
  return "inProgress"
}

const fileKind = (value: unknown): ChatFileArtifact["kind"] => {
  if (typeof value === "string" && ["add", "delete", "update"].includes(value)) {
    return value as ChatFileArtifact["kind"]
  }
  const kind = asString(asRecord(value)?.type)
  return kind === "add" || kind === "delete" ? kind : "update"
}

const collectFileChanges = (
  part: DynamicToolUIPart,
  input: JsonRecord | undefined,
  output: JsonRecord | undefined
): ChatFileArtifact[] => {
  const rawChanges = Array.isArray(output?.changes)
    ? output.changes
    : Array.isArray(input?.changes)
      ? input.changes
      : []
  const status = toolStatus(part, output)
  return rawChanges.flatMap((rawChange, index) => {
    const change = asRecord(rawChange)
    const path = asString(change?.path)
    if (!path) return []
    return [
      {
        diff: asString(change?.diff),
        id: `${part.toolCallId}:${index}`,
        kind: fileKind(change?.kind),
        path,
        status,
      },
    ]
  })
}

const collectCommand = (
  part: DynamicToolUIPart,
  input: JsonRecord | undefined,
  output: JsonRecord | undefined
): ChatCommandArtifact => ({
  command: asString(input?.command, "Command"),
  cwd: asString(input?.cwd),
  exitCode: typeof output?.exitCode === "number" ? output.exitCode : null,
  id: part.toolCallId,
  output: asString(output?.output),
  status: toolStatus(part, output),
})

export const deriveChatWorkspaceArtifacts = (
  messages: readonly UIMessage[]
): ChatWorkspaceArtifacts => {
  const commands: ChatCommandArtifact[] = []
  const filesByPath = new Map<string, ChatFileArtifact>()

  for (const message of messages) {
    for (const rawPart of message.parts) {
      if (rawPart.type !== "dynamic-tool" && !rawPart.type.startsWith("tool-")) continue
      const part = rawPart as DynamicToolUIPart
      const input = asRecord("input" in part ? part.input : undefined)
      const output = asRecord("output" in part ? part.output : undefined)
      if (part.toolName === "command") {
        commands.push(collectCommand(part, input, output))
      } else if (part.toolName === "fileChange") {
        for (const file of collectFileChanges(part, input, output)) {
          filesByPath.set(file.path, file)
        }
      }
    }
  }

  return { commands, files: [...filesByPath.values()] }
}
