import { Button } from "@cypheria/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@cypheria/ui/components/dropdown-menu"
import { Input } from "@cypheria/ui/components/input"
import { Textarea } from "@cypheria/ui/components/textarea"
import { cn } from "@cypheria/ui/lib/utils"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import {
  ArrowRightIcon,
  GitCommitHorizontalIcon,
  GitMergeIcon,
  GitPullRequestArrowIcon,
  ListFilterIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SmilePlusIcon,
} from "lucide-react"
import { useMemo, useState } from "react"

import {
  type DetailRequest,
  githubWrite,
  gitlabWrite,
  type PullRequestModel,
  useActivity,
  usePullRequestWrite,
} from "../data.js"
import { host } from "../host.js"
import type { ActivityItem, Comment, PrivateReview, Reaction } from "../schemas.js"
import { Avatar, compactAge, copyText, Markdown, RelativeTime, StatePill } from "./shared.js"
import { SideRail } from "./side-rail.js"

export type CommentTarget = { path: string; line: number; side: "left" | "right" }

type ActivityFilter = "all" | "comments" | "human" | "commits"

/** Summary: the header, description, activity, and comment box, beside the status rail. */
export function SummaryTab({
  onOpenComment,
  privateReview,
  pullRequest,
  request,
  viewerAvatarUrl,
}: Readonly<{
  onOpenComment: (target: CommentTarget) => void
  privateReview: { review: PrivateReview | null; completedReviews: PrivateReview[] } | null
  pullRequest: PullRequestModel
  request: DetailRequest
  viewerAvatarUrl: string | null
}>) {
  const activity = useActivity(request)
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1040px] gap-10 px-8 pt-4 pb-24">
        <div className="min-w-0 flex-1">
          <Header pullRequest={pullRequest} request={request} />
          <Description pullRequest={pullRequest} request={request} />
          <Activity
            activity={activity.data?.items ?? []}
            loading={activity.isLoading}
            pullRequest={pullRequest}
            request={request}
            viewerAvatarUrl={viewerAvatarUrl}
            onOpenComment={onOpenComment}
          />
        </div>
        <div className="w-[300px] shrink-0 pt-1">
          <SideRail
            privateReview={privateReview}
            pullRequest={pullRequest}
            reviewThreads={activity.data?.threads ?? []}
            request={request}
            onOpenComment={onOpenComment}
          />
        </div>
      </div>
    </div>
  )
}

function Header({
  pullRequest,
  request,
}: Readonly<{ pullRequest: PullRequestModel; request: DetailRequest }>) {
  const { i18n } = useLingui()
  const write = usePullRequestWrite(request)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(pullRequest.title)
  const repository = request.pullRequest.repository
  const number =
    request.provider === "gitlab"
      ? `!${pullRequest.pullRequest.number}`
      : `#${pullRequest.pullRequest.number}`
  const canChangeStatus = pullRequest.viewerCanUpdate && pullRequest.state !== "merged"
  const status = pullRequest.state === "closed" ? "closed" : pullRequest.isDraft ? "draft" : "open"
  const setStatus = (next: string) => {
    if (next === status) return
    const action =
      next === "closed"
        ? "close"
        : next === "draft"
          ? pullRequest.state === "closed"
            ? "reopen"
            : "mark-draft"
          : pullRequest.state === "closed"
            ? "reopen-ready"
            : "mark-ready"
    write.mutate(() =>
      request.provider === "gitlab"
        ? gitlabWrite(request, "update-status", { action })
        : githubWrite(request, "update", { action })
    )
  }
  const saveTitle = () => {
    const next = title.trim()
    setEditing(false)
    if (!next || next === pullRequest.title) return
    write.mutate(() =>
      request.provider === "gitlab"
        ? gitlabWrite(request, "update-title", { title: next })
        : githubWrite(request, "update", { action: "update-title", title: next })
    )
  }
  return (
    <header className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {canChangeStatus ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={i18n._(
                msg({
                  id: "pullRequestSidePanel.status.change",
                  message: "Change pull request status",
                })
              )}
              render={<button className="rounded-full" type="button" />}
            >
              <StatePill isDraft={pullRequest.isDraft} state={pullRequest.state} />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="min-w-48">
              <DropdownMenuRadioGroup
                value={status}
                onValueChange={(value) => setStatus(String(value))}
              >
                <DropdownMenuRadioItem value="open">
                  <Trans id="pullRequestSidePanel.status.open">Ready for review</Trans>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="draft">
                  <Trans id="pullRequestSidePanel.status.draft">Draft</Trans>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="closed">
                  <Trans id="pullRequestSidePanel.status.close">Closed</Trans>
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <StatePill isDraft={pullRequest.isDraft} state={pullRequest.state} />
        )}
        <button
          className="text-muted-foreground text-sm hover:text-foreground"
          title={i18n._(
            msg({
              id: "pullRequestDetail.header.copyNumber",
              message: `Copy pull request number ${number}`,
            })
          )}
          type="button"
          onClick={() => void copyText(`${repository} ${number}`)}
        >
          {repository} {number}
        </button>
      </div>
      {editing ? (
        <div className="flex items-center gap-2">
          <Input
            aria-label={i18n._(
              msg({ id: "pullRequestDetail.editTitle.label", message: "Pull request title" })
            )}
            autoFocus
            className="h-10 font-semibold text-xl"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") saveTitle()
              if (event.key === "Escape") setEditing(false)
            }}
          />
          <Button size="sm" onClick={saveTitle}>
            <Trans id="pullRequestDetail.edit.save">Save</Trans>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            <Trans id="pullRequestDetail.edit.cancel">Cancel</Trans>
          </Button>
        </div>
      ) : (
        <h1 className="group flex items-start gap-2 font-semibold text-[28px] leading-tight tracking-tight">
          <span className="min-w-0 break-words">{pullRequest.title}</span>
          {pullRequest.viewerCanUpdate ? (
            <button
              aria-label={i18n._(
                msg({ id: "pullRequestDetail.title.edit", message: "Edit title" })
              )}
              className="mt-2 text-muted-foreground opacity-70 hover:text-foreground hover:opacity-100"
              type="button"
              onClick={() => {
                setTitle(pullRequest.title)
                setEditing(true)
              }}
            >
              <PencilIcon className="size-4" />
            </button>
          ) : null}
        </h1>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-sm">
        <Avatar login={pullRequest.authorLogin} src={pullRequest.authorAvatarUrl} />
        <span className="font-medium text-foreground">{pullRequest.authorLogin}</span>
        <RelativeTime value={pullRequest.createdAt} />
        {pullRequest.headBranch ? (
          <>
            <span aria-hidden>·</span>
            <button
              className="font-mono text-[13px] hover:text-foreground"
              title={i18n._(
                msg({
                  id: "pullRequestDetail.header.copySourceBranch",
                  message: `Copy source branch ${pullRequest.headBranch}`,
                })
              )}
              type="button"
              onClick={() => void copyText(pullRequest.headBranch ?? "")}
            >
              {pullRequest.headBranch}
            </button>
            <ArrowRightIcon className="size-3.5" />
            <button
              className="font-mono text-[13px] hover:text-foreground"
              title={i18n._(
                msg({
                  id: "pullRequestDetail.header.copyTargetBranch",
                  message: `Copy target branch ${pullRequest.baseBranch ?? ""}`,
                })
              )}
              type="button"
              onClick={() => void copyText(pullRequest.baseBranch ?? "")}
            >
              {pullRequest.baseBranch}
            </button>
          </>
        ) : null}
      </div>
      {write.error ? (
        <p className="text-destructive text-sm">
          {request.provider === "gitlab" ? (
            <Trans id="codeReview.gitlab.updateFailed">
              GitLab could not update this merge request
            </Trans>
          ) : (
            <Trans id="pullRequestDetail.actions.updateError">
              GitHub could not update this pull request
            </Trans>
          )}
        </p>
      ) : null}
    </header>
  )
}

function Description({
  pullRequest,
  request,
}: Readonly<{ pullRequest: PullRequestModel; request: DetailRequest }>) {
  const { i18n } = useLingui()
  const write = usePullRequestWrite(request)
  const [editing, setEditing] = useState(false)
  const [mode, setMode] = useState<"write" | "preview">("write")
  const [body, setBody] = useState(pullRequest.body ?? "")
  const save = () => {
    setEditing(false)
    if (body === (pullRequest.body ?? "")) return
    write.mutate(() =>
      request.provider === "gitlab"
        ? gitlabWrite(request, "update-body", { body })
        : githubWrite(request, "update", { action: "update-body", body })
    )
  }
  if (editing) {
    return (
      <section className="mt-6 flex flex-col gap-2">
        <div
          aria-label={i18n._(
            msg({
              id: "pullRequestDetail.description.editorMode",
              message: "Description editor mode",
            })
          )}
          className="flex gap-1"
          role="tablist"
        >
          {(["write", "preview"] as const).map((value) => (
            <button
              key={value}
              aria-selected={mode === value}
              className={cn(
                "rounded-md px-2 py-1 text-sm",
                mode === value ? "bg-accent text-foreground" : "text-muted-foreground"
              )}
              role="tab"
              type="button"
              onClick={() => setMode(value)}
            >
              {value === "write" ? (
                <Trans id="pullRequestDetail.description.write">Write</Trans>
              ) : (
                <Trans id="pullRequestDetail.description.preview">Preview</Trans>
              )}
            </button>
          ))}
        </div>
        {mode === "write" ? (
          <Textarea
            aria-label={i18n._(
              msg({
                id: "pullRequestDetail.description.editorLabel",
                message: "Description editor",
              })
            )}
            className="min-h-48 font-mono text-[13px]"
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        ) : body.trim() ? (
          <Markdown className="min-h-48 rounded-md border border-border p-3">{body}</Markdown>
        ) : (
          <p className="min-h-48 rounded-md border border-border p-3 text-muted-foreground text-sm">
            <Trans id="pullRequestDetail.description.emptyPreview">Nothing to preview</Trans>
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            <Trans id="pullRequestDetail.edit.cancel">Cancel</Trans>
          </Button>
          <Button size="sm" onClick={save}>
            <Trans id="pullRequestDetail.edit.save">Save</Trans>
          </Button>
        </div>
      </section>
    )
  }
  return (
    <section className="mt-6">
      {pullRequest.body?.trim() ? (
        <Markdown>{pullRequest.body}</Markdown>
      ) : (
        <p className="text-muted-foreground text-sm">
          <Trans id="pullRequestDetail.description.empty">No description provided</Trans>
        </p>
      )}
      <div className="mt-4 flex items-center gap-2">
        <Reactions pullRequest={pullRequest} request={request} />
        {pullRequest.viewerCanUpdate ? (
          <button
            aria-label={i18n._(
              msg({ id: "pullRequestDetail.description.edit", message: "Edit description" })
            )}
            className="ml-auto flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
            type="button"
            onClick={() => {
              setBody(pullRequest.body ?? "")
              setMode("write")
              setEditing(true)
            }}
          >
            <PencilIcon className="size-3.5" />
            <Trans id="pullRequestDetail.description.editButton">Edit</Trans>
          </button>
        ) : null}
      </div>
    </section>
  )
}

const REACTIONS: { content: string; emoji: string }[] = [
  { content: "THUMBS_UP", emoji: "👍" },
  { content: "THUMBS_DOWN", emoji: "👎" },
  { content: "LAUGH", emoji: "😄" },
  { content: "HOORAY", emoji: "🎉" },
  { content: "CONFUSED", emoji: "😕" },
  { content: "HEART", emoji: "❤️" },
  { content: "ROCKET", emoji: "🚀" },
  { content: "EYES", emoji: "👀" },
]

function Reactions({
  nodeId,
  pullRequest,
  reactions = pullRequest.reactions,
  request,
  subject = "pull_request",
  viewerCanReact = pullRequest.viewerCanReact,
}: Readonly<{
  nodeId?: string
  pullRequest: PullRequestModel
  reactions?: readonly Reaction[]
  request: DetailRequest
  subject?: string
  viewerCanReact?: boolean
}>) {
  const { i18n } = useLingui()
  const write = usePullRequestWrite(request)
  const [local, setLocal] = useState<readonly Reaction[] | null>(null)
  const shown = (local ?? reactions).filter((reaction) => reaction.count > 0)
  const toggle = (content: string) => {
    const current = (local ?? reactions).find((reaction) => reaction.content === content)
    const active = !current?.viewerHasReacted
    setLocal(
      REACTIONS.map(({ content: key }) => {
        const existing = (local ?? reactions).find((reaction) => reaction.content === key)
        const base = existing ?? { content: key, count: 0, viewerHasReacted: false }
        return key === content
          ? {
              ...base,
              count: Math.max(0, base.count + (active ? 1 : -1)),
              viewerHasReacted: active,
            }
          : base
      })
    )
    write.mutate(() =>
      host.github("gh-pr-reaction-update", {
        account: request.account,
        active,
        content,
        pullRequest: request.pullRequest,
        subject,
        ...(nodeId ? { nodeId } : {}),
      })
    )
  }
  if (request.provider === "gitlab") return null
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((reaction) => (
        <button
          key={reaction.content}
          aria-label={i18n._(
            msg({
              id: "codeReview.reactions.count",
              message: `${reaction.content}, ${reaction.count} reactions`,
            })
          )}
          className={cn(
            "flex h-7 items-center gap-1 rounded-full border px-2 text-xs",
            reaction.viewerHasReacted ? "border-primary/40 bg-primary/10" : "border-border"
          )}
          disabled={!viewerCanReact}
          type="button"
          onClick={() => toggle(reaction.content)}
        >
          {REACTIONS.find((entry) => entry.content === reaction.content)?.emoji ?? reaction.emoji}
          <span>{reaction.count}</span>
        </button>
      ))}
      {viewerCanReact ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={i18n._(msg({ id: "codeReview.reactions.add", message: "Add reaction" }))}
            render={
              <button
                className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                type="button"
              />
            }
          >
            <SmilePlusIcon className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="flex min-w-0 gap-1 p-1">
            {REACTIONS.map((reaction) => (
              <DropdownMenuItem
                key={reaction.content}
                className="px-1.5 text-base"
                onClick={() => toggle(reaction.content)}
              >
                {reaction.emoji}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}

const isBot = (login: string | null | undefined) =>
  Boolean(login && (/\[bot\]$/iu.test(login) || /-bot$/iu.test(login)))

function Activity({
  activity,
  loading,
  onOpenComment,
  pullRequest,
  request,
  viewerAvatarUrl,
}: Readonly<{
  activity: readonly ActivityItem[]
  loading: boolean
  onOpenComment: (target: CommentTarget) => void
  pullRequest: PullRequestModel
  request: DetailRequest
  viewerAvatarUrl: string | null
}>) {
  const { i18n } = useLingui()
  const [filter, setFilter] = useState<ActivityFilter>("all")
  const items = useMemo(
    () =>
      [...activity]
        .filter((item) =>
          filter === "all"
            ? true
            : filter === "commits"
              ? item.type === "commit_group"
              : item.type !== "event" &&
                item.type !== "commit_group" &&
                (filter === "comments" || !isBot((item as Comment).authorLogin))
        )
        .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)),
    [activity, filter]
  )
  const filters: Record<ActivityFilter, string> = {
    all: i18n._(msg({ id: "pullRequestDetail.activity.filter.all", message: "All activity" })),
    comments: i18n._(
      msg({ id: "pullRequestDetail.activity.filter.comments", message: "All comments" })
    ),
    commits: i18n._(msg({ id: "pullRequestDetail.activity.filter.commits", message: "Commits" })),
    human: i18n._(
      msg({ id: "pullRequestDetail.activity.filter.humanComments", message: "Human comments" })
    ),
  }
  return (
    <section className="mt-10 flex flex-col gap-3 border-border border-t pt-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-lg">
          <Trans id="pullRequestDetail.activity.title">Activity</Trans>
        </h2>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                className="flex items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
                type="button"
              />
            }
          >
            <ListFilterIcon className="size-4" />
            {filters[filter]}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={filter}
              onValueChange={(value) => setFilter(value as ActivityFilter)}
            >
              {(Object.keys(filters) as ActivityFilter[]).map((key) => (
                <DropdownMenuRadioItem key={key} value={key}>
                  {filters[key]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {loading ? (
        <p className="text-muted-foreground text-sm">
          <Trans id="pullRequestDetail.activity.loading">Loading activity</Trans>
        </p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          <Trans id="pullRequestDetail.activity.empty">No activity</Trans>
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {items.flatMap((item) =>
            item.type === "commit_group"
              ? item.commits.map((commit) => (
                  <li
                    key={commit.oid}
                    className="flex h-11 items-center gap-3 rounded-xl border border-border/70 px-3 text-sm"
                  >
                    <GitCommitHorizontalIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{commit.messageHeadline}</span>
                    <span className="font-mono text-muted-foreground text-xs">
                      {commit.oid.slice(0, 7)}
                    </span>
                    <Avatar login={commit.authorLogin} />
                    <span className="w-8 text-right text-muted-foreground text-xs">
                      {compactAge(commit.committedDate)}
                    </span>
                  </li>
                ))
              : item.type === "event"
                ? [
                    <li
                      key={item.id}
                      className="flex h-11 items-center gap-3 rounded-xl border border-border/70 px-3 text-sm"
                    >
                      <EventIcon event={item.event} />
                      <span className="min-w-0 flex-1 truncate">
                        <EventText
                          actor={item.actorLogin}
                          event={item.event}
                          provider={request.provider}
                        />
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {compactAge(item.createdAt)}
                      </span>
                    </li>,
                  ]
                : [
                    <li key={item.id}>
                      <CommentCard
                        comment={item as Comment}
                        pullRequest={pullRequest}
                        request={request}
                        onOpenComment={onOpenComment}
                      />
                    </li>,
                  ]
          )}
        </ol>
      )}
      <CommentComposer request={request} viewerAvatarUrl={viewerAvatarUrl} />
    </section>
  )
}

function EventIcon({ event }: Readonly<{ event: string }>) {
  if (event === "merged")
    return <GitMergeIcon className="size-4 shrink-0 text-violet-600 dark:text-violet-300" />
  if (event === "opened") {
    return (
      <GitPullRequestArrowIcon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
    )
  }
  return <GitPullRequestArrowIcon className="size-4 shrink-0 text-muted-foreground" />
}

function EventText({
  actor,
  event,
  provider,
}: Readonly<{ actor: string | null; event: string; provider: "github" | "gitlab" }>) {
  const who = actor ?? ""
  if (event === "merged") {
    if (!actor) {
      return provider === "gitlab" ? (
        <Trans id="codeReview.gitlab.states.timelineMergedUnknown">
          Someone merged this merge request
        </Trans>
      ) : (
        <Trans id="codeReview.github.states.timelineMergedUnknown">
          Someone merged this pull request
        </Trans>
      )
    }
    return provider === "gitlab" ? (
      <Trans id="codeReview.gitlab.states.timelineMerged">{who} merged this merge request</Trans>
    ) : (
      <Trans id="pullRequestDetail.timeline.merged">{who} merged this pull request</Trans>
    )
  }
  if (event === "opened") {
    if (!actor) {
      return provider === "gitlab" ? (
        <Trans id="codeReview.gitlab.states.timelineOpenedUnknown">
          Someone opened this merge request
        </Trans>
      ) : (
        <Trans id="codeReview.github.states.timelineOpenedUnknown">
          Someone opened this pull request
        </Trans>
      )
    }
    return provider === "gitlab" ? (
      <Trans id="codeReview.gitlab.states.timelineOpened">{who} opened this merge request</Trans>
    ) : (
      <Trans id="pullRequestDetail.timeline.opened">{who} opened this pull request</Trans>
    )
  }
  if (event === "approved") {
    return actor ? (
      <Trans id="pullRequestDetail.timeline.approved">{who} approved these changes</Trans>
    ) : (
      <Trans id="codeReview.states.timelineApprovedUnknown">Someone approved these changes</Trans>
    )
  }
  return actor ? (
    <Trans id="pullRequestDetail.timeline.changesRequested">{who} requested changes</Trans>
  ) : (
    <Trans id="codeReview.states.timelineChangesRequestedUnknown">Someone requested changes</Trans>
  )
}

/** One comment, review, or review thread in the activity list. */
export function CommentCard({
  comment,
  onOpenComment,
  pullRequest,
  request,
}: Readonly<{
  comment: Comment
  onOpenComment?: (target: CommentTarget) => void
  pullRequest: PullRequestModel
  request: DetailRequest
}>) {
  const { i18n } = useLingui()
  const write = usePullRequestWrite(request)
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(comment.body)
  const [collapsed, setCollapsed] = useState(
    comment.type === "review_comment" && comment.isResolved === true
  )
  const commentType = comment.type
  const save = () => {
    setEditing(false)
    if (body.trim() === comment.body.trim()) return
    write.mutate(() =>
      request.provider === "gitlab"
        ? gitlabWrite(request, "update-comment", { body, commentId: comment.id })
        : githubWrite(request, "commentUpdate", {
            action: "update",
            body,
            commentType,
            nodeId: comment.nodeId ?? comment.id,
          })
    )
  }
  const remove = () =>
    write.mutate(() =>
      request.provider === "gitlab"
        ? gitlabWrite(request, "delete-comment", { commentId: comment.id })
        : githubWrite(request, "commentUpdate", {
            action: "delete",
            commentType,
            nodeId: comment.nodeId ?? comment.id,
          })
    )
  const location =
    comment.path && (comment.line ?? comment.originalLine)
      ? {
          line: (comment.line ?? comment.originalLine) as number,
          path: comment.path,
          side: comment.side ?? "right",
        }
      : null
  if (!comment.body.trim() && comment.type === "review" && !(comment.replies?.length ?? 0))
    return null
  return (
    <article className="rounded-xl border border-border/70">
      <div className="flex items-center gap-2 px-3 pt-3 text-sm">
        <Avatar login={comment.authorLogin} src={comment.authorAvatarUrl} />
        <span className="font-medium">
          {comment.authorLogin ?? (
            <Trans id="pullRequestsPage.detail.commentUnknownAuthor">Unknown author</Trans>
          )}
        </span>
        <span className="text-muted-foreground text-xs">{compactAge(comment.createdAt)}</span>
        {comment.isPending ? (
          <span
            className="rounded-full bg-amber-500/15 px-1.5 text-amber-700 text-xs dark:text-amber-300"
            title={i18n._(
              msg({
                id: "pullRequestDetail.comment.pendingTooltip",
                message: "Only visible to you until review is submitted",
              })
            )}
          >
            <Trans id="pullRequestDetail.comment.pending">Pending</Trans>
          </span>
        ) : null}
        {comment.type === "review_comment" && comment.isResolved ? (
          <button
            className="text-muted-foreground text-xs hover:text-foreground"
            type="button"
            onClick={() => setCollapsed((value) => !value)}
          >
            <Trans id="pullRequestDetail.comment.statusResolved">Resolved</Trans>
          </button>
        ) : null}
        {location ? (
          <button
            className="ml-1 min-w-0 truncate font-mono text-muted-foreground text-xs hover:text-foreground"
            title={i18n._(
              msg({
                id: "pullRequestsPage.detail.openCommentInReview",
                message: "Open comment in review",
              })
            )}
            type="button"
            onClick={() => onOpenComment?.(location)}
          >
            {location.path}:{location.line}
          </button>
        ) : null}
        {comment.viewerCanUpdate || comment.viewerCanDelete || comment.url ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={i18n._(
                msg({ id: "pullRequestDetail.comment.actions", message: "Comment actions" })
              )}
              render={
                <button
                  className="ml-auto flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
                  type="button"
                />
              }
            >
              <MoreHorizontalIcon className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {comment.viewerCanUpdate ? (
                <DropdownMenuItem onClick={() => setEditing(true)}>
                  <Trans id="pullRequestDetail.comment.edit">Edit</Trans>
                </DropdownMenuItem>
              ) : null}
              {comment.url ? (
                <DropdownMenuItem onClick={() => void host.openLink(comment.url as string)}>
                  {request.provider === "gitlab" ? (
                    <Trans id="pullRequestsPage.detail.viewCommentOnGitHub.gitlab">
                      View on GitLab
                    </Trans>
                  ) : (
                    <Trans id="pullRequestsPage.detail.viewCommentOnGitHub">View on GitHub</Trans>
                  )}
                </DropdownMenuItem>
              ) : null}
              {comment.viewerCanDelete ? (
                <DropdownMenuItem variant="destructive" onClick={remove}>
                  <Trans id="pullRequestDetail.comment.delete">Delete</Trans>
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {collapsed ? null : (
        <div className="px-3 pt-2 pb-3">
          {comment.diffHunk ? (
            <pre className="mb-2 max-h-40 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[12px] leading-5">
              {comment.diffHunk.split("\n").slice(-6).join("\n")}
            </pre>
          ) : null}
          {editing ? (
            <div className="flex flex-col gap-2">
              <Textarea
                aria-label={i18n._(
                  msg({
                    id: "pullRequestsPage.detail.commentEditInput.ariaLabel",
                    message: "Edit pull request comment",
                  })
                )}
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  <Trans id="pullRequestsPage.detail.commentReplyInput.cancel">Cancel</Trans>
                </Button>
                <Button size="sm" onClick={save}>
                  <Trans id="pullRequestsPage.detail.commentEditInput.submit">Save changes</Trans>
                </Button>
              </div>
            </div>
          ) : comment.body.trim() ? (
            <Markdown>{comment.body}</Markdown>
          ) : null}
          {comment.reactions?.length || comment.viewerCanReact ? (
            <div className="mt-2">
              <Reactions
                nodeId={comment.nodeId}
                pullRequest={pullRequest}
                reactions={comment.reactions ?? []}
                request={request}
                subject={comment.type}
                viewerCanReact={comment.viewerCanReact ?? false}
              />
            </div>
          ) : null}
          {comment.replies?.map((reply) => (
            <div key={reply.id} className="mt-3 border-border/70 border-t pt-3">
              <div className="flex items-center gap-2 text-sm">
                <Avatar login={reply.authorLogin} src={reply.authorAvatarUrl} />
                <span className="font-medium">{reply.authorLogin}</span>
                <span className="text-muted-foreground text-xs">{compactAge(reply.createdAt)}</span>
              </div>
              <Markdown className="mt-1">{reply.body}</Markdown>
            </div>
          ))}
          {comment.reviewThreadId ? <ThreadActions comment={comment} request={request} /> : null}
        </div>
      )}
    </article>
  )
}

/** Reply to a review thread, and resolve or reopen it. */
export function ThreadActions({
  comment,
  request,
}: Readonly<{ comment: Comment; request: DetailRequest }>) {
  const { i18n } = useLingui()
  const write = usePullRequestWrite(request)
  const [replying, setReplying] = useState(false)
  const [body, setBody] = useState("")
  const threadId = comment.reviewThreadId as string
  const reply = () => {
    const text = body.trim()
    if (!text) return
    setBody("")
    setReplying(false)
    write.mutate(() =>
      request.provider === "gitlab"
        ? gitlabWrite(request, "reply-comment", { body: text, discussionId: threadId })
        : githubWrite(request, "comment", { body: text, replyToReviewThreadId: threadId })
    )
  }
  const resolve = (resolved: boolean) =>
    write.mutate(() =>
      request.provider === "gitlab"
        ? gitlabWrite(request, "update-resolution", { discussionId: threadId, resolved })
        : githubWrite(request, "reviewThreadUpdate", {
            action: resolved ? "resolve" : "unresolve",
            reviewThreadId: threadId,
          })
    )
  return replying ? (
    <div className="mt-3 flex flex-col gap-2">
      <Textarea
        aria-label={i18n._(
          msg({
            id: "pullRequestsPage.detail.commentReplyInput.ariaLabel",
            message: "Pull request reply",
          })
        )}
        autoFocus
        placeholder={i18n._(
          msg({
            id: "pullRequestsPage.detail.commentReplyInput.unknownAuthorPlaceholder",
            message: "Reply to comment",
          })
        )}
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setReplying(false)}>
          <Trans id="pullRequestsPage.detail.commentReplyInput.cancel">Cancel</Trans>
        </Button>
        <Button disabled={!body.trim()} size="sm" onClick={reply}>
          <Trans id="pullRequestsPage.detail.commentReplyInput.submit">Reply</Trans>
        </Button>
      </div>
    </div>
  ) : (
    <div className="mt-3 flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={() => setReplying(true)}>
        <Trans id="pullRequestDetail.comment.reply">Reply</Trans>
      </Button>
      {comment.isResolved ? (
        comment.viewerCanUnresolve !== false ? (
          <Button size="sm" variant="ghost" onClick={() => resolve(false)}>
            <Trans id="pullRequestDetail.comment.unresolve">Reopen</Trans>
          </Button>
        ) : null
      ) : comment.viewerCanResolve !== false ? (
        <Button size="sm" variant="ghost" onClick={() => resolve(true)}>
          <Trans id="pullRequestDetail.comment.resolve">Resolve</Trans>
        </Button>
      ) : null}
    </div>
  )
}

function CommentComposer({
  request,
  viewerAvatarUrl,
}: Readonly<{ request: DetailRequest; viewerAvatarUrl: string | null }>) {
  const { i18n } = useLingui()
  const write = usePullRequestWrite(request)
  const [body, setBody] = useState("")
  const submit = () => {
    const text = body.trim()
    if (!text) return
    write.mutate(
      () =>
        request.provider === "gitlab"
          ? gitlabWrite(request, "post-comment", { body: text })
          : githubWrite(request, "comment", { body: text }),
      { onSuccess: () => setBody("") }
    )
  }
  return (
    <div className="mt-3 rounded-xl border border-border/70 p-3">
      <div className="flex gap-3">
        <Avatar className="size-7" src={viewerAvatarUrl} />
        <Textarea
          aria-label={
            request.provider === "gitlab"
              ? i18n._(
                  msg({
                    id: "pullRequestsPage.detail.commentInput.ariaLabel.gitlab",
                    message: "Merge request comment",
                  })
                )
              : i18n._(
                  msg({
                    id: "pullRequestsPage.detail.commentInput.ariaLabel",
                    message: "Pull request comment",
                  })
                )
          }
          className="min-h-9 resize-none border-0 p-0 shadow-none focus-visible:ring-0"
          placeholder={i18n._(
            msg({
              id: "pullRequestsPage.detail.commentInput.placeholder",
              message: "Leave a comment",
            })
          )}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit()
          }}
        />
      </div>
      <div className="mt-2 flex items-center gap-2 pl-10">
        <Button
          className="rounded-full"
          disabled={!body.trim() || write.isPending}
          size="sm"
          onClick={submit}
        >
          {write.isPending ? (
            <Trans id="pullRequestsPage.detail.commentInput.posting">Posting comment</Trans>
          ) : (
            <Trans id="pullRequestsPage.detail.commentInput.comment">Comment</Trans>
          )}
        </Button>
        {write.error ? (
          <span className="text-destructive text-sm">
            {request.provider === "gitlab" ? (
              <Trans id="pullRequestsPage.detail.commentInput.error.gitlab">
                GitLab could not post this comment
              </Trans>
            ) : (
              <Trans id="pullRequestsPage.detail.commentInput.error">
                GitHub could not post this comment
              </Trans>
            )}
          </span>
        ) : null}
      </div>
    </div>
  )
}
