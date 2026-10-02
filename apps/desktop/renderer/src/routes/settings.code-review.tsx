import { createFileRoute } from "@tanstack/react-router"

import {
  CODE_REVIEW_APP_URI,
  CODE_REVIEW_SERVER,
  useCodeReviewExtensions,
} from "../components/code-review/host.js"
import { McpAppFrame } from "../components/mcp-app-frame.js"

export const Route = createFileRoute("/settings/code-review")({
  component: CodeReviewSettingsRoute,
})

const TOOL_ARGUMENTS = {}

/** Code Review settings: the Code Review MCP App opened from its `settings` entry point. */
function CodeReviewSettingsRoute() {
  const extensions = useCodeReviewExtensions({ surface: "settings" })
  return (
    <main className="h-screen min-h-0 bg-background max-[860px]:h-[calc(100vh-48px)]">
      <McpAppFrame
        extensions={extensions}
        resourceUri={CODE_REVIEW_APP_URI}
        server={CODE_REVIEW_SERVER}
        toolArguments={TOOL_ARGUMENTS}
        toolName="pull_requests.settings"
      />
    </main>
  )
}
