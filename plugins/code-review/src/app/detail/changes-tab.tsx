import { Button } from "@cypheria/ui/components/button"
import {
  type ChatDiffAnnotation,
  type ChatDiffFocus,
  type ChatDiffStyle,
  type ChatDiffTarget,
  ChatDiffViewer,
  chatDiffFingerprints,
} from "@cypheria/ui/components/chat/diff-viewer"
import {
  ChatReviewFileTree,
  type ChatReviewTreeFile,
} from "@cypheria/ui/components/chat/review-file-tree"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@cypheria/ui/components/dropdown-menu"
import { Textarea } from "@cypheria/ui/components/textarea"
import { cn } from "@cypheria/ui/lib/utils"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { MoreHorizontalIcon, PanelRightIcon, RotateCwIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import {
  type DetailRequest,
  githubWrite,
  gitlabWrite,
  type PullRequestModel,
  useActivity,
  useDiff,
  usePullRequestWrite,
} from "../data.js"
import { fileSections } from "../diff.js"
import type { Comment, PrivateReview } from "../schemas.js"
import { IconButton } from "./pull-request-detail.js"
import { Avatar, compactAge, copyText, Markdown } from "./shared.js"
import { SubmitReviewDialog } from "./submit-review.js"
import { ThreadActions } from "./summary-tab.js"

const toSide = (side: "left" | "right" | null | undefined) =>
  side === "left" ? "deletions" : "additions"
const fromSide = (side: "additions" | "deletions") => (side === "deletions" ? "left" : "right")

/** Changes: the pull request's diff, its review threads, and the changed-file tree. */
export function ChangesTab({
  focus,
  privateReview,
  pullRequest,
  request,
}: Readonly<{
  focus: { path: string; line: number; side: "left" | "right" } | null
  privateReview: PrivateReview | null
  pullRequest: PullRequestModel
  request: DetailRequest
}>) {
  const { i18n } = useLingui()
  const diff = useDiff(request, pullRequest.headRevision)
  const activity = useActivity(request)
  const [diffStyle, setDiffStyle] = useState<ChatDiffStyle>("auto")
  const [wrap, setWrap] = useState(false)
  const [wordDiffs, setWordDiffs] = useState(true)
  const [showTree, setShowTree] = useState(true)
  const [filter, setFilter] = useState("")
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [viewed, setViewed] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState<ChatDiffTarget | null>(null)
  const [diffFocus, setDiffFocus] = useState<ChatDiffFocus | null>(
    focus
      ? { lineNumber: focus.line, nonce: Date.now(), path: focus.path, side: toSide(focus.side) }
      : null
  )
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (focus) {
      setDiffFocus({
        lineNumber: focus.line,
        nonce: Date.now(),
        path: focus.path,
        side: toSide(focus.side),
      })
    }
  }, [focus])

  const patch = diff.data?.patch ?? ""
  const headRevision = diff.data?.headRevision ?? pullRequest.headRevision
  const fingerprints = useMemo(() => chatDiffFingerprints(patch), [patch])
  const threads = activity.data?.threads ?? []
  const pending = useMemo(
    () =>
      (activity.data?.items ?? []).filter(
        (item): item is Comment => "isPending" in item && item.isPending === true
      ),
    [activity.data]
  )
  const pendingReviewId = pending.find((item) => item.pendingReviewId)?.pendingReviewId

  const files: ChatReviewTreeFile[] = useMemo(
    () =>
      fileSections(patch).map((section) => {
        let additions = 0
        let deletions = 0
        for (const line of section.text.split("\n")) {
          if (line.startsWith("+") && !line.startsWith("+++")) additions += 1
          else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1
        }
        const status = /^new file mode/mu.test(section.text)
          ? "added"
          : /^deleted file mode/mu.test(section.text)
            ? "deleted"
            : /^rename from/mu.test(section.text)
              ? "renamed"
              : "modified"
        return {
          additions,
          comments: threads.filter((thread) => thread.path === section.path).length,
          deletions,
          path: section.path,
          status,
          viewed:
            viewed[section.path] != null && viewed[section.path] === fingerprints.get(section.path),
        }
      }),
    [patch, threads, viewed, fingerprints]
  )
  const viewedPaths = useMemo(
    () => new Set(files.filter((file) => file.viewed).map((file) => file.path)),
    [files]
  )

  const annotations: ChatDiffAnnotation[] = useMemo(() => {
    const list: ChatDiffAnnotation[] = []
    for (const thread of threads) {
      const line = thread.line ?? thread.originalLine
      if (!thread.path || !line) continue
      list.push({
        content: <ThreadAnnotation comment={thread} request={request} />,
        key: `thread:${thread.id}`,
        lineNumber: line,
        path: thread.path,
        side: toSide(thread.side),
      })
    }
    for (const [index, finding] of (privateReview?.result?.findings ?? []).entries()) {
      if (privateReview?.findingResolutions[String(index)]) continue
      list.push({
        content: (
          <div className="flex flex-col gap-1 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 text-sm">
            <span className="font-medium text-violet-700 text-xs dark:text-violet-300">
              <Trans id="privateReview.inline.author">Private review</Trans> · P{finding.priority}
            </span>
            <span className="font-medium">{finding.title}</span>
            <Markdown>{finding.body}</Markdown>
          </div>
        ),
        key: `finding:${index}`,
        lineNumber: finding.line,
        path: finding.path,
        side: toSide(finding.side),
      })
    }
    if (draft) {
      list.push({
        content: (
          <InlineComposer
            headRevision={headRevision}
            pendingReviewId={pendingReviewId}
            request={request}
            target={draft}
            onClose={() => setDraft(null)}
          />
        ),
        key: "draft",
        lineNumber: draft.lineNumber,
        path: draft.path,
        side: draft.side,
      })
    }
    return list
  }, [threads, privateReview, draft, request, headRevision, pendingReviewId])

  if (diff.isLoading) {
    return (
      <p className="p-6 text-muted-foreground text-sm">
        {request.provider === "gitlab" ? (
          <Trans id="codeReview.gitlab.states.loadingChanges">Loading merge request changes</Trans>
        ) : (
          <Trans id="pullRequestDetail.code.loading">Loading pull request changes</Trans>
        )}
      </p>
    )
  }
  if (diff.error) {
    return (
      <div className="flex flex-col items-center gap-3 p-6 text-center">
        <p className="text-muted-foreground text-sm">
          <Trans id="pullRequestDetail.code.unavailable">Changes unavailable</Trans>
        </p>
        <Button size="sm" variant="outline" onClick={() => void diff.refetch()}>
          <Trans id="pullRequestDetail.code.retry">Try again</Trans>
        </Button>
      </div>
    )
  }
  if (!patch.trim()) {
    return (
      <p className="p-6 text-muted-foreground text-sm">
        <Trans id="pullRequestDetail.code.empty">No changed files</Trans>
      </p>
    )
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-border border-b px-3">
        {pullRequest.state === "open" ? (
          <Button
            size="sm"
            variant={pending.length > 0 ? "default" : "outline"}
            onClick={() => setSubmitting(true)}
          >
            {pending.length > 0 ? (
              <Trans id="pullRequestSubmitReview.openWithPending">
                Submit review · {pending.length}
              </Trans>
            ) : (
              <Trans id="pullRequestSubmitReview.open">Submit review</Trans>
            )}
          </Button>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <IconButton
            label={i18n._(msg({ id: "codex.review.refreshGitQueries", message: "Refresh" }))}
            onClick={() => {
              void diff.refetch()
              void activity.refetch()
            }}
          >
            <RotateCwIcon className="size-4" />
          </IconButton>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={i18n._(
                msg({ id: "codex.review.header.moreOptions", message: "Changes options" })
              )}
              render={<Button className="size-7 rounded-full" size="icon" variant="ghost" />}
            >
              <MoreHorizontalIcon className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuRadioGroup
                value={diffStyle}
                onValueChange={(value) => setDiffStyle(value as ChatDiffStyle)}
              >
                <DropdownMenuRadioItem value="auto">
                  <Trans id="codeReviewPlugin.diff.layout.auto">Automatic</Trans>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="split">
                  <Trans id="codeReviewPlugin.diff.layout.split">Split</Trans>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="unified">
                  <Trans id="codeReviewPlugin.diff.layout.unified">Unified</Trans>
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={wordDiffs} onCheckedChange={setWordDiffs}>
                <Trans id="codex.review.wordDiffs.label">Word diffs</Trans>
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={wrap} onCheckedChange={setWrap}>
                <Trans id="codex.review.wrap.label">Word wrap</Trans>
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={collapsed.size === files.length}
                onCheckedChange={(value) =>
                  setCollapsed(value ? new Set(files.map((file) => file.path)) : new Set())
                }
              >
                {collapsed.size === files.length ? (
                  <Trans id="codex.review.expandOrCollapseDiffMenu.expand">Expand all diffs</Trans>
                ) : (
                  <Trans id="codex.review.expandOrCollapseDiffMenu.collapse">
                    Collapse all diffs
                  </Trans>
                )}
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <IconButton
            label={
              showTree
                ? i18n._(
                    msg({
                      id: "pullRequestsPage.codeReview.hideFileTree",
                      message: "Hide file tree",
                    })
                  )
                : i18n._(
                    msg({
                      id: "pullRequestsPage.codeReview.showFileTree",
                      message: "Show file tree",
                    })
                  )
            }
            onClick={() => setShowTree((value) => !value)}
          >
            <PanelRightIcon className={cn("size-4", showTree && "text-foreground")} />
          </IconButton>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto px-3 py-2">
          <ChatDiffViewer
            annotations={annotations}
            collapsedPaths={collapsed}
            diffStyle={diffStyle}
            focus={diffFocus}
            labels={{
              collapse: i18n._(
                msg({ id: "codex.diff.fileHeader.menu.collapse", message: "Collapse file" })
              ),
              expand: i18n._(
                msg({ id: "codex.diff.fileHeader.menu.expand", message: "Expand file" })
              ),
              viewed: i18n._(
                msg({ id: "pullRequestDetail.file.tooltip.markViewed", message: "Mark as viewed" })
              ),
            }}
            patch={patch}
            renderFileActions={(file) => (
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={i18n._(
                    msg({ id: "codex.diff.fileHeader.actions", message: "File actions" })
                  )}
                  render={<Button size="icon-xs" variant="ghost" />}
                >
                  <MoreHorizontalIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuCheckboxItem
                    checked={false}
                    onCheckedChange={() => void copyText(file.path)}
                  >
                    <Trans id="codex.diff.fileHeader.menu.copyPath">Copy path</Trans>
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            viewedPaths={viewedPaths}
            wordDiffs={wordDiffs}
            wrap={wrap}
            onRequestComment={pullRequest.state === "open" ? setDraft : undefined}
            onToggleCollapsed={(path) =>
              setCollapsed((current) => {
                const next = new Set(current)
                if (next.has(path)) next.delete(path)
                else next.add(path)
                return next
              })
            }
            onToggleViewed={(path, value) =>
              setViewed((current) => {
                const next = { ...current }
                const fingerprint = fingerprints.get(path)
                if (value && fingerprint) next[path] = fingerprint
                else delete next[path]
                return next
              })
            }
          />
        </div>
        {showTree && files.length > 1 ? (
          <ChatReviewFileTree
            className="w-[260px] shrink-0 border-border border-l"
            files={files}
            filter={filter}
            labels={{
              filter: i18n._(
                msg({ id: "codex.fileTreeSearch.placeholder", message: "Filter files…" })
              ),
              noMatches: i18n._(
                msg({ id: "codex.review.fileSearch.empty", message: "No matching files" })
              ),
              rowSummary: (file) => file.path,
              tree: i18n._(
                msg({ id: "pullRequestDetail.code.changedFiles", message: "Changed files" })
              ),
            }}
            selectedPath={selectedPath}
            onFilterChange={setFilter}
            onSelectFile={(path) => {
              setSelectedPath(path)
              setDiffFocus({ lineNumber: 0, nonce: Date.now(), path, side: "additions" })
            }}
          />
        ) : null}
      </div>
      <SubmitReviewDialog
        headRevision={headRevision}
        open={submitting}
        pendingCount={pending.length}
        pendingReviewId={pendingReviewId}
        pullRequest={pullRequest}
        request={request}
        onOpenChange={setSubmitting}
      />
    </div>
  )
}

function ThreadAnnotation({
  comment,
  request,
}: Readonly<{ comment: Comment; request: DetailRequest }>) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3 text-sm">
      {[comment, ...(comment.replies ?? [])].map((entry) => (
        <div key={entry.id} className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Avatar login={entry.authorLogin} src={entry.authorAvatarUrl} />
            <span className="font-medium">{entry.authorLogin}</span>
            <span className="text-muted-foreground text-xs">{compactAge(entry.createdAt)}</span>
            {entry.isPending ? (
              <span className="rounded-full bg-amber-500/15 px-1.5 text-amber-700 text-xs dark:text-amber-300">
                <Trans id="pullRequestDetail.comment.pending">Pending</Trans>
              </span>
            ) : null}
          </div>
          <Markdown>{entry.body}</Markdown>
        </div>
      ))}
      {comment.reviewThreadId ? <ThreadActions comment={comment} request={request} /> : null}
    </div>
  )
}

/** A new comment on a diff line or range: post it now, or add it to a pending review. */
function InlineComposer({
  headRevision,
  onClose,
  pendingReviewId,
  request,
  target,
}: Readonly<{
  headRevision: string | null
  onClose: () => void
  pendingReviewId: string | undefined
  request: DetailRequest
  target: ChatDiffTarget
}>) {
  const { i18n } = useLingui()
  const write = usePullRequestWrite(request)
  const [body, setBody] = useState("")
  const inlineComment = {
    line: target.lineNumber,
    path: target.path,
    side: fromSide(target.side),
    ...(target.startLineNumber && target.startLineNumber !== target.lineNumber
      ? { startLine: target.startLineNumber, startSide: fromSide(target.side) }
      : {}),
  }
  const post = (pending: boolean) => {
    const text = body.trim()
    if (!text) return
    write.mutate(
      () =>
        request.provider === "gitlab"
          ? gitlabWrite(request, "post-comment", { body: text, inlineComment })
          : githubWrite(request, "comment", {
              body: text,
              expectedHeadRevision: headRevision,
              inlineComment,
              ...(pending ? { review: "pending" } : {}),
              ...(pending && pendingReviewId ? { pendingReviewId } : {}),
            }),
      { onSuccess: onClose }
    )
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
      <Textarea
        aria-label={i18n._(
          msg({
            id: "pullRequestsPage.detail.commentInput.ariaLabel",
            message: "Pull request comment",
          })
        )}
        autoFocus
        placeholder={i18n._(
          msg({
            id: "pullRequestsPage.detail.commentInput.placeholder",
            message: "Leave a comment",
          })
        )}
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      {write.error ? (
        <p className="text-destructive text-sm">
          <Trans id="pullRequestDetail.code.commentError">GitHub could not post this comment</Trans>
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onClose}>
          <Trans id="code.diffComment.cancel">Cancel</Trans>
        </Button>
        {request.provider === "github" ? (
          <Button
            disabled={!body.trim() || write.isPending}
            size="sm"
            variant="outline"
            onClick={() => post(true)}
          >
            {pendingReviewId ? (
              <Trans id="code.diffComment.addToReview">Add to review</Trans>
            ) : (
              <Trans id="code.diffComment.startReview">Start your review</Trans>
            )}
          </Button>
        ) : null}
        <Button disabled={!body.trim() || write.isPending} size="sm" onClick={() => post(false)}>
          <Trans id="code.diffComment.commentNow">Comment</Trans>
        </Button>
      </div>
    </div>
  )
}
