import type {
  ThreadAttachmentPage,
  ThreadAttachmentRecord,
  ThreadAttachmentType,
  ThreadClientMessage,
  ThreadContextUsage,
  ThreadServerMessage,
  ThreadTimelinePage,
  ThreadView,
} from "@cypheria/protocol"

import type { ProjectThreadPage } from "./project-thread.js"
import type { RequestOptions } from "./request-options.js"
import type { ServerClient } from "./server-client.js"

type Payload<T extends ThreadClientMessage["type"]> = Extract<
  ThreadClientMessage,
  { type: T }
>["payload"]

type ResultPayload<T> =
  | { ok: true; value: T }
  | { error: { code: string; message: string }; ok: false }

type ReadyThread = Extract<
  Extract<ThreadServerMessage, { type: "thread.resume.response" }>["payload"],
  { ok: true }
>["value"]

const unwrap = <T>(message: ThreadServerMessage): T => {
  const payload = message.payload as ResultPayload<T>
  if (payload.ok) return payload.value
  const error = new Error(payload.error.message)
  error.name = payload.error.code
  throw error
}

export interface ThreadActions {
  archive(threadId: string, options?: RequestOptions): Promise<ThreadView>
  cancelTurn(threadId: string, turnId?: string, options?: RequestOptions): Promise<ThreadView>
  close(threadId: string, options?: RequestOptions): Promise<ThreadView>
  create(input: Payload<"thread.create.request">, options?: RequestOptions): Promise<ReadyThread>
  delete(threadId: string, options?: RequestOptions): Promise<void>
  get(threadId: string, options?: RequestOptions): Promise<ThreadView>
  getTimeline(
    input: Payload<"thread.timeline.get.request">,
    options?: RequestOptions
  ): Promise<ThreadTimelinePage>
  fork(input: Payload<"thread.fork.request">, options?: RequestOptions): Promise<ReadyThread>
  list(
    input?: Payload<"thread.list.request">,
    options?: RequestOptions
  ): Promise<ProjectThreadPage<ThreadView>>
  move(input: Payload<"thread.move.request">, options?: RequestOptions): Promise<void>
  respondToInteraction(
    input: Payload<"thread.interaction.respond.request">,
    options?: RequestOptions
  ): Promise<ThreadView>
  resume(threadId: string, options?: RequestOptions): Promise<ReadyThread>
  startTurn(
    input: Payload<"thread.turn.start.request">,
    options?: RequestOptions
  ): Promise<{ thread: ThreadView; turnId: string }>
  steerTurn(
    input: Payload<"thread.turn.steer.request">,
    options?: RequestOptions
  ): Promise<{ thread: ThreadView; turnId: string }>
  touchRecency(threadId: string, recencyAt: number, options?: RequestOptions): Promise<ThreadView>
  unarchive(threadId: string, options?: RequestOptions): Promise<ThreadView>
  update(input: Payload<"thread.update.request">, options?: RequestOptions): Promise<ThreadView>
  updateConfig(
    input: Payload<"thread.config.update.request">,
    options?: RequestOptions
  ): Promise<ThreadView>
  readonly attachments: ThreadAttachmentActions
  readonly timeline: TimelineActions
  readonly contextUsage: ThreadContextUsageActions
}

export type ThreadAttachmentEvent = Extract<
  ThreadServerMessage,
  {
    type: "thread.attachment.upserted.notification" | "thread.attachment.deleted.notification"
  }
>

export interface ThreadAttachmentActions {
  addPullRequest(
    threadId: string,
    url: string,
    options?: RequestOptions
  ): Promise<ThreadAttachmentRecord>
  addWorktree(
    threadId: string,
    worktreeId: string,
    options?: RequestOptions
  ): Promise<ThreadAttachmentRecord>
  list(
    input?: Payload<"thread.attachment.list.request">,
    options?: RequestOptions
  ): Promise<ThreadAttachmentPage>
  listOwners(
    attachmentType: ThreadAttachmentType,
    identityKey: string,
    input?: Omit<
      Payload<"thread.attachment.owners.list.request">,
      "attachmentType" | "identityKey"
    >,
    options?: RequestOptions
  ): Promise<ThreadAttachmentPage>
  remove(
    threadId: string,
    attachmentType: ThreadAttachmentType,
    identityKey: string,
    options?: RequestOptions
  ): Promise<boolean>
  subscribe(handler: (event: ThreadAttachmentEvent) => void): () => void
}

export interface ThreadContextUsageActions {
  get(threadId: string, options?: RequestOptions): Promise<ThreadContextUsage | null>
  subscribe(threadId: string, handler: (usage: ThreadContextUsage | null) => void): () => void
}

export interface TimelineActions {
  get(
    input: Payload<"thread.timeline.get.request">,
    options?: RequestOptions
  ): Promise<ThreadTimelinePage>
}

export const createThreadActions = (client: ServerClient): ThreadActions => {
  const request = async <T>(
    type: ThreadClientMessage["type"],
    payload: unknown,
    options?: RequestOptions
  ): Promise<T> => unwrap<T>(await client.requestThread(type, payload, options))

  const timeline: TimelineActions = {
    get: (input, options) => request("thread.timeline.get.request", input, options),
  }
  const contextUsage: ThreadContextUsageActions = {
    get: (threadId, options) => request("thread.context.usage.get.request", { threadId }, options),
    subscribe: (threadId, handler) =>
      client.on("thread.context.usage.updated.notification", ({ payload }) => {
        if (payload.threadId === threadId) handler(payload.usage)
      }),
  }
  const attachments: ThreadAttachmentActions = {
    addPullRequest: (threadId, url, options) =>
      request(
        "thread.attachment.add.request",
        { attachment: { attachmentType: "pull_request", url }, threadId },
        options
      ),
    addWorktree: (threadId, worktreeId, options) =>
      request(
        "thread.attachment.add.request",
        { attachment: { attachmentType: "worktree", worktreeId }, threadId },
        options
      ),
    list: (input = {}, options) => request("thread.attachment.list.request", input, options),
    listOwners: (attachmentType, identityKey, input = {}, options) =>
      request(
        "thread.attachment.owners.list.request",
        { ...input, attachmentType, identityKey },
        options
      ),
    remove: async (threadId, attachmentType, identityKey, options) => {
      const result = await request<{ removed: boolean }>(
        "thread.attachment.remove.request",
        { attachmentType, identityKey, threadId },
        options
      )
      return result.removed
    },
    subscribe: (handler) => {
      const unsubscribeUpserted = client.on("thread.attachment.upserted.notification", handler)
      const unsubscribeDeleted = client.on("thread.attachment.deleted.notification", handler)
      return () => {
        unsubscribeUpserted()
        unsubscribeDeleted()
      }
    },
  }

  return {
    archive: (threadId, options) => request("thread.archive.request", { threadId }, options),
    attachments,
    cancelTurn: (threadId, turnId, options) =>
      request(
        "thread.turn.cancel.request",
        { threadId, ...(turnId === undefined ? {} : { turnId }) },
        options
      ),
    close: (threadId, options) => request("thread.close.request", { threadId }, options),
    contextUsage,
    create: (input, options) => request("thread.create.request", input, options),
    delete: async (threadId, options) => {
      await request("thread.delete.request", { threadId }, options)
    },
    get: (threadId, options) => request("thread.get.request", { threadId }, options),
    getTimeline: (input, options) => request("thread.timeline.get.request", input, options),
    fork: (input, options) => request("thread.fork.request", input, options),
    list: (input = {}, options) => request("thread.list.request", input, options),
    move: async (input, options) => {
      await request("thread.move.request", input, options)
    },
    respondToInteraction: (input, options) =>
      request("thread.interaction.respond.request", input, options),
    resume: (threadId, options) => request("thread.resume.request", { threadId }, options),
    startTurn: (input, options) => request("thread.turn.start.request", input, options),
    steerTurn: (input, options) => request("thread.turn.steer.request", input, options),
    touchRecency: (threadId, recencyAt, options) =>
      request("thread.recency.touch.request", { recencyAt, threadId }, options),
    unarchive: (threadId, options) => request("thread.unarchive.request", { threadId }, options),
    timeline,
    update: (input, options) => request("thread.update.request", input, options),
    updateConfig: (input, options) => request("thread.config.update.request", input, options),
  }
}
