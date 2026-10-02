import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useSetAtom } from "jotai"
import { useCallback, useEffect, useRef } from "react"
import { z } from "zod"

import {
  CODE_REVIEW_APP_URI,
  CODE_REVIEW_SERVER,
  codeReviewNotifierAtom,
  codeReviewSidebarAtom,
  parsePullRequestUrl,
  useCodeReviewExtensions,
} from "../components/code-review/host.js"
import { McpAppFrame, type McpAppNotifier } from "../components/mcp-app-frame.js"

export const Route = createFileRoute("/code-review")({
  component: CodeReviewRoute,
  validateSearch: z.object({ pr: z.string().url().optional().catch(undefined) }),
})

const TOOL_ARGUMENTS = { initialView: "inbox" }

/**
 * Code Review: the sidebar lists pull requests and the Code Review MCP App shows the chosen one.
 * The App runs in a sandboxed frame and reads through the `code-review` plugin's tools.
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

  return (
    <main className="h-full min-h-0 bg-background">
      <McpAppFrame
        extensions={extensions}
        resourceUri={CODE_REVIEW_APP_URI}
        server={CODE_REVIEW_SERVER}
        toolArguments={TOOL_ARGUMENTS}
        toolName="pull_requests.open"
        onNotifier={(notifier) => {
          notify.current = notifier
          setNotifier(notifier ? { notify: notifier } : null)
        }}
      />
    </main>
  )
}
