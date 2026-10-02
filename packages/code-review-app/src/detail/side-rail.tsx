import { Button } from "@cypheria/ui/components/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@cypheria/ui/components/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@cypheria/ui/components/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@cypheria/ui/components/popover"
import { cn } from "@cypheria/ui/lib/utils"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  CircleIcon,
  MessageCircleIcon,
  MinusCircleIcon,
  XIcon,
} from "lucide-react"
import { type ReactNode, useState } from "react"

import { callTool } from "../bridge.js"
import {
  type DetailRequest,
  githubWrite,
  gitlabWrite,
  type PullRequestModel,
  searchUsers,
  usePullRequestWrite,
  useReviewers,
  useStack,
} from "../data.js"
import { host } from "../host.js"
import type { Check, Comment, PrivateReview } from "../schemas.js"
import { MergeDialog } from "./merge.js"
import { Avatar, compactAge, Markdown } from "./shared.js"
import type { CommentTarget } from "./summary-tab.js"

/** The status column beside Summary: threads, comments, reviews, checks, merge, stack, review. */
export function SideRail({
  onOpenComment,
  privateReview,
  pullRequest,
  request,
  reviewThreads,
}: Readonly<{
  onOpenComment: (target: CommentTarget) => void
  privateReview: { review: PrivateReview | null; completedReviews: PrivateReview[] } | null
  pullRequest: PullRequestModel
  request: DetailRequest
  reviewThreads: readonly Comment[]
}>) {
  return (
    <div className="flex flex-col">
      <Threads pullRequest={pullRequest} />
      <Comments threads={reviewThreads} onOpenComment={onOpenComment} />
      <Reviewers pullRequest={pullRequest} request={request} />
      <Checks pullRequest={pullRequest} request={request} />
      {pullRequest.state === "open" ? (
        <MergeStatus pullRequest={pullRequest} request={request} />
      ) : null}
      <Stack request={request} />
      {privateReview?.review ? (
        <PrivateReviewSection
          review={privateReview.review}
          request={request}
          onOpenComment={onOpenComment}
        />
      ) : null}
    </div>
  )
}

function Section({
  action,
  children,
  title,
}: Readonly<{ action?: ReactNode; children: ReactNode; title: ReactNode }>) {
  return (
    <section className="flex flex-col gap-2 border-border border-b py-4 first:pt-0 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-muted-foreground text-sm">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function Threads({ pullRequest }: Readonly<{ pullRequest: PullRequestModel }>) {
  const threads = useQuery({
    queryFn: () => host.threads(pullRequest.url),
    queryKey: ["associated-threads", pullRequest.url],
    staleTime: 30_000,
  })
  const list = threads.data?.threads ?? []
  if (list.length === 0) return null
  return (
    <Section title={<Trans id="pullRequestDetail.associatedTasks.title">Threads</Trans>}>
      <ul className="flex flex-col gap-1">
        {list.map((thread) => (
          <li key={thread.id}>
            <button
              className="flex w-full items-center gap-2 rounded-md py-1 text-left text-sm hover:text-foreground"
              type="button"
              onClick={() => void host.openThread(thread.id)}
            >
              <MessageCircleIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{thread.title ?? thread.id}</span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Comments({
  onOpenComment,
  threads,
}: Readonly<{ onOpenComment: (target: CommentTarget) => void; threads: readonly Comment[] }>) {
  const [showResolved, setShowResolved] = useState(false)
  const open = threads.filter((thread) => !thread.isResolved)
  const resolved = threads.filter((thread) => thread.isResolved)
  const shown = showResolved ? threads : open
  return (
    <Section title={<Trans id="pullRequestDetail.comments.title">Comments</Trans>}>
      {threads.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          <Trans id="pullRequestDetail.comments.empty">No comments</Trans>
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {shown.map((thread) => (
              <li key={thread.id}>
                <button
                  className="flex w-full flex-col gap-0.5 rounded-md text-left text-sm"
                  type="button"
                  onClick={() =>
                    thread.path &&
                    onOpenComment({
                      line: thread.line ?? thread.originalLine ?? 1,
                      path: thread.path,
                      side: thread.side ?? "right",
                    })
                  }
                >
                  <span className="flex items-center gap-1.5">
                    <Avatar
                      className="size-4"
                      login={thread.authorLogin}
                      src={thread.authorAvatarUrl}
                    />
                    <span className="truncate font-medium">{thread.authorLogin}</span>
                    <span className="ml-auto text-muted-foreground text-xs">
                      {compactAge(thread.createdAt)}
                    </span>
                  </span>
                  <span className="line-clamp-2 text-muted-foreground">{thread.body}</span>
                </button>
              </li>
            ))}
          </ul>
          {resolved.length > 0 ? (
            <button
              className="self-start text-muted-foreground text-xs hover:text-foreground"
              type="button"
              onClick={() => setShowResolved((value) => !value)}
            >
              {showResolved ? (
                <Trans id="pullRequestDetail.comments.hideResolved">Hide resolved</Trans>
              ) : (
                <Trans id="pullRequestDetail.comments.showResolved">
                  Show {resolved.length} resolved
                </Trans>
              )}
            </button>
          ) : null}
        </>
      )}
    </Section>
  )
}

type ReviewerState = "approved" | "changes_requested" | "commented" | "waiting"

function Reviewers({
  pullRequest,
  request,
}: Readonly<{ pullRequest: PullRequestModel; request: DetailRequest }>) {
  const { i18n } = useLingui()
  const reviewers = useReviewers(request)
  const write = usePullRequestWrite(request)
  const data = reviewers.data?.reviewers
  const rows: { login: string; state: ReviewerState; team?: boolean }[] = []
  const add = (logins: readonly string[] | undefined, state: ReviewerState) => {
    for (const login of logins ?? [])
      if (!rows.some((row) => row.login === login)) rows.push({ login, state })
  }
  add(data?.approved, "approved")
  add(data?.changesRequested, "changes_requested")
  add(data?.commented, "commented")
  add(data?.requested, "waiting")
  for (const team of data?.requestedTeams ?? [])
    rows.push({ login: team, state: "waiting", team: true })
  const request_ = (login: string) =>
    write.mutate(() =>
      request.provider === "gitlab"
        ? gitlabWrite(request, "update-reviewer-assignment", { action: "add", reviewers: [login] })
        : githubWrite(request, "update", { action: "request-reviewers", reviewers: [login] })
    )
  const remove = (login: string, team: boolean) =>
    write.mutate(() =>
      request.provider === "gitlab"
        ? gitlabWrite(request, "update-reviewer-assignment", {
            action: "remove",
            reviewers: [login],
          })
        : githubWrite(request, "update", {
            action: "remove-reviewers",
            reviewers: team ? [] : [login],
            teamReviewers: team ? [data?.requestedTeamSlugs?.[login] ?? login] : [],
          })
    )
  return (
    <Section
      action={
        pullRequest.canManageReviewers && pullRequest.state === "open" ? (
          <ReviewerPicker request={request} onSelect={request_} />
        ) : null
      }
      title={<Trans id="pullRequestDetail.reviews">Reviews</Trans>}
    >
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          <Trans id="pullRequestDetail.reviews.empty">No reviews</Trans>
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <li
              key={`${row.team ? "team:" : ""}${row.login}`}
              className="group flex items-center gap-2 text-sm"
            >
              <Avatar
                className="size-5"
                login={row.login}
                src={row.team ? null : (data?.avatarUrlsByLogin?.[row.login] ?? null)}
              />
              <span className="min-w-0 flex-1 truncate">{row.login}</span>
              <ReviewerIcon state={row.state} />
              {pullRequest.canManageReviewers && row.state === "waiting" ? (
                <button
                  aria-label={i18n._(
                    msg({
                      id: "pullRequestSidePanel.approvals.removeSelf",
                      message: "Remove your review request",
                    })
                  )}
                  className="hidden text-muted-foreground hover:text-foreground group-hover:block"
                  type="button"
                  onClick={() => remove(row.login, Boolean(row.team))}
                >
                  <XIcon className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function ReviewerIcon({ state }: Readonly<{ state: ReviewerState }>) {
  const { i18n } = useLingui()
  const [Icon, tone, label] =
    state === "approved"
      ? [
          CheckIcon,
          "text-emerald-600 dark:text-emerald-400",
          i18n._(
            msg({ id: "pullRequestSidePanel.overview.reviewer.approved", message: "Approved" })
          ),
        ]
      : state === "changes_requested"
        ? [
            MinusCircleIcon,
            "text-red-600 dark:text-red-400",
            i18n._(
              msg({
                id: "pullRequestSidePanel.overview.reviewer.changesRequested",
                message: "Requested changes",
              })
            ),
          ]
        : state === "commented"
          ? [
              MessageCircleIcon,
              "text-muted-foreground",
              i18n._(
                msg({
                  id: "pullRequestSidePanel.overview.reviewer.commented",
                  message: "Commented",
                })
              ),
            ]
          : [
              CircleDashedIcon,
              "text-amber-600 dark:text-amber-400",
              i18n._(
                msg({
                  id: "pullRequestSidePanel.overview.reviewer.waiting",
                  message: "Waiting for review",
                })
              ),
            ]
  return (
    <span className={cn("shrink-0", tone)} title={label}>
      <Icon className="size-4" />
    </span>
  )
}

function ReviewerPicker({
  onSelect,
  request,
}: Readonly<{ onSelect: (login: string) => void; request: DetailRequest }>) {
  const { i18n } = useLingui()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const users = useQuery({
    enabled: open && query.trim().length > 0,
    queryFn: () => searchUsers(request, query.trim(), "collaborators"),
    queryKey: ["user-search", request.pullRequest, query.trim()],
    staleTime: 60_000,
  })
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button className="text-muted-foreground text-sm hover:text-foreground" type="button" />
        }
      >
        <Trans id="pullRequestDetail.reviews.request">Request</Trans>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        <Command shouldFilter={false}>
          <CommandInput
            aria-label={
              request.provider === "gitlab"
                ? i18n._(
                    msg({
                      id: "pullRequestSidePanel.approvals.search.ariaLabel.gitlab",
                      message: "Search GitLab users",
                    })
                  )
                : i18n._(
                    msg({
                      id: "pullRequestSidePanel.approvals.search.ariaLabel",
                      message: "Search GitHub users",
                    })
                  )
            }
            placeholder={i18n._(
              msg({
                id: "pullRequestSidePanel.approvals.search.placeholder",
                message: "Request review from…",
              })
            )}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {query.trim() ? (
              <CommandEmpty>
                {users.isLoading ? (
                  <Trans id="pullRequestSidePanel.approvals.search.loading">Searching…</Trans>
                ) : users.isError ? (
                  <Trans id="pullRequestSidePanel.approvals.search.error">
                    Couldn’t search GitHub users
                  </Trans>
                ) : (
                  <Trans id="pullRequestSidePanel.approvals.search.empty">No users found</Trans>
                )}
              </CommandEmpty>
            ) : (
              <p className="px-3 py-4 text-muted-foreground text-sm">
                {request.provider === "gitlab" ? (
                  <Trans id="pullRequestSidePanel.approvals.search.prompt.gitlab">
                    Search by name or GitLab username
                  </Trans>
                ) : (
                  <Trans id="pullRequestSidePanel.approvals.search.prompt">
                    Search by name or GitHub username
                  </Trans>
                )}
              </p>
            )}
            <CommandGroup>
              {(users.data ?? []).map((user) => (
                <CommandItem
                  key={user.login}
                  value={user.login}
                  onSelect={() => {
                    setOpen(false)
                    setQuery("")
                    onSelect(user.login)
                  }}
                >
                  <Avatar className="size-5" login={user.login} src={user.avatarUrl} />
                  {user.login}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

const checkOrder: Record<Check["status"], number> = {
  failing: 0,
  pending: 1,
  neutral: 2,
  unknown: 3,
  passing: 4,
  skipped: 5,
}

function Checks({
  pullRequest,
  request,
}: Readonly<{ pullRequest: PullRequestModel; request: DetailRequest }>) {
  const [open, setOpen] = useState(false)
  const checks = [...pullRequest.checks].sort(
    (left, right) => checkOrder[left.status] - checkOrder[right.status]
  )
  const failing = checks.filter((check) => check.status === "failing")
  const passing = checks.filter((check) => check.status === "passing")
  const summary =
    checks.length === 0 ? (
      <Trans id="pullRequestDetail.checks.empty.short">No checks</Trans>
    ) : failing.length > 0 ? (
      <span className="text-red-600 dark:text-red-400">
        <Trans id="pullRequestDetail.checks.failingCount">{failing.length} failing</Trans>
      </span>
    ) : pullRequest.ciStatus === "pending" ? (
      <span className="text-amber-600 dark:text-amber-400">
        <Trans id="pullRequestDetail.checks.pending">Pending</Trans>
      </span>
    ) : (
      <span className="text-emerald-600 dark:text-emerald-400">
        <Trans id="pullRequestDetail.checks.successfulCount">{passing.length} successful</Trans>
      </span>
    )
  return (
    <section className="flex flex-col gap-2 border-border border-b py-4">
      <button
        className="flex items-center justify-between gap-2 text-sm"
        disabled={checks.length === 0}
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flex items-center gap-1 text-muted-foreground">
          <Trans id="pullRequestDetail.checks.sectionTitle">Checks</Trans>
          {open ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
        </span>
        <span className="text-muted-foreground">{summary}</span>
      </button>
      {open ? (
        <ul className="flex flex-col gap-1.5">
          {checks.map((check) => (
            <li
              key={`${check.workflow ?? ""}/${check.name}`}
              className="flex items-center gap-2 text-sm"
            >
              <CheckStatusIcon status={check.status} />
              <button
                className="min-w-0 flex-1 truncate text-left hover:underline"
                disabled={!check.link}
                type="button"
                onClick={() => check.link && void host.openLink(check.link)}
              >
                {check.workflow ? `${check.workflow} / ${check.name}` : check.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {failing.length > 0 && pullRequest.state === "open" ? (
        <Button
          className="self-start"
          size="sm"
          variant="outline"
          onClick={() =>
            void host.openChat({
              context: failing
                .map(
                  (check) =>
                    `- ${check.workflow ? `${check.workflow} / ` : ""}${check.name}${check.link ? ` (${check.link})` : ""}`
                )
                .join("\n"),
              intent: "fix-checks",
              provider: request.provider,
              pullRequest: request.pullRequest,
              title: pullRequest.title,
              url: pullRequest.url,
            })
          }
        >
          <Trans id="pullRequestDetail.checks.fix">Fix</Trans>
        </Button>
      ) : null}
    </section>
  )
}

function CheckStatusIcon({ status }: Readonly<{ status: Check["status"] }>) {
  if (status === "passing")
    return <CheckIcon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
  if (status === "failing")
    return <XIcon className="size-4 shrink-0 text-red-600 dark:text-red-400" />
  if (status === "pending")
    return <CircleDashedIcon className="size-4 shrink-0 animate-spin text-amber-600" />
  return <CircleIcon className="size-4 shrink-0 text-muted-foreground" />
}

function MergeStatus({
  pullRequest,
  request,
}: Readonly<{ pullRequest: PullRequestModel; request: DetailRequest }>) {
  const { i18n } = useLingui()
  const write = usePullRequestWrite(request)
  const [merging, setMerging] = useState(false)
  const state =
    pullRequest.mergeBlocker === "conflicts"
      ? "conflicts"
      : pullRequest.mergeBlocker === "unknown"
        ? "checking"
        : "current"
  const disabledReason = mergeDisabledReason(pullRequest, i18n)
  const toggleAutoMerge = () =>
    write.mutate(() =>
      request.provider === "gitlab"
        ? gitlabWrite(request, "configure-auto-merge", {
            enabled: !pullRequest.isAutoMergeEnabled,
            expectedHeadRevision: pullRequest.headRevision,
            mergeMethod: pullRequest.allowedMergeMethods[0] ?? "merge",
          })
        : githubWrite(request, "update", {
            action: "toggle-auto-merge",
            enabled: !pullRequest.isAutoMergeEnabled,
            mergeMethod: pullRequest.allowedMergeMethods[0] ?? "merge",
          })
    )
  return (
    <section className="flex flex-col gap-2 border-border border-b py-4">
      <h3 className="text-muted-foreground text-sm">
        <Trans id="pullRequestMergeStatus.heading">Merge status</Trans>
      </h3>
      <p className="text-sm">
        {state === "conflicts" ? (
          <span className="text-red-600 dark:text-red-400">
            <Trans id="pullRequestMergeStatus.conflicts">Merge conflicts</Trans>
          </span>
        ) : state === "checking" ? (
          <Trans id="pullRequestMergeStatus.checking">Checking…</Trans>
        ) : (
          <Trans id="pullRequestMergeStatus.current">Can merge without conflicts</Trans>
        )}
      </p>
      <div className="flex items-center gap-2">
        <div className="flex">
          <Button
            className="rounded-r-none"
            disabled={disabledReason != null || write.isPending}
            size="sm"
            title={disabledReason ?? undefined}
            onClick={() => setMerging(true)}
          >
            <Trans id="pullRequestsPage.detail.actions.merge.trigger">Merge</Trans>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  className="rounded-l-none border-l border-l-primary-foreground/20 px-1.5"
                  size="sm"
                />
              }
            >
              <ChevronDownIcon className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={toggleAutoMerge}>
                {pullRequest.isAutoMergeEnabled ? (
                  <Trans id="pullRequestsPage.detail.actions.disableAutoMerge">
                    Disable auto-merge
                  </Trans>
                ) : (
                  <Trans id="pullRequestsPage.detail.actions.autoMerge.menuItem">
                    Enable auto-merge
                  </Trans>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {state === "conflicts" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void host.openChat({
                intent: "fix-conflicts",
                provider: request.provider,
                pullRequest: request.pullRequest,
                title: pullRequest.title,
                url: pullRequest.url,
              })
            }
          >
            <Trans id="pullRequestDetail.checks.fix">Fix</Trans>
          </Button>
        ) : null}
      </div>
      {pullRequest.isAutoMergeEnabled ? (
        <p className="text-muted-foreground text-xs">
          <Trans id="pullRequestDetail.timeline.autoMergeEnabled">
            Automerge enabled — the branch will merge when all requirements are met.
          </Trans>
        </p>
      ) : null}
      {disabledReason ? <p className="text-muted-foreground text-xs">{disabledReason}</p> : null}
      <MergeDialog
        open={merging}
        pullRequest={pullRequest}
        request={request}
        onOpenChange={setMerging}
      />
    </section>
  )
}

const mergeDisabledReason = (
  pullRequest: PullRequestModel,
  i18n: ReturnType<typeof useLingui>["i18n"]
): string | null => {
  if (pullRequest.state === "closed") {
    return i18n._(
      msg({
        id: "pullRequestDetail.actions.merge.disabled.closed",
        message: "Reopen this pull request before merging",
      })
    )
  }
  if (pullRequest.isDraft) {
    return i18n._(
      msg({
        id: "pullRequestDetail.actions.merge.disabled.draft",
        message: "Mark this pull request ready for review before merging",
      })
    )
  }
  if (pullRequest.mergeBlocker === "conflicts") {
    return i18n._(
      msg({
        id: "pullRequestDetail.actions.merge.disabled.conflicts",
        message: "Resolve merge conflicts before merging",
      })
    )
  }
  if (pullRequest.ciStatus === "failing") {
    return i18n._(
      msg({
        id: "pullRequestDetail.actions.merge.disabled.failingChecks",
        message: "Fix failing checks before merging",
      })
    )
  }
  if (pullRequest.ciStatus === "pending") {
    return i18n._(
      msg({
        id: "pullRequestDetail.actions.merge.disabled.pendingChecks",
        message: "Wait for checks to finish before merging",
      })
    )
  }
  if (pullRequest.mergeBlocker === "unknown") {
    return i18n._(
      msg({
        id: "pullRequestDetail.actions.merge.disabled.unknown",
        message: "Still checking whether this can be merged",
      })
    )
  }
  if (!pullRequest.canMerge) {
    return i18n._(
      msg({
        id: "pullRequestDetail.actions.merge.disabled.blocked",
        message: "This pull request can’t be merged yet",
      })
    )
  }
  return null
}

function Stack({ request }: Readonly<{ request: DetailRequest }>) {
  const stack = useStack(request)
  const entries = stack.data?.entries ?? []
  if (entries.length < 2) return null
  return (
    <Section title={<Trans id="pullRequestStack.label">Stack</Trans>}>
      <ul className="flex flex-col gap-1">
        {entries.map((entry) => (
          <li
            key={entry.number}
            className={cn(
              "flex flex-col text-sm",
              entry.number === request.pullRequest.number ? "font-medium" : "text-muted-foreground"
            )}
          >
            <span className="truncate">{entry.title}</span>
            <span className="truncate text-muted-foreground text-xs">
              #{entry.number} · {entry.headBranch} → {entry.baseBranch}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function PrivateReviewSection({
  onOpenComment,
  request,
  review,
}: Readonly<{
  onOpenComment: (target: CommentTarget) => void
  request: DetailRequest
  review: PrivateReview
}>) {
  const client = useQueryClient()
  const cancel = useMutation({
    mutationFn: () =>
      callTool("pull_requests.cancelReview", {
        account: request.account,
        pullRequest: request.pullRequest,
        runId: review.runId,
      }),
    onSettled: () => client.invalidateQueries({ queryKey: ["private-review"] }),
  })
  const resolve = useMutation({
    mutationFn: (input: { index: number; resolved: boolean; posted?: true }) =>
      callTool("pull_requests.setReviewFindingResolved", {
        account: request.account,
        findingIndex: input.index,
        pullRequest: request.pullRequest,
        resolved: input.resolved,
        runId: review.runId,
        ...(input.posted ? { posted: true } : {}),
      }),
    onSettled: () => client.invalidateQueries({ queryKey: ["private-review"] }),
  })
  const post = useMutation({
    mutationFn: async (index: number) => {
      const finding = review.result?.findings[index]
      if (!finding) return
      if (request.provider === "gitlab") {
        await gitlabWrite(request, "post-comment", {
          body: `**${finding.title}**\n\n${finding.body}`,
          inlineComment: { line: finding.line, path: finding.path, side: finding.side },
        })
      } else {
        await githubWrite(request, "comment", {
          body: `**${finding.title}**\n\n${finding.body}`,
          expectedHeadRevision: review.headRevision,
          inlineComment: { line: finding.line, path: finding.path, side: finding.side },
        })
      }
      await resolve.mutateAsync({ index, posted: true, resolved: true })
    },
  })
  return (
    <Section title={<Trans id="privateReview.inline.author">Private review</Trans>}>
      {review.status === "queued" || review.status === "running" ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            <Trans id="codeReview.sidebar.privateReviewWorking">Private review in progress</Trans>
          </span>
          <Button size="sm" variant="ghost" onClick={() => cancel.mutate()}>
            <Trans id="pullRequestDetail.edit.cancel">Cancel</Trans>
          </Button>
        </div>
      ) : review.status === "failed" ? (
        <p className="text-destructive text-sm">{review.error}</p>
      ) : review.result ? (
        <div className="flex flex-col gap-3">
          <Markdown>{review.result.summary}</Markdown>
          <ul className="flex flex-col gap-2">
            {review.result.findings.map((finding, index) => {
              const resolved = review.findingResolutions[String(index)] === true
              const posted = review.findingPosts?.[String(index)] === true
              return (
                <li
                  key={`${finding.path}:${finding.line}:${finding.title}`}
                  className={cn(
                    "flex flex-col gap-1 rounded-lg border border-border/70 p-2",
                    resolved && "opacity-60"
                  )}
                >
                  <button
                    className="text-left font-medium text-sm hover:underline"
                    type="button"
                    onClick={() =>
                      onOpenComment({ line: finding.line, path: finding.path, side: finding.side })
                    }
                  >
                    <span className="mr-1 rounded bg-muted px-1 text-xs">P{finding.priority}</span>
                    {finding.title}
                  </button>
                  <span className="truncate font-mono text-muted-foreground text-xs">
                    {finding.path}:{finding.line}
                  </span>
                  <div className="flex gap-1">
                    {posted ? (
                      <span className="text-muted-foreground text-xs">
                        <Trans id="privateReview.finding.posted">Posted</Trans>
                      </span>
                    ) : (
                      <Button size="xs" variant="outline" onClick={() => post.mutate(index)}>
                        <Trans id="privateReview.finding.post">Post comment</Trans>
                      </Button>
                    )}
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => resolve.mutate({ index, resolved: !resolved })}
                    >
                      {resolved ? (
                        <Trans id="privateReview.finding.reopen">Reopen</Trans>
                      ) : (
                        <Trans id="privateReview.finding.resolve">Resolve</Trans>
                      )}
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </Section>
  )
}
