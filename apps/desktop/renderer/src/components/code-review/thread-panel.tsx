import { ChatPullRequestPanel } from "@cypheria/ui/components/chat"
import { Trans } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { ensureCypheriaClient } from "../../cypheria-client.js"
import { McpAppFrame } from "../mcp-app-frame.js"
import {
  CODE_REVIEW_APP_URI,
  CODE_REVIEW_SERVER,
  parsePullRequestUrl,
  useCodeReviewExtensions,
} from "./host.js"
import { useThreadPullRequest } from "./thread-pull-request.js"

/**
 * A Thread's pull request tab: the Code Review App's pull request view, the same one Code Review
 * shows, opened from its `thread` entry point for the Thread's pull request.
 */
export function ThreadPullRequestPanel({
  cwd,
  threadId,
  url,
}: Readonly<{ cwd: string | null; threadId: string | null; url: string | null }>) {
  const status = useQuery({
    enabled: Boolean(cwd),
    queryFn: async () => (await ensureCypheriaClient()).git.status(cwd as string),
    queryKey: ["git", cwd, "status"],
    retry: false,
  })
  const found = useThreadPullRequest({
    branch: status.data?.branch ?? null,
    cwd: cwd ?? "",
    threadId,
  })
  const shown = url ?? found.data?.url ?? null
  const parsed = shown ? parsePullRequestUrl(shown) : null
  const extensions = useCodeReviewExtensions({
    surface: "thread",
    ...(threadId ? { threadId } : {}),
  })
  const pullRequestKey = parsed ? JSON.stringify(parsed.pullRequest) : null
  const toolArguments = useMemo(
    () =>
      pullRequestKey
        ? { initialView: "pull_request", pullRequest: JSON.parse(pullRequestKey) as unknown }
        : null,
    [pullRequestKey]
  )

  if (!toolArguments) {
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
      <McpAppFrame
        extensions={extensions}
        resourceUri={CODE_REVIEW_APP_URI}
        server={CODE_REVIEW_SERVER}
        toolArguments={toolArguments}
        toolName="pull_requests.open"
        {...(threadId ? { threadId } : {})}
      />
    </ChatPullRequestPanel>
  )
}
