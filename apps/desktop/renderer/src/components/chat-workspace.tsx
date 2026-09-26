import { Trans } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"

import { ensureCypheriaClient } from "../cypheria-client.js"
import { Route } from "../routes/index.js"
import { ConversationWorkspace } from "./conversation-workspace.js"

export default function ChatWorkspace() {
  const search = Route.useSearch()
  const threadQuery = useQuery({
    enabled: Boolean(search.thread),
    queryFn: () =>
      ensureCypheriaClient().then((client) => client.threads.get(search.thread as string)),
    queryKey: ["conversation-workspace", "thread", search.thread],
  })

  if (search.thread && threadQuery.isPending) {
    return (
      <div
        className="grid size-full place-items-center text-sm text-muted-foreground"
        role="status"
      >
        <Trans id="chat.loadingConversation">Loading conversation…</Trans>
      </div>
    )
  }

  if (threadQuery.error) {
    return (
      <div className="grid size-full place-items-center p-8 text-sm text-destructive" role="alert">
        {threadQuery.error.message}
      </div>
    )
  }

  const agentId = threadQuery.data?.agentId ?? search.agent ?? "codex"
  return (
    <ConversationWorkspace
      agentId={agentId}
      codex={agentId === "codex"}
      initialProjectId={search.project}
      initialPrompt={search.prompt}
      initialSectionId={search.section}
      initialThreadId={search.thread}
      key={`${search.thread ?? "new"}:${agentId}:${search.project ?? ""}:${search.section ?? ""}`}
    />
  )
}
