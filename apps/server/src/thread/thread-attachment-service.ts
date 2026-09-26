import type {
  ThreadAttachmentRecord as PersistedThreadAttachmentRecord,
  ProjectThreadPersistenceService,
  ThreadAttachmentPersistenceService,
} from "@cypheria/db"
import {
  type ServerMessage,
  type ThreadAttachmentRecord,
  ThreadAttachmentRecordSchema,
  type ThreadClientMessage,
  type ThreadPullRequestAttachmentPayload,
  type ThreadServerMessage,
} from "@cypheria/protocol"

export type ThreadAttachmentClientMessage = Extract<
  ThreadClientMessage,
  { type: `thread.attachment.${string}` }
>

export type ThreadAttachmentServiceOptions = {
  readonly persistence: ThreadAttachmentPersistenceService
  readonly projects: ProjectThreadPersistenceService
  readonly publish?: (message: ServerMessage) => void
  readonly worktreeExists?: (worktreeId: string) => Promise<boolean>
}

export class ThreadAttachmentServiceError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = code
    this.code = code
  }
}

const validPathPart = (value: string): boolean => /^[a-z0-9_.-]+$/iu.test(value)

const parsePullRequestUrl = (raw: string): ThreadPullRequestAttachmentPayload => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ThreadAttachmentServiceError(
      "THREAD_ATTACHMENT_URL_INVALID",
      "Pull request URL is invalid"
    )
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new ThreadAttachmentServiceError(
      "THREAD_ATTACHMENT_URL_INVALID",
      "Pull request URL must be an HTTPS URL without credentials"
    )
  }
  let parts: string[]
  try {
    parts = url.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => decodeURIComponent(part))
  } catch {
    throw new ThreadAttachmentServiceError(
      "THREAD_ATTACHMENT_URL_INVALID",
      "Pull request URL contains an invalid path"
    )
  }
  const host = url.hostname.toLowerCase()
  if (host === "github.com") {
    if (
      parts.length !== 4 ||
      parts[2] !== "pull" ||
      !validPathPart(parts[0] ?? "") ||
      !validPathPart(parts[1] ?? "") ||
      !/^\d+$/u.test(parts[3] ?? "")
    ) {
      throw new ThreadAttachmentServiceError(
        "THREAD_ATTACHMENT_URL_INVALID",
        "GitHub pull request URL is invalid"
      )
    }
    const owner = parts[0] ?? ""
    const repository = parts[1] ?? ""
    const number = Number(parts[3])
    if (!Number.isSafeInteger(number) || number < 1) {
      throw new ThreadAttachmentServiceError(
        "THREAD_ATTACHMENT_URL_INVALID",
        "GitHub pull request number is invalid"
      )
    }
    return {
      host,
      number,
      owner,
      provider: "github",
      repository,
      url: `https://${host}/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pull/${number}`,
    }
  }
  if (host === "gitlab.com") {
    const marker = parts.lastIndexOf("-")
    if (
      marker < 2 ||
      marker !== parts.length - 3 ||
      parts[marker + 1] !== "merge_requests" ||
      !/^\d+$/u.test(parts[marker + 2] ?? "") ||
      parts.slice(0, marker).some((part) => !validPathPart(part))
    ) {
      throw new ThreadAttachmentServiceError(
        "THREAD_ATTACHMENT_URL_INVALID",
        "GitLab merge request URL is invalid"
      )
    }
    const project = parts.slice(0, marker)
    const repository = project.at(-1) ?? ""
    const owner = project.slice(0, -1).join("/")
    const number = Number(parts[marker + 2])
    if (!Number.isSafeInteger(number) || number < 1) {
      throw new ThreadAttachmentServiceError(
        "THREAD_ATTACHMENT_URL_INVALID",
        "GitLab merge request number is invalid"
      )
    }
    const projectPath = project.map(encodeURIComponent).join("/")
    return {
      host,
      number,
      owner,
      provider: "gitlab",
      repository,
      url: `https://${host}/${projectPath}/-/merge_requests/${number}`,
    }
  }
  throw new ThreadAttachmentServiceError(
    "THREAD_ATTACHMENT_PROVIDER_UNSUPPORTED",
    "Only GitHub and GitLab pull request URLs are supported"
  )
}

const pullRequestIdentityKey = (payload: ThreadPullRequestAttachmentPayload): string =>
  `${payload.provider}:${payload.host}:${payload.owner.toLowerCase()}/${payload.repository.toLowerCase()}#${payload.number}`

const record = (value: PersistedThreadAttachmentRecord): ThreadAttachmentRecord =>
  ThreadAttachmentRecordSchema.parse(value)

export class ThreadAttachmentService {
  readonly #persistence: ThreadAttachmentPersistenceService
  readonly #projects: ProjectThreadPersistenceService
  readonly #publish: (message: ServerMessage) => void
  readonly #worktreeExists: ((worktreeId: string) => Promise<boolean>) | undefined

  constructor(options: ThreadAttachmentServiceOptions) {
    this.#persistence = options.persistence
    this.#projects = options.projects
    this.#publish = options.publish ?? (() => undefined)
    this.#worktreeExists = options.worktreeExists
  }

  async attachPullRequest(threadId: string, url: string): Promise<ThreadAttachmentRecord> {
    await this.#assertThread(threadId)
    const payload = parsePullRequestUrl(url)
    const attachment = record(
      await this.#persistence.upsert({
        attachmentType: "pull_request",
        identityKey: pullRequestIdentityKey(payload),
        payload,
        threadId,
      })
    )
    this.#publish({ payload: attachment, type: "thread.attachment.upserted.notification" })
    return attachment
  }

  async attachWorktree(threadId: string, worktreeId: string): Promise<ThreadAttachmentRecord> {
    await this.#assertThread(threadId)
    if (this.#worktreeExists && !(await this.#worktreeExists(worktreeId))) {
      throw new ThreadAttachmentServiceError(
        "THREAD_ATTACHMENT_WORKTREE_NOT_FOUND",
        "Managed worktree was not found"
      )
    }
    const owner = (
      await this.#persistence.listForIdentity({
        attachmentType: "worktree",
        identityKey: worktreeId,
        limit: 1,
      })
    ).data[0]
    if (owner && owner.threadId !== threadId) {
      throw new ThreadAttachmentServiceError(
        "THREAD_ATTACHMENT_CONFLICT",
        "Managed worktree is attached to another Thread"
      )
    }
    const attachment = record(
      await this.#persistence.upsert({
        attachmentType: "worktree",
        identityKey: worktreeId,
        payload: { worktreeId },
        threadId,
      })
    )
    this.#publish({ payload: attachment, type: "thread.attachment.upserted.notification" })
    return attachment
  }

  async detachWorktree(threadId: string, worktreeId: string): Promise<boolean> {
    return this.#remove(threadId, "worktree", worktreeId)
  }

  async deleteForThread(threadId: string): Promise<void> {
    let cursor: string | null = null
    do {
      const page = await this.#persistence.list({ cursor, limit: 200, threadId })
      for (const attachment of page.data) {
        await this.#remove(threadId, attachment.attachmentType, attachment.identityKey)
      }
      cursor = page.nextCursor
    } while (cursor)
  }

  async handle(
    message: ThreadAttachmentClientMessage,
    send: (message: ServerMessage) => void
  ): Promise<void> {
    const respond = (value: unknown): void => {
      send({
        payload: { ok: true, value },
        requestId: message.requestId,
        type: message.type.replace(/\.request$/u, ".response"),
      } as ThreadServerMessage)
    }
    try {
      switch (message.type) {
        case "thread.attachment.list.request": {
          if (message.payload.threadId) await this.#assertThread(message.payload.threadId)
          const page = await this.#persistence.list(message.payload)
          respond({ data: page.data.map(record), nextCursor: page.nextCursor })
          break
        }
        case "thread.attachment.owners.list.request": {
          const page = await this.#persistence.listForIdentity(message.payload)
          respond({ data: page.data.map(record), nextCursor: page.nextCursor })
          break
        }
        case "thread.attachment.add.request": {
          if (message.payload.attachment.attachmentType === "worktree") {
            respond(
              await this.attachWorktree(
                message.payload.threadId,
                message.payload.attachment.worktreeId
              )
            )
            break
          }
          respond(
            await this.attachPullRequest(message.payload.threadId, message.payload.attachment.url)
          )
          break
        }
        case "thread.attachment.remove.request": {
          await this.#assertThread(message.payload.threadId)
          respond({
            removed: await this.#remove(
              message.payload.threadId,
              message.payload.attachmentType,
              message.payload.identityKey
            ),
          })
          break
        }
      }
    } catch (error) {
      send({
        payload: {
          error: {
            code:
              error instanceof ThreadAttachmentServiceError
                ? error.code
                : error instanceof Error
                  ? error.name || "THREAD_ATTACHMENT_ERROR"
                  : "THREAD_ATTACHMENT_ERROR",
            message: error instanceof Error ? error.message : String(error),
          },
          ok: false,
        },
        requestId: message.requestId,
        type: message.type.replace(/\.request$/u, ".response"),
      } as ThreadServerMessage)
    }
  }

  async #assertThread(threadId: string): Promise<void> {
    if (!(await this.#projects.getThread(threadId))) {
      throw new ThreadAttachmentServiceError("THREAD_NOT_FOUND", "Thread was not found")
    }
  }

  async #remove(
    threadId: string,
    attachmentType: "pull_request" | "worktree",
    identityKey: string
  ): Promise<boolean> {
    const removed = await this.#persistence.remove({ attachmentType, identityKey, threadId })
    if (!removed) return false
    this.#publish({
      payload: { attachmentType, identityKey, threadId },
      type: "thread.attachment.deleted.notification",
    })
    return true
  }
}
