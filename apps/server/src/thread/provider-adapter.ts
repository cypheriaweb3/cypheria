import type {
  AgentId,
  ThreadCapabilities,
  ThreadInputBlock,
  ThreadInteraction,
  ThreadServerMessage,
  ThreadTimelineItem,
} from "@cypheria/protocol"

type ThreadProviderExtensionEvent = Extract<
  Extract<ThreadServerMessage, { type: "thread.event.notification" }>["payload"]["event"],
  { type: "provider" }
>

export type ThreadProviderHistoryItem = {
  readonly item: ThreadTimelineItem
  readonly providerItemId?: string | null
  readonly timestamp?: string
  readonly turnId?: string | null
}

export type ThreadProviderSession = {
  readonly capabilities: ThreadCapabilities
  readonly history?: readonly ThreadProviderHistoryItem[]
  readonly sessionId: string | null
}

export type ThreadProviderContext = {
  readonly agentId: AgentId
  readonly agentSessionId: string | null
  readonly cwd: string | null
  readonly threadId: string
}

export type ThreadProviderEvent =
  | { readonly item: ThreadProviderHistoryItem; readonly type: "timeline" }
  | { readonly interaction: ThreadInteraction; readonly type: "interaction-requested" }
  | { readonly interactionId: string; readonly type: "interaction-resolved" }
  | { readonly message: string; readonly type: "progress" }
  | { readonly code: string; readonly message: string; readonly type: "warning" }
  | ThreadProviderExtensionEvent
  | { readonly sessionId: string; readonly type: "session-bound" }
  | { readonly turnId: string; readonly type: "turn-completed" }
  | { readonly error: string; readonly turnId: string | null; readonly type: "error" }

export type ThreadProviderCreateInput = {
  readonly agentId: AgentId
  readonly cwd: string | null
  readonly forkedFromAgentSessionId: string | null
  readonly onEvent: (event: ThreadProviderEvent) => void
  readonly threadId: string
}

export type ThreadProviderResumeInput = ThreadProviderContext & {
  readonly onEvent: (event: ThreadProviderEvent) => void
}

export type ThreadProviderTurnInput = ThreadProviderContext & {
  readonly clientMessageId: string
  readonly content: readonly ThreadInputBlock[]
}

export type ThreadProviderSteerInput = ThreadProviderTurnInput & {
  readonly turnId: string
}

export type ThreadInteractionResponse =
  | { readonly outcome: "allow_once" | "allow_always" | "deny"; readonly type: "permission" }
  | { readonly optionId: string; readonly type: "selection" }
  | { readonly type: "text"; readonly value: string }
  | { readonly answers: readonly (readonly string[])[]; readonly type: "answers" }
  | { readonly type: "cancel" }

/** Provider-native behavior hidden behind the public Agent/Thread protocol. */
export interface ThreadProviderAdapter {
  readonly agentId: AgentId
  close(context: ThreadProviderContext): Promise<void>
  create(input: ThreadProviderCreateInput): Promise<ThreadProviderSession>
  delete(context: ThreadProviderContext): Promise<void>
  resume(input: ThreadProviderResumeInput): Promise<ThreadProviderSession>
  startTurn(input: ThreadProviderTurnInput): Promise<{ turnId: string }>
  steerTurn(input: ThreadProviderSteerInput): Promise<void>
  cancelTurn(context: ThreadProviderContext & { turnId?: string }): Promise<void>
  updateConfig(
    context: ThreadProviderContext,
    patch: {
      readonly mode?: string | null
      readonly model?: string | null
      readonly thinking?: string | null
    }
  ): Promise<void>
  respondToInteraction(
    context: ThreadProviderContext,
    interactionId: string,
    response: ThreadInteractionResponse
  ): Promise<void>
}
