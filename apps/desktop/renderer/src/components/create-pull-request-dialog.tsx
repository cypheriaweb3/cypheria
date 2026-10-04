import type { GitPullRequestSource } from "@cypheria/protocol"
import { Button } from "@cypheria/ui/components/button"
import { Checkbox } from "@cypheria/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cypheria/ui/components/dialog"
import { Input } from "@cypheria/ui/components/input"
import { Label } from "@cypheria/ui/components/label"
import { Spinner } from "@cypheria/ui/components/spinner"
import { Textarea } from "@cypheria/ui/components/textarea"
import { toast } from "@cypheria/ui/components/toast"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useId, useState } from "react"

import { ensureCypheriaClient } from "../cypheria-client.js"
import { threadAttachmentQueryKey } from "../thread-attachments.js"
import { useGitSettings } from "./git-settings.js"

/**
 * Creates the pull request of a Thread's checkout, as ChatGPT Desktop's Create PR dialog does:
 * on a new branch when the checkout is on its base, after committing local changes when asked,
 * pushing, and attaching the pull request to the Thread. A blank title or description is written
 * from the branch's changes.
 */
export function CreatePullRequestDialog({
  cwd,
  open,
  onOpenChange,
  threadId,
}: Readonly<{
  cwd: string
  open: boolean
  onOpenChange: (open: boolean) => void
  threadId: string | null
}>) {
  const { i18n } = useLingui()
  const queryClient = useQueryClient()
  const ids = { branch: useId(), changes: useId(), draft: useId(), title: useId(), body: useId() }
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [newBranch, setNewBranch] = useState("")
  const [includeLocalChanges, setIncludeLocalChanges] = useState(true)
  // Starts from Settings → Git → Create draft pull requests each time the dialog opens.
  const { settings: gitSettings } = useGitSettings()
  const [draftChoice, setDraft] = useState<boolean | null>(null)
  const draft = draftChoice ?? gitSettings?.createPullRequestAsDraft ?? false
  useEffect(() => {
    if (open) setDraft(null)
  }, [open])
  const target = useQuery({
    enabled: open,
    queryFn: async () => (await ensureCypheriaClient()).git.pullRequestTarget(cwd),
    queryKey: ["git", cwd, "pull-request-target"],
    retry: false,
  })
  const value = target.data
  const gitlab = value?.provider === "gitlab"
  const needsBranch = Boolean(value && (!value.branch || value.branch === value.defaultBranch))
  const create = useMutation({
    mutationFn: async (openInBrowser: boolean) =>
      (await ensureCypheriaClient()).git.createPullRequest({
        cwd,
        draft,
        includeLocalChanges: Boolean(value?.hasChanges) && includeLocalChanges,
        openInBrowser,
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(body.trim() ? { body: body.trim() } : {}),
        ...(newBranch.trim() ? { newBranch: newBranch.trim() } : {}),
        ...(value?.defaultBranch ? { base: value.defaultBranch } : {}),
        ...(threadId ? { threadId } : {}),
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["git", cwd] })
      void queryClient.invalidateQueries({ queryKey: threadAttachmentQueryKey })
      void queryClient.invalidateQueries({ queryKey: ["code-review", "thread-pull-request"] })
    },
    onSuccess: (result) => {
      onOpenChange(false)
      setTitle("")
      setBody("")
      setNewBranch("")
      if (result.openedInBrowser) {
        void window.cypheria?.app.openExternal(result.url).catch(() => undefined)
        return
      }
      toast.add({
        actionProps: {
          children: i18n._(msg({ id: "createPr.view", message: "View" })),
          onClick: () => void window.cypheria?.app.openExternal(result.url).catch(() => undefined),
        },
        title: gitlab
          ? i18n._({
              ...msg({
                id: "createPr.createdMergeRequest",
                message: "Created merge request for {branch}",
              }),
              values: { branch: result.branch },
            })
          : i18n._({
              ...msg({ id: "createPr.created", message: "Created PR for {branch}" }),
              values: { branch: result.branch },
            }),
        type: "success",
      })
    },
  })
  const sourceLabel = (source: GitPullRequestSource | undefined) =>
    source === "github-cli"
      ? i18n._(msg({ id: "createPr.source.cli", message: "Creates it with the GitHub CLI." }))
      : source === "connector"
        ? gitlab
          ? i18n._(
              msg({
                id: "createPr.source.gitlabAccount",
                message: "Creates it with the GitLab account linked in ChatGPT.",
              })
            )
          : i18n._(
              msg({
                id: "createPr.source.githubAccount",
                message: "Creates it with the GitHub account linked in ChatGPT.",
              })
            )
        : gitlab
          ? i18n._(
              msg({
                id: "createPr.source.gitlabBrowser",
                message: "Finishes in GitLab in your browser.",
              })
            )
          : i18n._(
              msg({
                id: "createPr.source.githubBrowser",
                message: "Finishes in GitHub in your browser.",
              })
            )
  const preferred = value?.sources[0]
  const blocked = !value || (needsBranch && !newBranch.trim()) || create.isPending

  return (
    <Dialog open={open} onOpenChange={(next) => !create.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {gitlab ? (
              <Trans id="createPr.gitlabTitle">Create merge request</Trans>
            ) : (
              <Trans id="createPr.title">Create PR</Trans>
            )}
          </DialogTitle>
          {value ? (
            <DialogDescription className="flex min-w-0 items-center gap-1 font-mono text-xs">
              <span className="truncate">
                {value.owner}/{value.repository}
              </span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{newBranch.trim() || value.branch || "HEAD"}</span>
              <span aria-hidden="true">→</span>
              <span className="truncate">{value.defaultBranch ?? "?"}</span>
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {target.isPending ? (
          <div className="grid place-items-center py-6 text-muted-foreground">
            <Spinner />
          </div>
        ) : !value ? (
          <p className="text-muted-foreground text-sm">
            {target.error?.message ?? (
              <Trans id="createPr.unsupported">
                Pull requests need an origin remote on github.com or gitlab.com.
              </Trans>
            )}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {needsBranch ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={ids.branch}>
                  <Trans id="createPr.newBranch">New branch</Trans>
                </Label>
                <Input
                  autoFocus
                  disabled={create.isPending}
                  id={ids.branch}
                  placeholder="feature/my-change"
                  value={newBranch}
                  onChange={(event) => setNewBranch(event.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  <Trans id="createPr.newBranchHint">
                    The checkout is on its base branch, so the pull request needs its own branch.
                  </Trans>
                </p>
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.title}>
                <Trans id="createPr.titleField">Title</Trans>
              </Label>
              <Input
                disabled={create.isPending}
                id={ids.title}
                placeholder={i18n._(
                  msg({ id: "createPr.titlePlaceholder", message: "Leave empty to generate" })
                )}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.body}>
                <Trans id="createPr.bodyField">Description</Trans>
              </Label>
              <Textarea
                className="max-h-60 min-h-24"
                disabled={create.isPending}
                id={ids.body}
                placeholder={i18n._(
                  msg({ id: "createPr.bodyPlaceholder", message: "Leave empty to generate" })
                )}
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
            </div>
            {value.hasChanges ? (
              <label className="flex items-center gap-2 text-sm" htmlFor={ids.changes}>
                <Checkbox
                  checked={includeLocalChanges}
                  disabled={create.isPending}
                  id={ids.changes}
                  onCheckedChange={(checked) => setIncludeLocalChanges(checked === true)}
                />
                <Trans id="createPr.includeLocalChanges">Commit and include local changes</Trans>
              </label>
            ) : null}
            {preferred !== "browser" ? (
              <label className="flex items-center gap-2 text-sm" htmlFor={ids.draft}>
                <Checkbox
                  checked={draft}
                  disabled={create.isPending}
                  id={ids.draft}
                  onCheckedChange={(checked) => setDraft(checked === true)}
                />
                <Trans id="createPr.draft">Create as draft</Trans>
              </label>
            ) : null}
            <p className="text-muted-foreground text-xs">{sourceLabel(preferred)}</p>
            {create.error ? (
              <p className="text-destructive text-sm" role="alert">
                {create.error.message}
              </p>
            ) : null}
          </div>
        )}
        <DialogFooter>
          <Button
            disabled={create.isPending}
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            <Trans id="common.cancel">Cancel</Trans>
          </Button>
          {value && preferred !== "browser" ? (
            <Button
              disabled={blocked}
              type="button"
              variant="outline"
              onClick={() => create.mutate(true)}
            >
              {gitlab ? (
                <Trans id="createPr.openGitLab">Open in GitLab</Trans>
              ) : (
                <Trans id="createPr.openGitHub">Open in GitHub</Trans>
              )}
            </Button>
          ) : null}
          <Button
            disabled={blocked}
            type="button"
            onClick={() => create.mutate(preferred === "browser")}
          >
            {create.isPending ? <Spinner /> : null}
            {preferred === "browser" ? (
              gitlab ? (
                <Trans id="createPr.continueGitLab">Continue in GitLab</Trans>
              ) : (
                <Trans id="createPr.continueGitHub">Continue in GitHub</Trans>
              )
            ) : gitlab ? (
              <Trans id="createPr.createMergeRequest">Create merge request</Trans>
            ) : draft ? (
              <Trans id="createPr.createDraft">Create draft PR</Trans>
            ) : (
              <Trans id="createPr.create">Create PR</Trans>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
