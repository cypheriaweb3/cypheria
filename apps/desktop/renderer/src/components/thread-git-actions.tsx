import { Button } from "@cypheria/ui/components/button"
import { Checkbox } from "@cypheria/ui/components/checkbox"
import { BranchIcon } from "@cypheria/ui/components/icons"
import { Input } from "@cypheria/ui/components/input"
import { Popover, PopoverContent, PopoverTrigger } from "@cypheria/ui/components/popover"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useId, useState } from "react"

import { ensureCypheriaClient } from "../cypheria-client.js"
import { commitChanges, hasCommittableChanges } from "./git-commit-actions.js"

/**
 * The Git controls of a Thread's header: the branch it works on, a commit and push popover, and a
 * way into its pull request. They act on the Thread's working directory through the same Server
 * Git API as the Review panel, so the two always agree. Nothing renders outside a repository.
 */
export function ThreadGitActions({
  cwd,
  onOpenPullRequest,
  onOpenReview,
}: Readonly<{
  cwd: string
  onOpenPullRequest: (url: string) => void
  onOpenReview: () => void
}>) {
  const { i18n } = useLingui()
  const queryClient = useQueryClient()
  const includeUnstagedId = useId()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState("")
  const [includeUnstaged, setIncludeUnstaged] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const status = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).git.status(cwd),
    queryKey: ["git", cwd, "status"],
    refetchInterval: 3_000,
    retry: false,
  })
  const availability = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).git.githubAvailability(cwd),
    queryKey: ["github-pr", cwd, "availability"],
    retry: false,
    staleTime: 30_000,
  })
  const cliAvailable = Boolean(availability.data?.authenticated && availability.data.repository)
  const branch = status.data?.branch ?? null
  const pullRequest = useQuery({
    enabled: cliAvailable && Boolean(branch),
    queryFn: async () => {
      if (!branch) throw new Error("A local Git branch is required")
      return (await ensureCypheriaClient()).git.githubPrForBranch(cwd, branch)
    },
    queryKey: ["github-pr", cwd, "for-branch", branch],
    refetchInterval: 30_000,
    retry: false,
  })
  if (!status.data) return null

  const entries = status.data.entries
  const canCommit = hasCommittableChanges(entries, includeUnstaged)
  const act = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      await queryClient.invalidateQueries({ queryKey: ["git", cwd] })
      setBusy(false)
    }
  }
  const commit = (push: boolean) =>
    act(async () => {
      await commitChanges((await ensureCypheriaClient()).git, cwd, {
        includeUnstaged,
        message,
        push,
      })
      setMessage("")
    })
  const pr = pullRequest.data

  return (
    <div className="flex shrink-0 items-center gap-1" data-slot="thread-git-actions">
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger
          render={
            <Button
              aria-label={i18n._(msg({ id: "thread.git.commitOrPush", message: "Commit or push" }))}
              size="sm"
              type="button"
              variant="ghost"
            />
          }
        >
          <BranchIcon aria-hidden="true" />
          <span className="max-w-40 truncate">
            {branch ?? i18n._(msg({ id: "thread.git.detached", message: "Detached HEAD" }))}
          </span>
          {entries.length > 0 ? (
            <span className="rounded-full bg-muted px-1.5 text-muted-foreground text-xs">
              {entries.length}
            </span>
          ) : null}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80">
          <p className="text-muted-foreground text-xs">
            <Trans id="thread.git.commitTo">Commit to</Trans>{" "}
            <span className="font-mono">{branch ?? "HEAD"}</span>
          </p>
          <Input
            aria-label={i18n._(msg({ id: "git.review.commitMessage", message: "Commit message" }))}
            disabled={busy}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={i18n._(
              msg({
                id: "thread.git.messagePlaceholder",
                message: "Commit message (leave blank to generate)…",
              })
            )}
            value={message}
          />
          <label
            className="flex items-center gap-2 text-muted-foreground text-xs"
            htmlFor={includeUnstagedId}
          >
            <Checkbox
              checked={includeUnstaged}
              id={includeUnstagedId}
              onCheckedChange={(checked) => setIncludeUnstaged(checked === true)}
            />
            <Trans id="git.review.includeUnstaged">Include unstaged changes</Trans>
          </label>
          {entries.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              <Trans id="thread.git.noChanges">No changes</Trans>
            </p>
          ) : null}
          {error ? <p className="text-destructive text-xs">{error}</p> : null}
          <div className="flex gap-2">
            <Button
              disabled={busy || !canCommit}
              onClick={() => void commit(false)}
              size="sm"
              type="button"
            >
              <Trans id="git.review.commit">Commit</Trans>
            </Button>
            <Button
              disabled={busy || !canCommit}
              onClick={() => void commit(true)}
              size="sm"
              type="button"
              variant="outline"
            >
              <Trans id="git.review.commitAndPush">Commit and push</Trans>
            </Button>
            <Button
              disabled={busy || !status.data.head}
              onClick={() =>
                void act(async () => {
                  await (await ensureCypheriaClient()).git.push(cwd)
                })
              }
              size="sm"
              type="button"
              variant="outline"
            >
              <Trans id="git.review.push">Push</Trans>
            </Button>
          </div>
          <Button onClick={onOpenReview} size="sm" type="button" variant="ghost">
            <Trans id="thread.git.openReview">Open Review</Trans>
          </Button>
        </PopoverContent>
      </Popover>
      {pr ? (
        <Button onClick={() => onOpenPullRequest(pr.url)} size="sm" type="button" variant="outline">
          <Trans id="thread.git.viewPr">View PR</Trans>
        </Button>
      ) : cliAvailable && branch && pullRequest.isSuccess ? (
        <Button onClick={onOpenReview} size="sm" type="button" variant="outline">
          <Trans id="thread.git.createPr">Create PR</Trans>
        </Button>
      ) : null}
    </div>
  )
}
