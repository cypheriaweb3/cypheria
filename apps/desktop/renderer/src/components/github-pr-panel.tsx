import { Alert, AlertDescription } from "@cypheria/ui/components/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@cypheria/ui/components/alert-dialog"
import { Button } from "@cypheria/ui/components/button"
import { Input } from "@cypheria/ui/components/input"
import { NativeSelect, NativeSelectOption } from "@cypheria/ui/components/native-select"
import { Textarea } from "@cypheria/ui/components/textarea"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { ensureCypheriaClient } from "../cypheria-client.js"

const openExternal = async (url: string): Promise<void> => {
  if (!window.cypheria) throw new Error("The system browser is unavailable")
  await window.cypheria.app.openExternal(url)
}

export function GitHubPrPanel({
  cwd,
  branch,
  threadId,
}: Readonly<{ cwd: string; branch: string | null; threadId: string | null }>) {
  const { i18n } = useLingui()
  const queryClient = useQueryClient()
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null)
  const [prSearchText, setPrSearchText] = useState("")
  const [prSearchQuery, setPrSearchQuery] = useState("")
  const [prListState, setPrListState] = useState<"open" | "closed" | "merged" | "all">("open")
  const [base, setBase] = useState("")
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [draft, setDraft] = useState(true)
  const [editTitle, setEditTitle] = useState("")
  const [editBody, setEditBody] = useState<string | null>(null)
  const [commentBody, setCommentBody] = useState("")
  const [reviewBody, setReviewBody] = useState("")
  const [mergeOpen, setMergeOpen] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectPullRequest = (number: number) => {
    setEditTitle("")
    setEditBody(null)
    setCommentBody("")
    setReviewBody("")
    setSelectedNumber(number)
  }
  const availability = useQuery({
    queryKey: ["github-pr", cwd, "availability"],
    queryFn: async () => (await ensureCypheriaClient()).git.githubAvailability(cwd),
    staleTime: 30_000,
    retry: false,
  })
  const cliAvailable = Boolean(availability.data?.authenticated && availability.data.repository)
  const appAvailability = useQuery({
    enabled: Boolean(threadId) && !cliAvailable,
    queryKey: ["github-pr", cwd, threadId, "app-availability"],
    queryFn: async () => {
      if (!threadId) throw new Error("A local Codex thread is required")
      return (await ensureCypheriaClient()).git.githubAppAvailability(cwd, threadId)
    },
    staleTime: 30_000,
    retry: false,
  })
  const list = useQuery({
    enabled: cliAvailable || Boolean(threadId && appAvailability.data?.canRead),
    queryKey: [
      "github-pr",
      cwd,
      "list",
      cliAvailable ? "cli" : "app",
      threadId,
      prListState,
      prSearchQuery,
    ],
    queryFn: async () => {
      const git = (await ensureCypheriaClient()).git
      if (cliAvailable) {
        const items = await git.githubPrList(cwd, {
          state: prListState,
          query: prSearchQuery,
          limit: 100,
        })
        return { items, truncated: items.length === 100 }
      }
      if (!threadId) throw new Error("A local Codex thread is required")
      return git.githubAppPrList(cwd, threadId)
    },
    retry: false,
  })
  const selected = useQuery({
    enabled:
      selectedNumber !== null &&
      (cliAvailable || Boolean(threadId && appAvailability.data?.canRead)),
    queryKey: ["github-pr", cwd, "detail", cliAvailable ? "cli" : "app", threadId, selectedNumber],
    queryFn: async () => {
      if (selectedNumber === null) throw new Error("A pull request number is required")
      const git = (await ensureCypheriaClient()).git
      if (cliAvailable) return git.githubPrRead(cwd, selectedNumber)
      if (!threadId) throw new Error("A local Codex thread is required")
      return git.githubAppPrRead(cwd, threadId, selectedNumber)
    },
    retry: false,
  })
  const checks = useQuery({
    enabled: cliAvailable && selected.data?.state === "OPEN",
    queryKey: ["github-pr", cwd, "checks", selected.data?.number, selected.data?.headRefOid],
    queryFn: async () => {
      if (!selected.data) throw new Error("A pull request is required")
      return (await ensureCypheriaClient()).git.githubPrChecks(cwd, selected.data.number)
    },
    refetchInterval: 30_000,
    retry: false,
  })
  const activity = useQuery({
    enabled: cliAvailable && Boolean(selected.data),
    queryKey: ["github-pr", cwd, "activity", selected.data?.number],
    queryFn: async () => {
      if (!selected.data) throw new Error("A pull request is required")
      return (await ensureCypheriaClient()).git.githubPrActivity(cwd, selected.data.number)
    },
    retry: false,
  })
  const mutate = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      await queryClient.invalidateQueries({ queryKey: ["github-pr", cwd] })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const setPrState = (action: "close" | "reopen" | "ready" | "draft") => {
    const pr = selected.data
    const head = pr?.headRefOid
    if (!pr || !head) return
    void mutate(async () => {
      await (await ensureCypheriaClient()).git.githubPrSetState(cwd, pr.number, head, action)
    })
  }

  return (
    <section
      aria-label={i18n._(msg({ id: "git.github.heading", message: "GitHub pull requests" }))}
      className="space-y-2 border-t p-2"
    >
      <p className="text-xs font-medium">
        <Trans id="git.github.heading">GitHub pull requests</Trans>
      </p>
      {availability.data?.error && !appAvailability.data?.available ? (
        <Alert>
          <AlertDescription>{availability.data.error}</AlertDescription>
        </Alert>
      ) : null}
      {availability.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{availability.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {availability.data?.repository ? (
        <p className="text-xs text-muted-foreground">
          {availability.data.account} · {availability.data.repository}
        </p>
      ) : null}
      {appAvailability.data?.available ? (
        <p className="text-xs text-muted-foreground">
          <Trans id="git.github.connectedApp">Connected GitHub App</Trans> ·{" "}
          {appAvailability.data.repository}
        </p>
      ) : null}
      {appAvailability.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{appAvailability.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {appAvailability.data?.error ? (
        <Alert>
          <AlertDescription>{appAvailability.data.error}</AlertDescription>
        </Alert>
      ) : null}
      {cliAvailable ? (
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label={i18n._(msg({ id: "git.github.search", message: "Search pull requests" }))}
            className="min-w-40 flex-1"
            maxLength={200}
            onChange={(event) => setPrSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") setPrSearchQuery(prSearchText.trim())
            }}
            placeholder={i18n._(msg({ id: "git.github.search", message: "Search pull requests" }))}
            value={prSearchText}
          />
          <NativeSelect
            aria-label={i18n._(msg({ id: "git.github.listState", message: "Pull request state" }))}
            onChange={(event) => setPrListState(event.target.value as typeof prListState)}
            size="sm"
            value={prListState}
          >
            <NativeSelectOption value="open">
              <Trans id="git.github.stateOpen">Open</Trans>
            </NativeSelectOption>
            <NativeSelectOption value="closed">
              <Trans id="git.github.stateClosed">Closed</Trans>
            </NativeSelectOption>
            <NativeSelectOption value="merged">
              <Trans id="git.github.stateMerged">Merged</Trans>
            </NativeSelectOption>
            <NativeSelectOption value="all">
              <Trans id="git.github.stateAll">All</Trans>
            </NativeSelectOption>
          </NativeSelect>
          <Button
            onClick={() => setPrSearchQuery(prSearchText.trim())}
            size="sm"
            type="button"
            variant="outline"
          >
            <Trans id="git.github.searchAction">Search</Trans>
          </Button>
        </div>
      ) : null}
      {list.data?.items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          <Trans id="git.github.noPullRequests">No pull requests found</Trans>
        </p>
      ) : null}
      {list.data?.items.map((pr) => (
        <Button
          className="flex h-auto w-full justify-start whitespace-normal text-left"
          key={pr.number}
          onClick={() => selectPullRequest(pr.number)}
          size="sm"
          type="button"
          variant={selectedNumber === pr.number ? "secondary" : "ghost"}
        >
          #{pr.number} {pr.title}
          {"headRefName" in pr && "baseRefName" in pr
            ? ` · ${pr.headRefName} → ${pr.baseRefName}`
            : null}
        </Button>
      ))}
      {list.data?.truncated ? (
        <p className="text-xs text-muted-foreground">
          <Trans id="git.github.listTruncated">Showing the most recent pull requests</Trans>
        </p>
      ) : null}
      {list.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{list.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {selected.data ? (
        <div className="space-y-2 rounded-md border p-2">
          <p className="text-sm font-medium">
            #{selected.data.number} {selected.data.title}
          </p>
          <p className="text-xs text-muted-foreground">
            {selected.data.headRefName} → {selected.data.baseRefName} · {selected.data.state}
          </p>
          <p className="text-xs whitespace-pre-wrap">{selected.data.body}</p>
          {cliAvailable && selected.data.state === "OPEN" ? (
            <div className="space-y-1 border-t pt-2">
              <p className="text-xs font-medium">
                <Trans id="git.github.checks">Checks</Trans>
              </p>
              {checks.data?.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  <Trans id="git.github.noChecks">No checks</Trans>
                </p>
              ) : null}
              {checks.data?.map((check) => (
                <div
                  className="flex items-center gap-2 text-xs"
                  key={`${check.name}:${check.link}`}
                >
                  <span className="min-w-0 flex-1 truncate">{check.name}</span>
                  <span className="shrink-0 text-muted-foreground">{check.bucket}</span>
                  {check.link ? (
                    <Button
                      onClick={() => {
                        const link = check.link
                        if (link) void mutate(async () => openExternal(link))
                      }}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <Trans id="git.github.browser">Browser</Trans>
                    </Button>
                  ) : null}
                </div>
              ))}
              {checks.isError ? (
                <Alert variant="destructive">
                  <AlertDescription>{checks.error.message}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}
          {cliAvailable ? (
            <div className="space-y-2 border-t pt-2">
              <p className="text-xs font-medium">
                <Trans id="git.github.activity">Discussion and reviews</Trans>
              </p>
              {activity.data?.comments.map((comment) => (
                <div className="rounded border p-2 text-xs" key={comment.id}>
                  <span className="font-medium">{comment.author ?? "GitHub"}</span>
                  <p className="whitespace-pre-wrap">{comment.body}</p>
                </div>
              ))}
              {activity.data?.reviews.map((review) => (
                <div className="rounded border p-2 text-xs" key={review.id}>
                  <span className="font-medium">{review.author ?? "GitHub"}</span> · {review.state}
                  {review.body ? <p className="whitespace-pre-wrap">{review.body}</p> : null}
                </div>
              ))}
              {activity.isError ? (
                <Alert variant="destructive">
                  <AlertDescription>{activity.error.message}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}
          {cliAvailable && selected.data.state === "OPEN" && selected.data.headRefOid ? (
            <div className="space-y-2 border-t pt-2">
              <Textarea
                aria-label={i18n._(
                  msg({ id: "git.github.commentBody", message: "Pull request comment" })
                )}
                onChange={(event) => setCommentBody(event.target.value)}
                rows={3}
                value={commentBody}
              />
              <Button
                disabled={busy || !commentBody.trim()}
                onClick={() => {
                  const head = selected.data.headRefOid
                  if (!head) return
                  void mutate(async () => {
                    await (await ensureCypheriaClient()).git.githubPrComment(
                      cwd,
                      selected.data.number,
                      head,
                      commentBody
                    )
                    setCommentBody("")
                  })
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                <Trans id="git.github.postComment">Post comment</Trans>
              </Button>
              <Textarea
                aria-label={i18n._(
                  msg({ id: "git.github.reviewBody", message: "Pull request review" })
                )}
                onChange={(event) => setReviewBody(event.target.value)}
                rows={3}
                value={reviewBody}
              />
              <div className="flex flex-wrap gap-2">
                {(["approve", "comment", "request_changes"] as const).map((decision) => (
                  <Button
                    disabled={busy || (decision !== "approve" && !reviewBody.trim())}
                    key={decision}
                    onClick={() => {
                      const head = selected.data.headRefOid
                      if (!head) return
                      void mutate(async () => {
                        await (await ensureCypheriaClient()).git.githubPrReview(
                          cwd,
                          selected.data.number,
                          head,
                          decision,
                          reviewBody
                        )
                        setReviewBody("")
                      })
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {decision === "approve" ? (
                      <Trans id="git.github.approve">Approve</Trans>
                    ) : decision === "comment" ? (
                      <Trans id="git.github.reviewComment">Review comment</Trans>
                    ) : (
                      <Trans id="git.github.requestChanges">Request changes</Trans>
                    )}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void mutate(async () => openExternal(selected.data.url))}
              size="sm"
              type="button"
              variant="outline"
            >
              <Trans id="git.github.browser">Browser</Trans>
            </Button>
            {cliAvailable && selected.data.state === "OPEN" && selected.data.headRefOid ? (
              <AlertDialog onOpenChange={setMergeOpen} open={mergeOpen}>
                <AlertDialogTrigger render={<Button disabled={busy} size="sm" variant="outline" />}>
                  <Trans id="git.github.merge">Merge</Trans>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      <Trans id="git.github.mergeTitle">Merge pull request?</Trans>
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      <Trans id="git.github.mergeDescription">
                        The displayed head commit must still match the pull request.
                      </Trans>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>
                      <Trans id="git.github.cancel">Cancel</Trans>
                    </AlertDialogCancel>
                    <AlertDialogAction
                      disabled={busy}
                      onClick={() => {
                        const head = selected.data.headRefOid
                        if (!head) return
                        setMergeOpen(false)
                        void mutate(async () => {
                          await (await ensureCypheriaClient()).git.githubPrMerge(
                            cwd,
                            selected.data.number,
                            head,
                            "merge"
                          )
                        })
                      }}
                    >
                      <Trans id="git.github.merge">Merge</Trans>
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
            {cliAvailable && selected.data.state === "OPEN" && selected.data.headRefOid ? (
              <>
                <Button
                  disabled={busy}
                  onClick={() => setPrState(selected.data.isDraft ? "ready" : "draft")}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {selected.data.isDraft ? (
                    <Trans id="git.github.markReady">Mark ready</Trans>
                  ) : (
                    <Trans id="git.github.markDraft">Convert to draft</Trans>
                  )}
                </Button>
                <AlertDialog onOpenChange={setCloseOpen} open={closeOpen}>
                  <AlertDialogTrigger
                    render={<Button disabled={busy} size="sm" variant="outline" />}
                  >
                    <Trans id="git.github.close">Close</Trans>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        <Trans id="git.github.closeTitle">Close pull request?</Trans>
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        <Trans id="git.github.closeDescription">
                          The pull request can be reopened later.
                        </Trans>
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>
                        <Trans id="git.github.cancel">Cancel</Trans>
                      </AlertDialogCancel>
                      <AlertDialogAction
                        disabled={busy}
                        onClick={() => {
                          setCloseOpen(false)
                          setPrState("close")
                        }}
                      >
                        <Trans id="git.github.close">Close</Trans>
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            ) : null}
            {cliAvailable && selected.data.state === "CLOSED" && selected.data.headRefOid ? (
              <Button
                disabled={busy}
                onClick={() => setPrState("reopen")}
                size="sm"
                type="button"
                variant="outline"
              >
                <Trans id="git.github.reopen">Reopen</Trans>
              </Button>
            ) : null}
          </div>
          {cliAvailable && selected.data.state === "OPEN" ? (
            <div className="space-y-2 border-t pt-2">
              <Input
                aria-label={i18n._(
                  msg({ id: "git.github.editTitle", message: "New pull request title" })
                )}
                onChange={(event) => setEditTitle(event.target.value)}
                placeholder={selected.data.title}
                value={editTitle}
              />
              <Textarea
                aria-label={i18n._(
                  msg({ id: "git.github.editBody", message: "New pull request body" })
                )}
                onChange={(event) => setEditBody(event.target.value)}
                placeholder={selected.data.body}
                rows={3}
                value={editBody ?? ""}
              />
              <Button
                disabled={busy || (!editTitle.trim() && editBody === null)}
                onClick={() =>
                  void mutate(async () => {
                    await (await ensureCypheriaClient()).git.githubPrUpdate(
                      cwd,
                      selected.data.number,
                      {
                        title: editTitle.trim() || undefined,
                        body: editBody ?? undefined,
                      }
                    )
                    setEditTitle("")
                    setEditBody(null)
                  })
                }
                size="sm"
                type="button"
                variant="outline"
              >
                <Trans id="git.github.save">Save changes</Trans>
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {selected.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{selected.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {cliAvailable || appAvailability.data?.available ? (
        <div className="space-y-2 border-t pt-2">
          <p className="text-xs text-muted-foreground">
            <Trans id="git.github.createHint">Create from the pushed current branch</Trans>
          </p>
          <Input
            aria-label={i18n._(msg({ id: "git.github.base", message: "Base branch" }))}
            onChange={(event) => setBase(event.target.value)}
            placeholder={i18n._(msg({ id: "git.github.base", message: "Base branch" }))}
            value={base}
          />
          <Input
            aria-label={i18n._(msg({ id: "git.github.title", message: "Pull request title" }))}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={i18n._(msg({ id: "git.github.title", message: "Pull request title" }))}
            value={title}
          />
          <Textarea
            aria-label={i18n._(msg({ id: "git.github.body", message: "Pull request body" }))}
            onChange={(event) => setBody(event.target.value)}
            placeholder={i18n._(msg({ id: "git.github.body", message: "Pull request body" }))}
            rows={3}
            value={body}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || !branch || !base.trim() || !title.trim()}
              onClick={() =>
                void mutate(async () => {
                  if (!branch) throw new Error("A local Git branch is required")
                  const git = (await ensureCypheriaClient()).git
                  const input = {
                    head: branch,
                    base: base.trim(),
                    title: title.trim(),
                    body,
                    draft,
                  }
                  if (cliAvailable) {
                    const created = await git.githubPrCreate(cwd, input)
                    selectPullRequest(created.number)
                  } else {
                    if (!threadId) throw new Error("A local Codex thread is required")
                    const created = await git.githubAppPrCreate(cwd, threadId, input)
                    selectPullRequest(created.number)
                    await openExternal(created.url)
                  }
                  setTitle("")
                  setBody("")
                })
              }
              size="sm"
              type="button"
            >
              <Trans id="git.github.create">Create PR</Trans>
            </Button>
            <Button
              aria-pressed={draft}
              onClick={() => setDraft((value) => !value)}
              size="sm"
              type="button"
              variant="outline"
            >
              {draft ? (
                <Trans id="git.github.draft">Draft</Trans>
              ) : (
                <Trans id="git.github.ready">Ready</Trans>
              )}
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  )
}
