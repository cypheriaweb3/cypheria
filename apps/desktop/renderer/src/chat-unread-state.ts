import type { ServerMessage } from "@cypheria/protocol"

import { clientStateStore, unreadThreadIdsAtom } from "./client-state.js"

export const MAX_UNREAD_THREAD_IDS = 1_000
export const UNREAD_THREAD_STORAGE_KEY = "unreadThreadIds"

export const nextUnreadThreadIds = (
  current: readonly string[],
  mutation: Readonly<{ action: "read" | "unread"; threadId: string }>,
  limit = MAX_UNREAD_THREAD_IDS
): string[] => {
  const withoutThread = current.filter((threadId) => threadId !== mutation.threadId)
  if (mutation.action === "read") return withoutThread
  return [...withoutThread, mutation.threadId].slice(-Math.max(1, limit))
}

export const mutateUnreadThread = (
  mutation: Readonly<{
    action: "read" | "unread"
    threadId: string
  }>
): void => {
  if (!mutation.threadId) return
  void clientStateStore.set(unreadThreadIdsAtom, (current) =>
    nextUnreadThreadIds(current, mutation)
  )
}

type UnreadThreadMutation = Readonly<{
  action: "read" | "unread"
  threadId: string
}>

export const unreadThreadMutationFromServerMessage = (
  event: ServerMessage,
  activeThreadId?: string
): UnreadThreadMutation | null => {
  if (
    event.type === "thread.timeline.appended.notification" &&
    event.payload.row.item.type === "message" &&
    event.payload.row.item.role === "assistant"
  )
    return {
      action: event.payload.threadId === activeThreadId ? "read" : "unread",
      threadId: event.payload.threadId,
    }
  if (event.type === "thread.deleted.notification")
    return { action: "read", threadId: event.payload.threadId }
  if (event.type === "thread.updated.notification" && event.payload.archivedAt !== null)
    return { action: "read", threadId: event.payload.id }
  return null
}
