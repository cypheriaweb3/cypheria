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
  type ChatDiffAnnotation,
  type ChatDiffTarget,
  ChatDiffViewer,
  ChatReviewDiffHost,
  type ChatReviewFileDescriptor,
  ChatReviewFileTree,
  ChatReviewPanel,
  ChatReviewToolbar,
  type ChatReviewTreeFile,
  chatDiffFingerprints,
} from "@cypheria/ui/components/chat"
import { Checkbox } from "@cypheria/ui/components/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@cypheria/ui/components/collapsible"
import { ChevronDownIcon } from "@cypheria/ui/components/icons"
import { Input } from "@cypheria/ui/components/input"
import { NativeSelect, NativeSelectOption } from "@cypheria/ui/components/native-select"
import { Textarea } from "@cypheria/ui/components/textarea"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useAtom } from "jotai"
import { type ReactNode, useEffect, useId, useMemo, useState } from "react"

import { gitReviewSourceAtom, reviewCommentsAtom } from "../client-state.js"
import { cypheriaClient, ensureCypheriaClient } from "../cypheria-client.js"
import { commitChanges, hasCommittableChanges, parseCoAuthors } from "./git-commit-actions.js"
import { GitHubPrPanel } from "./github-pr-panel.js"
import { GitLabMrPanel } from "./gitlab-mr-panel.js"
import { formatReviewComments, hunkAnchor } from "./review-comments.js"
import {
  ReviewDiffControls,
  useDiffViewerLabels,
  useReviewDiffDisplay,
  useViewedFiles,
} from "./review-diff-display.js"

const branchValue = (branch: { name: string; scope: "local" | "remote" }) =>
  branch.scope === "remote" ? `refs/remotes/${branch.name}` : branch.name

const statusKind = (code: string): ChatReviewFileDescriptor["status"] => {
  if (code.includes("?")) return "added"
  if (code.includes("D")) return "deleted"
  if (code.includes("R")) return "renamed"
  if (code.includes("A")) return "added"
  return "modified"
}

const treeStatus = (code: string): ChatReviewTreeFile["status"] => {
  if (code.includes("?")) return "untracked"
  if (code.includes("D")) return "deleted"
  if (code.includes("R")) return "renamed"
  if (code.includes("A")) return "added"
  return "modified"
}

function ReviewSection({
  children,
  defaultOpen,
  title,
}: Readonly<{ children: ReactNode; defaultOpen: boolean; title: string }>) {
  return (
    <Collapsible className="border-t" defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="group flex w-full items-center justify-between px-2 py-1.5 text-left font-medium text-xs hover:bg-accent">
        {title}
        <ChevronDownIcon className="size-3.5 transition-transform group-data-[panel-open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  )
}

export function GitReviewPanel({
  cwd,
  fallback,
  onAddFile,
  onSendComments,
  threadId,
}: Readonly<{
  cwd: string
  fallback: ReactNode
  onAddFile?: (path: string) => void
  /** Sends Review comments to the Thread's Agent as the next message. */
  onSendComments?: (text: string) => void
  threadId: string | null
}>) {
  const stashId = useId()
  const whitespaceId = useId()
  const worktreeChangesId = useId()
  const moveChangesId = useId()
  const commitIncludeUnstagedId = useId()
  const { i18n } = useLingui()
  const queryClient = useQueryClient()
  const [source, setSource] = useAtom(gitReviewSourceAtom)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedCommit, setSelectedCommit] = useState("")
  const [message, setMessage] = useState("")
  const [coAuthors, setCoAuthors] = useState("")
  const [commitIncludeUnstaged, setCommitIncludeUnstaged] = useState(false)
  const [targetBranch, setTargetBranch] = useState("")
  const [worktreeStartPoint, setWorktreeStartPoint] = useState("HEAD")
  const [worktreeIncludeChanges, setWorktreeIncludeChanges] = useState(false)
  const [moveChanges, setMoveChanges] = useState(false)
  const [worktreeEnvironmentPath, setWorktreeEnvironmentPath] = useState("")
  const [worktreeJobId, setWorktreeJobId] = useState<string | null>(null)
  const [branchSearch, setBranchSearch] = useState("")
  const [reviewBaseSearch, setReviewBaseSearch] = useState("")
  const [reviewBase, setReviewBase] = useState("")
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false)
  const [diffDisplay] = useReviewDiffDisplay()
  const diffViewerLabels = useDiffViewerLabels()
  const [collapsedPaths, setCollapsedPaths] = useState<ReadonlySet<string>>(new Set())
  const [commentDraft, setCommentDraft] = useState<ChatDiffTarget | null>(null)
  const [commentBody, setCommentBody] = useState("")
  const [reviewComments, setReviewComments] = useAtom(reviewCommentsAtom(threadId ?? `cwd:${cwd}`))
  const [fileSearch, setFileSearch] = useState("")
  const [newBranch, setNewBranch] = useState("")
  const [stashChanges, setStashChanges] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingRevert, setPendingRevert] = useState<{
    snapshot: GitReviewFile
    hunkIndex?: number
  } | null>(null)
  const [pendingSync, setPendingSync] = useState<"sync" | "undo" | null>(null)
  const gitSettings = useQuery({
    queryKey: ["settings", "git"],
    queryFn: async () => (await ensureCypheriaClient()).server.config(),
    staleTime: 30_000,
  })
  const lastTurnOnly =
    gitSettings.data?.config.git.reviewMode === "last-turn-only" && Boolean(threadId)
  useEffect(() => {
    if (lastTurnOnly) setSource("last-turn")
  }, [lastTurnOnly, setSource])
  useEffect(() => {
    if (!threadId && source === "last-turn") setSource("unstaged")
  }, [source, threadId, setSource])
  const status = useQuery({
    queryKey: ["git", cwd, "status"],
    queryFn: async () => (await ensureCypheriaClient()).git.status(cwd),
    refetchInterval: 3_000,
    retry: false,
  })
  useEffect(() => {
    const root = status.data?.repository.root
    if (!root) return
    return cypheriaClient.subscribe((message) => {
      if (message.type !== "git.repository-changed.notification" || message.payload.root !== root)
        return
      void queryClient.invalidateQueries({ queryKey: ["git", cwd] })
      void queryClient.invalidateQueries({ queryKey: ["github-pr", cwd] })
    })
  }, [cwd, queryClient, status.data?.repository.root])
  const branches = useQuery({
    enabled: Boolean(status.data),
    queryKey: ["git", cwd, "branch-search", branchSearch],
    queryFn: async () => (await ensureCypheriaClient()).git.searchBranches(cwd, branchSearch),
    refetchInterval: 3_000,
    retry: false,
  })
  const reviewBaseBranches = useQuery({
    enabled: source === "branch" && Boolean(status.data),
    queryKey: ["git", cwd, "review-base-search", reviewBaseSearch],
    queryFn: async () =>
      (await ensureCypheriaClient()).git.searchBranches(cwd, reviewBaseSearch, 100),
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
  const currentManagedWorktree = worktrees.data?.some(
    (entry) => entry.managed && entry.active && entry.path === status.data?.repository.root
  )
  const syncedBranch = useQuery({
    enabled: Boolean(status.data && currentManagedWorktree),
    queryKey: ["git", cwd, "synced-branch", status.data?.repository.root],
    queryFn: async () => {
      if (!status.data) throw new Error("A Git worktree is required")
      return (await ensureCypheriaClient()).git.syncedBranchState(cwd, status.data.repository.root)
    },
    refetchInterval: 5_000,
    retry: false,
  })
  const worktreeJob = useQuery({
    enabled: Boolean(worktreeJobId),
    queryKey: ["git", cwd, "worktree-job", worktreeJobId],
    queryFn: async () => {
      if (!worktreeJobId) throw new Error("Worktree operation is unavailable")
      return (await ensureCypheriaClient()).git.worktreeJob(worktreeJobId)
    },
    refetchInterval: (query) =>
      query.state.data && ["ready", "failed", "cancelled"].includes(query.state.data.phase)
        ? false
        : 500,
    retry: false,
  })
  const worktreeJobRunning = Boolean(
    worktreeJob.data && ["queued", "creating", "setting-up"].includes(worktreeJob.data.phase)
  )
  useEffect(() => {
    if (worktreeJob.data?.phase === "ready")
      void queryClient.invalidateQueries({ queryKey: ["git", cwd, "worktrees"] })
  }, [cwd, queryClient, worktreeJob.data?.phase])
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
  const activeReviewBase = reviewBase || branchContext.data?.defaultBranch || ""
  const branchReview = useQuery({
    enabled: source === "branch" && Boolean(status.data?.head && activeReviewBase),
    queryKey: ["git", cwd, "branch-review", activeReviewBase, status.data?.head],
    queryFn: async () => {
      if (!activeReviewBase) throw new Error("Base branch is unavailable")
      return (await ensureCypheriaClient()).git.branchReview(cwd, activeReviewBase)
    },
    refetchInterval: 5_000,
    retry: false,
  })
  const commits = useQuery({
    enabled: source === "commit" && Boolean(status.data?.head),
    queryKey: ["git", cwd, "commits", status.data?.head],
    queryFn: async () => (await ensureCypheriaClient()).git.commitList(cwd),
    retry: false,
  })
  const activeCommit = commits.data?.some((commit) => commit.id === selectedCommit)
    ? selectedCommit
    : commits.data?.[0]?.id
  const commitReview = useQuery({
    enabled: source === "commit" && Boolean(activeCommit),
    queryKey: ["git", cwd, "commit-review", activeCommit],
    queryFn: async () => {
      if (!activeCommit) throw new Error("A commit is required")
      return (await ensureCypheriaClient()).git.commitReview(cwd, activeCommit)
    },
    retry: false,
  })
  const lastTurnReview = useQuery({
    enabled: source === "last-turn" && Boolean(threadId && status.data),
    queryKey: ["git", cwd, "last-turn-review", threadId],
    queryFn: async () => {
      if (!threadId) throw new Error("A thread is required")
      return (await ensureCypheriaClient()).git.lastTurnReview(cwd, threadId)
    },
    refetchInterval: 5_000,
    retry: false,
  })
  const entries =
    source === "branch"
      ? (branchReview.data?.entries ?? [])
      : source === "commit"
        ? (commitReview.data?.entries ?? [])
        : source === "last-turn"
          ? (lastTurnReview.data?.entries ?? [])
          : (status.data?.entries.filter(({ code }) =>
              source === "staged"
                ? code[0] !== " " && code[0] !== "?"
                : source === "unstaged"
                  ? code[1] !== " "
                  : true
            ) ?? [])
  const fileSearchTerm = fileSearch.trim().toLowerCase()
  const visibleEntries = fileSearchTerm
    ? entries.filter((entry) => entry.path.toLowerCase().includes(fileSearchTerm))
    : entries
  const activePath = visibleEntries.some((entry) => entry.path === selectedPath)
    ? selectedPath
    : visibleEntries[0]?.path
  const reviewSnapshot =
    source === "branch"
      ? branchReview.data
      : source === "commit"
        ? commitReview.data
        : source === "last-turn"
          ? lastTurnReview.data
          : null
  const lineCounts = useQuery({
    enabled: Boolean(
      status.data &&
        (source === "branch" || source === "commit" || source === "last-turn"
          ? reviewSnapshot
          : true)
    ),
    queryKey: [
      "git",
      cwd,
      "line-counts",
      source,
      ignoreWhitespace,
      reviewSnapshot?.base,
      reviewSnapshot?.head,
      status.data?.entries,
    ],
    queryFn: async () =>
      (await ensureCypheriaClient()).git.reviewLineCounts(cwd, {
        source,
        ignoreWhitespace,
        ...(reviewSnapshot ? { base: reviewSnapshot.base, head: reviewSnapshot.head } : {}),
      }),
    refetchInterval: 5_000,
    retry: false,
  })
  const countsByPath = new Map(lineCounts.data?.map((entry) => [entry.path, entry]) ?? [])
  const visibleAdditions = visibleEntries.reduce(
    (total, entry) => total + (countsByPath.get(entry.path)?.additions ?? 0),
    0
  )
  const visibleDeletions = visibleEntries.reduce(
    (total, entry) => total + (countsByPath.get(entry.path)?.deletions ?? 0),
    0
  )
  const diff = useQuery({
    enabled: Boolean(
      status.data &&
        activePath &&
        (source !== "branch" || branchReview.data) &&
        (source !== "commit" || commitReview.data) &&
        (source !== "last-turn" || lastTurnReview.data)
    ),
    queryKey: [
      "git",
      cwd,
      "diff",
      source,
      ignoreWhitespace,
      activePath,
      status.data?.head,
      status.data?.entries,
      branchReview.data?.base,
      branchReview.data?.head,
      commitReview.data?.base,
      commitReview.data?.head,
      lastTurnReview.data?.base,
      lastTurnReview.data?.head,
    ],
    queryFn: async () => {
      const git = (await ensureCypheriaClient()).git
      if (source === "branch" && branchReview.data && activePath) {
        const branchDiff = await git.branchReviewDiff(cwd, {
          base: branchReview.data.base,
          expectedHead: branchReview.data.head,
          path: activePath,
          ignoreWhitespace,
        })
        return { diff: branchDiff, revision: null, hunks: [] }
      }
      if (source === "commit" && commitReview.data && activePath) {
        const commitDiff = await git.commitReviewDiff(cwd, {
          base: commitReview.data.base,
          commit: commitReview.data.head,
          path: activePath,
          ignoreWhitespace,
        })
        return { diff: commitDiff, revision: null, hunks: [] }
      }
      if (source === "last-turn" && lastTurnReview.data && activePath && threadId) {
        const turnDiff = await git.lastTurnReviewDiff(cwd, {
          threadId,
          base: lastTurnReview.data.base,
          head: lastTurnReview.data.head,
          path: activePath,
          ignoreWhitespace,
        })
        return { diff: turnDiff, revision: null, hunks: [] }
      }
      if (source === "uncommitted" && activePath) {
        const untracked = status.data?.entries.some(
          (entry) => entry.path === activePath && entry.code === "??"
        )
        const combinedDiff = status.data?.head
          ? await git.diff(cwd, {
              ...(untracked ? {} : { base: "HEAD" }),
              paths: [activePath],
              ignoreWhitespace,
            })
          : [
              await git.diff(cwd, { staged: true, paths: [activePath], ignoreWhitespace }),
              await git.diff(cwd, { paths: [activePath], ignoreWhitespace }),
            ]
              .filter(Boolean)
              .join("\n")
        return { diff: combinedDiff, revision: null, hunks: [] }
      }
      if (!activePath || (source !== "staged" && source !== "unstaged"))
        throw new Error("A review file is required")
      return git.reviewFile(cwd, source, activePath, ignoreWhitespace)
    },
    refetchInterval: 3_000,
    retry: false,
  })
  const diffFingerprints = useMemo(
    () => chatDiffFingerprints(diff.data?.diff ?? ""),
    [diff.data?.diff]
  )
  const viewed = useViewedFiles(`${threadId ?? `cwd:${cwd}`}:${source}`, diffFingerprints)
  const shownCollapsed = useMemo(
    () => new Set([...collapsedPaths, ...viewed.viewedPaths]),
    [collapsedPaths, viewed.viewedPaths]
  )
  const toggleCollapsed = (path: string) => {
    if (viewed.viewedPaths.has(path)) {
      viewed.setViewed(path, false)
      return
    }
    setCollapsedPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }
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
  const files: ChatReviewFileDescriptor[] = visibleEntries.map((entry) => ({
    id: entry.path,
    path: entry.path,
    selected: entry.path === activePath,
    status: statusKind(entry.code),
    ...(countsByPath.get(entry.path)?.additions !== null &&
    countsByPath.get(entry.path)?.additions !== undefined
      ? { additions: countsByPath.get(entry.path)?.additions ?? 0 }
      : {}),
    ...(countsByPath.get(entry.path)?.deletions !== null &&
    countsByPath.get(entry.path)?.deletions !== undefined
      ? { deletions: countsByPath.get(entry.path)?.deletions ?? 0 }
      : {}),
  }))
  const canCommit = hasCommittableChanges(status.data?.entries ?? [], commitIncludeUnstaged)
  const sourceComments = reviewComments.filter((comment) => comment.source === source)
  const treeFiles: ChatReviewTreeFile[] = files.map((file) => ({
    path: String(file.path),
    status: treeStatus(visibleEntries.find((entry) => entry.path === file.id)?.code ?? "M"),
    ...(file.additions !== undefined ? { additions: file.additions } : {}),
    ...(file.deletions !== undefined ? { deletions: file.deletions } : {}),
    comments: sourceComments.filter((comment) => comment.path === file.id).length,
    viewed: viewed.markedPaths.has(String(file.path)),
  }))
  const hunkActions = (hunk: { header: string; index: number }) => (
    <div className="flex flex-wrap items-center gap-1 border-y bg-muted/40 px-2 py-1">
      <Button
        disabled={busy}
        onClick={() => applyReview(source === "staged" ? "unstage" : "stage", hunk.index)}
        size="sm"
        type="button"
        variant="ghost"
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
          variant="ghost"
        >
          <Trans id="git.review.revertHunk">Revert section</Trans>
        </Button>
      ) : null}
    </div>
  )
  const diffAnnotations: ChatDiffAnnotation[] = activePath
    ? [
        ...(source === "staged" || source === "unstaged"
          ? (diff.data?.hunks ?? []).flatMap((hunk) => {
              const anchor = hunkAnchor(hunk.header)
              return anchor
                ? [
                    {
                      content: hunkActions(hunk),
                      key: `hunk:${hunk.index}`,
                      lineNumber: anchor.lineNumber,
                      path: activePath,
                      side: anchor.side,
                    },
                  ]
                : []
            })
          : []),
        ...sourceComments
          .filter((comment) => comment.path === activePath)
          .map((comment) => ({
            content: (
              <div className="flex items-start gap-2 border-y bg-background p-2 text-xs">
                <p className="min-w-0 flex-1 whitespace-pre-wrap">{comment.body}</p>
                <Button
                  onClick={() =>
                    setReviewComments((current) =>
                      current.filter((entry) => entry.id !== comment.id)
                    )
                  }
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Trans id="git.review.removeComment">Remove</Trans>
                </Button>
              </div>
            ),
            key: `comment:${comment.id}`,
            lineNumber: comment.lineNumber,
            path: comment.path,
            side: comment.side,
          })),
        ...(commentDraft && commentDraft.path === activePath
          ? [
              {
                content: (
                  <div className="space-y-1 border-y bg-background p-2">
                    <Textarea
                      aria-label={i18n._(
                        msg({ id: "git.review.commentBody", message: "Review comment" })
                      )}
                      autoFocus
                      onChange={(event) => setCommentBody(event.target.value)}
                      placeholder={i18n._(
                        msg({
                          id: "git.review.commentPlaceholder",
                          message: "Tell the Agent what to change here…",
                        })
                      )}
                      rows={3}
                      value={commentBody}
                    />
                    <div className="flex gap-1">
                      <Button
                        disabled={!commentBody.trim()}
                        onClick={() => {
                          const draft = commentDraft
                          setReviewComments((current) => [
                            ...current,
                            {
                              body: commentBody.trim(),
                              id: crypto.randomUUID(),
                              lineNumber: draft.lineNumber,
                              ...(draft.startLineNumber === undefined
                                ? {}
                                : { startLineNumber: draft.startLineNumber }),
                              path: draft.path,
                              side: draft.side,
                              source,
                            },
                          ])
                          setCommentDraft(null)
                          setCommentBody("")
                        }}
                        size="sm"
                        type="button"
                      >
                        <Trans id="git.review.addComment">Add comment</Trans>
                      </Button>
                      <Button
                        onClick={() => setCommentDraft(null)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        <Trans id="git.review.cancel">Cancel</Trans>
                      </Button>
                    </div>
                  </div>
                ),
                key: "comment-draft",
                lineNumber: commentDraft.lineNumber,
                path: commentDraft.path,
                side: commentDraft.side,
              },
            ]
          : []),
      ]
    : []

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
        {!lastTurnOnly ? (
          <>
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
              disabled={!status.data?.head || !activeReviewBase}
              onClick={() => setSource("branch")}
              size="sm"
              title={activeReviewBase || undefined}
              type="button"
              variant={source === "branch" ? "secondary" : "ghost"}
            >
              <Trans id="git.review.branchChanges">Branch</Trans>
            </Button>
            <Button
              disabled={!status.data?.head}
              onClick={() => setSource("commit")}
              size="sm"
              type="button"
              variant={source === "commit" ? "secondary" : "ghost"}
            >
              <Trans id="git.review.commitSource">Commit</Trans>
            </Button>
          </>
        ) : null}
        <Button
          disabled={!threadId}
          onClick={() => setSource("last-turn")}
          size="sm"
          type="button"
          variant={source === "last-turn" ? "secondary" : "ghost"}
        >
          <Trans id="git.review.lastTurn">Last turn</Trans>
        </Button>
        <span className="ml-auto truncate text-xs text-muted-foreground">
          {status.data?.branch ?? "HEAD"}
        </span>
      </ChatReviewToolbar>
      {source === "branch" ? (
        <div className="space-y-2 border-b p-2">
          <Input
            aria-label={i18n._(
              msg({ id: "git.review.searchBaseBranches", message: "Search base branches" })
            )}
            maxLength={200}
            onChange={(event) => setReviewBaseSearch(event.target.value)}
            placeholder={i18n._(
              msg({ id: "git.review.searchBaseBranches", message: "Search base branches" })
            )}
            value={reviewBaseSearch}
          />
          <NativeSelect
            aria-label={i18n._(msg({ id: "git.review.baseBranch", message: "Base branch" }))}
            className="w-full"
            onChange={(event) => {
              setReviewBase(event.target.value)
              setSelectedPath(null)
            }}
            size="sm"
            value={activeReviewBase}
          >
            {!activeReviewBase ? (
              <NativeSelectOption value="">
                <Trans id="git.review.selectBaseBranch">Select base branch</Trans>
              </NativeSelectOption>
            ) : null}
            {activeReviewBase &&
            !reviewBaseBranches.data?.some((branch) => branchValue(branch) === activeReviewBase) ? (
              <NativeSelectOption value={activeReviewBase}>{activeReviewBase}</NativeSelectOption>
            ) : null}
            {reviewBaseBranches.data
              ?.filter((branch) => !branch.current || branchValue(branch) === activeReviewBase)
              .map((branch) => (
                <NativeSelectOption
                  key={`${branch.scope}:${branch.name}`}
                  value={branchValue(branch)}
                >
                  {branch.name}
                </NativeSelectOption>
              ))}
          </NativeSelect>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-b px-2 py-1.5">
        <span className="text-xs tabular-nums text-muted-foreground">
          {i18n._({
            ...msg({
              id: "git.review.fileCount",
              message: "{count, plural, one {# file changed} other {# files changed}}",
            }),
            values: { count: entries.length },
          })}
        </span>
        {lineCounts.data ? (
          <span className="font-mono text-xs tabular-nums">
            <span className="text-emerald-600">+{visibleAdditions}</span>{" "}
            <span className="text-destructive">-{visibleDeletions}</span>
          </span>
        ) : null}
        <label
          className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground"
          htmlFor={whitespaceId}
        >
          <Checkbox
            id={whitespaceId}
            checked={ignoreWhitespace}
            onCheckedChange={(checked) => setIgnoreWhitespace(checked === true)}
          />
          <Trans id="git.review.ignoreWhitespace">Ignore whitespace changes</Trans>
        </label>
        <ReviewDiffControls
          files={visibleEntries.map((entry) => entry.path)}
          onError={setActionError}
          onJumpToFile={setSelectedPath}
          {...(diff.data?.diff ? { patch: diff.data.diff } : {})}
        />
      </div>
      {lineCounts.isError ? (
        <p className="border-b p-2 text-xs text-destructive">{lineCounts.error.message}</p>
      ) : null}
      {source === "commit" && status.data?.head ? (
        <div className="border-b p-2">
          <NativeSelect
            aria-label={i18n._(msg({ id: "git.review.selectCommit", message: "Select commit" }))}
            className="w-full"
            onChange={(event) => {
              setSelectedCommit(event.target.value)
              setSelectedPath(null)
            }}
            size="sm"
            value={activeCommit ?? ""}
          >
            {commits.data?.map((commit) => (
              <NativeSelectOption key={commit.id} value={commit.id}>
                {commit.id.slice(0, 8)} · {commit.subject}
              </NativeSelectOption>
            ))}
          </NativeSelect>
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
      {source === "commit" && commitReview.isError ? (
        <p className="p-3 text-sm text-destructive">{commitReview.error.message}</p>
      ) : null}
      {source === "commit" && commitReview.isPending ? (
        <p className="p-3 text-sm text-muted-foreground">
          <Trans id="git.review.commitLoading">Loading commit changes…</Trans>
        </p>
      ) : null}
      {source === "last-turn" && lastTurnReview.isError ? (
        <p className="p-3 text-sm text-destructive">{lastTurnReview.error.message}</p>
      ) : null}
      {status.data &&
      entries.length === 0 &&
      (source !== "branch" || branchReview.isSuccess) &&
      (source !== "commit" || commitReview.isSuccess) &&
      (source !== "last-turn" || lastTurnReview.isSuccess) ? (
        <p className="p-3 text-sm text-muted-foreground">
          <Trans id="git.review.empty">No changes in this source</Trans>
        </p>
      ) : null}
      {files.length > 0 || fileSearch ? (
        <div className="@container flex min-h-0 flex-col border-b">
          <div className="flex min-h-0 flex-col @3xl:flex-row">
            <ChatReviewFileTree
              className="h-56 shrink-0 border-b @3xl:h-[40rem] @3xl:w-64 @3xl:border-r @3xl:border-b-0"
              files={treeFiles}
              filter={fileSearch}
              labels={{
                filter: i18n._(
                  msg({ id: "git.review.searchFiles", message: "Search changed files" })
                ),
                noMatches: i18n._(
                  msg({ id: "git.review.noMatchingFiles", message: "No files match this search" })
                ),
                rowSummary: (file) =>
                  i18n._({
                    ...msg({
                      id: "git.review.rowSummary",
                      message:
                        "{path}, added lines: {additions}, deleted lines: {deletions}, comments: {comments}",
                    }),
                    values: {
                      additions: file.additions ?? 0,
                      comments: file.comments ?? 0,
                      deletions: file.deletions ?? 0,
                      path: file.path,
                    },
                  }),
                tree: i18n._(msg({ id: "git.review.changedFiles", message: "Changed files" })),
              }}
              onFilterChange={setFileSearch}
              onSelectFile={setSelectedPath}
              selectedPath={activePath ?? null}
            />
            {activePath ? (
              <ChatReviewDiffHost className="flex min-w-0 flex-1 flex-col border-t-0">
                <div className="flex flex-wrap gap-1 border-b p-2">
                  <Button
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(activePath)
                        .catch((error: unknown) =>
                          setActionError(error instanceof Error ? error.message : String(error))
                        )
                    }
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <Trans id="git.review.copyPath">Copy path</Trans>
                  </Button>
                  {onAddFile ? (
                    <Button
                      onClick={() => onAddFile(activePath)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <Trans id="git.review.addToChat">Add to chat</Trans>
                    </Button>
                  ) : null}
                  {window.cypheria ? (
                    <>
                      <Button
                        onClick={() =>
                          void window.cypheria?.app
                            .gitFileAction({ cwd, path: activePath, action: "open" })
                            .catch((error: unknown) =>
                              setActionError(error instanceof Error ? error.message : String(error))
                            )
                        }
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        <Trans id="git.review.openFile">Open file</Trans>
                      </Button>
                      <Button
                        onClick={() =>
                          void window.cypheria?.app
                            .gitFileAction({ cwd, path: activePath, action: "save" })
                            .catch((error: unknown) =>
                              setActionError(error instanceof Error ? error.message : String(error))
                            )
                        }
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        <Trans id="git.review.saveAs">Save as…</Trans>
                      </Button>
                    </>
                  ) : null}
                </div>
                <ChatDiffViewer
                  annotations={diffAnnotations}
                  className="max-h-[40rem]"
                  collapsedPaths={shownCollapsed}
                  diffStyle={diffDisplay.diffStyle}
                  labels={diffViewerLabels}
                  onToggleCollapsed={toggleCollapsed}
                  onToggleViewed={viewed.setViewed}
                  viewedPaths={viewed.viewedPaths}
                  wordDiffs={diffDisplay.wordDiffs}
                  fallback={
                    <pre className="overflow-x-auto p-3 text-xs whitespace-pre-wrap">
                      {diff.isError
                        ? diff.error.message
                        : diff.data?.diff ||
                          (diff.isPending
                            ? i18n._(
                                msg({ id: "git.review.diffLoading", message: "Loading diff…" })
                              )
                            : i18n._(
                                msg({
                                  id: "git.review.noTextDiff",
                                  message: "No text diff available",
                                })
                              ))}
                    </pre>
                  }
                  onRequestComment={(target) => {
                    setCommentBody("")
                    setCommentDraft(target)
                  }}
                  patch={diff.data?.diff ?? ""}
                  wrap={diffDisplay.wrap}
                />
                {source === "staged" || source === "unstaged" ? (
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
              </ChatReviewDiffHost>
            ) : null}
          </div>
          {reviewComments.length > 0 ? (
            <div className="flex items-center gap-2 border-t p-2">
              <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                {i18n._({
                  ...msg({
                    id: "git.review.pendingComments",
                    message: "{count, plural, one {# review comment} other {# review comments}}",
                  }),
                  values: { count: reviewComments.length },
                })}
              </span>
              <Button
                disabled={!onSendComments || !status.data}
                onClick={() => {
                  if (!onSendComments || !status.data) return
                  onSendComments(formatReviewComments(status.data.repository.root, reviewComments))
                  setReviewComments([])
                }}
                size="sm"
                type="button"
              >
                <Trans id="git.review.sendComments">Send to Agent</Trans>
              </Button>
              <Button onClick={() => setReviewComments([])} size="sm" type="button" variant="ghost">
                <Trans id="git.review.clearComments">Clear</Trans>
              </Button>
            </div>
          ) : null}
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
          if (!open) setPendingSync(null)
        }}
        open={pendingSync !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans id="git.review.syncConfirmTitle">Update the synced branch?</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans id="git.review.syncConfirmDescription">
                The branch checkout must be clean. Cypheria includes uncommitted worktree files in a
                snapshot commit and saves the previous branch commit for Undo.
              </Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans id="git.review.cancel">Cancel</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || !syncedBranch.data || !status.data}
              onClick={() => {
                const action = pendingSync
                const state = syncedBranch.data
                const root = status.data?.repository.root
                setPendingSync(null)
                if (!action || !state || !root) return
                void mutate(async () => {
                  const git = (await ensureCypheriaClient()).git
                  if (action === "sync")
                    await git.syncBranch(cwd, root, state.branchHead, state.worktreeHead)
                  else await git.undoSync(cwd, root)
                })
              }}
            >
              <Trans id="git.review.confirm">Confirm</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
        <ReviewSection
          defaultOpen={true}
          title={i18n._(msg({ id: "git.review.commitSection", message: "Commit" }))}
        >
          <div className="space-y-2 border-t p-2">
            <div className="flex gap-2">
              <Input
                aria-label={i18n._(
                  msg({ id: "git.review.commitMessage", message: "Commit message" })
                )}
                className="h-8 min-w-0 flex-1 rounded border bg-background px-2 text-sm"
                onChange={(event) => setMessage(event.target.value)}
                placeholder={i18n._(
                  msg({ id: "git.review.commitMessage", message: "Commit message" })
                )}
                value={message}
              />
              <Button
                disabled={busy || !canCommit}
                onClick={() =>
                  void mutate(async () => {
                    const generated = await (await ensureCypheriaClient()).git.generateText(
                      cwd,
                      "commit"
                    )
                    setMessage(generated.title)
                  })
                }
                size="sm"
                type="button"
                variant="outline"
              >
                <Trans id="git.review.generateMessage">Generate</Trans>
              </Button>
            </div>
            <Input
              aria-label={i18n._(
                msg({ id: "git.review.coAuthors", message: "Co-authors, separated by semicolons" })
              )}
              onChange={(event) => setCoAuthors(event.target.value)}
              placeholder={i18n._(
                msg({ id: "git.review.coAuthors", message: "Co-authors, separated by semicolons" })
              )}
              value={coAuthors}
            />
            <label
              className="flex items-center gap-2 text-xs text-muted-foreground"
              htmlFor={commitIncludeUnstagedId}
            >
              <Checkbox
                checked={commitIncludeUnstaged}
                id={commitIncludeUnstagedId}
                onCheckedChange={(checked) => setCommitIncludeUnstaged(checked === true)}
              />
              <Trans id="git.review.includeUnstaged">Include unstaged changes</Trans>
            </label>
            <div className="flex gap-2">
              <Button
                disabled={busy || !canCommit}
                onClick={() =>
                  void mutate(async () => {
                    await commitChanges((await ensureCypheriaClient()).git, cwd, {
                      coAuthors: parseCoAuthors(coAuthors),
                      includeUnstaged: commitIncludeUnstaged,
                      message,
                      push: false,
                    })
                    setMessage("")
                  })
                }
                size="sm"
                type="button"
              >
                <Trans id="git.review.commit">Commit</Trans>
              </Button>
              <Button
                disabled={busy || !canCommit}
                onClick={() =>
                  void mutate(async () => {
                    await commitChanges((await ensureCypheriaClient()).git, cwd, {
                      coAuthors: parseCoAuthors(coAuthors),
                      includeUnstaged: commitIncludeUnstaged,
                      message,
                      push: true,
                    })
                    setMessage("")
                  })
                }
                size="sm"
                type="button"
                variant="outline"
              >
                <Trans id="git.review.commitAndPush">Commit and push</Trans>
              </Button>
              <Button
                disabled={busy || !status.data.head}
                onClick={() =>
                  void mutate(async () => (await ensureCypheriaClient()).git.push(cwd))
                }
                size="sm"
                type="button"
                variant="outline"
              >
                <Trans id="git.review.push">Push</Trans>
              </Button>
            </div>
          </div>
        </ReviewSection>
      ) : null}
      {status.data ? (
        <ReviewSection
          defaultOpen={false}
          title={i18n._(msg({ id: "git.review.branchesSection", message: "Branches" }))}
        >
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
                placeholder={i18n._(
                  msg({ id: "git.review.newBranch", message: "New branch name" })
                )}
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
        </ReviewSection>
      ) : null}
      {status.data?.head ? (
        <ReviewSection
          defaultOpen={false}
          title={i18n._(msg({ id: "git.review.worktreesSection", message: "Worktrees" }))}
        >
          <div className="space-y-2 border-t p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">
                <Trans id="git.review.worktrees">Worktrees</Trans>
              </span>
              <NativeSelect
                aria-label={i18n._(
                  msg({ id: "git.review.worktreeStart", message: "Worktree start point" })
                )}
                className="min-w-0 max-w-40"
                onChange={(event) => setWorktreeStartPoint(event.target.value)}
                size="sm"
                value={worktreeStartPoint}
              >
                <NativeSelectOption value="HEAD">HEAD</NativeSelectOption>
                {worktreeStartPoint !== "HEAD" &&
                !branches.data?.some((entry) => branchValue(entry) === worktreeStartPoint) ? (
                  <NativeSelectOption value={worktreeStartPoint}>
                    {worktreeStartPoint}
                  </NativeSelectOption>
                ) : null}
                {branches.data?.map((entry) => (
                  <NativeSelectOption
                    key={`${entry.scope}:${entry.name}`}
                    value={branchValue(entry)}
                  >
                    {entry.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button
                disabled={busy || worktreeJobRunning}
                onClick={() =>
                  void mutate(async () => {
                    const job = await (await ensureCypheriaClient()).git.startWorktreeJob(cwd, {
                      startPoint: worktreeStartPoint === "HEAD" ? undefined : worktreeStartPoint,
                      includeChanges: worktreeIncludeChanges,
                      environmentConfigPath: worktreeEnvironmentPath.trim() || null,
                    })
                    setWorktreeJobId(job.id)
                  })
                }
                size="sm"
                type="button"
                variant="outline"
              >
                <Trans id="git.review.createWorktree">Create worktree</Trans>
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs" htmlFor={worktreeChangesId}>
                <Checkbox
                  checked={worktreeIncludeChanges}
                  id={worktreeChangesId}
                  onCheckedChange={(checked) => setWorktreeIncludeChanges(checked === true)}
                />
                <Trans id="git.review.includeLocalChanges">Include local changes</Trans>
              </label>
              <Input
                aria-label={i18n._(
                  msg({
                    id: "git.review.environmentConfig",
                    message: "Local environment config path",
                  })
                )}
                className="min-w-40 flex-1"
                onChange={(event) => setWorktreeEnvironmentPath(event.target.value)}
                placeholder={i18n._(
                  msg({ id: "git.review.noEnvironment", message: "No local environment" })
                )}
                value={worktreeEnvironmentPath}
              />
            </div>
            {worktreeJob.data ? (
              <div className="space-y-1 rounded-md border p-2 text-xs">
                <p>
                  {worktreeJob.data.phase}
                  {worktreeJob.data.path ? ` · ${worktreeJob.data.path}` : ""}
                </p>
                {worktreeJob.data.error ? (
                  <p className="text-destructive">{worktreeJob.data.error}</p>
                ) : null}
                {worktreeJob.data.log ? (
                  <pre className="max-h-36 overflow-auto whitespace-pre-wrap">
                    {worktreeJob.data.log}
                  </pre>
                ) : null}
                <div className="flex gap-2">
                  {worktreeJobRunning ? (
                    <Button
                      onClick={() =>
                        void mutate(async () => {
                          await (await ensureCypheriaClient()).git.cancelWorktreeJob(
                            worktreeJob.data.id
                          )
                          await worktreeJob.refetch()
                        })
                      }
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Trans id="git.review.cancelWorktree">Cancel</Trans>
                    </Button>
                  ) : null}
                  {["failed", "cancelled"].includes(worktreeJob.data.phase) ? (
                    <>
                      <Button
                        onClick={() =>
                          void mutate(async () => {
                            await (await ensureCypheriaClient()).git.retryWorktreeJob(
                              worktreeJob.data.id
                            )
                            await worktreeJob.refetch()
                          })
                        }
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Trans id="git.review.retryWorktree">Retry</Trans>
                      </Button>
                      {worktreeJob.data.path ? (
                        <Button
                          onClick={() =>
                            void mutate(async () => {
                              await (await ensureCypheriaClient()).git.retryWorktreeJob(
                                worktreeJob.data.id,
                                true
                              )
                              await worktreeJob.refetch()
                            })
                          }
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          <Trans id="git.review.skipSetup">Skip setup</Trans>
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}
            {syncedBranch.data ? (
              <div className="space-y-1 rounded-md border p-2 text-xs">
                <p>
                  <Trans id="git.review.syncedBranch">Synced branch</Trans>:{" "}
                  {syncedBranch.data.branch}
                </p>
                {syncedBranch.data.branchHead !== syncedBranch.data.expectedHead ? (
                  <p className="text-destructive">
                    <Trans id="git.review.syncedBranchChanged">
                      The branch changed outside this worktree. Refresh before syncing.
                    </Trans>
                  </p>
                ) : null}
                <div className="flex gap-2">
                  <Button
                    disabled={
                      busy ||
                      (syncedBranch.data.branchHead === syncedBranch.data.worktreeHead &&
                        !syncedBranch.data.worktreeDirty) ||
                      syncedBranch.data.branchHead !== syncedBranch.data.expectedHead ||
                      syncedBranch.data.sourceDirty
                    }
                    onClick={() => setPendingSync("sync")}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Trans id="git.review.syncBranch">Sync worktree to branch</Trans>
                  </Button>
                  {syncedBranch.data.backupRef ? (
                    <Button
                      disabled={busy || syncedBranch.data.sourceDirty}
                      onClick={() => setPendingSync("undo")}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Trans id="git.review.undoSync">Undo last sync</Trans>
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {threadId ? (
              <label
                className="flex items-center gap-2 text-xs text-muted-foreground"
                htmlFor={moveChangesId}
              >
                <Checkbox
                  checked={moveChanges}
                  id={moveChangesId}
                  onCheckedChange={(checked) => setMoveChanges(checked === true)}
                />
                <Trans id="git.review.copyChangesOnMove">
                  Copy local changes when moving thread
                </Trans>
              </label>
            ) : null}
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
                        threadId,
                        { copyChanges: moveChanges }
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
                            threadId,
                            { copyChanges: moveChanges }
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
        </ReviewSection>
      ) : null}
      {origin.data?.provider === "gitlab" ? (
        <ReviewSection
          defaultOpen
          title={i18n._(msg({ id: "git.review.mergeRequestSection", message: "Merge request" }))}
        >
          <GitLabMrPanel
            branch={status.data?.branch ?? null}
            cwd={cwd}
            key={cwd}
            threadId={threadId}
          />
        </ReviewSection>
      ) : null}
      {origin.data?.provider === "github" ? (
        <ReviewSection
          defaultOpen
          title={i18n._(msg({ id: "git.review.pullRequestSection", message: "Pull request" }))}
        >
          <GitHubPrPanel
            branch={status.data?.branch ?? null}
            cwd={cwd}
            key={cwd}
            threadId={threadId}
          />
        </ReviewSection>
      ) : null}
      {actionError ? <p className="p-2 text-sm text-destructive">{actionError}</p> : null}
    </ChatReviewPanel>
  )
}
