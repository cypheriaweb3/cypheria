import { z } from "zod"

import {
  CODE_REVIEW_GITHUB_HOST_OPERATIONS,
  CODE_REVIEW_GITLAB_OPERATIONS,
  CodeReviewSettingsSchema,
  CodeReviewSidebarItemSchema,
} from "./code-review.ts"

/**
 * The Cypheria host extension of the Code Review MCP App: requests and notifications that travel
 * over the App's MCP Apps channel next to the standard `tools/call` and `ui/*` messages. Both the
 * App and the client hosting it validate them with these schemas.
 */

export const CodeReviewAppPullRequestSchema = z
  .object({
    hostname: z.string().min(1),
    owner: z.string().min(1),
    repository: z.string().min(1),
    number: z.number().int().positive(),
  })
  .strict()

export const CodeReviewSidebarSectionIdSchema = z.enum([
  "waiting_for_review",
  "needs_my_review",
  "needs_my_teams_review",
  "approved",
  "drafts",
  "merged",
])

export const CodeReviewSidebarStateSchema = z
  .object({
    provider: z.enum(["github", "gitlab"]),
    /** Identifies the account the sections belong to, so pins stay per account. */
    accountKey: z.string().min(1).max(1024),
    sections: z
      .array(
        z
          .object({
            id: CodeReviewSidebarSectionIdSchema,
            items: z.array(CodeReviewSidebarItemSchema).max(1000),
            loading: z.boolean(),
            hasMore: z.boolean(),
            failed: z.boolean(),
          })
          .strict()
      )
      .max(6),
    search: z
      .object({
        query: z.string().max(4096),
        items: z.array(CodeReviewSidebarItemSchema).max(1000),
        loading: z.boolean(),
        hasMore: z.boolean(),
        failed: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict()
export type CodeReviewSidebarState = z.infer<typeof CodeReviewSidebarStateSchema>

/** What opening a chat from Code Review asks the Agent to do. */
export const CodeReviewChatIntentSchema = z.enum([
  "chat",
  "review",
  "fix-checks",
  "fix-comments",
  "fix-conflicts",
])
export type CodeReviewChatIntent = z.infer<typeof CodeReviewChatIntentSchema>

/** Watch and fix: a schedule that keeps fixing a pull request from the chat that shows it. */
export const CodeReviewWatchSchema = z
  .object({
    status: z.enum(["unavailable", "off", "active", "paused"]),
    /** Why watching is unavailable here. */
    reason: z.enum(["missing-conversation", "pull-request-closed"]).optional(),
  })
  .strict()
export type CodeReviewWatch = z.infer<typeof CodeReviewWatchSchema>

const CodeReviewWatchTargetSchema = z
  .object({
    provider: z.enum(["github", "gitlab"]),
    url: z.string().url().max(4096),
    title: z.string().max(1024),
    open: z.boolean(),
  })
  .strict()

export const CODE_REVIEW_APP_REQUESTS = {
  "cypheria/codeReview/setup": z.object({ refresh: z.boolean().optional() }).strict(),
  "cypheria/codeReview/settings/get": z.object({}).strict(),
  "cypheria/codeReview/settings/update": z
    .object({ patch: CodeReviewSettingsSchema.partial().strict() })
    .strict(),
  "cypheria/codeReview/provider": z.discriminatedUnion("provider", [
    z
      .object({
        provider: z.literal("gitlab"),
        operation: z.enum(CODE_REVIEW_GITLAB_OPERATIONS),
        body: z.record(z.string(), z.unknown()),
      })
      .strict(),
    z
      .object({
        provider: z.literal("github"),
        operation: z.enum(CODE_REVIEW_GITHUB_HOST_OPERATIONS),
        body: z.record(z.string(), z.unknown()),
      })
      .strict(),
  ]),
  "cypheria/codeReview/sidebar": CodeReviewSidebarStateSchema,
  "cypheria/codeReview/connect": z
    .object({ provider: z.enum(["chatgpt", "github", "gitlab"]) })
    .strict(),
  "cypheria/codeReview/openLink": z.object({ url: z.string().url().max(4096) }).strict(),
  "cypheria/codeReview/openChat": z
    .object({
      provider: z.enum(["github", "gitlab"]),
      pullRequest: CodeReviewAppPullRequestSchema,
      url: z.string().url().max(4096),
      title: z.string().max(1024),
      intent: CodeReviewChatIntentSchema,
      /** Attached context, such as the failing checks or the comments to address. */
      context: z.string().max(200_000).optional(),
    })
    .strict(),
  /** The pull request the host shows when the App starts, such as one a link opened. */
  "cypheria/codeReview/selection": z.object({}).strict(),
  "cypheria/codeReview/threads": z.object({ url: z.string().url().max(4096) }).strict(),
  "cypheria/codeReview/openThread": z.object({ threadId: z.string().min(1) }).strict(),
  "cypheria/codeReview/watch/get": CodeReviewWatchTargetSchema,
  "cypheria/codeReview/watch/set": CodeReviewWatchTargetSchema.extend({
    enabled: z.boolean(),
  }).strict(),
  /**
   * The App opened a pull request: the host records it among the recent ones and says whether it
   * is pinned.
   */
  "cypheria/codeReview/visit": z
    .object({ item: CodeReviewSidebarItemSchema, accountKey: z.string().min(1) })
    .strict(),
  "cypheria/codeReview/pin": z
    .object({
      item: CodeReviewSidebarItemSchema,
      accountKey: z.string().min(1),
      pinned: z.boolean(),
    })
    .strict(),
} as const
export type CodeReviewAppRequestMethod = keyof typeof CODE_REVIEW_APP_REQUESTS

/** Host notifications the App listens for. */
export const CODE_REVIEW_APP_NOTIFICATIONS = {
  /** The user chose a pull request in the sidebar, or cleared the selection. */
  "cypheria/codeReview/select": z
    .object({ pullRequest: CodeReviewAppPullRequestSchema.nullable() })
    .strict(),
  /** The sidebar asks for more results, or to retry a failed section. */
  "cypheria/codeReview/sidebarAction": z
    .object({
      sectionId: CodeReviewSidebarSectionIdSchema.or(z.literal("search")),
      action: z.enum(["more", "retry"]),
    })
    .strict(),
  /** The sidebar search box changed. */
  "cypheria/codeReview/search": z.object({ query: z.string().max(4096) }).strict(),
  /** Code Review settings changed in another view. */
  "cypheria/codeReview/settings": z.object({ settings: CodeReviewSettingsSchema }).strict(),
} as const

export {
  type CodeReviewSettings,
  CodeReviewSettingsSchema,
  type CodeReviewSetup,
  CodeReviewSetupSchema,
  type CodeReviewSidebarItem,
  CodeReviewSidebarItemSchema,
  DEFAULT_CODE_REVIEW_SETTINGS,
} from "./code-review.ts"
