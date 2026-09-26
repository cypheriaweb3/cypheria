import { Trans } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { useEffect } from "react"

import { ensureCypheriaClient } from "../cypheria-client.js"
import { Route } from "../routes/index.js"
import { ConversationWorkspace } from "./conversation-workspace.js"

export default function ChatWorkspace() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  useEffect(() => {
    if (search.thread || search.draft) return
    void navigate({
      replace: true,
      search: (current) => ({ ...current, draft: crypto.randomUUID() }),
    })
  }, [navigate, search.draft, search.thread])
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

  if (!search.thread && !search.draft) return null

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
      initialDraftId={search.draft}
      initialPrompt={search.prompt}
      initialSectionId={search.section}
      initialThreadId={search.thread}
      key={`${search.thread ?? search.draft ?? "new"}:${agentId}:${search.project ?? ""}:${search.section ?? ""}`}
    />
  )
}
