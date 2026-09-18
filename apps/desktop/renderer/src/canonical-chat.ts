import type {
  AgentId,
  ThreadCapabilities,
  ThreadInteraction,
  ThreadTimelineProjectedItem,
} from "@cypheria/protocol"
import type {
  CodexInteractionEvent,
  CodexThreadDetailView,
  CodexUiMessage,
} from "../../ipc/src/index.js"
import { ensureCypheriaClient } from "./cypheria-client.js"

type MutableMessage = { id: string; parts: unknown[]; role: "assistant" | "user" }

export type CypheriaThreadDetailView = CodexThreadDetailView & {
  agentId: AgentId
  capabilities: ThreadCapabilities
}

const attachmentPart = (
  attachment: NonNullable<
    Extract<ThreadTimelineProjectedItem["item"], { type: "message" }>["attachments"]
  >[number]
) => {
  switch (attachment.type) {
    case "image":
    case "audio":
      return {
        mediaType: attachment.mimeType,
        type: "file" as const,
        url: `data:${attachment.mimeType};base64,${attachment.data}`,
      }
    case "resource-link":
      return {
        ...(attachment.name ? { filename: attachment.name } : {}),
        mediaType: "application/octet-stream",
        type: "file" as const,
        url: attachment.uri,
      }
    case "embedded-resource":
      return {
        ...(attachment.name ? { filename: attachment.name } : {}),
        mediaType: attachment.mimeType,
        type: "file" as const,
        url: attachment.uri.startsWith("inline-base64:")
          ? `data:${attachment.mimeType};base64,${attachment.data}`
          : `data:${attachment.mimeType},${encodeURIComponent(attachment.data)}`,
      }
  }
}

export const canonicalInteractionToView = (
  interaction: ThreadInteraction,
  threadId: string
): CodexInteractionEvent => {
  const questions =
    interaction.questions?.map((question, index) => ({
      header: question.header,
      id: String(index),
      isOther: question.custom,
      isSecret: false,
      options: question.options.length
        ? question.options.map((option) => ({
            description: option.description ?? "",
            label: option.label,
          }))
        : null,
      question: question.question,
    })) ??
    (interaction.kind === "question"
      ? [
          {
            header: interaction.title ?? "Question",
            id: "0",
            isOther: false,
            isSecret: false,
            options: interaction.options.length
              ? interaction.options.map((option) => ({
                  description: option.description ?? "",
                  label: option.label,
                }))
              : null,
            question: interaction.message,
          },
        ]
      : undefined)
  return {
    description: interaction.message,
    interactionId: interaction.id,
    kind:
      interaction.kind === "permission"
        ? "approval"
        : interaction.kind === "question"
          ? "user-input"
          : "elicitation",
    method:
      interaction.kind === "permission"
        ? "execCommandApproval"
        : interaction.kind === "question"
          ? "item/tool/requestUserInput"
          : "mcpServer/elicitation/request",
    params: {
      availableDecisions:
        interaction.kind === "permission"
          ? [
              "accept",
              ...(interaction.options.some((option) => option.id === "allow_always")
                ? ["acceptForSession"]
                : []),
              "decline",
            ]
          : ["accept", "decline"],
    },
    ...(questions ? { questions } : {}),
    serverRequestId: interaction.id,
    threadId,
    title: interaction.title ?? (interaction.kind === "permission" ? "Permission" : "Question"),
    turnId: null,
  }
}

export const canonicalTimelineToUiMessages = (
  timeline: readonly ThreadTimelineProjectedItem[]
): CodexUiMessage[] => {
  const messages: MutableMessage[] = []
  const assistants = new Map<string, MutableMessage>()
  const assistantFor = (row: ThreadTimelineProjectedItem) => {
    const id = `assistant:${row.turnId ?? row.item.itemId}`
    let message = assistants.get(id)
    if (!message) {
      message = { id, parts: [], role: "assistant" }
      assistants.set(id, message)
      messages.push(message)
    }
    return message
  }

  for (const row of timeline) {
    const { item } = row
    if (item.type === "message" && item.role === "user") {
      messages.push({
        id: `user:${item.itemId}`,
        parts: [
          ...(item.text ? [{ text: item.text, type: "text" as const }] : []),
          ...(item.attachments ?? []).map(attachmentPart),
        ],
        role: "user",
      })
      continue
    }
    const message = assistantFor(row)
    if (item.type === "message" && item.role === "assistant") {
      message.parts.push({ text: item.text, type: "text" })
    } else if (item.type === "reasoning") {
      message.parts.push({ text: item.text, type: "reasoning" })
    } else if (item.type === "tool") {
      message.parts.push({
        input: item.input,
        ...(item.status === "failed"
          ? { errorText: item.error ?? "Tool failed", state: "output-error" }
          : item.status === "completed"
            ? { output: item.output, state: "output-available" }
            : { state: "input-available" }),
        toolCallId: item.itemId,
        toolName: item.name,
        type: "dynamic-tool",
      })
    } else if (item.type === "artifact") {
      message.parts.push({
        mediaType: item.mimeType ?? "application/octet-stream",
        providerMetadata: { cypheria: { itemId: item.itemId } },
        type: "file",
        url: item.uri,
      })
    } else {
      message.parts.push({
        kind: `cypheria.${item.type}`,
        providerMetadata: { cypheria: { item } },
        type: "custom",
      })
    }
  }
  return messages.filter(({ parts }) => parts.length > 0) as CodexUiMessage[]
}

export const readCypheriaThreadDetail = async (
  threadId: string
): Promise<CypheriaThreadDetailView> => {
  const client = await ensureCypheriaClient()
  const [thread, project, timeline] = await Promise.all([
    client.threads.get(threadId),
    client.projects.getThreadProject(threadId),
    client.timeline.get({
      direction: "tail",
      limit: 500,
      projection: "projected",
      threadId,
    }),
  ])
  return {
    agentId: thread.agentId,
    capabilities: thread.capabilities,
    cwd: thread.cwd ?? "",
    id: thread.id,
    messages: canonicalTimelineToUiMessages(
      timeline.projectedItems
    ) as unknown as CodexThreadDetailView["messages"],
    projectId: project?.project.id ?? null,
    title: thread.title ?? "New chat",
  }
}
