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
  const [base, setBase] = useState("")
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [draft, setDraft] = useState(true)
  const [editTitle, setEditTitle] = useState("")
  const [editBody, setEditBody] = useState<string | null>(null)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
    enabled: cliAvailable,
    queryKey: ["github-pr", cwd, "list"],
    queryFn: async () => (await ensureCypheriaClient()).git.githubPrList(cwd),
    retry: false,
  })
  const selected = useQuery({
    enabled: selectedNumber !== null,
    queryKey: ["github-pr", cwd, "detail", selectedNumber],
    queryFn: async () => {
      if (selectedNumber === null) throw new Error("A pull request number is required")
      return (await ensureCypheriaClient()).git.githubPrRead(cwd, selectedNumber)
    },
    retry: false,
  })
  const checks = useQuery({
    enabled: selected.data?.state === "OPEN",
    queryKey: ["github-pr", cwd, "checks", selected.data?.number, selected.data?.headRefOid],
    queryFn: async () => {
      if (!selected.data) throw new Error("A pull request is required")
      return (await ensureCypheriaClient()).git.githubPrChecks(cwd, selected.data.number)
    },
    refetchInterval: 30_000,
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
      {list.data?.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          <Trans id="git.github.noPullRequests">No open pull requests</Trans>
        </p>
      ) : null}
      {list.data?.map((pr) => (
        <Button
          className="flex h-auto w-full justify-start whitespace-normal text-left"
          key={pr.number}
          onClick={() => setSelectedNumber(pr.number)}
          size="sm"
          type="button"
          variant={selectedNumber === pr.number ? "secondary" : "ghost"}
        >
          #{pr.number} {pr.title} · {pr.headRefName} → {pr.baseRefName}
        </Button>
      ))}
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
          {selected.data.state === "OPEN" ? (
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
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void mutate(async () => openExternal(selected.data.url))}
              size="sm"
              type="button"
              variant="outline"
            >
              <Trans id="git.github.browser">Browser</Trans>
            </Button>
            {selected.data.state === "OPEN" ? (
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
                        setMergeOpen(false)
                        void mutate(async () => {
                          await (await ensureCypheriaClient()).git.githubPrMerge(
                            cwd,
                            selected.data.number,
                            selected.data.headRefOid,
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
          </div>
          {selected.data.state === "OPEN" ? (
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
                    setSelectedNumber(created.number)
                  } else {
                    if (!threadId) throw new Error("A local Codex thread is required")
                    const created = await git.githubAppPrCreate(cwd, threadId, input)
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
