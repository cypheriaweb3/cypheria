import { z } from "zod"

import { RequestIdSchema } from "./request-id.ts"

/**
 * Code Review host operations. The Code Review MCP App reads and writes GitHub pull requests through
 * the `code-review` plugin's tools; the host side covers what the official desktop keeps in its host:
 * whether ChatGPT, GitHub, and GitLab are connected, and the provider operations its bridge proxies.
 * Every provider operation runs on the Server with the user's ChatGPT session.
 */

/** GitLab operations the App may run; GitLab reads and writes live in the host, as officially. */
export const CODE_REVIEW_GITLAB_OPERATIONS = [
  "read-pull-request",
  "configure-auto-merge",
  "read-checks",
  "read-discussions",
  "post-comment",
  "reply-comment",
  "update-comment",
  "delete-comment",
  "read-diff",
  "update-resolution",
  "read-media",
  "read-mention-suggestions",
  "merge",
  "read-mergeability",
  "read-pull-requests-metadata",
  "update-reaction",
  "submit-review",
  "update-reviewer-assignment",
  "search-reviewer-candidates",
  "read-reviewers",
  "read-revision-file",
  "search-pull-requests",
  "read-snapshot",
  "read-stack",
  "update-status",
  "update-title",
  "update-body",
] as const

/** GitHub operations outside the plugin's tools that the official host runs for the App. */
export const CODE_REVIEW_GITHUB_HOST_OPERATIONS = [
  "gh-pr-reactions",
  "gh-pr-reaction-update",
  "searches",
  "initial-detail",
  "render-markdown",
  "review-metadata",
  "read-media",
] as const

export const CodeReviewProviderStatusSchema = z.enum(["ready", "required", "error"])
export type CodeReviewProviderStatus = z.infer<typeof CodeReviewProviderStatusSchema>

export const CodeReviewGitHubConnectionViewSchema = z
  .object({
    hostname: z.string(),
    connectorId: z.string(),
    accountLinkId: z.string(),
    login: z.string().nullable(),
    name: z.string().nullable(),
  })
  .strict()
export type CodeReviewGitHubConnectionView = z.infer<typeof CodeReviewGitHubConnectionViewSchema>

export const CodeReviewGitLabAccountSchema = z
  .object({
    provider: z.literal("gitlab-connector"),
    hostId: z.string().min(1),
    hostname: z.string().min(1),
    connectorId: z.string().min(1),
    accountLinkId: z.string().min(1),
  })
  .strict()
export type CodeReviewGitLabAccount = z.infer<typeof CodeReviewGitLabAccountSchema>

export const CodeReviewGitLabInstanceSchema = z
  .object({
    connectorId: z.string(),
    hostname: z.string(),
    name: z.string(),
    connected: z.boolean(),
  })
  .strict()
export type CodeReviewGitLabInstance = z.infer<typeof CodeReviewGitLabInstanceSchema>

/** Whether Code Review can run, and which accounts it can act for. */
export const CodeReviewSetupSchema = z
  .object({
    chatgpt: z.object({ signedIn: z.boolean(), email: z.string().nullable() }).strict(),
    github: z
      .object({
        status: CodeReviewProviderStatusSchema,
        /** Whether the OpenAI GitHub plugin is installed in Cypheria's Codex. */
        pluginInstalled: z.boolean(),
        /** The GitHub accounts linked in ChatGPT. */
        connections: z.array(CodeReviewGitHubConnectionViewSchema),
        error: z.string().nullable(),
      })
      .strict(),
    gitlab: z
      .object({
        status: CodeReviewProviderStatusSchema,
        pluginInstalled: z.boolean(),
        instances: z.array(CodeReviewGitLabInstanceSchema),
        /** The GitLab account Code Review uses, once its connector is linked. */
        account: CodeReviewGitLabAccountSchema.nullable(),
        error: z.string().nullable(),
      })
      .strict(),
  })
  .strict()
export type CodeReviewSetup = z.infer<typeof CodeReviewSetupSchema>

/** The GitHub account linked in ChatGPT that Code Review uses on one host. */
export const CodeReviewConnectionSchema = z
  .object({
    hostname: z.string().min(1),
    connectorId: z.string().min(1),
    accountLinkId: z.string().min(1),
  })
  .strict()
export type CodeReviewConnection = z.infer<typeof CodeReviewConnectionSchema>

export const CodeReviewSidebarSectionSchema = z.enum([
  "waiting_for_review",
  "needs_my_review",
  "needs_my_teams_review",
  "merged",
  "recents",
])
export type CodeReviewSidebarSection = z.infer<typeof CodeReviewSidebarSectionSchema>

/** Code Review preferences, shared by every client of this Server. */
export const CodeReviewSettingsSchema = z
  .object({
    gitHostingProvider: z.enum(["github", "gitlab"]),
    /** GitHub account Code Review uses; null uses the github.com account ChatGPT links. */
    githubConnection: CodeReviewConnectionSchema.nullable(),
    /** GitLab connector Code Review uses; null uses gitlab.com. */
    gitlabConnectorId: z.string().trim().min(1).nullable(),
    githubLinkTarget: z.enum(["code-review-tab", "in-app-browser", "external-browser"]),
    localReviewInstructions: z.string().max(100_000),
    sidebarSections: z.array(CodeReviewSidebarSectionSchema).max(5),
    sidebarLayout: z.enum(["compact", "detailed"]),
    activityNotifications: z.boolean(),
  })
  .strict()
export type CodeReviewSettings = z.infer<typeof CodeReviewSettingsSchema>
export const DEFAULT_CODE_REVIEW_SETTINGS: CodeReviewSettings = {
  gitHostingProvider: "github",
  githubConnection: null,
  gitlabConnectorId: null,
  githubLinkTarget: "code-review-tab",
  localReviewInstructions: "",
  sidebarSections: ["waiting_for_review", "needs_my_review", "needs_my_teams_review"],
  sidebarLayout: "detailed",
  activityNotifications: false,
}

const request = <T extends string, S extends z.ZodType>(type: T, payload: S) =>
  z.object({ type: z.literal(type), requestId: RequestIdSchema, payload }).strict()
const response = <T extends string, S extends z.ZodType>(type: T, value: S) =>
  z
    .object({
      type: z.literal(type),
      requestId: RequestIdSchema,
      payload: z.discriminatedUnion("ok", [
        z.object({ ok: z.literal(true), value }).strict(),
        z
          .object({
            ok: z.literal(false),
            error: z
              .object({
                code: z.string(),
                message: z.string(),
                kind: z.enum(["access", "rate-limit", "transient"]).optional(),
                retryAt: z.number().optional(),
              })
              .strict(),
          })
          .strict(),
      ]),
    })
    .strict()

export const CodeReviewSetupGetRequestSchema = request(
  "codeReview.setup.get.request",
  z.object({ refresh: z.boolean().optional() }).strict()
)
export const CodeReviewProviderRequestSchema = request(
  "codeReview.provider.request",
  z.discriminatedUnion("provider", [
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
  ])
)

export const CodeReviewSetupGetResponseSchema = response(
  "codeReview.setup.get.response",
  CodeReviewSetupSchema
)
export const CodeReviewProviderResponseSchema = response(
  "codeReview.provider.response",
  z.object({ value: z.unknown() }).strict()
)

export const CODE_REVIEW_CLIENT_SCHEMAS = [
  CodeReviewSetupGetRequestSchema,
  CodeReviewProviderRequestSchema,
] as const

export const CODE_REVIEW_SERVER_SCHEMAS = [
  CodeReviewSetupGetResponseSchema,
  CodeReviewProviderResponseSchema,
] as const

export const CODE_REVIEW_RESPONSE_TYPES = CODE_REVIEW_SERVER_SCHEMAS.map(
  (schema) => schema.shape.type.value
)

export type CodeReviewClientMessage = z.infer<(typeof CODE_REVIEW_CLIENT_SCHEMAS)[number]>
export type CodeReviewServerMessage = z.infer<(typeof CODE_REVIEW_SERVER_SCHEMAS)[number]>
