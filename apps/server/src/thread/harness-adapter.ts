import type {
  AgentId,
  ThreadCapabilities,
  ThreadInputBlock,
  ThreadInteraction,
  ThreadInteractionResponse,
  ThreadServerMessage,
  ThreadTimelineItem,
} from "@cypheria/protocol"

type ThreadHarnessExtensionEvent = Extract<
  Extract<ThreadServerMessage, { type: "thread.event.notification" }>["payload"]["event"],
  { type: "harness" }
>

export type ThreadHarnessHistoryItem = {
  /** Agent-native message identity. Kept internal and never projected onto the public row. */
  readonly agentMessageId?: string | null
  readonly item: ThreadTimelineItem
  readonly harnessItemId?: string | null
  readonly timestamp?: string
  readonly turnId?: string | null
}

export type ThreadHarnessSession = {
  readonly capabilities: ThreadCapabilities
  readonly history?: readonly ThreadHarnessHistoryItem[]
  readonly sessionId: string | null
}

export type ThreadHarnessContext = {
  readonly agentId: AgentId
  readonly agentSessionId: string | null
  readonly cwd: string | null
  readonly threadId: string
  readonly workspaceRoots?: readonly string[]
}

export type ThreadHarnessEvent =
  | { readonly item: ThreadHarnessHistoryItem; readonly type: "timeline" }
  | { readonly interaction: ThreadInteraction; readonly type: "interaction-requested" }
  | { readonly interactionId: string; readonly type: "interaction-resolved" }
  | { readonly message: string; readonly type: "progress" }
  | { readonly code: string; readonly message: string; readonly type: "warning" }
  | ThreadHarnessExtensionEvent
  | { readonly sessionId: string; readonly type: "session-bound" }
  | { readonly turnId: string; readonly type: "turn-completed" }
  | { readonly error: string; readonly turnId: string | null; readonly type: "error" }

export type ThreadHarnessCreateInput = {
  readonly agentId: AgentId
  readonly cwd: string | null
  readonly forkedFromAgentSessionId: string | null
  readonly onEvent: (event: ThreadHarnessEvent) => void
  readonly threadId: string
  readonly workspaceRoots?: readonly string[]
}

export type ThreadHarnessResumeInput = ThreadHarnessContext & {
  readonly onEvent: (event: ThreadHarnessEvent) => void
}

export type ThreadHarnessTurnInput = ThreadHarnessContext & {
  readonly clientMessageId: string
  readonly content: readonly ThreadInputBlock[]
}

export type ThreadHarnessSteerInput = ThreadHarnessTurnInput & {
  readonly turnId: string
}

export type { ThreadInteractionResponse }

/** Harness-native behavior hidden behind the public Agent/Thread protocol. */
export interface ThreadHarnessAdapter {
  readonly agentId: AgentId
  close(context: ThreadHarnessContext): Promise<void>
  create(input: ThreadHarnessCreateInput): Promise<ThreadHarnessSession>
  delete(context: ThreadHarnessContext): Promise<void>
  resume(input: ThreadHarnessResumeInput): Promise<ThreadHarnessSession>
  startTurn(input: ThreadHarnessTurnInput): Promise<{
    readonly agentMessageId?: string
    readonly turnId: string
  }>
  steerTurn(input: ThreadHarnessSteerInput): Promise<{ readonly agentMessageId?: string }>
  cancelTurn(context: ThreadHarnessContext & { turnId?: string }): Promise<void>
  updateConfig(
    context: ThreadHarnessContext,
    patch: {
      readonly mode?: string | null
      readonly model?: string | null
      readonly thinking?: string | null
    }
  ): Promise<void>
  respondToInteraction(
    context: ThreadHarnessContext,
    interactionId: string,
    response: ThreadInteractionResponse
  ): Promise<void>
}
