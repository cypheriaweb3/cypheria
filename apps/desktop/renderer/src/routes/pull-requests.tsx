import { Alert, AlertDescription } from "@cypheria/ui/components/alert"
import { Badge } from "@cypheria/ui/components/badge"
import { Button } from "@cypheria/ui/components/button"
import { Input } from "@cypheria/ui/components/input"
import { NativeSelect, NativeSelectOption } from "@cypheria/ui/components/native-select"
import { Skeleton } from "@cypheria/ui/components/skeleton"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { GitPullRequest } from "lucide-react"
import { useState } from "react"

import { WorkbenchFrame } from "../components/workbench-frame"
import { ensureCypheriaClient } from "../cypheria-client.js"

export const Route = createFileRoute("/pull-requests")({ component: PullRequestsRoute })

type Scope = "all" | "authored" | "reviewing" | "reviewed"
type State = "open" | "closed" | "merged" | "all"

const PAGE = 50
const MAX = 500

/**
 * Pull requests across the repositories the Server's GitHub CLI account can reach, with the
 * official desktop's filters. A pull request opens in the browser or in a new chat with the Agent.
 */
function PullRequestsRoute() {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const [scope, setScope] = useState<Scope>("reviewing")
  const [state, setState] = useState<State>("open")
  const [repository, setRepository] = useState("")
  const [searchText, setSearchText] = useState("")
  const [query, setQuery] = useState("")
  const [limit, setLimit] = useState(PAGE)
  const availability = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).git.githubAvailability(null),
    queryKey: ["github-pr", "board", "availability"],
    retry: false,
    staleTime: 30_000,
  })
  const repositoryFilter = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository.trim())
    ? repository.trim()
    : ""
  const board = useQuery({
    enabled: Boolean(availability.data?.authenticated),
    queryFn: async () =>
      (await ensureCypheriaClient()).git.githubPrBoard(null, {
        limit,
        query,
        scope,
        state,
        ...(repositoryFilter ? { repository: repositoryFilter } : {}),
      }),
    queryKey: ["github-pr", "board", scope, state, repositoryFilter, query, limit],
    refetchInterval: 60_000,
    retry: false,
  })
  const scopes: Array<[Scope, string]> = [
    ["reviewing", i18n._(msg({ id: "pullRequests.needsReview", message: "Needs my review" }))],
    ["authored", i18n._(msg({ id: "pullRequests.authored", message: "Authored" }))],
    ["reviewed", i18n._(msg({ id: "pullRequests.reviewed", message: "Previously reviewed" }))],
    ["all", i18n._(msg({ id: "pullRequests.all", message: "All" }))],
  ]

  return (
    <WorkbenchFrame>
      <header>
        <h1 className="flex items-center gap-2 font-semibold text-2xl">
          <GitPullRequest className="size-5" />
          <Trans id="pullRequests.title">Pull requests</Trans>
        </h1>
        <p className="mt-1 text-muted-foreground text-sm">
          {availability.data?.account ? (
            <Trans id="pullRequests.subtitleAccount">
              Review and track work across GitHub as {availability.data.account}.
            </Trans>
          ) : (
            <Trans id="pullRequests.subtitle">Review and track work across GitHub.</Trans>
          )}
        </p>
      </header>
      {availability.isPending ? (
        <p className="text-muted-foreground text-sm">
          <Trans id="pullRequests.checking">Checking GitHub access</Trans>
        </p>
      ) : availability.data && !availability.data.authenticated ? (
        <Alert>
          <AlertDescription className="space-y-2">
            <p className="font-medium">
              <Trans id="pullRequests.setupTitle">GitHub CLI setup required</Trans>
            </p>
            <p>
              <Trans id="pullRequests.setupBody">
                Install and sign in with the GitHub CLI on the computer that runs the Cypheria
                Server, then check again.
              </Trans>
            </p>
            <Button onClick={() => void availability.refetch()} size="sm" type="button">
              <Trans id="pullRequests.checkAgain">Check again</Trans>
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <section className="space-y-3">
          <div className="flex flex-wrap gap-1">
            {scopes.map(([value, label]) => (
              <Button
                aria-pressed={scope === value}
                key={value}
                onClick={() => {
                  setScope(value)
                  setLimit(PAGE)
                }}
                size="sm"
                type="button"
                variant={scope === value ? "secondary" : "ghost"}
              >
                {label}
              </Button>
            ))}
          </div>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              setQuery(searchText.trim())
              setLimit(PAGE)
            }}
          >
            <Input
              aria-label={i18n._(
                msg({ id: "pullRequests.search", message: "Search pull requests" })
              )}
              className="min-w-48 flex-1"
              maxLength={200}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder={i18n._(
                msg({ id: "pullRequests.search", message: "Search pull requests" })
              )}
              value={searchText}
            />
            <Input
              aria-label={i18n._(msg({ id: "pullRequests.repository", message: "Repository" }))}
              className="w-48"
              maxLength={200}
              onChange={(event) => setRepository(event.target.value)}
              placeholder="owner/repo"
              value={repository}
            />
            <NativeSelect
              aria-label={i18n._(msg({ id: "pullRequests.status", message: "Status" }))}
              onChange={(event) => {
                setState(event.target.value as State)
                setLimit(PAGE)
              }}
              size="sm"
              value={state}
            >
              <NativeSelectOption value="open">
                {i18n._(msg({ id: "pullRequests.open", message: "Open" }))}
              </NativeSelectOption>
              <NativeSelectOption value="merged">
                {i18n._(msg({ id: "pullRequests.merged", message: "Merged" }))}
              </NativeSelectOption>
              <NativeSelectOption value="closed">
                {i18n._(msg({ id: "pullRequests.closed", message: "Closed" }))}
              </NativeSelectOption>
              <NativeSelectOption value="all">
                {i18n._(msg({ id: "pullRequests.allStates", message: "All states" }))}
              </NativeSelectOption>
            </NativeSelect>
            <Button size="sm" type="submit" variant="outline">
              <Trans id="pullRequests.filter">Filter</Trans>
            </Button>
          </form>
          {board.isError ? (
            <Alert variant="destructive">
              <AlertDescription className="flex items-center gap-2">
                <span className="min-w-0 flex-1">{board.error.message}</span>
                <Button onClick={() => void board.refetch()} size="sm" type="button">
                  <Trans id="pullRequests.retry">Retry</Trans>
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {board.isPending && availability.data?.authenticated ? (
            <div className="space-y-2">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          ) : null}
          {board.data && board.data.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {query || repositoryFilter ? (
                <Trans id="pullRequests.noMatches">No pull requests match this search</Trans>
              ) : (
                <Trans id="pullRequests.caughtUp">You’re all caught up</Trans>
              )}
            </p>
          ) : null}
          <ul className="divide-y rounded-lg border">
            {board.data?.map((pr) => (
              <li className="flex items-center gap-3 p-3" key={pr.url}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sm">{pr.title}</p>
                  <p className="text-muted-foreground text-xs">
                    {pr.repository} #{pr.number} ·{" "}
                    {new Date(pr.updatedAt).toLocaleString(i18n.locale)}
                  </p>
                </div>
                <Badge variant="outline">{pr.state.toLowerCase()}</Badge>
                <Button
                  onClick={() =>
                    void navigate({
                      search: {
                        prompt: i18n._({
                          ...msg({
                            id: "pullRequests.askPrompt",
                            message: "Review this pull request: {url}",
                          }),
                          values: { url: pr.url },
                        }),
                      },
                      to: "/",
                    })
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Trans id="pullRequests.ask">Ask Agent</Trans>
                </Button>
                <Button
                  onClick={() => void window.cypheria?.app.openExternal(pr.url)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Trans id="pullRequests.openBrowser">Open in browser</Trans>
                </Button>
              </li>
            ))}
          </ul>
          {board.data && board.data.length === limit && limit < MAX ? (
            <Button
              onClick={() => setLimit((value) => Math.min(MAX, value + PAGE))}
              size="sm"
              type="button"
              variant="outline"
            >
              <Trans id="pullRequests.loadMore">Load more</Trans>
            </Button>
          ) : null}
        </section>
      )}
    </WorkbenchFrame>
  )
}
