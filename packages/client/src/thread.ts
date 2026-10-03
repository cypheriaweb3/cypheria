import type {
  ThreadAttachmentPage,
  ThreadAttachmentRecord,
  ThreadAttachmentType,
  ThreadClientMessage,
  ThreadContextUsage,
  ThreadServerMessage,
  ThreadSummary,
  ThreadTimelinePage,
  ThreadView,
  WorkspaceFileReadResult,
  WorkspaceThread,
} from "@cypheria/protocol"
import { decodeFileTransferFrame } from "@cypheria/protocol"

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

type BranchReadyThread = Extract<
  Extract<ThreadServerMessage, { type: "thread.fork.response" }>["payload"],
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
  archive(
    threadId: string,
    options?: RequestOptions
  ): Promise<ExtractReady<"thread.archive.response">>
  archiveMany(
    threadIds: readonly string[],
    options?: RequestOptions
  ): Promise<ExtractReady<"thread.archive_many.response">>
  cancelTurn(threadId: string, turnId?: string, options?: RequestOptions): Promise<ThreadView>
  close(threadId: string, options?: RequestOptions): Promise<ThreadView>
  create(input: Payload<"thread.create.request">, options?: RequestOptions): Promise<ReadyThread>
  delete(threadId: string, options?: RequestOptions): Promise<void>
  get(threadId: string, options?: RequestOptions): Promise<ThreadView>
  getTimeline(
    input: Payload<"thread.timeline.get.request">,
    options?: RequestOptions
  ): Promise<ThreadTimelinePage>
  getSummary(threadId: string, options?: RequestOptions): Promise<ThreadSummary>
  fork(input: Payload<"thread.fork.request">, options?: RequestOptions): Promise<BranchReadyThread>
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
  rewind(
    input: Payload<"thread.rewind.request">,
    options?: RequestOptions
  ): Promise<BranchReadyThread>
  startTurn(
    input: Payload<"thread.turn.start.request">,
    options?: RequestOptions
  ): Promise<{ thread: ThreadView; turnId: string }>
  steerTurn(
    input: Payload<"thread.turn.steer.request">,
    options?: RequestOptions
  ): Promise<{ thread: ThreadView; turnId: string }>
  queueTurn(
    input: Payload<"thread.turn.queue.add.request">,
    options?: RequestOptions
  ): Promise<ExtractReady<"thread.turn.queue.add.response">>
  touchRecency(threadId: string, recencyAt: number, options?: RequestOptions): Promise<ThreadView>
  unarchive(threadId: string, options?: RequestOptions): Promise<ThreadView>
  update(input: Payload<"thread.update.request">, options?: RequestOptions): Promise<ThreadView>
  updateConfig(
    input: Payload<"thread.config.update.request">,
    options?: RequestOptions
  ): Promise<ThreadView>
  readonly attachments: ThreadAttachmentActions
  readonly workspaceThreads: WorkspaceThreadActions
  readonly files: ThreadFileActions
  readonly paths: ThreadPathActions
  readonly inputFiles: ThreadInputFileActions
  readonly timeline: TimelineActions
  readonly contextUsage: ThreadContextUsageActions
  readonly composer: ThreadComposerActions
  readonly workspace: ThreadWorkspaceActions
}

export interface ThreadPathActions {
  /** Resolves a path a model wrote to a Thread root on the Server host. */
  resolve(
    input: Payload<"thread.paths.resolve.request">,
    options?: RequestOptions
  ): Promise<ExtractReady<"thread.paths.resolve.response">>
}

export interface ThreadFileActions {
  create(
    input: Payload<"thread.files.create.request">,
    options?: RequestOptions
  ): Promise<ExtractReady<"thread.files.create.response">>
  delete(
    input: Payload<"thread.files.delete.request">,
    options?: RequestOptions
  ): Promise<ExtractReady<"thread.files.delete.response">>
  listDirectory(
    input: Payload<"thread.files.directory.list.request">,
    options?: RequestOptions
  ): Promise<ExtractReady<"thread.files.directory.list.response">>
  move(
    input: Payload<"thread.files.move.request">,
    options?: RequestOptions
  ): Promise<ExtractReady<"thread.files.move.response">>
  read(
    input: Payload<"thread.files.read.request">,
    options?: RequestOptions
  ): Promise<ThreadFileReadResult>
  restore(
    input: Payload<"thread.files.restore.request">,
    options?: RequestOptions
  ): Promise<ExtractReady<"thread.files.restore.response">>
  search(
    input: Payload<"thread.files.search.request">,
    options?: RequestOptions
  ): Promise<ExtractReady<"thread.files.search.response">>
  subscribe(
    threadId: string,
    handler: (
      changes: Extract<
        ThreadServerMessage,
        { type: "thread.files.changed.notification" }
      >["payload"]["changes"]
    ) => void
  ): () => void
  write(
    input: Payload<"thread.files.write.request">,
    options?: RequestOptions
  ): Promise<ExtractReady<"thread.files.write.response">>
}

export type ThreadFileReadResult =
  | Exclude<WorkspaceFileReadResult, { kind: "binary" }>
  | (Extract<WorkspaceFileReadResult, { kind: "binary" }> & { readonly bytes: Uint8Array })

export interface ThreadWorkspaceActions {
  cleanupDelete(
    paths: readonly string[],
    options?: RequestOptions
  ): Promise<ExtractReady<"thread.workspace.cleanup.delete.response">>
  cleanupList(
    options?: RequestOptions
  ): Promise<ExtractReady<"thread.workspace.cleanup.list.response">>
  sync(
    input: Payload<"thread.workspace.sync.request">,
    options?: RequestOptions
  ): Promise<ExtractReady<"thread.workspace.sync.response">>
}

export interface ThreadComposerActions {
  suggest(
    input: Payload<"thread.composer.suggest.request">,
    options?: RequestOptions
  ): Promise<ExtractReady<"thread.composer.suggest.response">>
}

type SuccessValue<Message> = Message extends { payload: infer Payload }
  ? Payload extends { ok: true; value: infer Value }
    ? Value
    : never
  : never
type ExtractReady<T extends ThreadServerMessage["type"]> = SuccessValue<
  Extract<ThreadServerMessage, { type: T }>
>

export type ThreadAttachmentEvent = Extract<
  ThreadServerMessage,
  {
    type: "thread.attachment.upserted.notification" | "thread.attachment.deleted.notification"
  }
>

/** The chat each workspace page, such as a plugin's global page, shows beside its App. */
export interface WorkspaceThreadActions {
  get(workspaceKey: string, options?: RequestOptions): Promise<WorkspaceThread>
  /** Shows a chat on the page; null starts a new one there. */
  set(
    workspaceKey: string,
    threadId: string | null,
    options?: RequestOptions
  ): Promise<WorkspaceThread>
  subscribe(handler: (chat: WorkspaceThread) => void): () => void
}

export interface ThreadAttachmentActions {
  /** Attaches a pull request; `root` and `headBranch` name the checkout it was opened from. */
  addPullRequest(
    threadId: string,
    url: string,
    input?: {
      readonly root?: string
      readonly headBranch?: string
    },
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

export interface ThreadInputFileActions {
  upload(
    input: {
      bytes: Uint8Array
      fileName: string
      mimeType: string
      onProgress?: (sent: number, total: number) => void
    },
    options?: RequestOptions
  ): Promise<ExtractReady<"thread.input-file.upload.complete.response">>
  start(
    input: Payload<"thread.input-file.upload.start.request">,
    options?: RequestOptions
  ): Promise<ExtractReady<"thread.input-file.upload.start.response">>
  chunk(
    input: Payload<"thread.input-file.upload.chunk.request">,
    options?: RequestOptions
  ): Promise<ExtractReady<"thread.input-file.upload.chunk.response">>
  status(
    input: Payload<"thread.input-file.upload.status.request">,
    options?: RequestOptions
  ): Promise<ExtractReady<"thread.input-file.upload.status.response">>
  complete(
    input: Payload<"thread.input-file.upload.complete.request">,
    options?: RequestOptions
  ): Promise<ExtractReady<"thread.input-file.upload.complete.response">>
  abort(
    input: Payload<"thread.input-file.upload.abort.request">,
    options?: RequestOptions
  ): Promise<ExtractReady<"thread.input-file.upload.abort.response">>
  get(
    input: Payload<"thread.input-file.get.request">,
    options?: RequestOptions
  ): Promise<ExtractReady<"thread.input-file.get.response">>
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
  const inputFiles: ThreadInputFileActions = {
    upload: async ({ bytes, fileName, mimeType, onProgress }, options) => {
      const digest = new Uint8Array(
        await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(bytes))
      )
      const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")
      const started = await request<ExtractReady<"thread.input-file.upload.start.response">>(
        "thread.input-file.upload.start.request",
        { byteSize: bytes.length, fileName, mimeType, sha256 },
        options
      )
      let offset = started.offset
      while (offset < bytes.length) {
        const slice = bytes.slice(offset, offset + started.chunkSize)
        try {
          const result = await request<ExtractReady<"thread.input-file.upload.chunk.response">>(
            "thread.input-file.upload.chunk.request",
            { bytes: slice, offset, uploadId: started.uploadId },
            options
          )
          offset = result.offset
        } catch (error) {
          const status = await request<ExtractReady<"thread.input-file.upload.status.response">>(
            "thread.input-file.upload.status.request",
            { uploadId: started.uploadId },
            options
          ).catch(() => {
            throw error
          })
          if (status.offset === offset) throw error
          offset = status.offset
        }
        onProgress?.(offset, bytes.length)
      }
      return request(
        "thread.input-file.upload.complete.request",
        { uploadId: started.uploadId },
        options
      )
    },
    start: (input, options) => request("thread.input-file.upload.start.request", input, options),
    chunk: (input, options) => request("thread.input-file.upload.chunk.request", input, options),
    status: (input, options) => request("thread.input-file.upload.status.request", input, options),
    complete: (input, options) =>
      request("thread.input-file.upload.complete.request", input, options),
    abort: (input, options) => request("thread.input-file.upload.abort.request", input, options),
    get: (input, options) => request("thread.input-file.get.request", input, options),
  }
  const composer: ThreadComposerActions = {
    suggest: (input, options) => request("thread.composer.suggest.request", input, options),
  }
  const paths: ThreadPathActions = {
    resolve: (input, options) => request("thread.paths.resolve.request", input, options),
  }
  const files: ThreadFileActions = {
    create: (input, options) => request("thread.files.create.request", input, options),
    delete: (input, options) => request("thread.files.delete.request", input, options),
    listDirectory: (input, options) =>
      request("thread.files.directory.list.request", input, options),
    move: (input, options) => request("thread.files.move.request", input, options),
    read: async (input, options) => {
      const chunks = new Map<string, Uint8Array[]>()
      const ended = new Set<string>()
      let expectedStreamId: string | undefined
      let finish: (() => void) | undefined
      const completed = new Promise<void>((resolve) => {
        finish = resolve
      })
      const unsubscribe = client.subscribeBinaryFrames((frame) => {
        const decoded = decodeFileTransferFrame(frame)
        if (!decoded) return
        const values = chunks.get(decoded.streamId) ?? []
        values.push(Uint8Array.from(decoded.data))
        chunks.set(decoded.streamId, values)
        if (decoded.end) ended.add(decoded.streamId)
        if (decoded.end && decoded.streamId === expectedStreamId) finish?.()
      })
      try {
        const result = await request<ExtractReady<"thread.files.read.response">>(
          "thread.files.read.request",
          input,
          options
        )
        if (result.kind !== "binary") return result
        expectedStreamId = result.streamId
        if (ended.has(result.streamId)) finish?.()
        const signal = options?.signal
        let rejectTransfer: (() => void) | undefined
        const aborted = new Promise<never>((_, reject) => {
          rejectTransfer = () =>
            reject(
              signal?.reason instanceof Error
                ? signal.reason
                : new Error("File transfer was aborted")
            )
          if (signal?.aborted) rejectTransfer()
          else signal?.addEventListener("abort", rejectTransfer, { once: true })
        })
        let transferTimer: ReturnType<typeof setTimeout> | undefined
        const timedOut = new Promise<never>((_, reject) => {
          transferTimer = setTimeout(
            () => reject(new Error("File transfer timed out")),
            options?.timeoutMs ?? 30_000
          )
        })
        try {
          await Promise.race([completed, aborted, timedOut])
        } finally {
          if (transferTimer) clearTimeout(transferTimer)
          if (signal && rejectTransfer) signal.removeEventListener("abort", rejectTransfer)
        }
        const received = chunks.get(result.streamId) ?? []
        const byteLength = received.reduce((total, chunk) => total + chunk.byteLength, 0)
        if (byteLength !== result.sizeBytes) {
          throw new Error(
            `Incomplete file transfer: expected ${result.sizeBytes} bytes, received ${byteLength}`
          )
        }
        const bytes = new Uint8Array(byteLength)
        let offset = 0
        for (const chunk of received) {
          bytes.set(chunk, offset)
          offset += chunk.byteLength
        }
        return { ...result, bytes }
      } finally {
        unsubscribe()
      }
    },
    restore: (input, options) => request("thread.files.restore.request", input, options),
    search: (input, options) => request("thread.files.search.request", input, options),
    subscribe: (threadId, handler) =>
      client.on("thread.files.changed.notification", ({ payload }) => {
        if (payload.threadId === threadId) handler(payload.changes)
      }),
    write: (input, options) => request("thread.files.write.request", input, options),
  }
  const workspace: ThreadWorkspaceActions = {
    cleanupDelete: (paths, options) =>
      request("thread.workspace.cleanup.delete.request", { paths: [...paths] }, options),
    cleanupList: (options) => request("thread.workspace.cleanup.list.request", {}, options),
    sync: (input, options) => request("thread.workspace.sync.request", input, options),
  }
  const attachments: ThreadAttachmentActions = {
    addPullRequest: (threadId, url, input = {}, options) =>
      request(
        "thread.attachment.add.request",
        {
          attachment: {
            attachmentType: "pull_request",
            url,
            ...(input.root ? { root: input.root } : {}),
            ...(input.headBranch ? { headBranch: input.headBranch } : {}),
          },
          threadId,
        },
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

  const workspaceThreads: WorkspaceThreadActions = {
    get: (workspaceKey, options) =>
      request("thread.workspace-thread.get.request", { workspaceKey }, options),
    set: (workspaceKey, threadId, options) =>
      request("thread.workspace-thread.set.request", { threadId, workspaceKey }, options),
    subscribe: (handler) =>
      client.on("thread.workspace-thread.updated.notification", (message) =>
        handler(message.payload)
      ),
  }

  return {
    archive: (threadId, options) => request("thread.archive.request", { threadId }, options),
    archiveMany: (threadIds, options) =>
      request("thread.archive_many.request", { threadIds: [...threadIds] }, options),
    attachments,
    workspaceThreads,
    cancelTurn: (threadId, turnId, options) =>
      request(
        "thread.turn.cancel.request",
        { threadId, ...(turnId === undefined ? {} : { turnId }) },
        options
      ),
    close: (threadId, options) => request("thread.close.request", { threadId }, options),
    composer,
    contextUsage,
    create: (input, options) => request("thread.create.request", input, options),
    delete: async (threadId, options) => {
      await request("thread.delete.request", { threadId }, options)
    },
    files,
    paths,
    get: (threadId, options) => request("thread.get.request", { threadId }, options),
    getTimeline: (input, options) => request("thread.timeline.get.request", input, options),
    getSummary: (threadId, options) => request("thread.summary.get.request", { threadId }, options),
    inputFiles,
    fork: (input, options) => request("thread.fork.request", input, options),
    list: (input = {}, options) => request("thread.list.request", input, options),
    move: async (input, options) => {
      await request("thread.move.request", input, options)
    },
    respondToInteraction: (input, options) =>
      request("thread.interaction.respond.request", input, options),
    resume: (threadId, options) => request("thread.resume.request", { threadId }, options),
    rewind: (input, options) => request("thread.rewind.request", input, options),
    startTurn: (input, options) => request("thread.turn.start.request", input, options),
    steerTurn: (input, options) => request("thread.turn.steer.request", input, options),
    queueTurn: (input, options) => request("thread.turn.queue.add.request", input, options),
    touchRecency: (threadId, recencyAt, options) =>
      request("thread.recency.touch.request", { recencyAt, threadId }, options),
    unarchive: (threadId, options) => request("thread.unarchive.request", { threadId }, options),
    timeline,
    update: (input, options) => request("thread.update.request", input, options),
    updateConfig: (input, options) => request("thread.config.update.request", input, options),
    workspace,
  }
}
