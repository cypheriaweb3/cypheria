import type {
  Project,
  ProjectItem,
  ProjectMembership,
  ProjectThreadClientMessage,
  ProjectThreadServerMessage,
  Section,
  SectionItem,
  SectionItemRef,
  SectionMembership,
} from "@cypheria/protocol"

import type { RequestOptions } from "./request-options.js"
import type { ServerClient } from "./server-client.js"

type Payload<T extends ProjectThreadClientMessage["type"]> = Extract<
  ProjectThreadClientMessage,
  { type: T }
>["payload"]

type ResultPayload<T> =
  | { ok: true; value: T }
  | { error: { code: string; message: string }; ok: false }

export type ProjectThreadPage<T> = {
  readonly data: T[]
  readonly nextCursor: string | null
}

const unwrap = <T>(message: ProjectThreadServerMessage): T => {
  const payload = message.payload as ResultPayload<T>
  if (payload.ok) return payload.value
  const error = new Error(payload.error.message)
  error.name = payload.error.code
  throw error
}

export interface ProjectActions {
  create(input: Payload<"project.create.request">, options?: RequestOptions): Promise<Project>
  delete(projectId: string, options?: RequestOptions): Promise<void>
  get(projectId: string, options?: RequestOptions): Promise<Project>
  getThreadProject(threadId: string, options?: RequestOptions): Promise<ProjectMembership | null>
  list(
    input?: Payload<"project.list.request">,
    options?: RequestOptions
  ): Promise<ProjectThreadPage<Project>>
  listThreads(
    input: Payload<"project.item.list.request">,
    options?: RequestOptions
  ): Promise<ProjectThreadPage<ProjectItem>>
  move(input: Payload<"project.move.request">, options?: RequestOptions): Promise<void>
  moveThread(
    input: Payload<"project.item.move.request">,
    options?: RequestOptions
  ): Promise<ProjectMembership>
  removeThread(threadId: string, options?: RequestOptions): Promise<void>
  update(input: Payload<"project.update.request">, options?: RequestOptions): Promise<Project>
}

export interface SectionActions {
  create(input: Payload<"section.create.request">, options?: RequestOptions): Promise<Section>
  delete(sectionId: string, options?: RequestOptions): Promise<void>
  get(sectionId: string, options?: RequestOptions): Promise<Section>
  getItemSection(item: SectionItemRef, options?: RequestOptions): Promise<SectionMembership | null>
  list(
    input?: Payload<"section.list.request">,
    options?: RequestOptions
  ): Promise<ProjectThreadPage<Section>>
  listItems(
    input: Payload<"section.item.list.request">,
    options?: RequestOptions
  ): Promise<ProjectThreadPage<SectionItem>>
  move(input: Payload<"section.move.request">, options?: RequestOptions): Promise<void>
  moveItem(
    input: Payload<"section.item.move.request">,
    options?: RequestOptions
  ): Promise<SectionMembership>
  pinItem(
    input: Payload<"section.item.pin.request">,
    options?: RequestOptions
  ): Promise<SectionMembership>
  removeItem(item: SectionItemRef, options?: RequestOptions): Promise<void>
  unpinItem(item: SectionItemRef, options?: RequestOptions): Promise<void>
  update(input: Payload<"section.update.request">, options?: RequestOptions): Promise<Section>
}

export interface ProjectThreadActions {
  readonly projects: ProjectActions
  readonly sections: SectionActions
}

export const createProjectThreadActions = (client: ServerClient): ProjectThreadActions => {
  const request = async <T>(
    type: ProjectThreadClientMessage["type"],
    payload: unknown,
    options?: RequestOptions
  ): Promise<T> => unwrap<T>(await client.requestProjectThread(type, payload, options))

  return {
    projects: {
      create: (input, options) => request("project.create.request", input, options),
      delete: async (projectId, options) => {
        await request("project.delete.request", { projectId }, options)
      },
      get: (projectId, options) => request("project.read.request", { projectId }, options),
      getThreadProject: (threadId, options) =>
        request("project.item.get.request", { threadId }, options),
      list: (input = {}, options) => request("project.list.request", input, options),
      listThreads: (input, options) => request("project.item.list.request", input, options),
      move: async (input, options) => {
        await request("project.move.request", input, options)
      },
      moveThread: (input, options) => request("project.item.move.request", input, options),
      removeThread: async (threadId, options) => {
        await request("project.item.remove.request", { threadId }, options)
      },
      update: (input, options) => request("project.update.request", input, options),
    },
    sections: {
      create: (input, options) => request("section.create.request", input, options),
      delete: async (sectionId, options) => {
        await request("section.delete.request", { sectionId }, options)
      },
      get: (sectionId, options) => request("section.read.request", { sectionId }, options),
      getItemSection: (item, options) => request("section.item.get.request", { item }, options),
      list: (input = {}, options) => request("section.list.request", input, options),
      listItems: (input, options) => request("section.item.list.request", input, options),
      move: async (input, options) => {
        await request("section.move.request", input, options)
      },
      moveItem: (input, options) => request("section.item.move.request", input, options),
      pinItem: (input, options) => request("section.item.pin.request", input, options),
      removeItem: async (item, options) => {
        await request("section.item.remove.request", { item }, options)
      },
      unpinItem: async (item, options) => {
        await request("section.item.unpin.request", { item }, options)
      },
      update: (input, options) => request("section.update.request", input, options),
    },
  }
}
