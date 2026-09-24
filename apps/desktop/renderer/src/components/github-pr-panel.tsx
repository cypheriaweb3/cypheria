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
import { Checkbox } from "@cypheria/ui/components/checkbox"
import { Input } from "@cypheria/ui/components/input"
import { NativeSelect, NativeSelectOption } from "@cypheria/ui/components/native-select"
import { Textarea } from "@cypheria/ui/components/textarea"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useEffect, useState, useSyncExternalStore } from "react"

import { ensureCypheriaClient } from "../cypheria-client.js"
import { githubPrAssociations } from "../git-pr-associations.js"
import { type GitHubPrOperation, githubPrProvider } from "./github-pr-provider.js"
import { findGithubPrWatch, githubPrFixPrompt, githubPrWatchName } from "./github-pr-watch.js"

const openExternal = async (url: string): Promise<void> => {
  if (!window.cypheria) throw new Error("The system browser is unavailable")
  await window.cypheria.app.openExternal(url)
}
const githubMediaLinks = (body: string): Array<{ alt: string; url: string }> =>
  [
    ...body.matchAll(
      /!\[([^\]]*)\]\((https:\/\/private-user-images\.githubusercontent\.com\/[^)\s]+)\)/gu
    ),
  ]
    .map((match) => ({ alt: match[1] ?? "", url: match[2] ?? "" }))
    .filter(
      (item, index, items) => items.findIndex((candidate) => candidate.url === item.url) === index
    )
    .slice(0, 4)

export function GitHubPrPanel({
  cwd,
  branch,
  threadId,
}: Readonly<{ cwd: string; branch: string | null; threadId: string | null }>) {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const associations = useSyncExternalStore(
    githubPrAssociations.subscribe,
    githubPrAssociations.getSnapshot,
    githubPrAssociations.getServerSnapshot
  )
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null)
  const [directPrNumber, setDirectPrNumber] = useState("")
  const [prSearchText, setPrSearchText] = useState("")
  const [prSearchQuery, setPrSearchQuery] = useState("")
  const [prListState, setPrListState] = useState<"open" | "closed" | "merged" | "all">("open")
  const [prListScope, setPrListScope] = useState<"all" | "authored" | "reviewing">("all")
  const [prListLimit, setPrListLimit] = useState(100)
  const [boardRepository, setBoardRepository] = useState("all")
  const [boardRepositoryQuery, setBoardRepositoryQuery] = useState("")
  const [boardLimit, setBoardLimit] = useState(100)
  const [base, setBase] = useState("")
  const [newBranchName, setNewBranchName] = useState("")
  const [commitChanges, setCommitChanges] = useState(false)
  const [createCommitMessage, setCreateCommitMessage] = useState("")
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [draft, setDraft] = useState(true)
  const [editTitle, setEditTitle] = useState("")
  const [editBody, setEditBody] = useState<string | null>(null)
  const [commentBody, setCommentBody] = useState("")
  const [editingComment, setEditingComment] = useState<string | null>(null)
  const [commentEditBody, setCommentEditBody] = useState("")
  const [reviewBody, setReviewBody] = useState("")
  const [reviewer, setReviewer] = useState("")
  const [reviewerSearchQuery, setReviewerSearchQuery] = useState("")
  const [replyThreadId, setReplyThreadId] = useState<string | null>(null)
  const [replyBody, setReplyBody] = useState("")
  const [inlinePath, setInlinePath] = useState("")
  const [inlineLine, setInlineLine] = useState("")
  const [inlineSide, setInlineSide] = useState<"LEFT" | "RIGHT">("RIGHT")
  const [inlineBody, setInlineBody] = useState("")
  const [showDiff, setShowDiff] = useState(false)
  const [selectedRevision, setSelectedRevision] = useState<string | null>(null)
  const [showStack, setShowStack] = useState(false)
  const [attributesPath, setAttributesPath] = useState("")
  const [selectedAttributesPath, setSelectedAttributesPath] = useState<string | null>(null)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)
  const [createNeedsReview, setCreateNeedsReview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const gitSettings = useQuery({
    queryKey: ["settings", "git"],
    queryFn: async () => (await ensureCypheriaClient()).server.config(),
    staleTime: 30_000,
  })
  useEffect(() => {
    if (gitSettings.data) setDraft(gitSettings.data.config.git.createPullRequestAsDraft)
  }, [gitSettings.data])
  const selectPullRequest = (number: number) => {
    setEditTitle("")
    setEditBody(null)
    setCommentBody("")
    setEditingComment(null)
    setReviewBody("")
    setReviewer("")
    setReviewerSearchQuery("")
    setReplyThreadId(null)
    setReplyBody("")
    setInlinePath("")
    setInlineLine("")
    setInlineBody("")
    setShowDiff(false)
    setSelectedRevision(null)
    setShowStack(false)
    setAttributesPath("")
    setSelectedAttributesPath(null)
    setSelectedNumber(number)
  }
  const availability = useQuery({
    queryKey: ["github-pr", cwd, "availability"],
    queryFn: async () => (await ensureCypheriaClient()).git.githubAvailability(cwd),
    staleTime: 30_000,
    retry: false,
  })
  const branchContext = useQuery({
    enabled: Boolean(branch),
    queryKey: ["github-pr", cwd, "branch-context"],
    queryFn: async () => (await ensureCypheriaClient()).git.branchContext(cwd),
    refetchInterval: 10_000,
    retry: false,
  })
  useEffect(() => {
    if (!base && branchContext.data?.defaultBranch)
      setBase(branchContext.data.defaultBranch.replace(/^origin\//u, ""))
  }, [base, branchContext.data?.defaultBranch])
  const cliAvailable = Boolean(availability.data?.authenticated && availability.data.repository)
  const thread = useQuery({
    enabled: cliAvailable && Boolean(threadId),
    queryKey: ["thread", threadId, "github-pr-watch"],
    queryFn: async () => {
      if (!threadId) throw new Error("A local Codex thread is required")
      return (await ensureCypheriaClient()).threads.get(threadId)
    },
    retry: false,
  })
  const localCodexThread = thread.data?.agentId === "codex"
  const schedules = useQuery({
    enabled: localCodexThread,
    queryKey: ["cypheria", "schedules"],
    queryFn: async () => (await ensureCypheriaClient()).schedules.list(),
    retry: false,
  })
  const appAvailability = useQuery({
    enabled: Boolean(threadId) && (gitSettings.data?.config.git.githubConnectorEnabled ?? true),
    queryKey: ["github-pr", cwd, threadId, "app-availability"],
    queryFn: async () => {
      if (!threadId) throw new Error("A local Codex thread is required")
      return (await ensureCypheriaClient()).git.githubAppAvailability(cwd, threadId)
    },
    staleTime: 30_000,
    retry: false,
  })
  const appConnected = Boolean(
    appAvailability.data &&
      (appAvailability.data.available ||
        appAvailability.data.canList ||
        appAvailability.data.canRead ||
        appAvailability.data.canDiff ||
        appAvailability.data.canChecks ||
        appAvailability.data.canActivity ||
        appAvailability.data.canThreads)
  )
  const providerFor = (operation: GitHubPrOperation) =>
    githubPrProvider(
      operation,
      availability.data,
      appAvailability.data,
      Boolean(threadId),
      gitSettings.data?.config.git.githubConnectorEnabled ?? true
    )
  const listProvider = providerFor("list")
  const readProvider = providerFor("read")
  const diffProvider = providerFor("diff")
  const checksProvider = providerFor("checks")
  const activityProvider = providerFor("activity")
  const threadsProvider = providerFor("threads")
  const createProvider = providerFor("create")
  const board = useQuery({
    enabled:
      Boolean(availability.data?.authenticated) &&
      (!boardRepositoryQuery.trim() ||
        (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(boardRepositoryQuery.trim()) &&
          boardRepositoryQuery
            .trim()
            .split("/")
            .every((part) => part !== "." && part !== ".."))),
    queryKey: [
      "github-pr",
      "board",
      cwd,
      prListState,
      prListScope,
      prSearchQuery,
      boardRepositoryQuery,
      boardLimit,
    ],
    queryFn: async () =>
      (await ensureCypheriaClient()).git.githubPrBoard(cwd, {
        state: prListState,
        scope: prListScope,
        query: prSearchQuery,
        repository: boardRepositoryQuery.trim() || undefined,
        limit: boardLimit,
      }),
    retry: false,
  })
  const boardRepositories = [...new Set(board.data?.map((entry) => entry.repository) ?? [])].sort()
  const boardEntries =
    board.data?.filter(
      (entry) => boardRepository === "all" || entry.repository === boardRepository
    ) ?? []
  useEffect(() => {
    if (
      !availability.data?.authenticated &&
      appAvailability.data &&
      !appAvailability.data.canSearchByAccount
    )
      setPrListScope("all")
  }, [appAvailability.data, availability.data?.authenticated])
  const list = useQuery({
    enabled: listProvider !== null,
    queryKey: [
      "github-pr",
      cwd,
      "list",
      listProvider,
      threadId,
      prListState,
      prListScope,
      prSearchQuery,
      prListLimit,
    ],
    queryFn: async () => {
      const git = (await ensureCypheriaClient()).git
      if (listProvider === "cli") {
        const scopeQuery =
          prListScope === "authored"
            ? "author:@me"
            : prListScope === "reviewing"
              ? "review-requested:@me"
              : ""
        const items = await git.githubPrList(cwd, {
          state: prListState,
          query: [prSearchQuery, scopeQuery].filter(Boolean).join(" "),
          limit: prListLimit,
        })
        return { items, truncated: items.length === prListLimit }
      }
      if (!threadId) throw new Error("A local Codex thread is required")
      return git.githubAppPrList(cwd, threadId, {
        state: prListState,
        scope: prListScope,
        query: prSearchQuery,
        limit: Math.min(prListLimit, 100),
      })
    },
    retry: false,
  })
  const branchPr = useQuery({
    enabled: cliAvailable && Boolean(branch),
    queryKey: ["github-pr", cwd, "for-branch", branch],
    queryFn: async () => {
      if (!branch) throw new Error("A local Git branch is required")
      return (await ensureCypheriaClient()).git.githubPrForBranch(cwd, branch)
    },
    refetchInterval: 30_000,
    retry: false,
  })
  const activeNumber =
    selectedNumber ??
    branchPr.data?.number ??
    list.data?.items.find((item) => "headRefName" in item && item.headRefName === branch)?.number ??
    null
  const selected = useQuery({
    enabled: activeNumber !== null && readProvider !== null,
    queryKey: ["github-pr", cwd, "detail", readProvider, threadId, activeNumber],
    queryFn: async () => {
      if (activeNumber === null) throw new Error("A pull request number is required")
      const git = (await ensureCypheriaClient()).git
      if (readProvider === "cli") return git.githubPrRead(cwd, activeNumber)
      if (!threadId) throw new Error("A local Codex thread is required")
      return git.githubAppPrRead(cwd, threadId, activeNumber)
    },
    retry: false,
  })
  const mediaLinks = githubMediaLinks(selected.data?.body ?? "")
  const media = useQuery({
    enabled:
      !cliAvailable &&
      Boolean(
        threadId && appAvailability.data?.canMedia && selected.data?.headRefOid && mediaLinks.length
      ),
    queryKey: [
      "github-pr",
      cwd,
      "media",
      threadId,
      selected.data?.number,
      selected.data?.headRefOid,
      mediaLinks,
    ],
    queryFn: async () => {
      const pr = selected.data
      const head = pr?.headRefOid
      if (!threadId || !pr || !head)
        throw new Error("A local Codex thread and pull request head are required")
      const git = (await ensureCypheriaClient()).git
      return Promise.all(
        mediaLinks.map(async (link) => ({
          alt: link.alt,
          url: link.url,
          ...(await git.githubAppPrMedia(cwd, threadId, pr.number, head, link.url)),
        }))
      )
    },
    retry: false,
  })
  const prDiff = useQuery({
    enabled: showDiff && diffProvider !== null && Boolean(selected.data?.headRefOid),
    queryKey: [
      "github-pr",
      cwd,
      "diff",
      diffProvider,
      threadId,
      selected.data?.number,
      selected.data?.headRefOid,
    ],
    queryFn: async () => {
      const pr = selected.data
      if (!pr?.headRefOid) throw new Error("A pull request head is required")
      const git = (await ensureCypheriaClient()).git
      if (diffProvider === "cli") return git.githubPrDiff(cwd, pr.number, pr.headRefOid)
      if (!threadId) throw new Error("A local Codex thread is required")
      return git.githubAppPrDiff(cwd, threadId, pr.number, pr.headRefOid)
    },
    retry: false,
  })
  const revisionSnapshot = useQuery({
    enabled: cliAvailable && Boolean(selected.data?.headRefOid),
    queryKey: ["github-pr", cwd, "revisions", selected.data?.number, selected.data?.headRefOid],
    queryFn: async () => {
      const pr = selected.data
      if (!pr?.headRefOid) throw new Error("A pull request head is required")
      return (await ensureCypheriaClient()).git.githubPrRevisionSnapshot(
        cwd,
        pr.number,
        pr.headRefOid
      )
    },
    retry: false,
  })
  const revision = revisionSnapshot.data?.commits.find((commit) => commit.sha === selectedRevision)
  const revisionDiff = useQuery({
    enabled:
      cliAvailable && Boolean(selected.data?.headRefOid && revision && revisionSnapshot.data),
    queryKey: [
      "github-pr",
      cwd,
      "revision-diff",
      selected.data?.number,
      selected.data?.headRefOid,
      selectedRevision,
    ],
    queryFn: async () => {
      const pr = selected.data
      const snapshot = revisionSnapshot.data
      if (!pr?.headRefOid || !revision || !snapshot)
        throw new Error("A pull request revision is required")
      return (await ensureCypheriaClient()).git.githubPrRevisionDiff(
        cwd,
        pr.number,
        pr.headRefOid,
        revision.parentSha ?? snapshot.mergeBaseRevision,
        revision.sha
      )
    },
    retry: false,
  })
  const stack = useQuery({
    enabled: cliAvailable && showStack && Boolean(selected.data?.headRefOid),
    queryKey: ["github-pr", cwd, "stack", selected.data?.number, selected.data?.headRefOid],
    queryFn: async () => {
      const pr = selected.data
      if (!pr?.headRefOid) throw new Error("A pull request head is required")
      return (await ensureCypheriaClient()).git.githubPrStack(cwd, pr.number, pr.headRefOid)
    },
    retry: false,
  })
  const attributes = useQuery({
    enabled: cliAvailable && Boolean(selected.data?.headRefOid && selectedAttributesPath),
    queryKey: [
      "github-pr",
      cwd,
      "attributes",
      selected.data?.number,
      selected.data?.headRefOid,
      selectedAttributesPath,
    ],
    queryFn: async () => {
      const pr = selected.data
      if (!pr?.headRefOid || !selectedAttributesPath)
        throw new Error("A changed file path is required")
      return (await ensureCypheriaClient()).git.githubPrAttributes(cwd, pr.number, pr.headRefOid, [
        selectedAttributesPath,
      ])
    },
    retry: false,
  })
  const checks = useQuery({
    enabled:
      selected.data?.state === "OPEN" &&
      checksProvider !== null &&
      Boolean(selected.data?.headRefOid),
    queryKey: [
      "github-pr",
      cwd,
      "checks",
      checksProvider,
      threadId,
      selected.data?.number,
      selected.data?.headRefOid,
    ],
    queryFn: async () => {
      if (!selected.data) throw new Error("A pull request is required")
      const git = (await ensureCypheriaClient()).git
      if (checksProvider === "cli")
        return { checks: await git.githubPrChecks(cwd, selected.data.number), complete: true }
      if (!threadId || !selected.data.headRefOid)
        throw new Error("A local Codex thread and pull request head are required")
      return git.githubAppPrChecks(cwd, threadId, selected.data.number, selected.data.headRefOid)
    },
    refetchInterval: 30_000,
    retry: false,
  })
  const autoMerge = useQuery({
    enabled: cliAvailable && selected.data?.state === "OPEN",
    queryKey: ["github-pr", cwd, "auto-merge", selected.data?.number],
    queryFn: async () => {
      if (!selected.data) throw new Error("A pull request is required")
      return (await ensureCypheriaClient()).git.githubPrAutoMergeStatus(cwd, selected.data.number)
    },
    refetchInterval: 30_000,
    retry: false,
  })
  const activity = useQuery({
    enabled: activityProvider !== null && Boolean(selected.data?.headRefOid),
    queryKey: [
      "github-pr",
      cwd,
      "activity",
      activityProvider,
      threadId,
      selected.data?.number,
      selected.data?.headRefOid,
    ],
    queryFn: async () => {
      if (!selected.data) throw new Error("A pull request is required")
      const git = (await ensureCypheriaClient()).git
      if (activityProvider === "cli") return git.githubPrActivity(cwd, selected.data.number)
      if (!threadId || !selected.data.headRefOid)
        throw new Error("A local Codex thread and pull request head are required")
      return git.githubAppPrActivity(cwd, threadId, selected.data.number, selected.data.headRefOid)
    },
    retry: false,
  })
  const metadata = useQuery({
    enabled: cliAvailable && Boolean(selected.data?.headRefOid),
    queryKey: ["github-pr", cwd, "metadata", selected.data?.number, selected.data?.headRefOid],
    queryFn: async () => {
      const pr = selected.data
      if (!pr?.headRefOid) throw new Error("A pull request head is required")
      return (await ensureCypheriaClient()).git.githubPrMetadata(cwd, pr.number, pr.headRefOid)
    },
    retry: false,
  })
  const reviewStatus = useQuery({
    enabled: cliAvailable && Boolean(selected.data?.headRefOid),
    queryKey: ["github-pr", cwd, "review-status", selected.data?.number, selected.data?.headRefOid],
    queryFn: async () => {
      const pr = selected.data
      if (!pr?.headRefOid) throw new Error("A pull request head is required")
      return (await ensureCypheriaClient()).git.githubPrReviewStatus(cwd, pr.number, pr.headRefOid)
    },
    retry: false,
  })
  const reviewerCandidates = useQuery({
    enabled: cliAvailable && Boolean(selected.data?.headRefOid && reviewerSearchQuery),
    queryKey: [
      "github-pr",
      cwd,
      "reviewer-search",
      selected.data?.number,
      selected.data?.headRefOid,
      reviewerSearchQuery,
    ],
    queryFn: async () => {
      const pr = selected.data
      if (!pr?.headRefOid) throw new Error("A pull request head is required")
      return (await ensureCypheriaClient()).git.githubPrUserSearch(
        cwd,
        pr.number,
        pr.headRefOid,
        reviewerSearchQuery,
        "collaborators"
      )
    },
    retry: false,
  })
  const threads = useQuery({
    enabled: threadsProvider !== null && Boolean(selected.data?.headRefOid),
    queryKey: [
      "github-pr",
      cwd,
      "threads",
      threadsProvider,
      threadId,
      selected.data?.number,
      selected.data?.headRefOid,
    ],
    queryFn: async () => {
      const pr = selected.data
      if (!pr?.headRefOid) throw new Error("A pull request head is required")
      const git = (await ensureCypheriaClient()).git
      if (threadsProvider === "cli") return git.githubPrThreads(cwd, pr.number, pr.headRefOid)
      if (!threadId) throw new Error("A local Codex thread is required")
      return git.githubAppPrThreads(cwd, threadId, pr.number, pr.headRefOid)
    },
    retry: false,
  })
  const watch =
    selected.data && threadId && schedules.data
      ? findGithubPrWatch(schedules.data, threadId, selected.data)
      : null
  const mutate = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      await queryClient.invalidateQueries({ queryKey: ["github-pr", cwd] })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      await queryClient.invalidateQueries({ queryKey: ["github-pr", cwd] })
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
  const commentActions = (
    nodeId: string,
    commentType: "comment" | "review" | "review_comment",
    body: string,
    author: string | null
  ) => {
    const pr = selected.data
    if (
      !pr?.headRefOid ||
      !author ||
      author.toLowerCase() !== availability.data?.account?.toLowerCase()
    )
      return null
    const head = pr.headRefOid
    const key = `${commentType}:${nodeId}`
    const run = (action: "update" | "delete") =>
      void mutate(async () => {
        await (await ensureCypheriaClient()).git.githubPrCommentAction(cwd, {
          number: pr.number,
          expectedHead: head,
          nodeId,
          commentType,
          action,
          ...(action === "update" ? { body: commentEditBody } : {}),
        })
        setEditingComment(null)
      })
    return (
      <div className="space-y-1">
        {editingComment === key ? (
          <div className="space-y-1">
            <Textarea
              aria-label={i18n._(msg({ id: "git.github.editComment", message: "Edit comment" }))}
              onChange={(event) => setCommentEditBody(event.target.value)}
              rows={3}
              value={commentEditBody}
            />
            <div className="flex gap-1">
              <Button
                disabled={busy || !commentEditBody.trim()}
                onClick={() => run("update")}
                size="sm"
                type="button"
              >
                <Trans id="git.github.saveComment">Save</Trans>
              </Button>
              <Button
                onClick={() => setEditingComment(null)}
                size="sm"
                type="button"
                variant="ghost"
              >
                <Trans id="git.github.cancelCommentEdit">Cancel</Trans>
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-1">
            <Button
              disabled={busy}
              onClick={() => {
                setEditingComment(key)
                setCommentEditBody(body)
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Trans id="git.github.editComment">Edit comment</Trans>
            </Button>
            {commentType !== "review" ? (
              <AlertDialog>
                <AlertDialogTrigger render={<Button disabled={busy} size="sm" variant="ghost" />}>
                  <Trans id="git.github.deleteComment">Delete</Trans>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      <Trans id="git.github.deleteCommentTitle">Delete comment?</Trans>
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      <Trans id="git.github.deleteCommentDescription">
                        This removes the comment from GitHub.
                      </Trans>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>
                      <Trans id="git.github.cancelCommentEdit">Cancel</Trans>
                    </AlertDialogCancel>
                    <AlertDialogAction onClick={() => run("delete")}>
                      <Trans id="git.github.deleteComment">Delete</Trans>
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
          </div>
        )}
      </div>
    )
  }

  return (
    <section
      aria-label={i18n._(msg({ id: "git.github.heading", message: "GitHub pull requests" }))}
      className="space-y-2 border-t p-2"
    >
      <p className="text-xs font-medium">
        <Trans id="git.github.heading">GitHub pull requests</Trans>
      </p>
      {availability.data?.error && !appConnected ? (
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
      {appConnected ? (
        <p className="text-xs text-muted-foreground">
          <Trans id="git.github.connectedApp">Connected GitHub App</Trans> ·{" "}
          {appAvailability.data?.repository}
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
      {cliAvailable || appAvailability.data?.canList ? (
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label={i18n._(msg({ id: "git.github.search", message: "Search pull requests" }))}
            className="min-w-40 flex-1"
            maxLength={170}
            onChange={(event) => setPrSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                setPrListLimit(100)
                setPrSearchQuery(prSearchText.trim())
              }
            }}
            placeholder={i18n._(msg({ id: "git.github.search", message: "Search pull requests" }))}
            value={prSearchText}
          />
          <NativeSelect
            aria-label={i18n._(msg({ id: "git.github.listState", message: "Pull request state" }))}
            onChange={(event) => {
              setPrListLimit(100)
              setPrListState(event.target.value as typeof prListState)
            }}
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
          <NativeSelect
            aria-label={i18n._(
              msg({ id: "git.github.listScope", message: "Pull request involvement" })
            )}
            onChange={(event) => {
              setPrListLimit(100)
              setPrListScope(event.target.value as typeof prListScope)
            }}
            size="sm"
            value={prListScope}
          >
            <NativeSelectOption value="all">
              <Trans id="git.github.scopeAll">All</Trans>
            </NativeSelectOption>
            <NativeSelectOption
              disabled={
                !availability.data?.authenticated && !appAvailability.data?.canSearchByAccount
              }
              value="authored"
            >
              <Trans id="git.github.scopeAuthored">Created by me</Trans>
            </NativeSelectOption>
            <NativeSelectOption
              disabled={
                !availability.data?.authenticated && !appAvailability.data?.canSearchByAccount
              }
              value="reviewing"
            >
              <Trans id="git.github.scopeReviewing">Review requested</Trans>
            </NativeSelectOption>
          </NativeSelect>
          <Button
            onClick={() => {
              setPrListLimit(100)
              setPrSearchQuery(prSearchText.trim())
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            <Trans id="git.github.searchAction">Search</Trans>
          </Button>
        </div>
      ) : null}
      {!cliAvailable && appAvailability.data?.canRead && !appAvailability.data.canList ? (
        <div className="flex gap-2">
          <Input
            aria-label={i18n._(msg({ id: "git.github.prNumber", message: "Pull request number" }))}
            min={1}
            onChange={(event) => setDirectPrNumber(event.target.value)}
            type="number"
            value={directPrNumber}
          />
          <Button
            disabled={!Number.isSafeInteger(Number(directPrNumber)) || Number(directPrNumber) < 1}
            onClick={() => selectPullRequest(Number(directPrNumber))}
            size="sm"
            type="button"
            variant="outline"
          >
            <Trans id="git.github.openPr">Open PR</Trans>
          </Button>
        </div>
      ) : null}
      {board.data ? (
        <div className="space-y-2 rounded-md border p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium">
              <Trans id="git.github.board">Pull requests across repositories</Trans>
            </span>
            <NativeSelect
              aria-label={i18n._(
                msg({ id: "git.github.repositoryFilter", message: "Repository filter" })
              )}
              onChange={(event) => setBoardRepository(event.target.value)}
              size="sm"
              value={boardRepository}
            >
              <NativeSelectOption value="all">
                <Trans id="git.github.allRepositories">All repositories</Trans>
              </NativeSelectOption>
              {boardRepositories.map((repository) => (
                <NativeSelectOption key={repository} value={repository}>
                  {repository}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <Input
            aria-label={i18n._(
              msg({ id: "git.github.boardRepositorySearch", message: "Repository (owner/name)" })
            )}
            onChange={(event) => {
              setBoardRepositoryQuery(event.target.value)
              setBoardRepository("all")
              setBoardLimit(100)
            }}
            placeholder={i18n._(
              msg({ id: "git.github.boardRepositorySearch", message: "Repository (owner/name)" })
            )}
            value={boardRepositoryQuery}
          />
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {boardEntries.map((entry) => (
              <div className="flex items-center gap-1" key={entry.url}>
                <Button
                  className="h-auto min-w-0 flex-1 justify-start truncate text-left"
                  onClick={() => void openExternal(entry.url)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {entry.repository} #{entry.number} · {entry.title}
                </Button>
                {threadId ? (
                  <Button
                    onClick={() =>
                      githubPrAssociations.add(threadId, {
                        number: entry.number,
                        title: entry.title,
                        url: entry.url,
                      })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Trans id="git.github.attachThread">Attach to chat</Trans>
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
          {board.data.length === boardLimit && boardLimit < 500 ? (
            <Button
              disabled={board.isFetching}
              onClick={() => setBoardLimit((limit) => Math.min(limit + 100, 500))}
              size="sm"
              type="button"
              variant="outline"
            >
              <Trans id="git.github.loadMore">Load more pull requests</Trans>
            </Button>
          ) : null}
        </div>
      ) : null}
      {board.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{board.error.message}</AlertDescription>
        </Alert>
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
          variant={activeNumber === pr.number ? "secondary" : "ghost"}
        >
          #{pr.number} {pr.title}
          {"headRefName" in pr && "baseRefName" in pr
            ? ` · ${pr.headRefName} → ${pr.baseRefName}`
            : null}
        </Button>
      ))}
      {list.data?.truncated ? (
        cliAvailable && prListLimit < 500 ? (
          <Button
            disabled={list.isFetching}
            onClick={() => setPrListLimit((limit) => Math.min(limit + 100, 500))}
            size="sm"
            type="button"
            variant="outline"
          >
            <Trans id="git.github.loadMore">Load more pull requests</Trans>
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            <Trans id="git.github.listTruncated">Showing the most recent pull requests</Trans>
          </p>
        )
      ) : null}
      {list.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{list.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {branchPr.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{branchPr.error.message}</AlertDescription>
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
          {threadId ? (
            <Button
              onClick={() => {
                if (!selected.data) return
                if (associations[threadId]?.some((item) => item.url === selected.data.url))
                  githubPrAssociations.remove(threadId, selected.data.url)
                else
                  githubPrAssociations.add(threadId, {
                    number: selected.data.number,
                    title: selected.data.title,
                    url: selected.data.url,
                  })
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              {associations[threadId]?.some((item) => item.url === selected.data.url) ? (
                <Trans id="git.github.detachThread">Detach from chat</Trans>
              ) : (
                <Trans id="git.github.attachThread">Attach to chat</Trans>
              )}
            </Button>
          ) : null}
          {githubPrAssociations.forPullRequest(selected.data.url).length ? (
            <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <Trans id="git.github.linkedChats">Linked chats:</Trans>
              {githubPrAssociations
                .forPullRequest(selected.data.url)
                .map(({ threadId: linkedThreadId }) => (
                  <Button
                    key={linkedThreadId}
                    onClick={() => void navigate({ search: { thread: linkedThreadId }, to: "/" })}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {linkedThreadId.slice(0, 8)}
                  </Button>
                ))}
            </div>
          ) : null}
          <p className="text-xs whitespace-pre-wrap">{selected.data.body}</p>
          {media.data?.map((item) => (
            <img
              alt={item.alt}
              className="max-h-64 max-w-full rounded border object-contain"
              key={item.url}
              loading="lazy"
              src={`data:${item.mimeType};base64,${item.contentsBase64}`}
            />
          ))}
          {media.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{media.error.message}</AlertDescription>
            </Alert>
          ) : null}
          {metadata.data ? (
            <p className="text-xs text-muted-foreground">
              +{metadata.data.additions ?? 0} / -{metadata.data.deletions ?? 0} ·{" "}
              {metadata.data.changedFiles ?? 0} files ·{" "}
              {metadata.data.allowedMergeMethods.join(", ")}
            </p>
          ) : null}
          {metadata.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{metadata.error.message}</AlertDescription>
            </Alert>
          ) : null}
          {selected.data.headRefOid && (cliAvailable || appAvailability.data?.canDiff) ? (
            <div className="space-y-2 border-t pt-2">
              <Button
                onClick={() => setShowDiff((value) => !value)}
                size="sm"
                type="button"
                variant="outline"
              >
                <Trans id="git.github.codeChanges">Code changes</Trans>
              </Button>
              {showDiff ? (
                <div className="space-y-2">
                  <pre className="max-h-96 overflow-auto rounded border p-2 text-xs whitespace-pre-wrap">
                    {prDiff.isError
                      ? prDiff.error.message
                      : (prDiff.data ??
                        i18n._(msg({ id: "git.github.diffLoading", message: "Loading diff…" })))}
                  </pre>
                  {cliAvailable ? (
                    <div className="flex gap-1">
                      <Input
                        aria-label={i18n._(
                          msg({
                            id: "git.github.attributesPath",
                            message: "Changed file path for attributes",
                          })
                        )}
                        onChange={(event) => setAttributesPath(event.target.value)}
                        placeholder={i18n._(
                          msg({
                            id: "git.github.attributesPath",
                            message: "Changed file path for attributes",
                          })
                        )}
                        value={attributesPath}
                      />
                      <Button
                        disabled={!attributesPath.trim()}
                        onClick={() => setSelectedAttributesPath(attributesPath.trim())}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Trans id="git.github.loadAttributes">Load attributes</Trans>
                      </Button>
                    </div>
                  ) : null}
                  {cliAvailable
                    ? attributes.data?.map((file) => (
                        <pre
                          className="overflow-auto rounded border p-2 text-xs whitespace-pre-wrap"
                          key={file.basePath}
                        >
                          {file.basePath || "."}/.gitattributes{"\n"}
                          {file.contents}
                        </pre>
                      ))
                    : null}
                  {cliAvailable && attributes.isError ? (
                    <Alert variant="destructive">
                      <AlertDescription>{attributes.error.message}</AlertDescription>
                    </Alert>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {cliAvailable && selected.data.headRefOid ? (
            <div className="space-y-1 border-t pt-2">
              <Button
                onClick={() => setShowStack((value) => !value)}
                size="sm"
                type="button"
                variant="outline"
              >
                <Trans id="git.github.stack">Pull request stack</Trans>
              </Button>
              {showStack
                ? stack.data?.map((entry) => (
                    <p className="text-xs" key={entry.number}>
                      #{entry.number} {entry.title} · {entry.baseBranch} → {entry.headBranch}
                      {entry.parentNumber ? ` · #${entry.parentNumber}` : ""}
                    </p>
                  ))
                : null}
              {showStack && stack.isError ? (
                <Alert variant="destructive">
                  <AlertDescription>{stack.error.message}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}
          {cliAvailable && selected.data.headRefOid ? (
            <div className="space-y-1 border-t pt-2">
              <p className="text-xs font-medium">
                <Trans id="git.github.revisions">Revisions</Trans>
              </p>
              {revisionSnapshot.data?.commits.map((commit) => (
                <Button
                  key={commit.sha}
                  onClick={() =>
                    setSelectedRevision(commit.sha === selectedRevision ? null : commit.sha)
                  }
                  size="sm"
                  type="button"
                  variant={commit.sha === selectedRevision ? "secondary" : "ghost"}
                >
                  <span className="font-mono">{commit.sha.slice(0, 7)}</span> {commit.title}
                </Button>
              ))}
              {revision ? (
                <pre className="max-h-96 overflow-auto rounded border p-2 text-xs whitespace-pre-wrap">
                  {revisionDiff.isError
                    ? revisionDiff.error.message
                    : (revisionDiff.data ??
                      i18n._(msg({ id: "git.github.diffLoading", message: "Loading diff…" })))}
                </pre>
              ) : null}
              {revisionSnapshot.isError ? (
                <Alert variant="destructive">
                  <AlertDescription>{revisionSnapshot.error.message}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}
          {selected.data.state === "OPEN" && (cliAvailable || appAvailability.data?.canChecks) ? (
            <div className="space-y-1 border-t pt-2">
              <p className="text-xs font-medium">
                <Trans id="git.github.checks">Checks</Trans>
              </p>
              {checks.data?.checks.length === 0 && checks.data.complete ? (
                <p className="text-xs text-muted-foreground">
                  <Trans id="git.github.noChecks">No checks</Trans>
                </p>
              ) : null}
              {checks.data?.checks.map((check) => (
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
              {reviewStatus.data ? (
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>
                    <Trans id="git.github.reviewDecision">Review decision</Trans>:{" "}
                    {reviewStatus.data.reviewDecision ?? "—"}
                  </p>
                  {reviewStatus.data.reviewRequests.map((request) => (
                    <p key={`${request.type}:${request.login}`}>
                      {request.type}: {request.login}
                    </p>
                  ))}
                  {reviewStatus.data.truncated ? (
                    <p>
                      <Trans id="git.github.reviewsTruncated">
                        More reviews are available on GitHub.
                      </Trans>
                    </p>
                  ) : null}
                </div>
              ) : null}
              {reviewStatus.isError ? (
                <Alert variant="destructive">
                  <AlertDescription>{reviewStatus.error.message}</AlertDescription>
                </Alert>
              ) : null}
              {activity.data?.comments.map((comment) => (
                <div className="rounded border p-2 text-xs" key={comment.id}>
                  <span className="font-medium">{comment.author ?? "GitHub"}</span>
                  <p className="whitespace-pre-wrap">{comment.body}</p>
                  {commentActions(comment.id, "comment", comment.body, comment.author)}
                </div>
              ))}
              {activity.data?.reviews.map((review) => (
                <div className="rounded border p-2 text-xs" key={review.id}>
                  <span className="font-medium">{review.author ?? "GitHub"}</span> · {review.state}
                  {review.body ? <p className="whitespace-pre-wrap">{review.body}</p> : null}
                  {commentActions(review.id, "review", review.body, review.author)}
                </div>
              ))}
              {activity.isError ? (
                <Alert variant="destructive">
                  <AlertDescription>{activity.error.message}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}
          {!cliAvailable && appAvailability.data?.canActivity && selected.data.headRefOid ? (
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
          {!cliAvailable && appAvailability.data?.canThreads && selected.data.headRefOid ? (
            <div className="space-y-2 border-t pt-2">
              <p className="text-xs font-medium">
                <Trans id="git.github.reviewThreads">Review threads</Trans>
              </p>
              {threads.data?.threads.map((thread) => (
                <div className="space-y-1 rounded border p-2 text-xs" key={thread.id}>
                  <p className="font-mono text-muted-foreground">
                    {thread.path}
                    {thread.line ? `:${thread.line}` : ""} ·{" "}
                    {thread.isResolved
                      ? i18n._(msg({ id: "git.github.resolved", message: "Resolved" }))
                      : i18n._(msg({ id: "git.github.unresolved", message: "Unresolved" }))}
                  </p>
                  {thread.comments.map((comment) => (
                    <div className="border-l pl-2" key={comment.id}>
                      <span className="font-medium">{comment.author ?? "GitHub"}</span>
                      <p className="whitespace-pre-wrap">{comment.body}</p>
                    </div>
                  ))}
                </div>
              ))}
              {threads.isError ? (
                <Alert variant="destructive">
                  <AlertDescription>{threads.error.message}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}
          {cliAvailable && selected.data.headRefOid ? (
            <div className="space-y-2 border-t pt-2">
              <p className="text-xs font-medium">
                <Trans id="git.github.reviewThreads">Review threads</Trans>
              </p>
              {threads.data?.threads.map((thread) => (
                <div className="space-y-2 rounded border p-2 text-xs" key={thread.id}>
                  <p className="font-mono text-muted-foreground">
                    {thread.path}
                    {thread.line ? `:${thread.line}` : ""} ·{" "}
                    {thread.isResolved
                      ? i18n._(msg({ id: "git.github.resolved", message: "Resolved" }))
                      : i18n._(msg({ id: "git.github.unresolved", message: "Unresolved" }))}
                  </p>
                  {thread.comments.map((comment) => (
                    <div className="border-l pl-2" key={comment.id}>
                      <span className="font-medium">{comment.author ?? "GitHub"}</span>
                      <p className="whitespace-pre-wrap">{comment.body}</p>
                      {commentActions(comment.id, "review_comment", comment.body, comment.author)}
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-1">
                    <Button
                      disabled={busy || selected.data.state !== "OPEN"}
                      onClick={() => {
                        setReplyThreadId(thread.id)
                        setReplyBody("")
                      }}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Trans id="git.github.reply">Reply</Trans>
                    </Button>
                    {(thread.isResolved ? thread.canUnresolve : thread.canResolve) ? (
                      <Button
                        disabled={busy || selected.data.state !== "OPEN"}
                        onClick={() =>
                          void mutate(async () => {
                            const head = selected.data.headRefOid
                            if (!head) throw new Error("A pull request head is required")
                            await (await ensureCypheriaClient()).git.githubPrThreadAction(cwd, {
                              number: selected.data.number,
                              expectedHead: head,
                              action: thread.isResolved ? "unresolve" : "resolve",
                              threadId: thread.id,
                            })
                          })
                        }
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {thread.isResolved ? (
                          <Trans id="git.github.reopenThread">Reopen thread</Trans>
                        ) : (
                          <Trans id="git.github.resolveThread">Resolve thread</Trans>
                        )}
                      </Button>
                    ) : null}
                  </div>
                  {replyThreadId === thread.id ? (
                    <div className="space-y-1">
                      <Textarea
                        aria-label={i18n._(
                          msg({ id: "git.github.replyBody", message: "Review thread reply" })
                        )}
                        onChange={(event) => setReplyBody(event.target.value)}
                        rows={2}
                        value={replyBody}
                      />
                      <Button
                        disabled={busy || !replyBody.trim()}
                        onClick={() =>
                          void mutate(async () => {
                            const head = selected.data.headRefOid
                            if (!head) throw new Error("A pull request head is required")
                            await (await ensureCypheriaClient()).git.githubPrThreadAction(cwd, {
                              number: selected.data.number,
                              expectedHead: head,
                              action: "reply",
                              threadId: thread.id,
                              body: replyBody,
                            })
                            setReplyThreadId(null)
                            setReplyBody("")
                          })
                        }
                        size="sm"
                        type="button"
                      >
                        <Trans id="git.github.postReply">Post reply</Trans>
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
              {threads.data?.truncated ? (
                <p className="text-xs text-muted-foreground">
                  <Trans id="git.github.threadsTruncated">
                    More review threads are available on GitHub.
                  </Trans>
                </p>
              ) : null}
              {threads.isError ? (
                <Alert variant="destructive">
                  <AlertDescription>{threads.error.message}</AlertDescription>
                </Alert>
              ) : null}
              {selected.data.state === "OPEN" ? (
                <div className="space-y-2 rounded border p-2">
                  <p className="text-xs font-medium">
                    <Trans id="git.github.inlineComment">Comment on a changed line</Trans>
                  </p>
                  <div className="flex gap-2">
                    <Input
                      aria-label={i18n._(
                        msg({ id: "git.github.inlinePath", message: "Changed file path" })
                      )}
                      onChange={(event) => setInlinePath(event.target.value)}
                      placeholder={i18n._(
                        msg({ id: "git.github.inlinePath", message: "Changed file path" })
                      )}
                      value={inlinePath}
                    />
                    <Input
                      aria-label={i18n._(
                        msg({ id: "git.github.inlineLine", message: "Diff line number" })
                      )}
                      min={1}
                      onChange={(event) => setInlineLine(event.target.value)}
                      placeholder={i18n._(
                        msg({ id: "git.github.inlineLine", message: "Diff line number" })
                      )}
                      type="number"
                      value={inlineLine}
                    />
                    <NativeSelect
                      aria-label={i18n._(
                        msg({ id: "git.github.inlineSide", message: "Diff side" })
                      )}
                      onChange={(event) => setInlineSide(event.target.value as "LEFT" | "RIGHT")}
                      size="sm"
                      value={inlineSide}
                    >
                      <NativeSelectOption value="RIGHT">
                        <Trans id="git.github.newSide">New</Trans>
                      </NativeSelectOption>
                      <NativeSelectOption value="LEFT">
                        <Trans id="git.github.oldSide">Old</Trans>
                      </NativeSelectOption>
                    </NativeSelect>
                  </div>
                  <Textarea
                    aria-label={i18n._(
                      msg({ id: "git.github.inlineBody", message: "Inline comment" })
                    )}
                    onChange={(event) => setInlineBody(event.target.value)}
                    rows={2}
                    value={inlineBody}
                  />
                  <Button
                    disabled={
                      busy ||
                      !inlinePath.trim() ||
                      !Number.isInteger(Number(inlineLine)) ||
                      Number(inlineLine) < 1 ||
                      !inlineBody.trim()
                    }
                    onClick={() =>
                      void mutate(async () => {
                        const head = selected.data.headRefOid
                        if (!head) throw new Error("A pull request head is required")
                        await (await ensureCypheriaClient()).git.githubPrThreadAction(cwd, {
                          number: selected.data.number,
                          expectedHead: head,
                          action: "inline",
                          path: inlinePath.trim(),
                          line: Number(inlineLine),
                          side: inlineSide,
                          body: inlineBody,
                        })
                        setInlineBody("")
                      })
                    }
                    size="sm"
                    type="button"
                  >
                    <Trans id="git.github.postInline">Post inline comment</Trans>
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          {cliAvailable && selected.data.state === "OPEN" && selected.data.headRefOid ? (
            <div className="space-y-2 border-t pt-2">
              <Input
                aria-label={i18n._(
                  msg({ id: "git.github.reviewer", message: "Reviewer login or team" })
                )}
                onChange={(event) => setReviewer(event.target.value)}
                placeholder={i18n._(
                  msg({ id: "git.github.reviewer", message: "Reviewer login or team" })
                )}
                value={reviewer}
              />
              <Button
                disabled={!reviewer.trim()}
                onClick={() => setReviewerSearchQuery(reviewer.trim())}
                size="sm"
                type="button"
                variant="ghost"
              >
                <Trans id="git.github.searchReviewers">Search reviewers</Trans>
              </Button>
              {reviewerCandidates.data?.map((candidate) => (
                <Button
                  key={candidate.login}
                  onClick={() => setReviewer(candidate.login)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {candidate.login}
                </Button>
              ))}
              {reviewerCandidates.isError ? (
                <Alert variant="destructive">
                  <AlertDescription>{reviewerCandidates.error.message}</AlertDescription>
                </Alert>
              ) : null}
              <div className="flex gap-2">
                {(["add", "remove"] as const).map((action) => (
                  <Button
                    disabled={busy || !reviewer.trim()}
                    key={action}
                    onClick={() => {
                      const head = selected.data.headRefOid
                      if (!head) return
                      void mutate(async () => {
                        await (await ensureCypheriaClient()).git.githubPrReviewer(
                          cwd,
                          selected.data.number,
                          head,
                          reviewer.trim(),
                          action
                        )
                        setReviewer("")
                      })
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {action === "add" ? (
                      <Trans id="git.github.requestReviewer">Request reviewer</Trans>
                    ) : (
                      <Trans id="git.github.removeReviewer">Remove reviewer</Trans>
                    )}
                  </Button>
                ))}
              </div>
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
            {cliAvailable &&
            localCodexThread &&
            threadId &&
            selected.data.state === "OPEN" &&
            selected.data.headRefOid &&
            gitSettings.data ? (
              <>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void mutate(async () => {
                      await (await ensureCypheriaClient()).threads.startTurn({
                        clientMessageId: crypto.randomUUID(),
                        content: [
                          {
                            type: "text",
                            text: githubPrFixPrompt(
                              selected.data,
                              gitSettings.data.config.git,
                              false
                            ),
                          },
                        ],
                        threadId,
                      })
                    })
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Trans id="git.github.fixPr">Fix PR</Trans>
                </Button>
                {watch ? (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void mutate(async () => {
                        const client = await ensureCypheriaClient()
                        if (watch.status === "paused") await client.schedules.resume(watch.id)
                        else await client.schedules.pause(watch.id)
                        await queryClient.invalidateQueries({ queryKey: ["cypheria", "schedules"] })
                      })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {watch.status === "paused" ? (
                      <Trans id="git.github.resumeWatch">Resume watch</Trans>
                    ) : (
                      <Trans id="git.github.pauseWatch">Pause watch</Trans>
                    )}
                  </Button>
                ) : (
                  <Button
                    disabled={busy || !schedules.isSuccess || !availability.data?.repository}
                    onClick={() =>
                      void mutate(async () => {
                        const repository = availability.data?.repository
                        if (!repository) throw new Error("GitHub repository is unavailable")
                        await (await ensureCypheriaClient()).schedules.create({
                          cadence: { type: "interval", everyMs: 600_000 },
                          name: githubPrWatchName(repository, selected.data.number),
                          target: {
                            type: "thread",
                            threadId,
                            content: [
                              {
                                type: "text",
                                text: githubPrFixPrompt(
                                  selected.data,
                                  gitSettings.data.config.git,
                                  true
                                ),
                              },
                            ],
                          },
                        })
                        await queryClient.invalidateQueries({ queryKey: ["cypheria", "schedules"] })
                      })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Trans id="git.github.watchPr">Watch and fix</Trans>
                  </Button>
                )}
              </>
            ) : null}
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
                            gitSettings.data?.config.git.pullRequestMergeMethod ?? "merge"
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
              <Button
                disabled={busy || !autoMerge.isSuccess}
                onClick={() => {
                  const head = selected.data.headRefOid
                  if (!head) return
                  void mutate(async () => {
                    await (await ensureCypheriaClient()).git.githubPrToggleAutoMerge(
                      cwd,
                      selected.data.number,
                      head,
                      !autoMerge.data,
                      gitSettings.data?.config.git.pullRequestMergeMethod ?? "merge"
                    )
                  })
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {autoMerge.data ? (
                  <Trans id="git.github.disableAutoMerge">Disable auto merge</Trans>
                ) : (
                  <Trans id="git.github.enableAutoMerge">Enable auto merge</Trans>
                )}
              </Button>
            ) : null}
            {autoMerge.isError ? (
              <Alert variant="destructive">
                <AlertDescription>{autoMerge.error.message}</AlertDescription>
              </Alert>
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
                    const head = selected.data.headRefOid
                    if (!head) throw new Error("A pull request head is required")
                    await (await ensureCypheriaClient()).git.githubPrUpdate(
                      cwd,
                      selected.data.number,
                      {
                        expectedHead: head,
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
      {createProvider ? (
        <div className="space-y-2 border-t pt-2">
          <p className="text-xs text-muted-foreground">
            <Trans id="git.github.createHint">Create from the pushed current branch</Trans>
          </p>
          {branch && (!branchContext.data?.upstream || branchContext.data.ahead > 0) ? (
            <Button
              disabled={busy}
              onClick={() =>
                void mutate(async () => {
                  await (await ensureCypheriaClient()).git.push(cwd, {
                    remote: "origin",
                    branch,
                    setUpstream: !branchContext.data?.upstream,
                  })
                })
              }
              size="sm"
              type="button"
              variant="outline"
            >
              <Trans id="git.github.pushBranch">Push current branch</Trans>
            </Button>
          ) : null}
          {branchPr.data?.state === "OPEN" ? (
            <p className="text-xs text-muted-foreground">
              <Trans id="git.github.existingBranchPr">
                The current branch already has an open pull request.
              </Trans>
            </p>
          ) : null}
          {createNeedsReview ? (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center gap-2">
                <Trans id="git.github.createUncertain">
                  The result of the create request is uncertain. Check GitHub for an existing pull
                  request before trying again.
                </Trans>
                <Button
                  onClick={() => setCreateNeedsReview(false)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Trans id="git.github.checkedRemote">I checked GitHub</Trans>
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          <Input
            aria-label={i18n._(msg({ id: "git.github.base", message: "Base branch" }))}
            onChange={(event) => setBase(event.target.value)}
            placeholder={i18n._(msg({ id: "git.github.base", message: "Base branch" }))}
            value={base}
          />
          <Input
            aria-label={i18n._(
              msg({ id: "git.github.newBranch", message: "New branch (optional)" })
            )}
            onChange={(event) => setNewBranchName(event.target.value)}
            placeholder={i18n._(
              msg({ id: "git.github.newBranch", message: "New branch (optional)" })
            )}
            value={newBranchName}
          />
          <label
            className="flex items-center gap-2 text-xs text-muted-foreground"
            htmlFor="git-create-pr-commit-changes"
          >
            <Checkbox
              checked={commitChanges}
              id="git-create-pr-commit-changes"
              onCheckedChange={(checked) => setCommitChanges(checked === true)}
            />
            <Trans id="git.github.commitChanges">Commit local changes before creating</Trans>
          </label>
          {commitChanges ? (
            <Input
              aria-label={i18n._(
                msg({
                  id: "git.github.commitMessage",
                  message: "Commit message (leave blank to generate)",
                })
              )}
              onChange={(event) => setCreateCommitMessage(event.target.value)}
              placeholder={i18n._(
                msg({
                  id: "git.github.commitMessage",
                  message: "Commit message (leave blank to generate)",
                })
              )}
              value={createCommitMessage}
            />
          ) : null}
          <div className="flex gap-2">
            <Input
              aria-label={i18n._(msg({ id: "git.github.title", message: "Pull request title" }))}
              className="min-w-0 flex-1"
              onChange={(event) => setTitle(event.target.value)}
              placeholder={i18n._(msg({ id: "git.github.title", message: "Pull request title" }))}
              value={title}
            />
            <Button
              disabled={busy || !base.trim()}
              onClick={() =>
                void mutate(async () => {
                  const generated = await (await ensureCypheriaClient()).git.generateText(
                    cwd,
                    "pull-request",
                    base.trim()
                  )
                  setTitle(generated.title)
                  setBody(generated.body)
                })
              }
              size="sm"
              type="button"
              variant="outline"
            >
              <Trans id="git.github.generateDescription">Generate</Trans>
            </Button>
          </div>
          <Textarea
            aria-label={i18n._(msg({ id: "git.github.body", message: "Pull request body" }))}
            onChange={(event) => setBody(event.target.value)}
            placeholder={i18n._(msg({ id: "git.github.body", message: "Pull request body" }))}
            rows={3}
            value={body}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={
                busy ||
                createNeedsReview ||
                (!branch && !newBranchName.trim()) ||
                !base.trim() ||
                (!newBranchName.trim() && branchPr.data?.state === "OPEN")
              }
              onClick={() =>
                void mutate(async () => {
                  const git = (await ensureCypheriaClient()).git
                  let head = branch
                  if (newBranchName.trim()) {
                    head = await git.createBranch(cwd, newBranchName.trim())
                    await git.checkout(cwd, head, true)
                  }
                  if (!head) throw new Error("A local Git branch is required")
                  if (commitChanges) {
                    const state = await git.status(cwd)
                    if (state.entries.length) {
                      const commitTitle =
                        createCommitMessage.trim() || (await git.generateText(cwd, "commit")).title
                      await git.commit(cwd, { message: commitTitle, includeUnstaged: true })
                    }
                  }
                  if (cliAvailable) {
                    const existing = await git.githubPrForBranch(cwd, head)
                    if (existing?.state === "OPEN") {
                      selectPullRequest(existing.number)
                      setCreateNeedsReview(false)
                      return
                    }
                  } else if (
                    createProvider === "app" &&
                    appAvailability.data?.canList &&
                    threadId
                  ) {
                    const existing = await git.githubAppPrList(cwd, threadId, {
                      state: "open",
                      query: `head:${head}`,
                      limit: 20,
                    })
                    if (existing.items[0]) {
                      selectPullRequest(existing.items[0].number)
                      setCreateNeedsReview(false)
                      return
                    }
                  }
                  await git.push(cwd, { remote: "origin", branch: head, setUpstream: true })
                  const generated = title.trim()
                    ? null
                    : await git.generateText(cwd, "pull-request", base.trim())
                  if (generated) {
                    setTitle(generated.title)
                    setBody(generated.body)
                  }
                  const input = {
                    head,
                    base: base.trim(),
                    title: generated?.title ?? title.trim(),
                    body: generated?.body ?? body,
                    draft,
                  }
                  try {
                    if (createProvider === "cli") {
                      const created = await git.githubPrCreate(cwd, input)
                      selectPullRequest(created.number)
                      if (threadId)
                        githubPrAssociations.add(threadId, {
                          number: created.number,
                          title: created.title,
                          url: created.url,
                        })
                    } else {
                      if (!threadId) throw new Error("A local Codex thread is required")
                      const created = await git.githubAppPrCreate(cwd, threadId, input)
                      selectPullRequest(created.number)
                      githubPrAssociations.add(threadId, {
                        number: created.number,
                        title: input.title,
                        url: created.url,
                      })
                      await openExternal(created.url)
                    }
                  } catch (cause) {
                    if (cliAvailable) {
                      const existing = await git.githubPrForBranch(cwd, head).catch(() => null)
                      if (existing?.state === "OPEN") {
                        selectPullRequest(existing.number)
                        setCreateNeedsReview(false)
                        return
                      }
                    }
                    setCreateNeedsReview(true)
                    throw cause
                  }
                  setCreateNeedsReview(false)
                  setTitle("")
                  setBody("")
                  setNewBranchName("")
                  setCreateCommitMessage("")
                  setCommitChanges(false)
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
