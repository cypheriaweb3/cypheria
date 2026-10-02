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
import {
  type ChatDiffAnnotation,
  type ChatDiffFocus,
  type ChatDiffTarget,
  ChatDiffViewer,
  ChatReviewFileTree,
  type ChatReviewTreeFile,
  chatDiffFileSections,
  chatDiffFingerprints,
  chatHideImportOnlyHunks,
  isLikelyGeneratedPath,
  parseChatDiffFiles,
} from "@cypheria/ui/components/chat"
import { Checkbox } from "@cypheria/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@cypheria/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@cypheria/ui/components/dropdown-menu"
import { DotsVerticalIcon } from "@cypheria/ui/components/icons"
import { Input } from "@cypheria/ui/components/input"
import { NativeSelect, NativeSelectOption } from "@cypheria/ui/components/native-select"
import { RadioGroup, RadioGroupItem } from "@cypheria/ui/components/radio-group"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@cypheria/ui/components/tabs"
import { Textarea } from "@cypheria/ui/components/textarea"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useAtomValue } from "jotai"
import { useEffect, useId, useMemo, useState } from "react"

import { clientStateStore } from "../client-state.js"
import { ensureCypheriaClient } from "../cypheria-client.js"
import {
  pullRequestNumber,
  type ReviewFocusRequest,
  reviewFocusAtom,
  samePullRequest,
} from "../deep-links.js"
import { useThreadAttachments } from "../thread-attachments.js"
import { type GitHubPrOperation, githubPrProvider } from "./github-pr-provider.js"
import {
  findGithubPrWatch,
  type GithubPrRepairFocus,
  githubPrFixPrompt,
  githubPrWatchName,
} from "./github-pr-watch.js"
import { MentionTextarea } from "./mention-textarea.js"
import { PullRequestChecks } from "./pull-request-checks.js"
import { defaultMergeMethod, type MergeBlocker, mergeBlocker } from "./pull-request-merge.js"
import {
  ReviewDiffControls,
  useDiffViewerLabels,
  useReviewDiffDisplay,
  useViewedFiles,
} from "./review-diff-display.js"

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

type PrTab = "activity" | "code" | "summary"
type ReviewDecision = "approve" | "comment" | "request_changes"

export function GitHubPrPanel({
  cwd,
  branch,
  threadId,
}: Readonly<{ cwd: string; branch: string | null; threadId: string | null }>) {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const pullRequestAttachments = useThreadAttachments("pull_request")
  const associations = (pullRequestAttachments.data ?? []).filter(
    (attachment) => attachment.attachmentType === "pull_request"
  )
  const attachmentsForUrl = (url: string) =>
    associations.filter((attachment) => attachment.payload.url === url)
  const attachmentForThread = (url: string) =>
    associations.find(
      (attachment) => attachment.threadId === threadId && attachment.payload.url === url
    )
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [prTab, setPrTab] = useState<PrTab>("summary")
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
  const [reviewOpen, setReviewOpen] = useState(false)
  const reviewDecisionId = useId()
  const [reviewDecision, setReviewDecision] = useState<ReviewDecision>("comment")
  const [reviewer, setReviewer] = useState("")
  const [reviewerSearchQuery, setReviewerSearchQuery] = useState("")
  const [replyThreadId, setReplyThreadId] = useState<string | null>(null)
  const [replyBody, setReplyBody] = useState("")
  const [draftComment, setDraftComment] = useState<ChatDiffTarget | null>(null)
  const [inlineBody, setInlineBody] = useState("")
  const reviewFocus = useAtomValue(reviewFocusAtom)
  const [pendingFocus, setPendingFocus] = useState<ReviewFocusRequest | null>(null)
  const [diffFocus, setDiffFocus] = useState<ChatDiffFocus | null>(null)
  const [prFileFilter, setPrFileFilter] = useState("")
  const [prSelectedFile, setPrSelectedFile] = useState<string | null>(null)
  const [prCollapsedPaths, setPrCollapsedPaths] = useState<ReadonlySet<string>>(new Set())
  const [prFullFiles, setPrFullFiles] = useState(false)
  const [diffDisplay] = useReviewDiffDisplay()
  const diffViewerLabels = useDiffViewerLabels()
  const [focusNotice, setFocusNotice] = useState<string | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [selectedRevision, setSelectedRevision] = useState<string | null>(null)
  const [showStack, setShowStack] = useState(false)
  const [attributesPath, setAttributesPath] = useState("")
  const [selectedAttributesPath, setSelectedAttributesPath] = useState<string | null>(null)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeMethod, setMergeMethod] = useState<"merge" | "squash" | null>(null)
  const mergeMethodId = useId()
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
    setDraftComment(null)
    setInlineBody("")
    setShowDiff(false)
    setSelectedRevision(null)
    setShowStack(false)
    setAttributesPath("")
    setSelectedAttributesPath(null)
    setSelectedNumber(number)
    setListOpen(false)
  }
  const openPrTab = (tab: PrTab) => {
    setPrTab(tab)
    if (tab === "code") setShowDiff(true)
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
  type PrThread = NonNullable<typeof threads.data>["threads"][number]
  const renderCliThread = (thread: PrThread, pr: NonNullable<typeof selected.data>) => (
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
          disabled={busy || pr.state !== "OPEN"}
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
            disabled={busy || pr.state !== "OPEN"}
            onClick={() =>
              void mutate(async () => {
                const head = pr.headRefOid
                if (!head) throw new Error("A pull request head is required")
                await (await ensureCypheriaClient()).git.githubPrThreadAction(cwd, {
                  number: pr.number,
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
          <MentionTextarea
            aria-label={i18n._(msg({ id: "git.github.replyBody", message: "Review thread reply" }))}
            onValueChange={setReplyBody}
            rows={2}
            value={replyBody}
            {...mentionProps}
          />
          <Button
            disabled={busy || !replyBody.trim()}
            onClick={() =>
              void mutate(async () => {
                const head = pr.headRefOid
                if (!head) throw new Error("A pull request head is required")
                await (await ensureCypheriaClient()).git.githubPrThreadAction(cwd, {
                  number: pr.number,
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
  )
  const blocker: MergeBlocker | null = selected.data
    ? mergeBlocker({
        checks: checks.data?.checks ?? null,
        isDraft: selected.data.isDraft,
        metadata: metadata.data ?? null,
        state: selected.data.state,
      })
    : null
  const blockerMessage = (reason: MergeBlocker): string =>
    reason === "closed"
      ? i18n._(
          msg({
            id: "git.github.mergeBlocked.closed",
            message: "Reopen this pull request before merging",
          })
        )
      : reason === "draft"
        ? i18n._(
            msg({
              id: "git.github.mergeBlocked.draft",
              message: "Mark this pull request ready for review before merging",
            })
          )
        : reason === "conflicts"
          ? i18n._(
              msg({
                id: "git.github.mergeBlocked.conflicts",
                message: "Resolve merge conflicts before merging",
              })
            )
          : reason === "failingChecks"
            ? i18n._(
                msg({
                  id: "git.github.mergeBlocked.failingChecks",
                  message: "Fix failing checks before merging",
                })
              )
            : reason === "pendingChecks"
              ? i18n._(
                  msg({
                    id: "git.github.mergeBlocked.pendingChecks",
                    message: "Wait for checks to finish before merging",
                  })
                )
              : reason === "blocked"
                ? i18n._(
                    msg({
                      id: "git.github.mergeBlocked.blocked",
                      message: "This pull request can’t be merged yet",
                    })
                  )
                : i18n._(
                    msg({
                      id: "git.github.mergeBlocked.unknown",
                      message: "GitHub is still checking whether this can be merged",
                    })
                  )
  const allowedMergeMethods = metadata.data?.allowedMergeMethods ?? []
  const chosenMergeMethod =
    mergeMethod && allowedMergeMethods.includes(mergeMethod)
      ? mergeMethod
      : defaultMergeMethod(
          gitSettings.data?.config.git.pullRequestMergeMethod ?? "merge",
          allowedMergeMethods
        )
  const startRepair = (focus: GithubPrRepairFocus) =>
    void mutate(async () => {
      const settings = gitSettings.data?.config.git
      if (!selected.data || !threadId || !settings) return
      await (await ensureCypheriaClient()).threads.startTurn({
        clientMessageId: crypto.randomUUID(),
        content: [{ type: "text", text: githubPrFixPrompt(selected.data, settings, false, focus) }],
        threadId,
      })
    })
  const searchMentions =
    cliAvailable && selected.data?.headRefOid
      ? async (query: string) => {
          const pr = selected.data
          if (!pr?.headRefOid) return []
          return (await ensureCypheriaClient()).git.githubPrUserSearch(
            cwd,
            pr.number,
            pr.headRefOid,
            query,
            "mentions"
          )
        }
      : undefined
  const mentionProps = searchMentions
    ? { searchKey: `${cwd}#${selected.data?.number}`, searchUsers: searchMentions }
    : {}
  const prSections = useMemo(
    () =>
      chatDiffFileSections(prDiff.data ?? "").filter(
        (section) => !diffDisplay.hideGenerated || !isLikelyGeneratedPath(section.path)
      ),
    [diffDisplay.hideGenerated, prDiff.data]
  )
  const prVisiblePatch = useMemo(
    () => prSections.map((section) => section.text).join(""),
    [prSections]
  )
  const prLargeDiff = prSections.length > 60 || prVisiblePatch.length > 1_000_000
  const prPagedIndex = prLargeDiff
    ? Math.max(
        0,
        prSections.findIndex((section) => section.path === prSelectedFile)
      )
    : -1
  const prShownPatch = useMemo(() => {
    const patch = prPagedIndex >= 0 ? (prSections[prPagedIndex]?.text ?? "") : prVisiblePatch
    return diffDisplay.hideImports ? chatHideImportOnlyHunks(patch) : patch
  }, [diffDisplay.hideImports, prPagedIndex, prSections, prVisiblePatch])
  const showPrPage = (index: number) => {
    const path = prSections[index]?.path
    if (path) setPrSelectedFile(path)
  }
  const prFingerprints = useMemo(() => chatDiffFingerprints(prVisiblePatch), [prVisiblePatch])
  const prViewed = useViewedFiles(`pr:${selected.data?.url ?? cwd}`, prFingerprints)
  const prShownCollapsed = useMemo(
    () => new Set([...prCollapsedPaths, ...prViewed.viewedPaths]),
    [prCollapsedPaths, prViewed.viewedPaths]
  )
  const togglePrCollapsed = (path: string) => {
    if (prViewed.viewedPaths.has(path)) {
      prViewed.setViewed(path, false)
      return
    }
    setPrCollapsedPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }
  const loadPrFiles =
    cliAvailable && revisionSnapshot.data && selected.data?.headRefOid
      ? async (file: { path: string; prevPath?: string }) => {
          const pr = selected.data
          const snapshot = revisionSnapshot.data
          if (!pr?.headRefOid || !snapshot) throw new Error("A pull request revision is required")
          const parsed = parseChatDiffFiles(prDiff.data ?? "").find(
            (entry) => entry.file.name === file.path
          )?.file
          const loaded = await (await ensureCypheriaClient()).git.githubPrRevisionFile(
            cwd,
            pr.number,
            pr.headRefOid,
            snapshot.mergeBaseRevision,
            snapshot.headRevision,
            parsed?.type === "new" ? null : (file.prevPath ?? file.path),
            parsed?.type === "deleted" ? null : file.path
          )
          if (loaded.status !== "success") throw new Error("The full file is unavailable")
          return {
            newContents: loaded.headContent,
            oldContents: parsed?.type === "rename-pure" ? null : loaded.baseContent,
          }
        }
      : undefined
  const githubFileUrl = (path: string): string | null => {
    const pr = selected.data
    if (!pr?.headRefOid) return null
    const match = /^(https:\/\/[^/]+\/[^/]+\/[^/]+)\/pull\/\d+/u.exec(pr.url)
    return match
      ? `${match[1]}/blob/${pr.headRefOid}/${path.split("/").map(encodeURIComponent).join("/")}`
      : null
  }
  const prDiffFiles: ChatReviewTreeFile[] = parseChatDiffFiles(prVisiblePatch).map(({ file }) => ({
    viewed: prViewed.markedPaths.has(file.name),
    additions: file.hunks.reduce((total, hunk) => total + hunk.additionLines, 0),
    comments: (threads.data?.threads ?? []).filter((thread) => thread.path === file.name).length,
    deletions: file.hunks.reduce((total, hunk) => total + hunk.deletionLines, 0),
    path: file.name,
    status:
      file.type === "new"
        ? "added"
        : file.type === "deleted"
          ? "deleted"
          : file.type === "rename-pure" || file.type === "rename-changed"
            ? "renamed"
            : "modified",
  }))
  const canCommentInline =
    cliAvailable && selected.data?.state === "OPEN" && Boolean(selected.data.headRefOid)
  const postInlineComment = (target: ChatDiffTarget) =>
    void mutate(async () => {
      const pr = selected.data
      const head = pr?.headRefOid
      if (!pr || !head) throw new Error("A pull request head is required")
      await (await ensureCypheriaClient()).git.githubPrThreadAction(cwd, {
        number: pr.number,
        expectedHead: head,
        action: "inline",
        path: target.path,
        line: target.lineNumber,
        ...(target.startLineNumber !== undefined && target.startLineNumber < target.lineNumber
          ? { startLine: target.startLineNumber }
          : {}),
        side: target.side === "deletions" ? "LEFT" : "RIGHT",
        body: inlineBody,
      })
      setInlineBody("")
      setDraftComment(null)
    })
  const diffAnnotations: ChatDiffAnnotation[] = [
    ...(threads.data?.threads ?? []).flatMap((thread) =>
      thread.line && selected.data
        ? [
            {
              content: canCommentInline ? (
                renderCliThread(thread, selected.data)
              ) : (
                <div className="space-y-1 border-y p-2 text-xs">
                  {thread.comments.map((comment) => (
                    <div className="border-l pl-2" key={comment.id}>
                      <span className="font-medium">{comment.author ?? "GitHub"}</span>
                      <p className="whitespace-pre-wrap">{comment.body}</p>
                    </div>
                  ))}
                </div>
              ),
              key: `thread:${thread.id}`,
              lineNumber: thread.line,
              path: thread.path,
              side: thread.side === "LEFT" ? ("deletions" as const) : ("additions" as const),
            },
          ]
        : []
    ),
    ...(draftComment && canCommentInline
      ? [
          {
            content: (
              <div className="space-y-1 border-y bg-background p-2">
                <MentionTextarea
                  aria-label={i18n._(
                    msg({ id: "git.github.inlineBody", message: "Inline comment" })
                  )}
                  autoFocus
                  onValueChange={setInlineBody}
                  rows={3}
                  value={inlineBody}
                  {...mentionProps}
                />
                <div className="flex gap-1">
                  <Button
                    disabled={busy || !inlineBody.trim()}
                    onClick={() => postInlineComment(draftComment)}
                    size="sm"
                    type="button"
                  >
                    <Trans id="git.github.postInline">Post inline comment</Trans>
                  </Button>
                  <Button
                    onClick={() => setDraftComment(null)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <Trans id="git.github.cancelCommentEdit">Cancel</Trans>
                  </Button>
                </div>
              </div>
            ),
            key: "draft",
            lineNumber: draftComment.lineNumber,
            path: draftComment.path,
            side: draftComment.side,
          },
        ]
      : []),
  ]
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectPullRequest only sets state; the effect runs once per request
  useEffect(() => {
    if (!reviewFocus || (reviewFocus.threadId && reviewFocus.threadId !== threadId)) return
    clientStateStore.set(reviewFocusAtom, null)
    const number = (() => {
      try {
        return pullRequestNumber(reviewFocus.pullRequest)
      } catch {
        return null
      }
    })()
    if (number === null) {
      setFocusNotice(
        i18n._(
          msg({
            id: "git.github.focusUnsupported",
            message: "This link does not point to a GitHub pull request.",
          })
        )
      )
      return
    }
    setFocusNotice(null)
    selectPullRequest(number)
    setShowDiff(true)
    setPendingFocus(reviewFocus)
  }, [reviewFocus, threadId, i18n])
  useEffect(() => {
    if (!pendingFocus || !selected.data) return
    if (!samePullRequest(selected.data.url, pendingFocus.pullRequest)) {
      if (selected.data.number === pullRequestNumber(pendingFocus.pullRequest)) {
        setFocusNotice(
          i18n._(
            msg({
              id: "git.github.focusOtherRepository",
              message:
                "This pull request belongs to another repository than this working directory.",
            })
          )
        )
        setPendingFocus(null)
      }
      return
    }
    if (pendingFocus.path && pendingFocus.line) {
      setPrTab("code")
      setDiffFocus({
        lineNumber: pendingFocus.line,
        nonce: pendingFocus.nonce,
        path: pendingFocus.path,
        side: pendingFocus.side,
      })
    }
    setPendingFocus(null)
  }, [pendingFocus, selected.data, i18n])
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
            <MentionTextarea
              aria-label={i18n._(msg({ id: "git.github.editComment", message: "Edit comment" }))}
              onValueChange={setCommentEditBody}
              rows={3}
              value={commentEditBody}
              {...mentionProps}
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

  const showList = !selected.data || listOpen
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
      {showList ? (
        <>
          {cliAvailable || appAvailability.data?.canList ? (
            <div className="flex flex-wrap gap-2">
              <Input
                aria-label={i18n._(
                  msg({ id: "git.github.search", message: "Search pull requests" })
                )}
                className="min-w-40 flex-1"
                maxLength={170}
                onChange={(event) => setPrSearchText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    setPrListLimit(100)
                    setPrSearchQuery(prSearchText.trim())
                  }
                }}
                placeholder={i18n._(
                  msg({ id: "git.github.search", message: "Search pull requests" })
                )}
                value={prSearchText}
              />
              <NativeSelect
                aria-label={i18n._(
                  msg({ id: "git.github.listState", message: "Pull request state" })
                )}
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
                aria-label={i18n._(
                  msg({ id: "git.github.prNumber", message: "Pull request number" })
                )}
                min={1}
                onChange={(event) => setDirectPrNumber(event.target.value)}
                type="number"
                value={directPrNumber}
              />
              <Button
                disabled={
                  !Number.isSafeInteger(Number(directPrNumber)) || Number(directPrNumber) < 1
                }
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
                  msg({
                    id: "git.github.boardRepositorySearch",
                    message: "Repository (owner/name)",
                  })
                )}
                onChange={(event) => {
                  setBoardRepositoryQuery(event.target.value)
                  setBoardRepository("all")
                  setBoardLimit(100)
                }}
                placeholder={i18n._(
                  msg({
                    id: "git.github.boardRepositorySearch",
                    message: "Repository (owner/name)",
                  })
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
                          void mutate(async () => {
                            const client = await ensureCypheriaClient()
                            await client.threads.attachments.addPullRequest(threadId, entry.url)
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
        </>
      ) : null}
      {selected.data ? (
        <div className="space-y-2 rounded-md border p-2">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-sm font-medium">
                #{selected.data.number} {selected.data.title}
              </p>
              <p className="text-xs text-muted-foreground">
                {selected.data.headRefName} → {selected.data.baseRefName} · {selected.data.state}
              </p>
            </div>
            <Button onClick={() => setListOpen(true)} size="sm" type="button" variant="ghost">
              <Trans id="git.github.allPullRequests">All pull requests</Trans>
            </Button>
          </div>
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
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button disabled={busy} size="sm" type="button" variant="outline" />}
                  >
                    <Trans id="git.github.repair">Repair</Trans>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-44">
                    <DropdownMenuItem onClick={() => startRepair("checks")}>
                      <Trans id="git.github.repair.checks">Failing checks</Trans>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => startRepair("comments")}>
                      <Trans id="git.github.repair.comments">Comments</Trans>
                    </DropdownMenuItem>
                    {blocker === "conflicts" ? (
                      <DropdownMenuItem onClick={() => startRepair("conflicts")}>
                        <Trans id="git.github.repair.conflicts">Merge conflicts</Trans>
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem onClick={() => startRepair("everything")}>
                      <Trans id="git.github.repair.everything">Everything</Trans>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
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
                <AlertDialogTrigger
                  render={
                    <Button
                      aria-label={
                        blocker
                          ? i18n._({
                              ...msg({
                                id: "git.github.mergeUnavailable",
                                message: "Merge unavailable: {reason}",
                              }),
                              values: { reason: blockerMessage(blocker) },
                            })
                          : undefined
                      }
                      disabled={busy || blocker !== null || chosenMergeMethod === null}
                      size="sm"
                      title={blocker ? blockerMessage(blocker) : undefined}
                      variant="outline"
                    />
                  }
                >
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
                  {allowedMergeMethods.length > 1 ? (
                    <RadioGroup
                      onValueChange={(value) => setMergeMethod(value as "merge" | "squash")}
                      value={chosenMergeMethod ?? undefined}
                    >
                      {allowedMergeMethods.map((method) => (
                        <label
                          className="flex items-center gap-2 text-sm"
                          htmlFor={`${mergeMethodId}-${method}`}
                          key={method}
                        >
                          <RadioGroupItem id={`${mergeMethodId}-${method}`} value={method} />
                          {method === "squash" ? (
                            <Trans id="git.github.mergeMethod.squash">Squash and merge</Trans>
                          ) : (
                            <Trans id="git.github.mergeMethod.merge">Create merge commit</Trans>
                          )}
                        </label>
                      ))}
                    </RadioGroup>
                  ) : null}
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
                        const method = chosenMergeMethod
                        if (!method) return
                        void mutate(async () => {
                          const client = await ensureCypheriaClient()
                          await client.git.githubPrMerge(cwd, selected.data.number, head, method)
                          if (method !== gitSettings.data?.config.git.pullRequestMergeMethod) {
                            await client.server.patchConfig({
                              git: { pullRequestMergeMethod: method },
                            })
                            await queryClient.invalidateQueries({ queryKey: ["settings", "git"] })
                          }
                        })
                      }}
                    >
                      <Trans id="git.github.merge">Merge</Trans>
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
            {cliAvailable && blocker && blocker !== "closed" ? (
              <span className="basis-full text-xs text-muted-foreground">
                {blockerMessage(blocker)}
              </span>
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
          <Tabs onValueChange={(value) => openPrTab(value as PrTab)} value={prTab}>
            <TabsList>
              <TabsTrigger value="summary">
                <Trans id="git.github.tabSummary">Summary</Trans>
              </TabsTrigger>
              <TabsTrigger value="code">
                <Trans id="git.github.tabCode">Code</Trans>
              </TabsTrigger>
              <TabsTrigger value="activity">
                <Trans id="git.github.tabActivity">Activity</Trans>
              </TabsTrigger>
            </TabsList>
            <TabsContent className="space-y-2" value="summary">
              {threadId ? (
                <Button
                  onClick={() =>
                    void mutate(async () => {
                      if (!selected.data) return
                      const client = await ensureCypheriaClient()
                      const attachment = attachmentForThread(selected.data.url)
                      if (attachment) {
                        await client.threads.attachments.remove(
                          threadId,
                          "pull_request",
                          attachment.identityKey
                        )
                      } else {
                        await client.threads.attachments.addPullRequest(threadId, selected.data.url)
                      }
                    })
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {attachmentForThread(selected.data.url) ? (
                    <Trans id="git.github.detachThread">Detach from chat</Trans>
                  ) : (
                    <Trans id="git.github.attachThread">Attach to chat</Trans>
                  )}
                </Button>
              ) : null}
              {attachmentsForUrl(selected.data.url).length ? (
                <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  <Trans id="git.github.linkedChats">Linked chats:</Trans>
                  {attachmentsForUrl(selected.data.url).map(({ threadId: linkedThreadId }) => (
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
                  {selected.data.headRefName === branch ? (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void mutate(async () => {
                          const generated = await (await ensureCypheriaClient()).git.generateText(
                            cwd,
                            "pull-request",
                            selected.data.baseRefName
                          )
                          setEditTitle(generated.title)
                          setEditBody(generated.body)
                        })
                      }
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <Trans id="git.github.generateTitleAndBody">Generate with Codex</Trans>
                    </Button>
                  ) : null}
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
              {selected.data.state === "OPEN" &&
              (cliAvailable || appAvailability.data?.canChecks) ? (
                <div className="space-y-1 border-t pt-2">
                  <p className="text-xs font-medium">
                    <Trans id="git.github.checks">Checks</Trans>
                  </p>
                  {checks.data ? (
                    <PullRequestChecks
                      checks={checks.data.checks}
                      complete={checks.data.complete}
                      onOpen={(url) => void mutate(async () => openExternal(url))}
                      {...(cliAvailable &&
                      localCodexThread &&
                      threadId &&
                      gitSettings.data &&
                      selected.data.headRefOid
                        ? {
                            onFixFailing: () =>
                              void mutate(async () => {
                                const settings = gitSettings.data?.config.git
                                if (!settings) return
                                await (await ensureCypheriaClient()).threads.startTurn({
                                  clientMessageId: crypto.randomUUID(),
                                  content: [
                                    {
                                      text: githubPrFixPrompt(selected.data, settings, false),
                                      type: "text",
                                    },
                                  ],
                                  threadId,
                                })
                              }),
                          }
                        : {})}
                    />
                  ) : null}
                  {checks.isError ? (
                    <Alert variant="destructive">
                      <AlertDescription>{checks.error.message}</AlertDescription>
                    </Alert>
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
            </TabsContent>
            <TabsContent className="space-y-2" value="code">
              {selected.data.headRefOid && (cliAvailable || appAvailability.data?.canDiff) ? (
                <div className="space-y-2 border-t pt-2">
                  <div className="flex items-center gap-1">
                    <Button
                      onClick={() => setShowDiff((value) => !value)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Trans id="git.github.codeChanges">Code changes</Trans>
                    </Button>
                    {showDiff && prDiffFiles.length > 0 ? (
                      <span className="ml-auto">
                        <ReviewDiffControls
                          files={prDiffFiles.map((file) => file.path)}
                          onCollapseAll={() =>
                            setPrCollapsedPaths(new Set(prDiffFiles.map((file) => file.path)))
                          }
                          onError={setError}
                          onExpandAll={() => {
                            setPrCollapsedPaths(new Set())
                            for (const path of prViewed.viewedPaths) prViewed.setViewed(path, false)
                          }}
                          onJumpToFile={(path) => {
                            setPrSelectedFile(path)
                            setDiffFocus({
                              lineNumber: 0,
                              nonce: Date.now(),
                              path,
                              side: "additions",
                            })
                          }}
                          {...(loadPrFiles
                            ? { fullFiles: prFullFiles, onFullFilesChange: setPrFullFiles }
                            : {})}
                          {...(prVisiblePatch ? { patch: prVisiblePatch } : {})}
                        />
                      </span>
                    ) : null}
                  </div>
                  {showDiff ? (
                    <div className="space-y-2">
                      {prLargeDiff ? (
                        <div className="flex items-center gap-2 rounded border px-2 py-1 text-xs">
                          <span className="min-w-0 flex-1 text-muted-foreground">
                            <Trans id="git.diff.largeDiff">
                              This diff is large, so it shows one file at a time.
                            </Trans>
                          </span>
                          <Button
                            disabled={prPagedIndex <= 0}
                            onClick={() => showPrPage(prPagedIndex - 1)}
                            size="sm"
                            type="button"
                            variant="ghost"
                          >
                            <Trans id="git.diff.previousFile">Previous file</Trans>
                          </Button>
                          <span className="tabular-nums">
                            {prPagedIndex + 1}/{prSections.length}
                          </span>
                          <Button
                            disabled={prPagedIndex >= prSections.length - 1}
                            onClick={() => showPrPage(prPagedIndex + 1)}
                            size="sm"
                            type="button"
                            variant="ghost"
                          >
                            <Trans id="git.diff.nextFile">Next file</Trans>
                          </Button>
                        </div>
                      ) : null}
                      <div className="flex min-h-0 flex-col rounded border @container">
                        <div className="flex min-h-0 flex-col @2xl:flex-row">
                          {prDiffFiles.length > 1 ? (
                            <ChatReviewFileTree
                              className="h-48 shrink-0 border-b @2xl:h-[40rem] @2xl:w-56 @2xl:border-r @2xl:border-b-0"
                              files={prDiffFiles}
                              filter={prFileFilter}
                              labels={{
                                filter: i18n._(
                                  msg({
                                    id: "git.review.searchFiles",
                                    message: "Search changed files",
                                  })
                                ),
                                noMatches: i18n._(
                                  msg({
                                    id: "git.review.noMatchingFiles",
                                    message: "No files match this search",
                                  })
                                ),
                                rowSummary: (file) => file.path,
                                tree: i18n._(
                                  msg({ id: "git.review.changedFiles", message: "Changed files" })
                                ),
                              }}
                              onFilterChange={setPrFileFilter}
                              onSelectFile={(path) => {
                                setPrSelectedFile(path)
                                setDiffFocus({
                                  lineNumber: 0,
                                  nonce: Date.now(),
                                  path,
                                  side: "additions",
                                })
                              }}
                              selectedPath={prSelectedFile}
                            />
                          ) : null}
                          <div className="flex min-w-0 flex-1 flex-col">
                            <ChatDiffViewer
                              annotations={diffAnnotations}
                              className="max-h-[40rem]"
                              collapsedPaths={prShownCollapsed}
                              diffStyle={diffDisplay.diffStyle}
                              expandUnchanged={prFullFiles}
                              labels={diffViewerLabels}
                              onToggleCollapsed={togglePrCollapsed}
                              onToggleViewed={prViewed.setViewed}
                              renderFileActions={(file) => (
                                <DropdownMenu>
                                  <DropdownMenuTrigger
                                    render={
                                      <Button
                                        aria-label={i18n._(
                                          msg({
                                            id: "git.diff.fileActions",
                                            message: "File actions",
                                          })
                                        )}
                                        size="icon-xs"
                                        type="button"
                                        variant="ghost"
                                      />
                                    }
                                  >
                                    <DotsVerticalIcon />
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="min-w-44">
                                    <DropdownMenuItem
                                      onClick={() =>
                                        void navigator.clipboard
                                          .writeText(file.path)
                                          .catch((error: unknown) =>
                                            setError(
                                              error instanceof Error ? error.message : String(error)
                                            )
                                          )
                                      }
                                    >
                                      <Trans id="git.diff.copyPath">Copy path</Trans>
                                    </DropdownMenuItem>
                                    {githubFileUrl(file.path) ? (
                                      <DropdownMenuItem
                                        onClick={() => {
                                          const url = githubFileUrl(file.path)
                                          if (url)
                                            void openExternal(url).catch((cause: unknown) =>
                                              setError(
                                                cause instanceof Error
                                                  ? cause.message
                                                  : String(cause)
                                              )
                                            )
                                        }}
                                      >
                                        <Trans id="git.diff.openInGitHub">Open in GitHub</Trans>
                                      </DropdownMenuItem>
                                    ) : null}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                              viewedPaths={prViewed.viewedPaths}
                              wordDiffs={diffDisplay.wordDiffs}
                              wrap={diffDisplay.wrap}
                              {...(loadPrFiles && prFullFiles ? { loadFiles: loadPrFiles } : {})}
                              patch={prShownPatch}
                              fallback={
                                <pre className="max-h-96 overflow-auto rounded border p-2 text-xs whitespace-pre-wrap">
                                  {prDiff.isError
                                    ? prDiff.error.message
                                    : prDiff.data ||
                                      i18n._(
                                        msg({
                                          id: "git.github.diffLoading",
                                          message: "Loading diff…",
                                        })
                                      )}
                                </pre>
                              }
                              focus={diffFocus}
                              {...(canCommentInline
                                ? {
                                    onRequestComment: (target: ChatDiffTarget) => {
                                      setInlineBody("")
                                      setDraftComment(target)
                                    },
                                  }
                                : {})}
                            />
                          </div>
                        </div>
                      </div>
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
            </TabsContent>
            <TabsContent className="space-y-2" value="activity">
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
                      <span className="font-medium">{review.author ?? "GitHub"}</span> ·{" "}
                      {review.state}
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
                      <span className="font-medium">{review.author ?? "GitHub"}</span> ·{" "}
                      {review.state}
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
                  {threads.data?.threads.map((thread) => renderCliThread(thread, selected.data))}
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
                </div>
              ) : null}
              {cliAvailable && selected.data.state === "OPEN" && selected.data.headRefOid ? (
                <div className="space-y-2 border-t pt-2">
                  <MentionTextarea
                    aria-label={i18n._(
                      msg({ id: "git.github.commentBody", message: "Pull request comment" })
                    )}
                    onValueChange={setCommentBody}
                    rows={3}
                    value={commentBody}
                    {...mentionProps}
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
                  <Dialog onOpenChange={setReviewOpen} open={reviewOpen}>
                    <DialogTrigger render={<Button disabled={busy} size="sm" type="button" />}>
                      <Trans id="git.github.submitReview">Submit review</Trans>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>
                          <Trans id="git.github.reviewDecision">Review decision</Trans>
                        </DialogTitle>
                        <DialogDescription>
                          <Trans id="git.github.reviewDecisionHint">
                            Choose a review decision and optionally add a comment. The review
                            applies only if the displayed head commit still matches.
                          </Trans>
                        </DialogDescription>
                      </DialogHeader>
                      <RadioGroup
                        onValueChange={(value) => setReviewDecision(value as ReviewDecision)}
                        value={reviewDecision}
                      >
                        {(["comment", "approve", "request_changes"] as const).map((decision) => (
                          <label
                            className="flex items-center gap-2 text-sm"
                            htmlFor={`${reviewDecisionId}-${decision}`}
                            key={decision}
                          >
                            <RadioGroupItem
                              id={`${reviewDecisionId}-${decision}`}
                              value={decision}
                            />
                            {decision === "approve" ? (
                              <Trans id="git.github.approve">Approve</Trans>
                            ) : decision === "comment" ? (
                              <Trans id="git.github.reviewComment">Review comment</Trans>
                            ) : (
                              <Trans id="git.github.requestChanges">Request changes</Trans>
                            )}
                          </label>
                        ))}
                      </RadioGroup>
                      <MentionTextarea
                        aria-label={i18n._(
                          msg({ id: "git.github.reviewBody", message: "Pull request review" })
                        )}
                        onValueChange={setReviewBody}
                        placeholder={i18n._(
                          msg({ id: "git.github.optionalComment", message: "Optional comment" })
                        )}
                        rows={4}
                        value={reviewBody}
                        {...mentionProps}
                      />
                      <DialogFooter>
                        <Button
                          disabled={busy || (reviewDecision !== "approve" && !reviewBody.trim())}
                          onClick={() => {
                            const head = selected.data.headRefOid
                            if (!head) return
                            void mutate(async () => {
                              await (await ensureCypheriaClient()).git.githubPrReview(
                                cwd,
                                selected.data.number,
                                head,
                                reviewDecision,
                                reviewBody
                              )
                              setReviewBody("")
                              setReviewOpen(false)
                            })
                          }}
                          type="button"
                        >
                          <Trans id="git.github.submitReview">Submit review</Trans>
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              ) : null}
            </TabsContent>
          </Tabs>
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
                  const client = await ensureCypheriaClient()
                  const git = client.git
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
                      if (threadId) {
                        await client.threads.attachments.addPullRequest(threadId, existing.url)
                      }
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
                      await client.threads.attachments.addPullRequest(
                        threadId,
                        existing.items[0].url
                      )
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
                    ...(threadId ? { threadId } : {}),
                  }
                  try {
                    if (createProvider === "cli") {
                      const created = await git.githubPrCreate(cwd, input)
                      selectPullRequest(created.number)
                    } else {
                      if (!threadId) throw new Error("A local Codex thread is required")
                      const created = await git.githubAppPrCreate(cwd, threadId, input)
                      selectPullRequest(created.number)
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
      {focusNotice ? (
        <Alert>
          <AlertDescription>{focusNotice}</AlertDescription>
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
