import type { ToolCallContent } from "@agentclientprotocol/sdk"

/**
 * Format a tool result (array of ToolCallContent) into a human readable
 * error string. ACP tool results can contain a variety of content blocks
 * (text, error objects, json/data, etc.) so this helper attempts to
 * extract the most useful information in a defensive way.
 */
export function formatToolError(toolResult: unknown): string {
  if (!Array.isArray(toolResult) || toolResult.length === 0) {
    if (toolResult instanceof Error) return toolResult.message
    if (typeof toolResult === "string") return toolResult
    try {
      return toolResult == null ? "Unknown tool error" : JSON.stringify(toolResult)
    } catch {
      return String(toolResult)
    }
  }

  const parts: string[] = []
  for (const blk of toolResult as Array<ToolCallContent>) {
    if (blk.type === "content") {
      if (blk.content.type === "text") {
        parts.push(blk.content.text)
      }
    }
  }
  return parts.join("\n") || JSON.stringify(toolResult)
}
