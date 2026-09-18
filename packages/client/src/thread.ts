import type {
  ThreadClientMessage,
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
  cancelTurn(threadId: string, turnId?: string, options?: RequestOptions): Promise<ThreadView>
  close(threadId: string, options?: RequestOptions): Promise<ThreadView>
  create(input: Payload<"thread.create.request">, options?: RequestOptions): Promise<ReadyThread>
  delete(threadId: string, options?: RequestOptions): Promise<void>
  get(threadId: string, options?: RequestOptions): Promise<ThreadView>
  getTimeline(
    input: Payload<"thread.timeline.get.request">,
    options?: RequestOptions
  ): Promise<ThreadTimelinePage>
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
  touchRecency(threadId: string, recencyAt: number, options?: RequestOptions): Promise<ThreadView>
  update(input: Payload<"thread.update.request">, options?: RequestOptions): Promise<ThreadView>
  updateConfig(
    input: Payload<"thread.config.update.request">,
    options?: RequestOptions
  ): Promise<ThreadView>
  readonly timeline: TimelineActions
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

  return {
    cancelTurn: (threadId, turnId, options) =>
      request(
        "thread.turn.cancel.request",
        { threadId, ...(turnId === undefined ? {} : { turnId }) },
        options
      ),
    close: (threadId, options) => request("thread.close.request", { threadId }, options),
    create: (input, options) => request("thread.create.request", input, options),
    delete: async (threadId, options) => {
      await request("thread.delete.request", { threadId }, options)
    },
    get: (threadId, options) => request("thread.get.request", { threadId }, options),
    getTimeline: (input, options) => request("thread.timeline.get.request", input, options),
    list: (input = {}, options) => request("thread.list.request", input, options),
    move: async (input, options) => {
      await request("thread.move.request", input, options)
    },
    respondToInteraction: (input, options) =>
      request("thread.interaction.respond.request", input, options),
    resume: (threadId, options) => request("thread.resume.request", { threadId }, options),
    startTurn: (input, options) => request("thread.turn.start.request", input, options),
    touchRecency: (threadId, recencyAt, options) =>
      request("thread.recency.touch.request", { recencyAt, threadId }, options),
    timeline,
    update: (input, options) => request("thread.update.request", input, options),
    updateConfig: (input, options) => request("thread.config.update.request", input, options),
  }
}
