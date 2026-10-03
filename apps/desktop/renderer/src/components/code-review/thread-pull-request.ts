import { useQuery } from "@tanstack/react-query"
import { z } from "zod"

import { ensureCypheriaClient } from "../../cypheria-client.js"
import { useThreadAttachments } from "../../thread-attachments.js"

/** A Thread's pull request as its header shows it. */
export type ThreadPullRequest = {
  readonly url: string
  /** Its Thread Attachment identity. */
  readonly identityKey: string
  /** The attachment's checkout, which undoing a detach restores. */
  readonly checkout: { readonly root?: string; readonly headBranch?: string }
  readonly number: number
  readonly provider: "github" | "gitlab"
  readonly state: "open" | "closed" | "merged" | null
  readonly isDraft: boolean
  readonly ciStatus: "failing" | "none" | "passing" | "pending" | null
}

const structured = (result: {
  content: unknown[]
  isError: boolean
  structuredContent?: Record<string, unknown>
}) => {
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
  structured(await (await ensureCypheriaClient()).codeReview.callTool(name, args))

const SummarySchema = z
  .object({
    status: z.string(),
    state: z.enum(["open", "closed", "merged"]).optional(),
    isDraft: z.boolean().optional(),
    ciStatus: z.enum(["failing", "none", "passing", "pending"]).optional(),
  })
  .passthrough()

/**
 * The pull request a Thread works on: the one most recently attached to it. As in ChatGPT
 * Desktop, a Thread without a pull request attachment shows none; nothing is inferred from its
 * branch.
 */
export const useThreadPullRequest = (input: { threadId: string | null }) => {
  const attachments = useThreadAttachments("pull_request")
  const attached = (attachments.data ?? [])
    .filter((attachment) => attachment.threadId === input.threadId)
    .reduce<(typeof attachments.data & object)[number] | null>(
      (latest, attachment) =>
        latest === null || attachment.updatedAt >= latest.updatedAt ? attachment : latest,
      null
    )
  const payload = attached?.payload as
    | { url?: unknown; root?: unknown; headBranch?: unknown }
    | undefined
  const url = typeof payload?.url === "string" ? payload.url : null
  const identityKey = attached?.identityKey ?? null
  const root = typeof payload?.root === "string" ? payload.root : null
  const headBranch = typeof payload?.headBranch === "string" ? payload.headBranch : null
  return useQuery({
    enabled: url !== null,
    queryFn: async (): Promise<ThreadPullRequest | null> => {
      if (!url || !identityKey) return null
      const checkout = {
        ...(root ? { root } : {}),
        ...(headBranch ? { headBranch } : {}),
      }
      const parsed = new URL(url)
      const gitlab = parsed.pathname.includes("/-/merge_requests/")
      const number = Number(parsed.pathname.split("/").filter(Boolean).at(-1))
      if (gitlab) {
        return {
          checkout,
          ciStatus: null,
          identityKey,
          isDraft: false,
          number,
          provider: "gitlab",
          state: null,
          url,
        }
      }
      const [owner, repository] = parsed.pathname.split("/").filter(Boolean)
      const summary = SummarySchema.safeParse(
        await callTool("pull_requests.summary", {
          pullRequest: { hostname: parsed.hostname, number, owner, repository },
        }).catch(() => null)
      )
      const value = summary.success && summary.data.status === "success" ? summary.data : null
      return {
        checkout,
        ciStatus: value?.ciStatus ?? null,
        identityKey,
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
      input.threadId,
      identityKey,
      url,
      root,
      headBranch,
    ],
    refetchInterval: 60_000,
    retry: false,
    staleTime: 30_000,
  })
}
