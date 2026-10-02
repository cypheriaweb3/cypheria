import type { McpAppToolResult } from "@cypheria/protocol"
import { useQuery } from "@tanstack/react-query"
import { z } from "zod"

import { ensureCypheriaClient } from "../../cypheria-client.js"
import { useThreadAttachments } from "../../thread-attachments.js"
import { CODE_REVIEW_SERVER } from "./host.js"

/** A Thread's pull request as its header shows it. */
export type ThreadPullRequest = {
  readonly url: string
  readonly number: number
  readonly provider: "github" | "gitlab"
  readonly state: "open" | "closed" | "merged" | null
  readonly isDraft: boolean
  readonly ciStatus: "failing" | "none" | "passing" | "pending" | null
}

const structured = (result: McpAppToolResult) => {
  if (result.isError) {
    const text = result.content.find(
      (item): item is { type: "text"; text: string } =>
        typeof item === "object" && item != null && (item as { type?: unknown }).type === "text"
    )
    throw new Error(text?.text ?? "Code Review could not complete the request")
  }
  return result.structuredContent ?? {}
}

const callTool = async (name: string, args: Record<string, unknown>) =>
  structured(
    await (await ensureCypheriaClient()).mcpApps.callTool({
      arguments: args,
      name,
      server: CODE_REVIEW_SERVER,
    })
  )

const AccountSchema = z.object({
  currentUser: z.object({
    status: z.literal("success"),
    account: z.object({ hostname: z.string(), login: z.string() }).passthrough(),
  }),
})
const SearchSchema = z.object({
  items: z.array(
    z
      .object({
        url: z.string(),
        state: z.enum(["open", "closed", "merged"]),
        isDraft: z.boolean(),
        pullRequest: z.object({ number: z.number() }).passthrough(),
      })
      .passthrough()
  ),
})
const SummarySchema = z
  .object({
    status: z.string(),
    state: z.enum(["open", "closed", "merged"]).optional(),
    isDraft: z.boolean().optional(),
    ciStatus: z.enum(["failing", "none", "passing", "pending"]).optional(),
  })
  .passthrough()

/**
 * The pull request a Thread works on: the one attached to the Thread, or else the open GitHub pull
 * request of its branch, found through Code Review with the account the user linked in ChatGPT.
 */
export const useThreadPullRequest = (input: {
  cwd: string
  threadId: string | null
  branch: string | null
}) => {
  const attachments = useThreadAttachments("pull_request")
  const attached = (attachments.data ?? [])
    .filter((attachment) => attachment.threadId === input.threadId)
    .sort((left, right) => right.createdAt - left.createdAt)[0]
  const attachedUrl =
    attached && typeof (attached.payload as { url?: unknown }).url === "string"
      ? (attached.payload as { url: string }).url
      : null
  return useQuery({
    enabled: Boolean(attachedUrl || input.branch),
    queryFn: async (): Promise<ThreadPullRequest | null> => {
      const client = await ensureCypheriaClient()
      let url = attachedUrl
      if (!url && input.branch) {
        const remote = (await client.git.remotes(input.cwd).catch(() => [])).find(
          (entry) => entry.name === "origin"
        )
        if (!remote || remote.host === "gitlab.com") return null
        const settings = (await client.settings.get()).config.codeReview
        const connection =
          settings.githubConnection?.hostname === remote.host ? settings.githubConnection : null
        const account = AccountSchema.safeParse(
          await callTool("pull_requests.account", {
            hostname: remote.host,
            ...(connection
              ? {
                  connection: {
                    accountLinkId: connection.accountLinkId,
                    connectorId: connection.connectorId,
                  },
                }
              : {}),
          }).catch(() => null)
        )
        if (!account.success) return null
        const found = SearchSchema.parse(
          await callTool("pull_requests.search", {
            account: account.data.currentUser.account,
            hostname: remote.host,
            lifecycle: "all",
            pageSize: 1,
            rawQuery: `repo:${remote.repository} head:${input.branch}`,
            relationship: "all",
          })
        ).items[0]
        if (!found) return null
        url = found.url
      }
      if (!url) return null
      const parsed = new URL(url)
      const gitlab = parsed.pathname.includes("/-/merge_requests/")
      const number = Number(parsed.pathname.split("/").filter(Boolean).at(-1))
      if (gitlab) {
        return { ciStatus: null, isDraft: false, number, provider: "gitlab", state: null, url }
      }
      const [owner, repository] = parsed.pathname.split("/").filter(Boolean)
      const summary = SummarySchema.safeParse(
        await callTool("pull_requests.summary", {
          pullRequest: { hostname: parsed.hostname, number, owner, repository },
        }).catch(() => null)
      )
      const value = summary.success && summary.data.status === "success" ? summary.data : null
      return {
        ciStatus: value?.ciStatus ?? null,
        isDraft: value?.isDraft ?? false,
        number,
        provider: "github",
        state: value?.state ?? null,
        url,
      }
    },
    queryKey: [
      "code-review",
      "thread-pull-request",
      input.cwd,
      input.threadId,
      input.branch,
      attachedUrl,
    ],
    refetchInterval: 60_000,
    retry: false,
    staleTime: 30_000,
  })
}
