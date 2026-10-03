import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useSetAtom } from "jotai"
import { useCallback, useEffect, useRef } from "react"
import { z } from "zod"

import {
  CODE_REVIEW_SERVER,
  codeReviewNotifierAtom,
  codeReviewSidebarAtom,
  codeReviewWorkspaceKey,
  parsePullRequestUrl,
  pullRequestIdentityKey,
  useCodeReviewExtensions,
} from "../components/code-review/host.js"
import { McpAppHost, type McpAppNotifier } from "../components/mcp-app-host.js"
import { WorkspaceChat } from "../components/workspace-chat.js"
import { ensureCypheriaClient } from "../cypheria-client.js"

export const Route = createFileRoute("/code-review")({
  component: CodeReviewRoute,
  validateSearch: z.object({ pr: z.string().url().optional().catch(undefined) }),
})

const TARGET = {
  arguments: { initialView: "inbox" },
  kind: "tool",
  server: CODE_REVIEW_SERVER,
  tool: "pull_requests.open",
} as const

/**
 * The latest chat the pull request is attached to, which the page shows until a chat is chosen
 * for it, as ChatGPT Desktop links a pull request's workspace to its most recent task.
 */
const useLinkedThread = (url: string | null) =>
  useQuery({
    enabled: Boolean(url && pullRequestIdentityKey(url)),
    queryFn: async () => {
      const client = await ensureCypheriaClient()
      const owners = await client.threads.attachments.listOwners(
        "pull_request",
        pullRequestIdentityKey(url as string) as string,
        { limit: 20 }
      )
      const threads = await Promise.all(
        owners.data.map((owner) => client.threads.get(owner.threadId).catch(() => null))
      )
      return (
        threads
          .filter((thread) => thread && thread.archivedAt === null)
          .sort(
            (left, right) =>
              (right?.recencyAt ?? right?.updatedAt ?? 0) -
              (left?.recencyAt ?? left?.updatedAt ?? 0)
          )[0]?.id ?? null
      )
    },
    queryKey: ["code-review", "linked-thread", url],
  })

/**
 * Code Review: the sidebar lists pull requests and the Code Review MCP App shows the chosen one,
 * with a chat beside it for that pull request. The App runs in a sandboxed frame and reads
 * through the `code-review` plugin's tools.
 */
function CodeReviewRoute() {
  const { pr } = Route.useSearch()
  const navigate = useNavigate()
  const setNotifier = useSetAtom(codeReviewNotifierAtom)
  const setSidebar = useSetAtom(codeReviewSidebarAtom)
  const notify = useRef<McpAppNotifier | null>(null)
  const select = useCallback(
    (url: string) => {
      if (!parsePullRequestUrl(url)) return false
      void navigate({ search: { pr: url }, to: "/code-review" })
      return true
    },
    [navigate]
  )
  const extensions = useCodeReviewExtensions({
    onSelect: select,
    selectedUrl: pr ?? null,
    surface: "global",
  })

  useEffect(() => {
    const parsed = pr ? parsePullRequestUrl(pr) : null
    notify.current?.("cypheria/codeReview/select", { pullRequest: parsed?.pullRequest ?? null })
  }, [pr])
  useEffect(() => () => setSidebar(null), [setSidebar])
  const { i18n } = useLingui()
  const workspaceKey = pr ? codeReviewWorkspaceKey(pr) : null
  const linked = useLinkedThread(pr ?? null)

  return (
    <main className="relative h-full min-h-0 bg-background">
      <McpAppHost
        extensions={extensions}
        target={TARGET}
        onNotifier={(notifier) => {
          notify.current = notifier
          setNotifier(notifier ? { notify: notifier } : null)
        }}
      />
      {workspaceKey && linked.isFetched ? (
        <WorkspaceChat
          key={workspaceKey}
          agentId="codex"
          fallbackThreadId={linked.data ?? null}
          placeholder={i18n._(
            msg({ id: "codeReview.chat.placeholder", message: "Ask about this pull request" })
          )}
          workspaceKey={workspaceKey}
        />
      ) : null}
    </main>
  )
}
