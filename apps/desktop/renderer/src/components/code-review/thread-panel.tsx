import { ChatPullRequestPanel } from "@cypheria/ui/components/chat"
import { Trans } from "@lingui/react/macro"
import { useMemo } from "react"

import { McpAppHost } from "../mcp-app-host.js"
import { CODE_REVIEW_SERVER, parsePullRequestUrl, useCodeReviewExtensions } from "./host.js"
import { useThreadPullRequest } from "./thread-pull-request.js"

/**
 * A Thread's pull request tab: the Code Review App's pull request view, the same one Code Review
 * shows, opened from its `thread` entry point for the Thread's pull request.
 */
export function ThreadPullRequestPanel({
  threadId,
  url,
}: Readonly<{ threadId: string | null; url: string | null }>) {
  const found = useThreadPullRequest({ threadId })
  const shown = url ?? found.data?.url ?? null
  const parsed = shown ? parsePullRequestUrl(shown) : null
  const extensions = useCodeReviewExtensions({
    surface: "thread",
    ...(threadId ? { threadId } : {}),
  })
  const pullRequestKey = parsed ? JSON.stringify(parsed.pullRequest) : null
  const target = useMemo(
    () =>
      pullRequestKey
        ? {
            arguments: {
              initialView: "pull_request",
              pullRequest: JSON.parse(pullRequestKey) as unknown,
            },
            kind: "tool" as const,
            server: CODE_REVIEW_SERVER,
            tool: "pull_requests.open",
            ...(threadId ? { threadId } : {}),
          }
        : null,
    [pullRequestKey, threadId]
  )

  if (!target) {
    return (
      <ChatPullRequestPanel>
        <div className="flex h-full items-center justify-center px-6 text-center text-muted-foreground text-sm">
          {found.isLoading ? (
            <Trans id="chat.panel.pullRequest.loading">Looking for this chat’s pull request…</Trans>
          ) : (
            <Trans id="chat.panel.pullRequest.empty">This chat has no pull request</Trans>
          )}
        </div>
      </ChatPullRequestPanel>
    )
  }
  return (
    <ChatPullRequestPanel>
      <McpAppHost extensions={extensions} target={target} />
    </ChatPullRequestPanel>
  )
}
