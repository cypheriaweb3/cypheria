import { Alert, AlertDescription } from "@cypheria/ui/components/alert"
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

export function GitLabMrPanel({
  cwd,
  branch,
  threadId,
}: Readonly<{ cwd: string; branch: string | null; threadId: string | null }>) {
  const { i18n } = useLingui()
  const queryClient = useQueryClient()
  const [iidInput, setIidInput] = useState("")
  const [iid, setIid] = useState<number | null>(null)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [newTitle, setNewTitle] = useState("")
  const [comment, setComment] = useState("")
  const [reviewerQuery, setReviewerQuery] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const branchMr = useQuery({
    enabled: Boolean(threadId && branch),
    queryKey: ["gitlab-mr", cwd, threadId, "branch", branch],
    queryFn: async () => {
      if (!threadId || !branch) throw new Error("A local Codex thread and branch are required")
      return (await ensureCypheriaClient()).git.gitlabMrForBranch(cwd, threadId, branch)
    },
    retry: false,
  })
  const activeIid = iid ?? branchMr.data?.iid ?? null
  const mr = useQuery({
    enabled: Boolean(threadId && activeIid),
    queryKey: ["gitlab-mr", cwd, threadId, activeIid],
    queryFn: async () => {
      if (!threadId || !activeIid)
        throw new Error("A local Codex thread and MR number are required")
      return (await ensureCypheriaClient()).git.gitlabMrRead(cwd, threadId, activeIid)
    },
    retry: false,
  })
  const checks = useQuery({
    enabled: Boolean(threadId && mr.data),
    queryKey: ["gitlab-mr-checks", cwd, threadId, mr.data?.iid],
    queryFn: async () => {
      if (!threadId || !mr.data) throw new Error("A local Codex thread and MR are required")
      return (await ensureCypheriaClient()).git.gitlabMrChecks(cwd, threadId, mr.data.iid)
    },
    retry: false,
  })
  const discussions = useQuery({
    enabled: Boolean(threadId && mr.data),
    queryKey: ["gitlab-mr", cwd, threadId, "discussions", mr.data?.iid],
    queryFn: async () => {
      if (!threadId || !mr.data) throw new Error("A local Codex thread and MR are required")
      return (await ensureCypheriaClient()).git.gitlabMrDiscussions(cwd, threadId, mr.data.iid)
    },
    retry: false,
  })
  const reviewers = useQuery({
    enabled: Boolean(threadId && mr.data),
    queryKey: ["gitlab-mr", cwd, threadId, "reviewers", mr.data?.iid],
    queryFn: async () => {
      if (!threadId || !mr.data) throw new Error("A local Codex thread and MR are required")
      return (await ensureCypheriaClient()).git.gitlabMrReviewers(cwd, threadId, mr.data.iid)
    },
    retry: false,
  })
  const reviewerCandidates = useQuery({
    enabled: Boolean(threadId && mr.data && reviewerQuery.trim()),
    queryKey: ["gitlab-mr", cwd, threadId, "reviewer-search", reviewerQuery.trim()],
    queryFn: async () => {
      if (!threadId) throw new Error("A local Codex thread is required")
      return (await ensureCypheriaClient()).git.gitlabMrReviewerSearch(
        cwd,
        threadId,
        reviewerQuery.trim()
      )
    },
    retry: false,
  })
  const mutate = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      await queryClient.invalidateQueries({ queryKey: ["gitlab-mr", cwd] })
      await queryClient.invalidateQueries({ queryKey: ["gitlab-mr-checks", cwd] })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const selectedIid = Number(iidInput)

  return (
    <section
      aria-label={i18n._(msg({ id: "git.gitlab.heading", message: "GitLab merge requests" }))}
      className="space-y-2 border-t p-2"
    >
      <p className="text-xs font-medium">
        <Trans id="git.gitlab.heading">GitLab merge requests</Trans>
      </p>
      <div className="flex gap-2">
        <Input
          aria-label={i18n._(msg({ id: "git.gitlab.number", message: "Merge request number" }))}
          min={1}
          onChange={(event) => setIidInput(event.target.value)}
          placeholder={i18n._(msg({ id: "git.gitlab.number", message: "Merge request number" }))}
          type="number"
          value={iidInput}
        />
        <Button
          disabled={!threadId || !Number.isSafeInteger(selectedIid) || selectedIid < 1}
          onClick={() => setIid(selectedIid)}
          size="sm"
          type="button"
          variant="outline"
        >
          <Trans id="git.gitlab.open">View</Trans>
        </Button>
      </div>
      {branchMr.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{branchMr.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {mr.isPending && activeIid ? (
        <p className="text-xs text-muted-foreground">
          <Trans id="git.gitlab.loading">Loading merge request…</Trans>
        </p>
      ) : null}
      {mr.data ? (
        <div className="space-y-2 rounded-md border p-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                !{mr.data.iid} {mr.data.title}
              </p>
              <p className="text-xs text-muted-foreground">
                {mr.data.sourceBranch} → {mr.data.targetBranch} · {mr.data.state}
              </p>
            </div>
            <Button
              onClick={() => void mutate(async () => openExternal(mr.data.webUrl))}
              size="sm"
              type="button"
              variant="outline"
            >
              <Trans id="git.gitlab.browser">Browser</Trans>
            </Button>
          </div>
          <div className="flex gap-2">
            <Input
              aria-label={i18n._(
                msg({ id: "git.gitlab.newTitle", message: "New merge request title" })
              )}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder={mr.data.title}
              value={newTitle}
            />
            <Button
              disabled={busy || !newTitle.trim() || newTitle === mr.data.title || !threadId}
              onClick={() =>
                void mutate(async () => {
                  if (!threadId) throw new Error("A local Codex thread is required")
                  await (await ensureCypheriaClient()).git.gitlabMrUpdateTitle(
                    cwd,
                    threadId,
                    mr.data.iid,
                    newTitle
                  )
                  setNewTitle("")
                })
              }
              size="sm"
              type="button"
              variant="outline"
            >
              <Trans id="git.gitlab.saveTitle">Save title</Trans>
            </Button>
          </div>
          <Textarea
            aria-label={i18n._(msg({ id: "git.gitlab.comment", message: "Merge request comment" }))}
            onChange={(event) => setComment(event.target.value)}
            placeholder={i18n._(
              msg({ id: "git.gitlab.comment", message: "Merge request comment" })
            )}
            rows={3}
            value={comment}
          />
          <Button
            disabled={busy || !comment.trim() || !threadId}
            onClick={() =>
              void mutate(async () => {
                if (!threadId) throw new Error("A local Codex thread is required")
                await (await ensureCypheriaClient()).git.gitlabMrPostComment(
                  cwd,
                  threadId,
                  mr.data.iid,
                  comment
                )
                setComment("")
              })
            }
            size="sm"
            type="button"
            variant="outline"
          >
            <Trans id="git.gitlab.postComment">Post comment</Trans>
          </Button>
          <div className="space-y-1 border-t pt-2">
            <p className="text-xs font-medium">
              <Trans id="git.gitlab.discussions">Discussions</Trans>
            </p>
            {discussions.data?.map((discussion) => (
              <div className="space-y-1 rounded border p-2 text-xs" key={discussion.id}>
                {discussion.notes.map((note) => (
                  <div className="border-l pl-2" key={note.id}>
                    <span className="font-medium">{note.author}</span>
                    {note.path ? (
                      <span className="ml-2 font-mono text-muted-foreground">
                        {note.path}
                        {note.line ? `:${note.line}` : ""}
                      </span>
                    ) : null}
                    {note.resolved ? (
                      <span className="ml-2 text-muted-foreground">
                        <Trans id="git.gitlab.resolved">Resolved</Trans>
                      </span>
                    ) : null}
                    <p className="whitespace-pre-wrap">{note.body}</p>
                  </div>
                ))}
              </div>
            ))}
            {discussions.isError ? (
              <Alert variant="destructive">
                <AlertDescription>{discussions.error.message}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <div className="space-y-2 border-t pt-2">
            <p className="text-xs font-medium">
              <Trans id="git.gitlab.reviewers">Reviewers</Trans>
            </p>
            {reviewers.data?.map((reviewer) => (
              <div className="flex items-center gap-2 text-xs" key={reviewer.userId}>
                <span className="min-w-0 flex-1 truncate">{reviewer.login}</span>
                <span className="text-muted-foreground">{reviewer.status}</span>
                {reviewer.isReviewRequested ? (
                  <Button
                    disabled={busy || !threadId}
                    onClick={() =>
                      void mutate(async () => {
                        if (!threadId) throw new Error("A local Codex thread is required")
                        await (await ensureCypheriaClient()).git.gitlabMrReviewerAction(
                          cwd,
                          threadId,
                          mr.data.iid,
                          reviewer.userId,
                          "remove"
                        )
                      })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Trans id="git.gitlab.removeReviewer">Remove</Trans>
                  </Button>
                ) : null}
              </div>
            ))}
            {reviewers.isError ? (
              <Alert variant="destructive">
                <AlertDescription>{reviewers.error.message}</AlertDescription>
              </Alert>
            ) : null}
            <Input
              aria-label={i18n._(
                msg({ id: "git.gitlab.searchReviewers", message: "Search project members" })
              )}
              maxLength={100}
              onChange={(event) => setReviewerQuery(event.target.value)}
              placeholder={i18n._(
                msg({ id: "git.gitlab.searchReviewers", message: "Search project members" })
              )}
              value={reviewerQuery}
            />
            {reviewerCandidates.data
              ?.filter(
                (candidate) =>
                  !reviewers.data?.some((reviewer) => reviewer.userId === candidate.userId)
              )
              .map((candidate) => (
                <div className="flex items-center gap-2 text-xs" key={candidate.userId}>
                  <span className="min-w-0 flex-1 truncate">{candidate.login}</span>
                  <Button
                    disabled={busy || !threadId}
                    onClick={() =>
                      void mutate(async () => {
                        if (!threadId) throw new Error("A local Codex thread is required")
                        await (await ensureCypheriaClient()).git.gitlabMrReviewerAction(
                          cwd,
                          threadId,
                          mr.data.iid,
                          candidate.userId,
                          "add"
                        )
                        setReviewerQuery("")
                      })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Trans id="git.gitlab.addReviewer">Request review</Trans>
                  </Button>
                </div>
              ))}
            {reviewerCandidates.isError ? (
              <Alert variant="destructive">
                <AlertDescription>{reviewerCandidates.error.message}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <div className="space-y-1 border-t pt-2">
            <p className="text-xs font-medium">
              <Trans id="git.gitlab.checks">Pipeline checks</Trans>
            </p>
            {checks.data && !checks.data.checksComplete ? (
              <p className="text-xs text-muted-foreground">
                <Trans id="git.gitlab.checksPartial">
                  Some pipeline checks could not be loaded.
                </Trans>
              </p>
            ) : null}
            {checks.data?.checks.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                <Trans id="git.gitlab.noChecks">No pipeline checks</Trans>
              </p>
            ) : null}
            {checks.data?.checks.map((check) => (
              <div className="flex items-center justify-between gap-2 text-xs" key={check.link}>
                <span className="truncate">
                  {check.stage} · {check.name}
                </span>
                <span className="shrink-0 text-muted-foreground">{check.state}</span>
                <Button
                  onClick={() => void mutate(async () => openExternal(check.link))}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Trans id="git.gitlab.browser">Browser</Trans>
                </Button>
              </div>
            ))}
            {checks.isError ? (
              <Alert variant="destructive">
                <AlertDescription>{checks.error.message}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="space-y-2 border-t pt-2">
        <p className="text-xs text-muted-foreground">
          <Trans id="git.gitlab.createHint">Create from the pushed current branch</Trans>
        </p>
        <Input
          aria-label={i18n._(msg({ id: "git.gitlab.title", message: "Merge request title" }))}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={i18n._(msg({ id: "git.gitlab.title", message: "Merge request title" }))}
          value={title}
        />
        <Textarea
          aria-label={i18n._(
            msg({ id: "git.gitlab.description", message: "Merge request description" })
          )}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={i18n._(
            msg({ id: "git.gitlab.description", message: "Merge request description" })
          )}
          rows={3}
          value={description}
        />
        <div className="flex flex-wrap gap-2">
          {([false, true] as const).map((draft) => (
            <Button
              disabled={busy || !branch || !threadId || !title.trim()}
              key={String(draft)}
              onClick={() =>
                void mutate(async () => {
                  if (!threadId || !branch) throw new Error("A local Codex branch is required")
                  const created = await (await ensureCypheriaClient()).git.gitlabMrCreate(
                    cwd,
                    threadId,
                    {
                      sourceBranch: branch,
                      title,
                      description,
                      draft,
                    }
                  )
                  setIid(created.iid)
                  setIidInput(String(created.iid))
                })
              }
              size="sm"
              type="button"
              variant={draft ? "outline" : "default"}
            >
              {draft ? (
                <Trans id="git.gitlab.createDraft">Create draft</Trans>
              ) : (
                <Trans id="git.gitlab.create">Create MR</Trans>
              )}
            </Button>
          ))}
          <Button
            disabled={busy || !branch || !title.trim()}
            onClick={() =>
              void mutate(async () => {
                if (!branch) throw new Error("A local Git branch is required")
                const url = await (await ensureCypheriaClient()).git.gitlabMrBrowserForm(cwd, {
                  sourceBranch: branch,
                  title,
                  description,
                })
                await openExternal(url)
              })
            }
            size="sm"
            type="button"
            variant="outline"
          >
            <Trans id="git.gitlab.openForm">Open form in browser</Trans>
          </Button>
        </div>
      </div>
      {mr.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{mr.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  )
}
