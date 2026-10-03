import { createFileRoute } from "@tanstack/react-router"

import { CODE_REVIEW_SERVER, useCodeReviewExtensions } from "../components/code-review/host.js"
import { McpAppHost } from "../components/mcp-app-host.js"

export const Route = createFileRoute("/settings/code-review")({
  component: CodeReviewSettingsRoute,
})

const TARGET = { kind: "tool", server: CODE_REVIEW_SERVER, tool: "pull_requests.settings" } as const

/** Code Review settings: the Code Review MCP App opened from its `settings` entry point. */
function CodeReviewSettingsRoute() {
  const extensions = useCodeReviewExtensions({ surface: "settings" })
  return (
    <main className="h-screen min-h-0 bg-background max-[860px]:h-[calc(100vh-48px)]">
      <McpAppHost extensions={extensions} target={TARGET} />
    </main>
  )
}
