import type {
  CodeReviewChatIntent,
  CodeReviewSettings,
  CodeReviewSetup,
  CodeReviewSidebarItem,
  CodeReviewSidebarState,
  CodeReviewWatch,
} from "@cypheria/protocol/code-review-app"

import { hostRequest } from "./bridge.js"
import type { PullRequestIdentity } from "./schemas.js"

/** A Cypheria Thread linked to a pull request. */
export type AssociatedThread = { id: string; title: string | null; updatedAt: number }

/** The pull request a watch keeps fixing. */
export type WatchTarget = {
  provider: "github" | "gitlab"
  url: string
  title: string
  open: boolean
}

/** The host side of Code Review, as typed calls. */
export const host = {
  setup: (refresh = false) =>
    hostRequest<CodeReviewSetup>("cypheria/codeReview/setup", refresh ? { refresh } : {}),
  settings: () => hostRequest<CodeReviewSettings>("cypheria/codeReview/settings/get"),
  updateSettings: (patch: Partial<CodeReviewSettings>) =>
    hostRequest<CodeReviewSettings>("cypheria/codeReview/settings/update", { patch }),
  gitlab: <T = unknown>(operation: string, body: Record<string, unknown>) =>
    hostRequest<T>("cypheria/codeReview/provider", { body, operation, provider: "gitlab" }),
  github: <T = unknown>(operation: string, body: Record<string, unknown>) =>
    hostRequest<T>("cypheria/codeReview/provider", { body, operation, provider: "github" }),
  sidebar: (state: CodeReviewSidebarState) =>
    hostRequest("cypheria/codeReview/sidebar", state as unknown as Record<string, unknown>),
  connect: (provider: "chatgpt" | "github" | "gitlab") =>
    hostRequest("cypheria/codeReview/connect", { provider }),
  openLink: (url: string) => hostRequest("cypheria/codeReview/openLink", { url }),
  openChat: (input: {
    provider: "github" | "gitlab"
    pullRequest: PullRequestIdentity
    url: string
    title: string
    intent: CodeReviewChatIntent
    context?: string
  }) => hostRequest<{ threadId: string }>("cypheria/codeReview/openChat", input),
  selection: () =>
    hostRequest<{ pullRequest: PullRequestIdentity | null }>("cypheria/codeReview/selection"),
  threads: (url: string) =>
    hostRequest<{ threads: AssociatedThread[] }>("cypheria/codeReview/threads", { url }),
  openThread: (threadId: string) => hostRequest("cypheria/codeReview/openThread", { threadId }),
  watch: (target: WatchTarget) =>
    hostRequest<CodeReviewWatch>("cypheria/codeReview/watch/get", target),
  setWatch: (target: WatchTarget, enabled: boolean) =>
    hostRequest<CodeReviewWatch>("cypheria/codeReview/watch/set", { ...target, enabled }),
  pin: (item: CodeReviewSidebarItem, accountKey: string, pinned: boolean) =>
    hostRequest<{ pinned: boolean }>("cypheria/codeReview/pin", { accountKey, item, pinned }),
}
