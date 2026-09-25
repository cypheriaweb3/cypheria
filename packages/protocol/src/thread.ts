import { z } from "zod"

import { AgentIdSchema } from "./agent/registry.ts"
import {
  ProjectThreadCursorSchema,
  ProjectThreadIdSchema,
  ProjectThreadLimitSchema,
  ProjectThreadSortDirectionSchema,
  ThreadSchema,
  UnixTimestampSecondsSchema,
} from "./project-thread.ts"
import { RequestIdSchema } from "./request-id.ts"

export const ThreadStateSchema = z.enum([
  "stopped",
  "starting",
  "idle",
  "running",
  "stopping",
  "deleting",
  "errored",
])
export type ThreadState = z.infer<typeof ThreadStateSchema>

export const ThreadPromptContentTypeSchema = z.enum([
  "text",
  "image",
  "audio",
  "resource-link",
  "embedded-resource",
])
export type ThreadPromptContentType = z.infer<typeof ThreadPromptContentTypeSchema>

export const ThreadCapabilitiesSchema = z.object({
  changeCwd: z.boolean(),
  configure: z.boolean(),
  fork: z.boolean(),
  promptContent: z.array(ThreadPromptContentTypeSchema),
  harnessExtensions: z.boolean(),
  steer: z.boolean(),
})
export type ThreadCapabilities = z.infer<typeof ThreadCapabilitiesSchema>

export const ThreadActiveTurnSchema = z.object({
  id: z.string().min(1),
  startedAt: z.string().datetime(),
})
export type ThreadActiveTurn = z.infer<typeof ThreadActiveTurnSchema>

export const ThreadContextTokenBreakdownSchema = z.object({
  cacheRead: z.number().nonnegative(),
  cacheWrite: z.number().nonnegative(),
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  reasoning: z.number().nonnegative(),
  total: z.number().nonnegative(),
})
export type ThreadContextTokenBreakdown = z.infer<typeof ThreadContextTokenBreakdownSchema>

export const ThreadContextCostSchema = z.object({
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  scope: z.enum(["session", "turn"]),
})
export type ThreadContextCost = z.infer<typeof ThreadContextCostSchema>

const ThreadContextUsageBaseSchema = z.object({
  agentId: AgentIdSchema,
  cost: ThreadContextCostSchema.nullable(),
  maxTokens: z.number().positive(),
  model: z.string().nullable(),
  observedAt: z.string().datetime(),
  percentage: z.number().nonnegative(),
  remainingTokens: z.number().nonnegative(),
  source: z.enum(["reported", "queried", "derived", "estimated"]),
  tokens: ThreadContextTokenBreakdownSchema.nullable(),
  usedTokens: z.number().nonnegative(),
})

export const ThreadContextUsageSchema = z.intersection(
  ThreadContextUsageBaseSchema,
  z.discriminatedUnion("kind", [
    z.object({
      cumulativeTokens: ThreadContextTokenBreakdownSchema,
      kind: z.literal("codex"),
    }),
    z.object({
      categories: z.array(
        z.object({
          kind: z.enum(["used", "free", "buffer", "deferred"]),
          name: z.string(),
          tokens: z.number().nonnegative(),
        })
      ),
      kind: z.literal("claude"),
      rawMaxTokens: z.number().positive(),
    }),
    z.object({
      kind: z.literal("pi"),
      sessionTokens: ThreadContextTokenBreakdownSchema,
    }),
    z.object({
      kind: z.literal("opencode"),
      providerId: z.string().nullable(),
    }),
    z.object({ kind: z.literal("acp") }),
  ])
)
export type ThreadContextUsage = z.infer<typeof ThreadContextUsageSchema>

export const ThreadInteractionOptionSchema = z.object({
  description: z.string().nullable(),
  id: z.string().min(1),
  label: z.string().min(1),
})

export const ThreadQuestionSchema = z.object({
  custom: z.boolean(),
  header: z.string().min(1),
  id: z.string().min(1).optional(),
  multiple: z.boolean(),
  options: z.array(ThreadInteractionOptionSchema),
  question: z.string().min(1),
  secret: z.boolean().optional(),
})

export const ThreadInteractionSchema = z.object({
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  id: z.string().min(1),
  itemId: z.string().min(1).optional(),
  kind: z.enum(["permission", "question", "elicitation"]),
  message: z.string(),
  options: z.array(ThreadInteractionOptionSchema),
  harness: z
    .object({
      agentId: AgentIdSchema,
      metadata: z.json(),
      nativeType: z.string().min(1),
    })
    .optional(),
  questions: z.array(ThreadQuestionSchema).optional(),
  title: z.string().nullable(),
  turnId: z.string().min(1).optional(),
})
export type ThreadInteraction = z.infer<typeof ThreadInteractionSchema>

export const ThreadViewSchema = z.object({
  ...ThreadSchema.shape,
  activeTurn: ThreadActiveTurnSchema.nullable(),
  attention: z.boolean(),
  capabilities: ThreadCapabilitiesSchema,
  pendingInteractions: z.array(ThreadInteractionSchema),
  state: ThreadStateSchema,
})
export type ThreadView = z.infer<typeof ThreadViewSchema>

const ThreadTextInputBlockSchema = z.object({ text: z.string(), type: z.literal("text") })
const ThreadImageInputBlockSchema = z.object({
  data: z.string(),
  mimeType: z.string().min(1),
  type: z.literal("image"),
})
const ThreadAudioInputBlockSchema = z.object({
  data: z.string(),
  mimeType: z.string().min(1),
  type: z.literal("audio"),
})
const ThreadResourceLinkInputBlockSchema = z.object({
  name: z.string().nullable(),
  type: z.literal("resource-link"),
  uri: z.string().min(1),
})
const ThreadEmbeddedResourceInputBlockSchema = z.object({
  data: z.string(),
  mimeType: z.string().min(1),
  name: z.string().nullable(),
  type: z.literal("embedded-resource"),
  uri: z.string().min(1),
})

export const ThreadAttachmentSchema = z.discriminatedUnion("type", [
  ThreadImageInputBlockSchema,
  ThreadAudioInputBlockSchema,
  ThreadResourceLinkInputBlockSchema,
  ThreadEmbeddedResourceInputBlockSchema,
])
export type ThreadAttachment = z.infer<typeof ThreadAttachmentSchema>

export const ThreadInputBlockSchema = z.discriminatedUnion("type", [
  ThreadTextInputBlockSchema,
  ThreadImageInputBlockSchema,
  ThreadAudioInputBlockSchema,
  ThreadResourceLinkInputBlockSchema,
  ThreadEmbeddedResourceInputBlockSchema,
])
export type ThreadInputBlock = z.infer<typeof ThreadInputBlockSchema>

export const ThreadTimelineItemStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
])

const TimelineBaseItemSchema = z.object({
  itemId: z.string().min(1),
  harnessData: z
    .object({
      agentId: AgentIdSchema,
      nativeType: z.string().min(1),
      payload: z.unknown().optional(),
    })
    .optional(),
})

const TimelineTextItemSchema = TimelineBaseItemSchema.extend({
  operation: z.enum(["append", "replace"]),
  text: z.string(),
})

export const ThreadTimelineItemSchema = z.discriminatedUnion("type", [
  TimelineTextItemSchema.extend({
    attachments: z.array(ThreadAttachmentSchema).optional(),
    clientMessageId: z.string().min(1).optional(),
    role: z.enum(["user", "assistant"]),
    type: z.literal("message"),
  }),
  TimelineTextItemSchema.extend({ type: z.literal("reasoning") }),
  z.object({
    error: z.string().nullable(),
    input: z.unknown().nullable(),
    itemId: z.string().min(1),
    name: z.string().min(1),
    output: z.unknown().nullable(),
    harnessData: TimelineBaseItemSchema.shape.harnessData,
    status: ThreadTimelineItemStatusSchema,
    type: z.literal("tool"),
  }),
  z.object({
    entries: z.array(
      z.object({
        status: z.enum(["pending", "in_progress", "completed"]),
        text: z.string(),
      })
    ),
    itemId: z.string().min(1),
    harnessData: TimelineBaseItemSchema.shape.harnessData,
    type: z.literal("plan"),
  }),
  z.object({
    command: z.string(),
    cwd: z.string().nullable(),
    durationMs: z.number().nonnegative().nullable(),
    exitCode: z.int().nullable(),
    itemId: z.string().min(1),
    output: z.string(),
    harnessData: TimelineBaseItemSchema.shape.harnessData,
    status: ThreadTimelineItemStatusSchema,
    type: z.literal("command"),
  }),
  z.object({
    changes: z
      .array(
        z.object({
          diff: z.string(),
          kind: z.enum(["add", "delete", "update", "move"]),
          path: z.string().min(1),
          previousPath: z.string().nullable(),
        })
      )
      .min(1),
    itemId: z.string().min(1),
    harnessData: TimelineBaseItemSchema.shape.harnessData,
    status: ThreadTimelineItemStatusSchema,
    type: z.literal("diff"),
  }),
  z.object({
    decision: z.enum(["pending", "allowed", "denied", "cancelled"]),
    interactionId: z.string().nullable(),
    itemId: z.string().min(1),
    message: z.string(),
    harnessData: TimelineBaseItemSchema.shape.harnessData,
    title: z.string().nullable(),
    type: z.literal("approval"),
  }),
  z.object({
    itemId: z.string().min(1),
    kind: z.enum(["file", "image", "audio", "terminal", "url", "other"]),
    mimeType: z.string().nullable(),
    name: z.string(),
    harnessData: TimelineBaseItemSchema.shape.harnessData,
    uri: z.string().min(1),
    type: z.literal("artifact"),
  }),
  z.object({
    itemId: z.string().min(1),
    message: z.string(),
    harnessData: TimelineBaseItemSchema.shape.harnessData,
    status: ThreadTimelineItemStatusSchema,
    type: z.literal("status"),
  }),
  z.object({
    agentId: AgentIdSchema,
    itemId: z.string().min(1),
    nativeType: z.string().min(1),
    payload: z.unknown(),
    status: ThreadTimelineItemStatusSchema.optional(),
    type: z.literal("harness"),
  }),
  z.object({
    code: z.string().min(1),
    itemId: z.string().min(1),
    message: z.string(),
    harnessData: TimelineBaseItemSchema.shape.harnessData,
    type: z.literal("error"),
  }),
])
export type ThreadTimelineItem = z.infer<typeof ThreadTimelineItemSchema>

export const ThreadTimelineRowSchema = z.object({
  item: ThreadTimelineItemSchema,
  harnessItemId: z.string().nullable(),
  seq: z.int().positive(),
  timestamp: z.string().datetime(),
  turnId: z.string().nullable(),
})
export type ThreadTimelineRow = z.infer<typeof ThreadTimelineRowSchema>

export const ThreadTimelineSourceRangeSchema = z.object({
  end: z.int().positive(),
  start: z.int().positive(),
})

export const ThreadTimelineProjectedItemSchema = z.object({
  collapsed: z.boolean(),
  item: ThreadTimelineItemSchema,
  seqEnd: z.int().positive(),
  seqStart: z.int().positive(),
  sourceSeqRanges: z.array(ThreadTimelineSourceRangeSchema).min(1),
  timestamp: z.string().datetime(),
  turnId: z.string().nullable(),
})
export type ThreadTimelineProjectedItem = z.infer<typeof ThreadTimelineProjectedItemSchema>

export const ThreadTimelineCursorSchema = z.object({
  epoch: z.string().uuid(),
  seq: z.int().nonnegative(),
})
export type ThreadTimelineCursor = z.infer<typeof ThreadTimelineCursorSchema>

export const ThreadTimelineProjectionSchema = z.enum(["projected", "canonical"])
export type ThreadTimelineProjection = z.infer<typeof ThreadTimelineProjectionSchema>

export const ThreadTimelineDirectionSchema = z.enum(["tail", "before", "after"])
export type ThreadTimelineDirection = z.infer<typeof ThreadTimelineDirectionSchema>

export const ThreadTimelinePageSchema = z.object({
  canonicalRows: z.array(ThreadTimelineRowSchema),
  endCursor: ThreadTimelineCursorSchema.nullable(),
  epoch: z.string().uuid(),
  hasNewer: z.boolean(),
  hasOlder: z.boolean(),
  projectedItems: z.array(ThreadTimelineProjectedItemSchema),
  projection: ThreadTimelineProjectionSchema,
  reset: z.boolean(),
  startCursor: ThreadTimelineCursorSchema.nullable(),
  threadId: ProjectThreadIdSchema,
})
export type ThreadTimelinePage = z.infer<typeof ThreadTimelinePageSchema>

const errorSchema = z.object({ code: z.string().min(1), message: z.string().min(1) })
const emptySchema = z.object({})
const request = <T extends string, S extends z.ZodType>(type: T, payload: S) =>
  z.object({ payload, requestId: RequestIdSchema, type: z.literal(type) })
const resultSchema = <S extends z.ZodType>(schema: S) =>
  z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value: schema }),
    z.object({ error: errorSchema, ok: z.literal(false) }),
  ])
const response = <T extends string, S extends z.ZodType>(type: T, value: S) =>
  z.object({ payload: resultSchema(value), requestId: RequestIdSchema, type: z.literal(type) })
const timelineHeadSchema = z.object({
  endCursor: ThreadTimelineCursorSchema.nullable(),
  epoch: z.string().uuid(),
})
const threadReadySchema = z.object({ thread: ThreadViewSchema, timeline: timelineHeadSchema })
const threadListPageSchema = z.object({
  data: z.array(ThreadViewSchema),
  nextCursor: ProjectThreadCursorSchema.nullable(),
})

const beforeThreadSchema = z.object({ beforeThreadId: ProjectThreadIdSchema.nullish() })
const sectionPlacementSchema = z.object({
  beforeItem: z
    .object({ id: ProjectThreadIdSchema, type: z.enum(["thread", "project"]) })
    .nullish(),
  sectionId: ProjectThreadIdSchema,
})
const projectPlacementSchema = z.object({
  beforeThreadId: ProjectThreadIdSchema.nullish(),
  projectId: ProjectThreadIdSchema,
})

export const ThreadCreateRequestSchema = request(
  "thread.create.request",
  z.object({
    agentId: AgentIdSchema,
    ...beforeThreadSchema.shape,
    cwd: z.string().nullable().optional(),
    forkedFromId: ProjectThreadIdSchema.nullish(),
    projectPlacement: projectPlacementSchema.optional(),
    recencyAt: UnixTimestampSecondsSchema.nullish(),
    sectionPlacement: sectionPlacementSchema.optional(),
    title: z.string().nullable().optional(),
  })
)
export const ThreadGetRequestSchema = request(
  "thread.get.request",
  z.object({ threadId: ProjectThreadIdSchema })
)
export const ThreadListRequestSchema = request(
  "thread.list.request",
  z.object({
    agentId: AgentIdSchema.optional(),
    archived: z.boolean().optional(),
    cursor: ProjectThreadCursorSchema.nullish(),
    forkedFromId: ProjectThreadIdSchema.optional(),
    limit: ProjectThreadLimitSchema.optional(),
    projectId: ProjectThreadIdSchema.nullable().optional(),
    sectionId: ProjectThreadIdSchema.nullable().optional(),
    sortDirection: ProjectThreadSortDirectionSchema.optional(),
    sortKey: z
      .enum(["position", "recencyAt", "createdAt", "updatedAt", "sectionPosition"])
      .optional(),
  })
)
export const ThreadUpdateRequestSchema = request(
  "thread.update.request",
  z.object({
    cwd: z.string().nullable().optional(),
    threadId: ProjectThreadIdSchema,
    title: z.string().nullable().optional(),
  })
)
export const ThreadTouchRecencyRequestSchema = request(
  "thread.recency.touch.request",
  z.object({ recencyAt: UnixTimestampSecondsSchema, threadId: ProjectThreadIdSchema })
)
export const ThreadMoveRequestSchema = request(
  "thread.move.request",
  z.object({ ...beforeThreadSchema.shape, threadId: ProjectThreadIdSchema })
)
export const ThreadResumeRequestSchema = request(
  "thread.resume.request",
  z.object({ threadId: ProjectThreadIdSchema })
)
export const ThreadForkRequestSchema = request(
  "thread.fork.request",
  z.object({
    ...beforeThreadSchema.shape,
    cwd: z.string().nullable().optional(),
    projectPlacement: projectPlacementSchema.optional(),
    sectionPlacement: sectionPlacementSchema.optional(),
    threadId: ProjectThreadIdSchema,
    title: z.string().nullable().optional(),
  })
)
export const ThreadCloseRequestSchema = request(
  "thread.close.request",
  z.object({ threadId: ProjectThreadIdSchema })
)
export const ThreadArchiveRequestSchema = request(
  "thread.archive.request",
  z.object({ threadId: ProjectThreadIdSchema })
)
export const ThreadUnarchiveRequestSchema = request(
  "thread.unarchive.request",
  z.object({ threadId: ProjectThreadIdSchema })
)
export const ThreadDeleteRequestSchema = request(
  "thread.delete.request",
  z.object({ threadId: ProjectThreadIdSchema })
)
export const ThreadTurnStartRequestSchema = request(
  "thread.turn.start.request",
  z.object({
    clientMessageId: z.string().min(1),
    content: z.array(ThreadInputBlockSchema).min(1),
    threadId: ProjectThreadIdSchema,
  })
)
export const ThreadTurnSteerRequestSchema = request(
  "thread.turn.steer.request",
  z.object({
    clientMessageId: z.string().min(1),
    content: z.array(ThreadInputBlockSchema).min(1),
    threadId: ProjectThreadIdSchema,
  })
)
export const ThreadTurnCancelRequestSchema = request(
  "thread.turn.cancel.request",
  z.object({ threadId: ProjectThreadIdSchema, turnId: z.string().min(1).optional() })
)
export const ThreadTimelineGetRequestSchema = request(
  "thread.timeline.get.request",
  z.object({
    cursor: ThreadTimelineCursorSchema.optional(),
    direction: ThreadTimelineDirectionSchema.default("tail"),
    limit: z.int().min(1).max(500).default(100),
    projection: ThreadTimelineProjectionSchema.default("projected"),
    threadId: ProjectThreadIdSchema,
  })
)
export const ThreadContextUsageGetRequestSchema = request(
  "thread.context.usage.get.request",
  z.object({ threadId: ProjectThreadIdSchema })
)
export const ThreadConfigUpdateRequestSchema = request(
  "thread.config.update.request",
  z.object({
    mode: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    speed: z.string().nullable().optional(),
    thinking: z.string().nullable().optional(),
    threadId: ProjectThreadIdSchema,
  })
)
export const ThreadInteractionResponseSchema = z.discriminatedUnion("type", [
  z.object({
    decision: z.json().optional(),
    outcome: z.enum(["allow_once", "allow_always", "deny"]),
    permissions: z.json().optional(),
    scope: z.enum(["turn", "session"]).optional(),
    strictAutoReview: z.boolean().optional(),
    type: z.literal("permission"),
  }),
  z.object({ optionId: z.string().min(1), type: z.literal("selection") }),
  z.object({ type: z.literal("text"), value: z.string() }),
  z.object({
    answers: z.union([
      z.array(z.array(z.string())).min(1),
      z.record(z.string(), z.array(z.string())),
    ]),
    type: z.literal("answers"),
  }),
  z.object({
    action: z.enum(["accept", "decline", "cancel"]),
    content: z.json().optional(),
    type: z.literal("elicitation"),
  }),
  z.object({ type: z.literal("cancel") }),
])
export type ThreadInteractionResponse = z.infer<typeof ThreadInteractionResponseSchema>

export const ThreadInteractionRespondRequestSchema = request(
  "thread.interaction.respond.request",
  z.object({
    interactionId: z.string().min(1),
    response: ThreadInteractionResponseSchema,
    threadId: ProjectThreadIdSchema,
  })
)

export const ThreadCreateResponseSchema = response("thread.create.response", threadReadySchema)
export const ThreadGetResponseSchema = response("thread.get.response", ThreadViewSchema)
export const ThreadListResponseSchema = response("thread.list.response", threadListPageSchema)
export const ThreadUpdateResponseSchema = response("thread.update.response", ThreadViewSchema)
export const ThreadTouchRecencyResponseSchema = response(
  "thread.recency.touch.response",
  ThreadViewSchema
)
export const ThreadMoveResponseSchema = response("thread.move.response", emptySchema)
export const ThreadResumeResponseSchema = response("thread.resume.response", threadReadySchema)
export const ThreadForkResponseSchema = response("thread.fork.response", threadReadySchema)
export const ThreadCloseResponseSchema = response("thread.close.response", ThreadViewSchema)
export const ThreadArchiveResponseSchema = response("thread.archive.response", ThreadViewSchema)
export const ThreadUnarchiveResponseSchema = response("thread.unarchive.response", ThreadViewSchema)
export const ThreadDeleteResponseSchema = response("thread.delete.response", emptySchema)
export const ThreadTurnStartResponseSchema = response(
  "thread.turn.start.response",
  z.object({ thread: ThreadViewSchema, turnId: z.string().min(1) })
)
export const ThreadTurnSteerResponseSchema = response(
  "thread.turn.steer.response",
  z.object({ thread: ThreadViewSchema, turnId: z.string().min(1) })
)
export const ThreadTurnCancelResponseSchema = response(
  "thread.turn.cancel.response",
  ThreadViewSchema
)
export const ThreadTimelineGetResponseSchema = response(
  "thread.timeline.get.response",
  ThreadTimelinePageSchema
)
export const ThreadContextUsageGetResponseSchema = response(
  "thread.context.usage.get.response",
  ThreadContextUsageSchema.nullable()
)
export const ThreadConfigUpdateResponseSchema = response(
  "thread.config.update.response",
  ThreadViewSchema
)
export const ThreadInteractionRespondResponseSchema = response(
  "thread.interaction.respond.response",
  ThreadViewSchema
)

export const ThreadCreatedNotificationSchema = z.object({
  payload: ThreadViewSchema,
  type: z.literal("thread.created.notification"),
})
export const ThreadUpdatedNotificationSchema = z.object({
  payload: ThreadViewSchema,
  type: z.literal("thread.updated.notification"),
})
export const ThreadDeletedNotificationSchema = z.object({
  payload: z.object({ threadId: ProjectThreadIdSchema }),
  type: z.literal("thread.deleted.notification"),
})
export const ThreadTimelineAppendedNotificationSchema = z.object({
  payload: z.object({
    epoch: z.string().uuid(),
    row: ThreadTimelineRowSchema,
    threadId: ProjectThreadIdSchema,
  }),
  type: z.literal("thread.timeline.appended.notification"),
})
export const ThreadTimelineReplacedNotificationSchema = z.object({
  payload: z.object({
    epoch: z.string().uuid(),
    reason: z.enum(["hydrated", "history_changed", "gap_recovery", "cache_rebuilt"]),
    threadId: ProjectThreadIdSchema,
  }),
  type: z.literal("thread.timeline.replaced.notification"),
})
export const ThreadInteractionRequestedNotificationSchema = z.object({
  payload: z.object({ interaction: ThreadInteractionSchema, threadId: ProjectThreadIdSchema }),
  type: z.literal("thread.interaction.requested.notification"),
})
export const ThreadInteractionResolvedNotificationSchema = z.object({
  payload: z.object({ interactionId: z.string().min(1), threadId: ProjectThreadIdSchema }),
  type: z.literal("thread.interaction.resolved.notification"),
})
export const ThreadContextUsageUpdatedNotificationSchema = z.object({
  payload: z.object({
    threadId: ProjectThreadIdSchema,
    usage: ThreadContextUsageSchema.nullable(),
  }),
  type: z.literal("thread.context.usage.updated.notification"),
})
export const ThreadEventNotificationSchema = z.object({
  payload: z.object({
    event: z.discriminatedUnion("type", [
      z.object({ message: z.string(), type: z.literal("progress") }),
      z.object({ code: z.string().min(1), message: z.string(), type: z.literal("warning") }),
      z.object({
        agentId: AgentIdSchema,
        nativeType: z.string().min(1),
        payload: z.json(),
        type: z.literal("harness"),
      }),
    ]),
    threadId: ProjectThreadIdSchema,
  }),
  type: z.literal("thread.event.notification"),
})

export const THREAD_CLIENT_SCHEMAS = [
  ThreadCreateRequestSchema,
  ThreadGetRequestSchema,
  ThreadListRequestSchema,
  ThreadUpdateRequestSchema,
  ThreadTouchRecencyRequestSchema,
  ThreadMoveRequestSchema,
  ThreadResumeRequestSchema,
  ThreadForkRequestSchema,
  ThreadCloseRequestSchema,
  ThreadArchiveRequestSchema,
  ThreadUnarchiveRequestSchema,
  ThreadDeleteRequestSchema,
  ThreadTurnStartRequestSchema,
  ThreadTurnSteerRequestSchema,
  ThreadTurnCancelRequestSchema,
  ThreadTimelineGetRequestSchema,
  ThreadContextUsageGetRequestSchema,
  ThreadConfigUpdateRequestSchema,
  ThreadInteractionRespondRequestSchema,
] as const

export const THREAD_SERVER_SCHEMAS = [
  ThreadCreateResponseSchema,
  ThreadGetResponseSchema,
  ThreadListResponseSchema,
  ThreadUpdateResponseSchema,
  ThreadTouchRecencyResponseSchema,
  ThreadMoveResponseSchema,
  ThreadResumeResponseSchema,
  ThreadForkResponseSchema,
  ThreadCloseResponseSchema,
  ThreadArchiveResponseSchema,
  ThreadUnarchiveResponseSchema,
  ThreadDeleteResponseSchema,
  ThreadTurnStartResponseSchema,
  ThreadTurnSteerResponseSchema,
  ThreadTurnCancelResponseSchema,
  ThreadTimelineGetResponseSchema,
  ThreadContextUsageGetResponseSchema,
  ThreadConfigUpdateResponseSchema,
  ThreadInteractionRespondResponseSchema,
  ThreadCreatedNotificationSchema,
  ThreadUpdatedNotificationSchema,
  ThreadDeletedNotificationSchema,
  ThreadTimelineAppendedNotificationSchema,
  ThreadTimelineReplacedNotificationSchema,
  ThreadInteractionRequestedNotificationSchema,
  ThreadInteractionResolvedNotificationSchema,
  ThreadContextUsageUpdatedNotificationSchema,
  ThreadEventNotificationSchema,
] as const

export const THREAD_RESPONSE_TYPES = THREAD_SERVER_SCHEMAS.flatMap((schema) => {
  const type = schema.shape.type.value
  return type.endsWith(".response") ? [type] : []
})

export type ThreadClientMessage = z.infer<(typeof THREAD_CLIENT_SCHEMAS)[number]>
export type ThreadServerMessage = z.infer<(typeof THREAD_SERVER_SCHEMAS)[number]>
