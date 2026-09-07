import { randomUUID } from "node:crypto"
import type {
  CodexAppServerBridge,
  CodexJsonValue,
  ServerRequest,
  v2,
} from "@cypheria/codex-bridge"
import type {
  CodexInteractionEvent,
  CodexInteractionMethod,
  CodexInteractionResponse,
} from "../../ipc/src/index.js"

type SupportedRequest = Extract<ServerRequest, { method: CodexInteractionMethod }>

type PendingInteraction = {
  readonly request: SupportedRequest
  readonly resolve: (value: CodexJsonValue) => void
  readonly timer: ReturnType<typeof setTimeout>
}

export type CodexInteractionBroker = {
  readonly close: () => void
  readonly respond: (response: CodexInteractionResponse) => Promise<void>
}

export type CodexInteractionBrokerOptions = {
  readonly bridge: CodexAppServerBridge
  readonly emit: (event: CodexInteractionEvent) => void
  readonly timeoutMs?: number
}

const supportedMethods = [
  "applyPatchApproval",
  "execCommandApproval",
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
] as const satisfies readonly CodexInteractionMethod[]

const threadIdOf = (request: SupportedRequest): string | null =>
  request.method === "applyPatchApproval" || request.method === "execCommandApproval"
    ? request.params.conversationId
    : request.params.threadId

const turnIdOf = (request: SupportedRequest): string | null =>
  "turnId" in request.params ? request.params.turnId : null

const eventFromRequest = (
  interactionId: string,
  request: SupportedRequest
): CodexInteractionEvent => {
  if (request.method === "item/tool/requestUserInput") {
    return {
      description: null,
      interactionId,
      kind: "user-input",
      method: request.method,
      params: request.params,
      questions: request.params.questions,
      threadId: request.params.threadId,
      title: "Codex needs your input",
      turnId: request.params.turnId,
    }
  }
  if (request.method === "mcpServer/elicitation/request") {
    return {
      description: request.params.message,
      interactionId,
      kind: "elicitation",
      method: request.method,
      params: request.params,
      threadId: request.params.threadId,
      title: `Input requested by ${request.params.serverName}`,
      turnId: request.params.turnId,
    }
  }

  const description = "reason" in request.params ? (request.params.reason ?? null) : null
  const title =
    request.method.includes("fileChange") || request.method === "applyPatchApproval"
      ? "Approve file changes"
      : request.method.includes("permissions")
        ? "Approve additional permissions"
        : "Approve command execution"
  return {
    description,
    interactionId,
    kind: "approval",
    method: request.method,
    params: request.params,
    threadId: threadIdOf(request),
    title,
    turnId: turnIdOf(request),
  }
}

const legacyDecision = (response: CodexInteractionResponse): CodexJsonValue => ({
  decision:
    response.action === "accept"
      ? "approved"
      : response.action === "accept-for-session"
        ? "approved_for_session"
        : response.action === "decline"
          ? { denied: { rejection: "Declined by the user." } }
          : "abort",
})

const grantedPermissions = (
  permissions: v2.RequestPermissionProfile
): v2.GrantedPermissionProfile => ({
  ...(permissions.fileSystem ? { fileSystem: permissions.fileSystem } : {}),
  ...(permissions.network ? { network: permissions.network } : {}),
})

const resultForResponse = (
  request: SupportedRequest,
  response: CodexInteractionResponse
): CodexJsonValue => {
  switch (request.method) {
    case "applyPatchApproval":
    case "execCommandApproval":
      return legacyDecision(response)
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
      return {
        decision:
          response.action === "accept"
            ? "accept"
            : response.action === "accept-for-session"
              ? "acceptForSession"
              : response.action === "decline"
                ? "decline"
                : "cancel",
      }
    case "item/permissions/requestApproval":
      return {
        permissions:
          response.action === "accept" || response.action === "accept-for-session"
            ? grantedPermissions(request.params.permissions)
            : {},
        scope: response.action === "accept-for-session" ? "session" : "turn",
      }
    case "item/tool/requestUserInput":
      return {
        answers: Object.fromEntries(
          Object.entries(response.answers ?? {}).map(([id, answers]) => [id, { answers }])
        ),
      }
    case "mcpServer/elicitation/request":
      return {
        _meta: null,
        action:
          response.action === "accept"
            ? "accept"
            : response.action === "decline"
              ? "decline"
              : "cancel",
        content: response.action === "accept" ? (response.content ?? null) : null,
      }
  }
}

export const createCodexInteractionBroker = (
  options: CodexInteractionBrokerOptions
): CodexInteractionBroker => {
  const pending = new Map<string, PendingInteraction>()
  const unregister = supportedMethods.map((method) =>
    options.bridge.onServerRequest(
      method,
      (request) =>
        new Promise<CodexJsonValue>((resolve) => {
          const supportedRequest = request as SupportedRequest
          const interactionId = randomUUID()
          const timer = setTimeout(
            () => {
              const current = pending.get(interactionId)
              if (!current) return
              pending.delete(interactionId)
              current.resolve(
                resultForResponse(current.request, {
                  action: "cancel",
                  interactionId,
                })
              )
            },
            options.timeoutMs ?? 5 * 60_000
          )
          pending.set(interactionId, { request: supportedRequest, resolve, timer })
          options.emit(eventFromRequest(interactionId, supportedRequest))
        })
    )
  )

  const respond = async (response: CodexInteractionResponse): Promise<void> => {
    const interaction = pending.get(response.interactionId)
    if (!interaction) {
      throw new Error("The Codex interaction is no longer pending.")
    }
    pending.delete(response.interactionId)
    clearTimeout(interaction.timer)
    interaction.resolve(resultForResponse(interaction.request, response))
  }

  return {
    close: () => {
      for (const unregisterHandler of unregister) unregisterHandler()
      for (const [interactionId, interaction] of pending) {
        clearTimeout(interaction.timer)
        interaction.resolve(
          resultForResponse(interaction.request, { action: "cancel", interactionId })
        )
      }
      pending.clear()
    },
    respond,
  }
}
