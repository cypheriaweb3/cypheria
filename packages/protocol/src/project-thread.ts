import { z } from "zod"

import { AgentIdSchema } from "./agent/registry.ts"
import { RequestIdSchema } from "./request-id.ts"

export const PINNED_SECTION_ID = "01984de2-8f74-7c91-a3b2-5c5e937cf318" as const

export const ProjectThreadIdSchema = z.uuidv7()
export const UnixTimestampSecondsSchema = z.int().nonnegative()
export const ProjectThreadSortDirectionSchema = z.enum(["asc", "desc"])
export const ProjectThreadCursorSchema = z.string().min(1).max(2048)
export const ProjectThreadLimitSchema = z.int().min(1).max(200)

export const ProjectSchema = z.object({
  createdAt: UnixTimestampSecondsSchema,
  id: ProjectThreadIdSchema,
  name: z.string().trim().min(1),
  position: z.int().nonnegative(),
  recencyAt: UnixTimestampSecondsSchema.nullable(),
  roots: z.array(z.string().trim().min(1)).min(1),
  updatedAt: UnixTimestampSecondsSchema,
})
export type Project = z.infer<typeof ProjectSchema>

export const ThreadSchema = z.object({
  archivedAt: UnixTimestampSecondsSchema.nullable(),
  id: ProjectThreadIdSchema,
  agentId: AgentIdSchema,
  agentSessionId: z.string().nullable(),
  title: z.string().nullable(),
  cwd: z.string().nullable(),
  forkedFromId: ProjectThreadIdSchema.nullable(),
  position: z.int().nonnegative(),
  recencyAt: UnixTimestampSecondsSchema.nullable(),
  createdAt: UnixTimestampSecondsSchema,
  updatedAt: UnixTimestampSecondsSchema,
})
export type Thread = z.infer<typeof ThreadSchema>

export const SectionSchema = z.object({
  color: z.string().nullable(),
  createdAt: UnixTimestampSecondsSchema,
  icon: z.string().nullable(),
  id: ProjectThreadIdSchema,
  name: z.string().trim().min(1),
  position: z.int().nonnegative(),
  updatedAt: UnixTimestampSecondsSchema,
})
export type Section = z.infer<typeof SectionSchema>

export const SectionItemRefSchema = z.discriminatedUnion("type", [
  z.object({ id: ProjectThreadIdSchema, type: z.literal("thread") }),
  z.object({ id: ProjectThreadIdSchema, type: z.literal("project") }),
])
export type SectionItemRef = z.infer<typeof SectionItemRefSchema>

export const ProjectItemSchema = z.object({
  createdAt: UnixTimestampSecondsSchema,
  position: z.int().nonnegative(),
  thread: ThreadSchema,
  updatedAt: UnixTimestampSecondsSchema,
})
export type ProjectItem = z.infer<typeof ProjectItemSchema>

export const ProjectMembershipSchema = z.object({
  createdAt: UnixTimestampSecondsSchema,
  position: z.int().nonnegative(),
  project: ProjectSchema,
  updatedAt: UnixTimestampSecondsSchema,
})
export type ProjectMembership = z.infer<typeof ProjectMembershipSchema>

export const SectionItemSchema = z.discriminatedUnion("type", [
  z.object({
    createdAt: UnixTimestampSecondsSchema,
    position: z.int().nonnegative(),
    thread: ThreadSchema,
    type: z.literal("thread"),
    updatedAt: UnixTimestampSecondsSchema,
  }),
  z.object({
    createdAt: UnixTimestampSecondsSchema,
    position: z.int().nonnegative(),
    project: ProjectSchema,
    type: z.literal("project"),
    updatedAt: UnixTimestampSecondsSchema,
  }),
])
export type SectionItem = z.infer<typeof SectionItemSchema>

export const SectionMembershipSchema = z.object({
  createdAt: UnixTimestampSecondsSchema,
  position: z.int().nonnegative(),
  section: SectionSchema,
  updatedAt: UnixTimestampSecondsSchema,
})
export type SectionMembership = z.infer<typeof SectionMembershipSchema>

const pageSchema = <S extends z.ZodType>(schema: S) =>
  z.object({ data: z.array(schema), nextCursor: ProjectThreadCursorSchema.nullable() })
const listPayloadSchema = z.object({
  cursor: ProjectThreadCursorSchema.nullish(),
  limit: ProjectThreadLimitSchema.optional(),
})
const beforeProjectSchema = z.object({ beforeProjectId: ProjectThreadIdSchema.nullish() })
const beforeThreadSchema = z.object({ beforeThreadId: ProjectThreadIdSchema.nullish() })
const beforeSectionSchema = z.object({ beforeSectionId: ProjectThreadIdSchema.nullish() })
const sectionPlacementSchema = z.object({
  beforeItem: SectionItemRefSchema.nullish(),
  sectionId: ProjectThreadIdSchema,
})
const request = <T extends string, S extends z.ZodType>(type: T, payload: S) =>
  z.object({ payload, requestId: RequestIdSchema, type: z.literal(type) })
const errorSchema = z.object({ code: z.string().min(1), message: z.string().min(1) })
const resultSchema = <S extends z.ZodType>(schema: S) =>
  z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value: schema }),
    z.object({ error: errorSchema, ok: z.literal(false) }),
  ])
const response = <T extends string, S extends z.ZodType>(type: T, value: S) =>
  z.object({ payload: resultSchema(value), requestId: RequestIdSchema, type: z.literal(type) })
const emptySchema = z.object({})

export const ProjectCreateRequestSchema = request(
  "project.create.request",
  z.object({
    ...beforeProjectSchema.shape,
    name: z.string().trim().min(1),
    roots: z.array(z.string().trim().min(1)).min(1),
    sectionPlacement: sectionPlacementSchema.optional(),
  })
)
export const ProjectReadRequestSchema = request(
  "project.read.request",
  z.object({ projectId: ProjectThreadIdSchema })
)
export const ProjectListRequestSchema = request(
  "project.list.request",
  listPayloadSchema.extend({
    sortDirection: ProjectThreadSortDirectionSchema.optional(),
    sortKey: z.enum(["position", "recencyAt"]).optional(),
  })
)
export const ProjectUpdateRequestSchema = request(
  "project.update.request",
  z.object({
    name: z.string().trim().min(1).optional(),
    projectId: ProjectThreadIdSchema,
    roots: z.array(z.string().trim().min(1)).min(1).optional(),
  })
)
export const ProjectMoveRequestSchema = request(
  "project.move.request",
  z.object({ ...beforeProjectSchema.shape, projectId: ProjectThreadIdSchema })
)
export const ProjectDeleteRequestSchema = request(
  "project.delete.request",
  z.object({ projectId: ProjectThreadIdSchema })
)

export const ProjectItemGetRequestSchema = request(
  "project.item.get.request",
  z.object({ threadId: ProjectThreadIdSchema })
)
export const ProjectItemListRequestSchema = request(
  "project.item.list.request",
  listPayloadSchema.extend({ projectId: ProjectThreadIdSchema })
)
export const ProjectItemMoveRequestSchema = request(
  "project.item.move.request",
  z.object({
    ...beforeThreadSchema.shape,
    projectId: ProjectThreadIdSchema,
    threadId: ProjectThreadIdSchema,
  })
)
export const ProjectItemRemoveRequestSchema = request(
  "project.item.remove.request",
  z.object({ threadId: ProjectThreadIdSchema })
)

export const SectionCreateRequestSchema = request(
  "section.create.request",
  z.object({
    ...beforeSectionSchema.shape,
    color: z.string().nullable().optional(),
    icon: z.string().nullable().optional(),
    name: z.string().trim().min(1),
  })
)
export const SectionReadRequestSchema = request(
  "section.read.request",
  z.object({ sectionId: ProjectThreadIdSchema })
)
export const SectionListRequestSchema = request("section.list.request", listPayloadSchema)
export const SectionUpdateRequestSchema = request(
  "section.update.request",
  z.object({
    color: z.string().nullable().optional(),
    icon: z.string().nullable().optional(),
    name: z.string().trim().min(1).optional(),
    sectionId: ProjectThreadIdSchema,
  })
)
export const SectionMoveRequestSchema = request(
  "section.move.request",
  z.object({ ...beforeSectionSchema.shape, sectionId: ProjectThreadIdSchema })
)
export const SectionDeleteRequestSchema = request(
  "section.delete.request",
  z.object({ sectionId: ProjectThreadIdSchema })
)

export const SectionItemGetRequestSchema = request(
  "section.item.get.request",
  z.object({ item: SectionItemRefSchema })
)
export const SectionItemListRequestSchema = request(
  "section.item.list.request",
  listPayloadSchema.extend({ sectionId: ProjectThreadIdSchema })
)
export const SectionItemMoveRequestSchema = request(
  "section.item.move.request",
  z.object({
    beforeItem: SectionItemRefSchema.nullish(),
    item: SectionItemRefSchema,
    sectionId: ProjectThreadIdSchema,
  })
)
export const SectionItemRemoveRequestSchema = request(
  "section.item.remove.request",
  z.object({ item: SectionItemRefSchema })
)
export const SectionItemPinRequestSchema = request(
  "section.item.pin.request",
  z.object({ beforeItem: SectionItemRefSchema.nullish(), item: SectionItemRefSchema })
)
export const SectionItemUnpinRequestSchema = request(
  "section.item.unpin.request",
  z.object({ item: SectionItemRefSchema })
)

export const ProjectCreateResponseSchema = response("project.create.response", ProjectSchema)
export const ProjectReadResponseSchema = response("project.read.response", ProjectSchema)
export const ProjectListResponseSchema = response(
  "project.list.response",
  pageSchema(ProjectSchema)
)
export const ProjectUpdateResponseSchema = response("project.update.response", ProjectSchema)
export const ProjectMoveResponseSchema = response("project.move.response", emptySchema)
export const ProjectDeleteResponseSchema = response("project.delete.response", emptySchema)
export const ProjectItemGetResponseSchema = response(
  "project.item.get.response",
  ProjectMembershipSchema.nullable()
)
export const ProjectItemListResponseSchema = response(
  "project.item.list.response",
  pageSchema(ProjectItemSchema)
)
export const ProjectItemMoveResponseSchema = response(
  "project.item.move.response",
  ProjectMembershipSchema
)
export const ProjectItemRemoveResponseSchema = response("project.item.remove.response", emptySchema)
export const SectionCreateResponseSchema = response("section.create.response", SectionSchema)
export const SectionReadResponseSchema = response("section.read.response", SectionSchema)
export const SectionListResponseSchema = response(
  "section.list.response",
  pageSchema(SectionSchema)
)
export const SectionUpdateResponseSchema = response("section.update.response", SectionSchema)
export const SectionMoveResponseSchema = response("section.move.response", emptySchema)
export const SectionDeleteResponseSchema = response("section.delete.response", emptySchema)
export const SectionItemGetResponseSchema = response(
  "section.item.get.response",
  SectionMembershipSchema.nullable()
)
export const SectionItemListResponseSchema = response(
  "section.item.list.response",
  pageSchema(SectionItemSchema)
)
export const SectionItemMoveResponseSchema = response(
  "section.item.move.response",
  SectionMembershipSchema
)
export const SectionItemRemoveResponseSchema = response("section.item.remove.response", emptySchema)
export const SectionItemPinResponseSchema = response(
  "section.item.pin.response",
  SectionMembershipSchema
)
export const SectionItemUnpinResponseSchema = response("section.item.unpin.response", emptySchema)

export const PROJECT_THREAD_CLIENT_SCHEMAS = [
  ProjectCreateRequestSchema,
  ProjectReadRequestSchema,
  ProjectListRequestSchema,
  ProjectUpdateRequestSchema,
  ProjectMoveRequestSchema,
  ProjectDeleteRequestSchema,
  ProjectItemGetRequestSchema,
  ProjectItemListRequestSchema,
  ProjectItemMoveRequestSchema,
  ProjectItemRemoveRequestSchema,
  SectionCreateRequestSchema,
  SectionReadRequestSchema,
  SectionListRequestSchema,
  SectionUpdateRequestSchema,
  SectionMoveRequestSchema,
  SectionDeleteRequestSchema,
  SectionItemGetRequestSchema,
  SectionItemListRequestSchema,
  SectionItemMoveRequestSchema,
  SectionItemRemoveRequestSchema,
  SectionItemPinRequestSchema,
  SectionItemUnpinRequestSchema,
] as const

export const PROJECT_THREAD_SERVER_SCHEMAS = [
  ProjectCreateResponseSchema,
  ProjectReadResponseSchema,
  ProjectListResponseSchema,
  ProjectUpdateResponseSchema,
  ProjectMoveResponseSchema,
  ProjectDeleteResponseSchema,
  ProjectItemGetResponseSchema,
  ProjectItemListResponseSchema,
  ProjectItemMoveResponseSchema,
  ProjectItemRemoveResponseSchema,
  SectionCreateResponseSchema,
  SectionReadResponseSchema,
  SectionListResponseSchema,
  SectionUpdateResponseSchema,
  SectionMoveResponseSchema,
  SectionDeleteResponseSchema,
  SectionItemGetResponseSchema,
  SectionItemListResponseSchema,
  SectionItemMoveResponseSchema,
  SectionItemRemoveResponseSchema,
  SectionItemPinResponseSchema,
  SectionItemUnpinResponseSchema,
] as const

export const PROJECT_THREAD_RESPONSE_TYPES = PROJECT_THREAD_SERVER_SCHEMAS.map(
  (schema) => schema.shape.type.value
)

export type ProjectThreadClientMessage = z.infer<(typeof PROJECT_THREAD_CLIENT_SCHEMAS)[number]>
export type ProjectThreadServerMessage = z.infer<(typeof PROJECT_THREAD_SERVER_SCHEMAS)[number]>
