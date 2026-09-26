import { and, asc, eq, gt, or } from "drizzle-orm"
import { z } from "zod"

import type { CypheriaDatabase } from "./client.js"
import { threadAttachments } from "./schema/index.js"

export type ThreadAttachmentRecord = typeof threadAttachments.$inferSelect
export type ThreadAttachmentType = ThreadAttachmentRecord["attachmentType"]

export type ThreadAttachmentPage = {
  readonly data: ThreadAttachmentRecord[]
  readonly nextCursor: string | null
}

export type ThreadAttachmentPersistenceService = {
  list(input: {
    attachmentType?: ThreadAttachmentType
    cursor?: string | null
    limit?: number
    threadId?: string
  }): Promise<ThreadAttachmentPage>
  listForIdentity(input: {
    attachmentType: ThreadAttachmentType
    cursor?: string | null
    identityKey: string
    limit?: number
  }): Promise<ThreadAttachmentPage>
  remove(input: {
    attachmentType: ThreadAttachmentType
    identityKey: string
    threadId: string
  }): Promise<ThreadAttachmentRecord | undefined>
  upsert(
    input: {
      attachmentType: ThreadAttachmentType
      identityKey: string
      payload: unknown
      threadId: string
    },
    now?: number
  ): Promise<ThreadAttachmentRecord>
}

export class ThreadAttachmentPersistenceError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = code
    this.code = code
  }
}

const cursorSchema = z.discriminatedUnion("kind", [
  z.object({
    attachmentType: z.string(),
    identityKey: z.string(),
    kind: z.literal("list"),
    threadId: z.string(),
  }),
  z.object({ kind: z.literal("identity"), threadId: z.string() }),
])
type Cursor = z.infer<typeof cursorSchema>

const encodeCursor = (cursor: Cursor): string =>
  Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")

const decodeCursor = (value: string | null | undefined, kind: Cursor["kind"]): Cursor | null => {
  if (!value) return null
  try {
    const cursor = cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")))
    if (cursor.kind !== kind) throw new Error("Cursor kind mismatch")
    return cursor
  } catch {
    throw new ThreadAttachmentPersistenceError(
      "THREAD_ATTACHMENT_CURSOR_INVALID",
      "Thread attachment cursor is invalid"
    )
  }
}

const parseLimit = (limit: number | undefined): number => Math.min(Math.max(limit ?? 50, 1), 200)
const nowSeconds = (): number => Math.floor(Date.now() / 1000)

export const createThreadAttachmentPersistenceService = (
  database: CypheriaDatabase
): ThreadAttachmentPersistenceService => ({
  async list(input) {
    const limit = parseLimit(input.limit)
    const cursor = decodeCursor(input.cursor, "list")
    const after =
      cursor?.kind === "list"
        ? or(
            gt(threadAttachments.threadId, cursor.threadId),
            and(
              eq(threadAttachments.threadId, cursor.threadId),
              or(
                gt(threadAttachments.attachmentType, cursor.attachmentType as ThreadAttachmentType),
                and(
                  eq(
                    threadAttachments.attachmentType,
                    cursor.attachmentType as ThreadAttachmentType
                  ),
                  gt(threadAttachments.identityKey, cursor.identityKey)
                )
              )
            )
          )
        : undefined
    const rows = await database
      .select()
      .from(threadAttachments)
      .where(
        and(
          input.threadId ? eq(threadAttachments.threadId, input.threadId) : undefined,
          input.attachmentType
            ? eq(threadAttachments.attachmentType, input.attachmentType)
            : undefined,
          after
        )
      )
      .orderBy(
        asc(threadAttachments.threadId),
        asc(threadAttachments.attachmentType),
        asc(threadAttachments.identityKey)
      )
      .limit(limit + 1)
    const data = rows.slice(0, limit)
    const last = data.at(-1)
    return {
      data,
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({
              attachmentType: last.attachmentType,
              identityKey: last.identityKey,
              kind: "list",
              threadId: last.threadId,
            })
          : null,
    }
  },

  async listForIdentity(input) {
    const limit = parseLimit(input.limit)
    const cursor = decodeCursor(input.cursor, "identity")
    const rows = await database
      .select()
      .from(threadAttachments)
      .where(
        and(
          eq(threadAttachments.attachmentType, input.attachmentType),
          eq(threadAttachments.identityKey, input.identityKey),
          cursor?.kind === "identity" ? gt(threadAttachments.threadId, cursor.threadId) : undefined
        )
      )
      .orderBy(asc(threadAttachments.threadId))
      .limit(limit + 1)
    const data = rows.slice(0, limit)
    const last = data.at(-1)
    return {
      data,
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ kind: "identity", threadId: last.threadId })
          : null,
    }
  },

  async remove(input) {
    const [removed] = await database
      .delete(threadAttachments)
      .where(
        and(
          eq(threadAttachments.threadId, input.threadId),
          eq(threadAttachments.attachmentType, input.attachmentType),
          eq(threadAttachments.identityKey, input.identityKey)
        )
      )
      .returning()
    return removed
  },

  async upsert(input, now = nowSeconds()) {
    const [record] = await database
      .insert(threadAttachments)
      .values({ ...input, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [
          threadAttachments.threadId,
          threadAttachments.attachmentType,
          threadAttachments.identityKey,
        ],
        set: { payload: input.payload, updatedAt: now },
      })
      .returning()
    if (!record) {
      throw new ThreadAttachmentPersistenceError(
        "THREAD_ATTACHMENT_WRITE_FAILED",
        "Thread attachment could not be persisted"
      )
    }
    return record
  },
})
