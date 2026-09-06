import type { ContentBlock, PromptCapabilities } from "@agentclientprotocol/sdk"
import type {
  LanguageModelV4CallOptions,
  LanguageModelV4FilePart,
  LanguageModelV4FunctionTool,
  LanguageModelV4Prompt,
  LanguageModelV4ProviderTool,
  LanguageModelV4ToolResultOutput,
} from "@ai-sdk/provider"
import { convertUint8ArrayToBase64 } from "@ai-sdk/provider-utils"
import { asSchema, type FlexibleSchema, type Tool } from "ai"
import { getACPToolRegistrationId, getRegisteredACPTool } from "./acp-tool.js"
import { extractBase64Data } from "./utils.js"

const ROLE_PREFIXES: Record<string, string> = {
  system: "System: ",
  assistant: "Assistant: ",
  tool: "Result: ",
}

function getRolePrefix(role: string): string {
  return ROLE_PREFIXES[role] || ""
}

function getMediaType(mimeType: string): "image" | "audio" | null {
  if (mimeType.startsWith("image/")) return "image"
  if (mimeType.startsWith("audio/")) return "audio"
  return null
}

function toMeta(providerOptions: unknown): { _meta?: Record<string, unknown> } {
  return providerOptions && typeof providerOptions === "object"
    ? { _meta: { "ai-sdk": providerOptions } }
    : {}
}

function sameMessage(left: LanguageModelV4Prompt[number], right: LanguageModelV4Prompt[number]) {
  if (left === right) return true
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

function selectPromptDelta(
  prompt: LanguageModelV4Prompt,
  isFreshSession: boolean,
  previousPrompt?: LanguageModelV4Prompt
): LanguageModelV4Prompt {
  if (isFreshSession) return prompt

  if (previousPrompt) {
    let common = 0
    while (common < prompt.length && common < previousPrompt.length) {
      const currentMessage = prompt[common]
      const previousMessage = previousPrompt[common]
      if (!currentMessage || !previousMessage || !sameMessage(currentMessage, previousMessage))
        break
      common += 1
    }
    if (common < prompt.length) return prompt.slice(common)
  }

  // A loaded ACP session has history that is unknown to the adapter. Send the
  // newest user turn and everything after it instead of replaying all history.
  const lastUser = prompt.findLastIndex((message) => message.role === "user")
  return lastUser >= 0 ? prompt.slice(lastUser) : prompt.slice(-1)
}

function filePartToACP(
  part: Pick<LanguageModelV4FilePart, "data" | "mediaType" | "filename" | "providerOptions">,
  prefix: string,
  capabilities: PromptCapabilities
): ContentBlock[] {
  const metadata = toMeta(part.providerOptions)
  const mediaType = getMediaType(part.mediaType)
  if (part.data.type === "text") {
    return [
      capabilities.embeddedContext
        ? {
            type: "resource",
            resource: {
              uri: part.filename
                ? `urn:ai-sdk-file:${encodeURIComponent(part.filename)}`
                : "data:text/plain",
              mimeType: part.mediaType,
              text: prefix + part.data.text,
            },
            ...metadata,
          }
        : { type: "text", text: prefix + part.data.text, ...metadata },
    ]
  }
  if (part.data.type === "url") {
    const url = String(part.data.url)
    return [
      {
        type: "resource_link",
        uri: url,
        name: part.filename ?? url,
        mimeType: part.mediaType,
        ...metadata,
      },
    ]
  }
  if (mediaType && part.data.type === "data") {
    if (capabilities[mediaType] !== true) {
      throw new Error(`The ACP agent does not advertise ${mediaType} prompt support`)
    }
    const data =
      typeof part.data.data === "string"
        ? extractBase64Data(part.data.data)
        : convertUint8ArrayToBase64(part.data.data)
    return data === undefined
      ? []
      : [{ type: mediaType, mimeType: part.mediaType, data, ...metadata }]
  }
  if (part.data.type === "data") {
    if (!capabilities.embeddedContext) {
      throw new Error(`The ACP agent does not advertise embeddedContext for ${part.mediaType}`)
    }
    const blob =
      typeof part.data.data === "string"
        ? extractBase64Data(part.data.data)
        : convertUint8ArrayToBase64(part.data.data)
    return [
      {
        type: "resource",
        resource: {
          uri: part.filename
            ? `urn:ai-sdk-file:${encodeURIComponent(part.filename)}`
            : `data:${part.mediaType}`,
          mimeType: part.mediaType,
          blob,
        },
        ...metadata,
      },
    ]
  }
  throw new Error("AI SDK provider file references cannot be represented by ACP")
}

function toolResultToACP(
  output: LanguageModelV4ToolResultOutput,
  prefix: string,
  capabilities: PromptCapabilities
): ContentBlock[] {
  const metadata = toMeta("providerOptions" in output ? output.providerOptions : undefined)
  switch (output.type) {
    case "text":
      return [{ type: "text", text: prefix + output.value, ...metadata }]
    case "json":
      return [{ type: "text", text: prefix + JSON.stringify(output.value), ...metadata }]
    case "error-text":
      return [{ type: "text", text: `${prefix}[Tool Error] ${output.value}`, ...metadata }]
    case "error-json":
      return [
        {
          type: "text",
          text: `${prefix}[Tool Error] ${JSON.stringify(output.value)}`,
          ...metadata,
        },
      ]
    case "execution-denied":
      return [
        {
          type: "text",
          text: `${prefix}[Tool Execution Denied]${output.reason ? ` ${output.reason}` : ""}`,
          ...metadata,
        },
      ]
    case "content": {
      const blocks: ContentBlock[] = []
      let nextPrefix = prefix
      for (const item of output.value) {
        if (item.type === "text") {
          blocks.push({
            type: "text",
            text: nextPrefix + item.text,
            ...toMeta(item.providerOptions),
          })
        } else if (item.type === "file") {
          blocks.push(...filePartToACP(item, nextPrefix, capabilities))
        } else {
          blocks.push({
            type: "text",
            text: `${nextPrefix}[Custom Tool Content]`,
            ...toMeta(item.providerOptions),
          })
        }
        nextPrefix = ""
      }
      return blocks
    }
  }
}

/**
 * Converts AI SDK prompt messages into ACP ContentBlock objects.
 * Prefixes text with role since ACP ContentBlock has no role field.
 *
 * @param options - The call options from the language model
 * @param isFreshSession - Whether this is a fresh session (send full history) or reused (send only latest user message)
 * @param jsonSchemaPrompt - Optional JSON schema instruction to prepend to the prompt
 */
export function convertAiSdkMessagesToAcp(
  options: LanguageModelV4CallOptions,
  isFreshSession: boolean,
  jsonSchemaPrompt?: string,
  capabilities: PromptCapabilities = {},
  previousPrompt?: LanguageModelV4Prompt
): ContentBlock[] {
  const messages = selectPromptDelta(options.prompt, isFreshSession, previousPrompt)

  const contentBlocks: ContentBlock[] = []

  // Prepend JSON schema instruction if provided
  if (jsonSchemaPrompt) {
    contentBlocks.push({ type: "text", text: jsonSchemaPrompt })
  }

  for (const msg of messages) {
    const prefix = getRolePrefix(msg.role)

    if (typeof msg.content === "string") {
      contentBlocks.push({ type: "text", text: `${prefix}${msg.content} ` })
      continue
    }

    if (!Array.isArray(msg.content)) continue

    let needsPrefix = true
    for (const part of msg.content) {
      const currentPrefix = needsPrefix ? prefix : ""

      if (part.type === "text") {
        contentBlocks.push({
          type: "text",
          text: currentPrefix + part.text,
          ...toMeta(part.providerOptions),
        })
        needsPrefix = false
      }

      if (part.type === "reasoning") {
        contentBlocks.push({
          type: "text",
          text: `${currentPrefix}[Reasoning] ${part.text}`,
          ...toMeta(part.providerOptions),
        })
        needsPrefix = false
      }

      if (part.type === "tool-call") {
        const toolCallText = `[Tool Call: ${part.toolName}(${JSON.stringify(part.input)})]`
        contentBlocks.push({
          type: "text",
          text: currentPrefix + toolCallText,
          ...toMeta(part.providerOptions),
        })
        needsPrefix = false
      }

      if (part.type === "tool-result") {
        contentBlocks.push(...toolResultToACP(part.output, currentPrefix, capabilities))
        needsPrefix = false
      }

      if (part.type === "tool-approval-response") {
        contentBlocks.push({
          type: "text",
          text: `${currentPrefix}[Tool Approval ${part.approved ? "Granted" : "Denied"}: ${part.approvalId}]${part.reason ? ` ${part.reason}` : ""}`,
          ...toMeta(part.providerOptions),
        })
        needsPrefix = false
      }

      if (part.type === "file") {
        contentBlocks.push(...filePartToACP(part, currentPrefix, capabilities))
        needsPrefix = false
      }

      if (part.type === "reasoning-file") {
        contentBlocks.push(
          ...filePartToACP(
            { ...part, filename: undefined },
            `${currentPrefix}[Reasoning File] `,
            capabilities
          )
        )
        needsPrefix = false
      }

      if (part.type === "custom") {
        contentBlocks.push({
          type: "text",
          text: `${currentPrefix}[Custom Content] ${part.kind}`,
          ...toMeta(part.providerOptions),
        })
        needsPrefix = false
      }
    }
  }

  return contentBlocks
}

/** Input type for tools - matches streamText's tools parameter */
export type ToolsInput =
  | (LanguageModelV4FunctionTool | LanguageModelV4ProviderTool)[]
  | Record<string, Tool>

/**
 * Extracts ACP tools from the provided options that have a registered execution handler.
 * These tools will be proxied to the agent.
 *
 * @param tools - Tools in either array or Record format (matches streamText's tools param)
 * @param prepared - Whether the schema has been converted to a prepared format.
 * If tools go through streamText's transformation, they are prepared.
 */
export function extractACPTools(
  tools?: ToolsInput,
  prepared = true
): Array<Tool & { name: string }> {
  const acpTools: Array<Tool & { name: string }> = []

  if (!tools) {
    return acpTools
  }

  // Convert Record<string, Tool> to array format if needed
  const toolsArray = Array.isArray(tools)
    ? tools
    : Object.entries(tools).map(([name, tool]) => ({
        type: "function" as const,
        name,
        ...tool,
      }))

  for (const t of toolsArray) {
    if (t.type === "function") {
      // AI SDK internally converts parameters to inputSchema
      // LanguageModelV4 function tools have a `name` property.
      const toolWithSchema = t as unknown as Record<string, unknown>
      const toolInputSchema = toolWithSchema.inputSchema as Record<string, unknown> | undefined

      const registrationId = getACPToolRegistrationId(t)
      const registered = registrationId ? getRegisteredACPTool(registrationId) : undefined
      // Direct initSession() calls still contain execute; prepared AI SDK tools
      // recover it through the opaque registration ID above.
      const original = registered ?? (t as unknown as Tool)
      if (registrationId && registered && toolInputSchema) {
        if (typeof registered.execute !== "function") {
          throw new Error(
            `ACP tool "${t.name}" has no execute function. Client-side AI SDK tools cannot be resumed through an ACP MCP turn; provide execute or do not expose the tool through acpTools().`
          )
        }
        // Add name to Tool for internal tracking
        acpTools.push({
          ...t,
          name: t.name,
          inputSchema: prepared
            ? toolInputSchema
            : asSchema(toolInputSchema as FlexibleSchema<unknown>).jsonSchema,
          execute: original.execute,
        } as Tool & { name: string })
      } else if (!prepared && "execute" in original && toolInputSchema) {
        acpTools.push({
          ...original,
          name: t.name,
          inputSchema: asSchema(toolInputSchema as FlexibleSchema<unknown>).jsonSchema,
        } as Tool & { name: string })
      }
    }
  }

  return acpTools
}
