import { randomUUID } from "node:crypto"
import { jsonSchema, type Tool, tool } from "ai"

/**
 * The name of the provider tool used to represent ACP agent tool calls.
 */
export const ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME = "acp.acp_provider_agent_dynamic_tool"

const ACP_TOOL_REGISTRATION_KEY = "toolRegistrationId"

type RegisteredTool = Tool

// AI SDK intentionally removes execute functions when preparing model tools. A
// random ID in providerOptions lets us recover the original tool without using
// its public name as global mutable identity. Weak references avoid retaining
// abandoned tool sets indefinitely.
const toolRegistrations = new Map<string, WeakRef<RegisteredTool>>()
const registrationFinalizer = new FinalizationRegistry<string>((id) => {
  toolRegistrations.delete(id)
})

function registerTool(toolDefinition: RegisteredTool): string {
  const id = randomUUID()
  toolRegistrations.set(id, new WeakRef(toolDefinition))
  registrationFinalizer.register(toolDefinition, id)
  return id
}

export function getACPToolRegistrationId(toolDefinition: {
  providerOptions?: Record<string, unknown>
}): string | undefined {
  const acpOptions = toolDefinition.providerOptions?.acp
  if (!acpOptions || typeof acpOptions !== "object") return undefined
  const id = (acpOptions as Record<string, unknown>)[ACP_TOOL_REGISTRATION_KEY]
  return typeof id === "string" ? id : undefined
}

export function getRegisteredACPTool(id: string): RegisteredTool | undefined {
  const value = toolRegistrations.get(id)?.deref()
  if (!value) toolRegistrations.delete(id)
  return value
}

/**
 * Wrap AI SDK tools with ACP execute preservation.
 * Automatically includes the ACP provider dynamic tool for streaming tool calls.
 *
 * @example
 * ```typescript
 * import { acpTools } from "@mcpc/acp-ai-provider";
 * import { tool } from "ai";
 * import { z } from "zod";
 *
 * streamText({
 *   model: provider.languageModel(),
 *   tools: acpTools({
 *     greet: tool({
 *       description: "Greet someone",
 *       inputSchema: z.object({ name: z.string() }),
 *       execute: async ({ name }) => `Hello, ${name}!`,
 *     }),
 *   }),
 * });
 * ```
 */
export function acpTools<T extends Record<string, Tool>>(
  tools: T
): T & Record<string, ReturnType<typeof tool>> {
  const registeredTools: Record<string, Tool> = {}
  for (const [name, toolDefinition] of Object.entries(tools)) {
    const registrationId = registerTool(toolDefinition as RegisteredTool)
    registeredTools[name] = {
      ...toolDefinition,
      providerOptions: {
        ...toolDefinition.providerOptions,
        acp: {
          ...(toolDefinition.providerOptions?.acp as Record<string, unknown> | undefined),
          [ACP_TOOL_REGISTRATION_KEY]: registrationId,
        },
      },
    } as Tool
  }

  // Return tools merged with the ACP provider dynamic tool
  return {
    ...registeredTools,
    ...getACPDynamicTool(),
  } as unknown as T & Record<string, ReturnType<typeof tool>>
}

/**
 * Get the ACP provider dynamic tool definition
 */
export function getACPDynamicTool(): Record<string, ReturnType<typeof tool>> {
  return {
    [ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME]: tool({
      type: "provider",
      id: ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME as `${string}.${string}`,
      args: {},
      inputSchema: jsonSchema({}),
      isProviderExecuted: true,
    }),
  }
}
