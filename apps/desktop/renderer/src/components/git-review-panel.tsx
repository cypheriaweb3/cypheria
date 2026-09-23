import type { GitReviewFile } from "@cypheria/protocol"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@cypheria/ui/components/alert-dialog"
import { Button } from "@cypheria/ui/components/button"
import {
  ChatReviewDiffHost,
  type ChatReviewFileDescriptor,
  ChatReviewFileList,
  ChatReviewPanel,
  ChatReviewToolbar,
} from "@cypheria/ui/components/chat"
import { Checkbox } from "@cypheria/ui/components/checkbox"
import { Input } from "@cypheria/ui/components/input"
import { NativeSelect, NativeSelectOption } from "@cypheria/ui/components/native-select"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useId, useState } from "react"

import { ensureCypheriaClient } from "../cypheria-client.js"
import { GitHubPrPanel } from "./github-pr-panel.js"
import { GitLabMrPanel } from "./gitlab-mr-panel.js"

type ReviewSource = "unstaged" | "staged" | "uncommitted" | "branch"
const branchValue = (branch: { name: string; scope: "local" | "remote" }) =>
  branch.scope === "remote" ? `refs/remotes/${branch.name}` : branch.name

const statusKind = (code: string): ChatReviewFileDescriptor["status"] => {
  if (code.includes("?")) return "added"
  if (code.includes("D")) return "deleted"
  if (code.includes("R")) return "renamed"
  if (code.includes("A")) return "added"
  return "modified"
}

export function GitReviewPanel({
  cwd,
  fallback,
  threadId,
}: Readonly<{ cwd: string; fallback: ReactNode; threadId: string | null }>) {
  const stashId = useId()
  const { i18n } = useLingui()
  const queryClient = useQueryClient()
  const [source, setSource] = useState<ReviewSource>("unstaged")
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const [targetBranch, setTargetBranch] = useState("")
  const [branchSearch, setBranchSearch] = useState("")
  const [newBranch, setNewBranch] = useState("")
  const [stashChanges, setStashChanges] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingRevert, setPendingRevert] = useState<{
    snapshot: GitReviewFile
    hunkIndex?: number
  } | null>(null)
  const status = useQuery({
    queryKey: ["git", cwd, "status"],
    queryFn: async () => (await ensureCypheriaClient()).git.status(cwd),
    refetchInterval: 3_000,
    retry: false,
  })
  const branches = useQuery({
    enabled: Boolean(status.data),
    queryKey: ["git", cwd, "branch-search", branchSearch],
    queryFn: async () => (await ensureCypheriaClient()).git.searchBranches(cwd, branchSearch),
    refetchInterval: 3_000,
    retry: false,
  })
  const origin = useQuery({
    enabled: Boolean(status.data),
    queryKey: ["git", cwd, "origin"],
    queryFn: async () => (await ensureCypheriaClient()).git.origin(cwd),
    staleTime: 30_000,
    retry: false,
  })
  const worktrees = useQuery({
    enabled: Boolean(status.data),
    queryKey: ["git", cwd, "worktrees"],
    queryFn: async () => (await ensureCypheriaClient()).git.worktrees(cwd),
    refetchInterval: 5_000,
    retry: false,
  })
  const reviewUndos = useQuery({
    enabled: Boolean(status.data),
    queryKey: ["git", cwd, "review-undos"],
    queryFn: async () => (await ensureCypheriaClient()).git.reviewUndoList(cwd),
    retry: false,
  })
  const branchContext = useQuery({
    enabled: Boolean(status.data?.head),
    queryKey: ["git", cwd, "branch-context"],
    queryFn: async () => (await ensureCypheriaClient()).git.branchContext(cwd),
    refetchInterval: 5_000,
    retry: false,
  })
  const branchReview = useQuery({
    enabled: source === "branch" && Boolean(status.data?.head && branchContext.data?.defaultBranch),
    queryKey: ["git", cwd, "branch-review", branchContext.data?.defaultBranch, status.data?.head],
    queryFn: async () => {
      const base = branchContext.data?.defaultBranch
      if (!base) throw new Error("Base branch is unavailable")
      return (await ensureCypheriaClient()).git.branchReview(cwd, base)
    },
    refetchInterval: 5_000,
    retry: false,
  })
  const entries =
    source === "branch"
      ? (branchReview.data?.entries ?? [])
      : (status.data?.entries.filter(({ code }) =>
          source === "staged"
            ? code[0] !== " " && code[0] !== "?"
            : source === "unstaged"
              ? code[1] !== " "
              : true
        ) ?? [])
  const activePath = entries.some((entry) => entry.path === selectedPath)
    ? selectedPath
    : entries[0]?.path
  const diff = useQuery({
    enabled: Boolean(status.data && activePath && (source !== "branch" || branchReview.data)),
    queryKey: [
      "git",
      cwd,
      "diff",
      source,
      activePath,
      status.data?.head,
      status.data?.entries,
      branchReview.data?.base,
      branchReview.data?.head,
    ],
    queryFn: async () => {
      const git = (await ensureCypheriaClient()).git
      if (source === "branch" && branchReview.data && activePath) {
        const branchDiff = await git.branchReviewDiff(cwd, {
          base: branchReview.data.base,
          expectedHead: branchReview.data.head,
          path: activePath,
        })
        return { diff: branchDiff, revision: null, hunks: [] }
      }
      if (source === "uncommitted" && activePath) {
        const untracked = status.data?.entries.some(
          (entry) => entry.path === activePath && entry.code === "??"
        )
        const combinedDiff = status.data?.head
          ? await git.diff(cwd, { ...(untracked ? {} : { base: "HEAD" }), paths: [activePath] })
          : [
              await git.diff(cwd, { staged: true, paths: [activePath] }),
              await git.diff(cwd, { paths: [activePath] }),
            ]
              .filter(Boolean)
              .join("\n")
        return { diff: combinedDiff, revision: null, hunks: [] }
      }
      if (!activePath || (source !== "staged" && source !== "unstaged"))
        throw new Error("A review file is required")
      return git.reviewFile(cwd, source, activePath)
    },
    refetchInterval: 3_000,
    retry: false,
  })
  const mutate = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setActionError(null)
    try {
      await action()
      await queryClient.invalidateQueries({ queryKey: ["git", cwd] })
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
      await queryClient.invalidateQueries({ queryKey: ["git", cwd] })
    } finally {
      setBusy(false)
    }
  }
  const applyReview = (
    action: "stage" | "unstage" | "revert",
    hunkIndex?: number,
    selected?: GitReviewFile
  ) => {
    const snapshot = selected ?? diff.data
    if (!snapshot?.revision) return
    void mutate(async () => {
      await (await ensureCypheriaClient()).git.applyReviewSection(cwd, {
        source: snapshot.source,
        path: snapshot.path,
        revision: snapshot.revision,
        action,
        hunkIndex,
      })
    })
  }
  const files: ChatReviewFileDescriptor[] = entries.map((entry) => ({
    id: entry.path,
    path: entry.path,
    selected: entry.path === activePath,
    status: statusKind(entry.code),
  }))

  if (status.isError) {
    const canInit = /not a git repository/iu.test(status.error.message)
    return (
      <>
        <div className="space-y-2 border-b p-3">
          <p className="text-sm text-muted-foreground">{status.error.message}</p>
          {canInit ? (
            <Button
              disabled={busy}
              onClick={() => void mutate(async () => (await ensureCypheriaClient()).git.init(cwd))}
              size="sm"
              type="button"
              variant="outline"
            >
              <Trans id="git.review.init">Initialize repository</Trans>
            </Button>
          ) : null}
          {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
        </div>
        {fallback}
      </>
    )
  }

  return (
    <ChatReviewPanel>
      <ChatReviewToolbar>
        <Button
          onClick={() => setSource("unstaged")}
          size="sm"
          type="button"
          variant={source === "unstaged" ? "secondary" : "ghost"}
        >
          <Trans id="git.review.unstaged">Unstaged</Trans>
        </Button>
        <Button
          onClick={() => setSource("staged")}
          size="sm"
          type="button"
          variant={source === "staged" ? "secondary" : "ghost"}
        >
          <Trans id="git.review.staged">Staged</Trans>
        </Button>
        <Button
          onClick={() => setSource("uncommitted")}
          size="sm"
          type="button"
          variant={source === "uncommitted" ? "secondary" : "ghost"}
        >
          <Trans id="git.review.uncommitted">Uncommitted</Trans>
        </Button>
        <Button
          disabled={!status.data?.head || !branchContext.data?.defaultBranch}
          onClick={() => setSource("branch")}
          size="sm"
          title={branchContext.data?.defaultBranch ?? undefined}
          type="button"
          variant={source === "branch" ? "secondary" : "ghost"}
        >
          <Trans id="git.review.branchChanges">Branch</Trans>
        </Button>
        <span className="ml-auto truncate text-xs text-muted-foreground">
          {status.data?.branch ?? "HEAD"}
        </span>
      </ChatReviewToolbar>
      {status.data ? (
        <div className="space-y-2 border-b p-2">
          <Input
            aria-label={i18n._(
              msg({ id: "git.review.searchBranches", message: "Search branches" })
            )}
            className="h-8"
            maxLength={200}
            onChange={(event) => setBranchSearch(event.target.value)}
            placeholder={i18n._(
              msg({ id: "git.review.searchBranches", message: "Search branches" })
            )}
            value={branchSearch}
          />
          <div className="flex items-center gap-2">
            <NativeSelect
              aria-label={i18n._(msg({ id: "git.review.branch", message: "Branch" }))}
              className="min-w-0 flex-1"
              onChange={(event) => setTargetBranch(event.target.value)}
              size="sm"
              value={targetBranch || status.data.branch || ""}
            >
              <NativeSelectOption value="">
                <Trans id="git.review.selectBranch">Select branch</Trans>
              </NativeSelectOption>
              {status.data.branch &&
              !branches.data?.some((branch) => branchValue(branch) === status.data.branch) ? (
                <NativeSelectOption value={status.data.branch}>
                  {status.data.branch}
                </NativeSelectOption>
              ) : null}
              {targetBranch &&
              targetBranch !== status.data.branch &&
              !branches.data?.some((branch) => branchValue(branch) === targetBranch) ? (
                <NativeSelectOption value={targetBranch}>{targetBranch}</NativeSelectOption>
              ) : null}
              {branches.data?.map((branch) => (
                <NativeSelectOption
                  key={`${branch.scope}:${branch.name}`}
                  value={branchValue(branch)}
                >
                  {branch.name}
                  {branch.scope === "remote" ? (
                    <>
                      {" "}
                      (<Trans id="git.review.remoteBranch">remote</Trans>)
                    </>
                  ) : null}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Button
              disabled={busy || !targetBranch || targetBranch === status.data.branch}
              onClick={() =>
                void mutate(async () =>
                  (await ensureCypheriaClient()).git.checkout(cwd, targetBranch, stashChanges)
                )
              }
              size="sm"
              type="button"
              variant="outline"
            >
              <Trans id="git.review.switch">Switch</Trans>
            </Button>
          </div>
          <label
            className="flex items-center gap-2 text-xs text-muted-foreground"
            htmlFor={stashId}
          >
            <Checkbox
              id={stashId}
              checked={stashChanges}
              onCheckedChange={(checked) => setStashChanges(checked === true)}
            />
            <Trans id="git.review.stashChanges">Stash local changes before switching</Trans>
          </label>
          <div className="flex gap-2">
            <Input
              aria-label={i18n._(msg({ id: "git.review.newBranch", message: "New branch name" }))}
              onChange={(event) => setNewBranch(event.target.value)}
              placeholder={i18n._(msg({ id: "git.review.newBranch", message: "New branch name" }))}
              value={newBranch}
            />
            <Button
              disabled={busy || !newBranch.trim()}
              onClick={() =>
                void mutate(async () => {
                  const name = await (await ensureCypheriaClient()).git.createBranch(
                    cwd,
                    newBranch.trim()
                  )
                  setTargetBranch(name)
                  setNewBranch("")
                })
              }
              size="sm"
              type="button"
              variant="outline"
            >
              <Trans id="git.review.createBranch">Create</Trans>
            </Button>
          </div>
        </div>
      ) : null}
      {status.isPending ? (
        <p className="p-3 text-sm text-muted-foreground">
          <Trans id="git.review.loading">Loading repository changes…</Trans>
        </p>
      ) : null}
      {source === "branch" && branchReview.isError ? (
        <p className="p-3 text-sm text-destructive">{branchReview.error.message}</p>
      ) : null}
      {source === "branch" && branchReview.isPending ? (
        <p className="p-3 text-sm text-muted-foreground">
          <Trans id="git.review.branchLoading">Loading branch changes…</Trans>
        </p>
      ) : null}
      {status.data && files.length === 0 && (source !== "branch" || branchReview.isSuccess) ? (
        <p className="p-3 text-sm text-muted-foreground">
          <Trans id="git.review.empty">No changes in this source</Trans>
        </p>
      ) : null}
      {files.length > 0 ? (
        <ChatReviewFileList files={files} onSelectFile={setSelectedPath} />
      ) : null}
      {activePath ? (
        <ChatReviewDiffHost>
          <pre className="overflow-x-auto p-3 text-xs whitespace-pre-wrap">
            {diff.isError
              ? diff.error.message
              : diff.data?.diff ||
                (diff.isPending
                  ? i18n._(msg({ id: "git.review.diffLoading", message: "Loading diff…" }))
                  : i18n._(
                      msg({ id: "git.review.noTextDiff", message: "No text diff available" })
                    ))}
          </pre>
        </ChatReviewDiffHost>
      ) : null}
      {activePath && (source === "staged" || source === "unstaged") && diff.data?.hunks.length ? (
        <div className="space-y-1 border-t p-2">
          {diff.data.hunks.map((hunk) => (
            <div className="flex items-center gap-2" key={hunk.index}>
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={hunk.header}>
                {hunk.header}
              </span>
              <Button
                disabled={busy}
                onClick={() => applyReview(source === "staged" ? "unstage" : "stage", hunk.index)}
                size="sm"
                type="button"
                variant="outline"
              >
                {source === "staged" ? (
                  <Trans id="git.review.unstageHunk">Unstage section</Trans>
                ) : (
                  <Trans id="git.review.stageHunk">Stage section</Trans>
                )}
              </Button>
              {source === "unstaged" ? (
                <Button
                  disabled={busy}
                  onClick={() => {
                    const snapshot = diff.data
                    if (snapshot?.revision) setPendingRevert({ snapshot, hunkIndex: hunk.index })
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Trans id="git.review.revertHunk">Revert section</Trans>
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {activePath && (source === "staged" || source === "unstaged") ? (
        <div className="flex gap-2 border-t p-2">
          {source === "unstaged" ? (
            <>
              <Button
                disabled={busy}
                onClick={() => applyReview("stage")}
                size="sm"
                type="button"
                variant="outline"
              >
                <Trans id="git.review.stage">Stage file</Trans>
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  const snapshot = diff.data
                  if (snapshot?.revision) setPendingRevert({ snapshot })
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                <Trans id="git.review.revertFile">Revert file</Trans>
              </Button>
            </>
          ) : (
            <Button
              disabled={busy}
              onClick={() => applyReview("unstage")}
              size="sm"
              type="button"
              variant="outline"
            >
              <Trans id="git.review.unstage">Unstage file</Trans>
            </Button>
          )}
        </div>
      ) : null}
      {reviewUndos.data?.length ? (
        <div className="space-y-1 border-t p-2">
          <p className="text-xs font-medium">
            <Trans id="git.review.savedReverts">Saved reverts</Trans>
          </p>
          {reviewUndos.data.slice(0, 5).map((entry) => (
            <div className="flex items-center gap-2" key={entry.id}>
              <span className="min-w-0 flex-1 truncate text-xs" title={entry.path}>
                {entry.path}
              </span>
              <Button
                disabled={busy}
                onClick={() =>
                  void mutate(async () => {
                    await (await ensureCypheriaClient()).git.undoReviewRevert(cwd, entry.id)
                  })
                }
                size="sm"
                type="button"
                variant="outline"
              >
                <Trans id="git.review.undoRevert">Undo revert</Trans>
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setPendingRevert(null)
        }}
        open={pendingRevert !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans id="git.review.revertTitle">Revert changes?</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans id="git.review.revertDescription">
                A recoverable copy will be saved before the changes are reverted.
              </Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans id="git.review.cancel">Cancel</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                if (pendingRevert)
                  applyReview("revert", pendingRevert.hunkIndex, pendingRevert.snapshot)
                setPendingRevert(null)
              }}
            >
              <Trans id="git.review.revert">Revert</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {status.data ? (
        <div className="space-y-2 border-t p-2">
          <Input
            aria-label={i18n._(msg({ id: "git.review.commitMessage", message: "Commit message" }))}
            className="h-8 w-full rounded border bg-background px-2 text-sm"
            onChange={(event) => setMessage(event.target.value)}
            placeholder={i18n._(msg({ id: "git.review.commitMessage", message: "Commit message" }))}
            value={message}
          />
          <div className="flex gap-2">
            <Button
              disabled={
                busy ||
                !message.trim() ||
                !status.data.entries.some(({ code }) => code[0] !== " " && code[0] !== "?")
              }
              onClick={() =>
                void mutate(async () => {
                  await (await ensureCypheriaClient()).git.commit(cwd, message)
                  setMessage("")
                })
              }
              size="sm"
              type="button"
            >
              <Trans id="git.review.commit">Commit staged</Trans>
            </Button>
            <Button
              disabled={busy || !status.data.head}
              onClick={() => void mutate(async () => (await ensureCypheriaClient()).git.push(cwd))}
              size="sm"
              type="button"
              variant="outline"
            >
              <Trans id="git.review.push">Push</Trans>
            </Button>
          </div>
        </div>
      ) : null}
      {status.data?.head ? (
        <div className="space-y-2 border-t p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium">
              <Trans id="git.review.worktrees">Worktrees</Trans>
            </span>
            <Button
              disabled={busy}
              onClick={() =>
                void mutate(async () => (await ensureCypheriaClient()).git.createWorktree(cwd))
              }
              size="sm"
              type="button"
              variant="outline"
            >
              <Trans id="git.review.createWorktree">Create worktree</Trans>
            </Button>
          </div>
          {threadId &&
          worktrees.data?.some(
            (entry) => entry.path === status.data.repository.root && entry.managed
          ) ? (
            <Button
              disabled={busy || !worktrees.data?.find((entry) => !entry.managed && entry.active)}
              onClick={() => {
                const checkout = worktrees.data?.find((entry) => !entry.managed && entry.active)
                if (checkout)
                  void mutate(async () =>
                    (await ensureCypheriaClient()).git.moveThreadToWorktree(
                      cwd,
                      checkout.path,
                      threadId
                    )
                  )
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              <Trans id="git.review.moveToCheckout">Move thread to checkout</Trans>
            </Button>
          ) : null}
          {worktrees.data
            ?.filter((entry) => entry.managed)
            .map((entry) => (
              <div className="flex items-center gap-2" key={entry.path}>
                <span className="min-w-0 flex-1 truncate text-xs" title={entry.path}>
                  {entry.path}
                </span>
                {threadId && entry.active && entry.path !== status.data.repository.root ? (
                  <Button
                    disabled={
                      busy || Boolean(entry.ownerThreadId && entry.ownerThreadId !== threadId)
                    }
                    onClick={() =>
                      void mutate(async () =>
                        (await ensureCypheriaClient()).git.moveThreadToWorktree(
                          cwd,
                          entry.path,
                          threadId
                        )
                      )
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Trans id="git.review.moveThreadHere">Move thread here</Trans>
                  </Button>
                ) : null}
                <Button
                  disabled={busy || entry.path === status.data.repository.root}
                  onClick={() =>
                    void mutate(async () =>
                      entry.active
                        ? (await ensureCypheriaClient()).git.deleteWorktree(cwd, entry.path)
                        : (await ensureCypheriaClient()).git.restoreWorktree(cwd, entry.path)
                    )
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {entry.active ? (
                    <Trans id="git.review.deleteWorktree">Delete</Trans>
                  ) : (
                    <Trans id="git.review.restoreWorktree">Restore</Trans>
                  )}
                </Button>
              </div>
            ))}
        </div>
      ) : null}
      {origin.data?.provider === "gitlab" ? (
        <GitLabMrPanel
          branch={status.data?.branch ?? null}
          cwd={cwd}
          key={cwd}
          threadId={threadId}
        />
      ) : null}
      {origin.data?.provider === "github" ? (
        <GitHubPrPanel
          branch={status.data?.branch ?? null}
          cwd={cwd}
          key={cwd}
          threadId={threadId}
        />
      ) : null}
      {actionError ? <p className="p-2 text-sm text-destructive">{actionError}</p> : null}
    </ChatReviewPanel>
  )
}
