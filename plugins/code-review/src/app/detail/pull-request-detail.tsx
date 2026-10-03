import { Button } from "@cypheria/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@cypheria/ui/components/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@cypheria/ui/components/tooltip"
import { cn } from "@cypheria/ui/lib/utils"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ChevronDownIcon, LinkIcon, MessageCircleIcon, PinIcon, SettingsIcon } from "lucide-react"
import { type ReactNode, useState } from "react"

import { callTool, ReadFailure } from "../bridge.js"
import { accountKey, type DetailRequest, usePrivateReview, usePullRequest } from "../data.js"
import { host } from "../host.js"
import { Loading } from "../root.js"
import { GitHubMark, GitLabMark } from "./brand-icons.js"
import { ChangesTab } from "./changes-tab.js"
import { ReviewInstructionsDialog } from "./review-instructions.js"
import { copyText } from "./shared.js"
import { SummaryTab } from "./summary-tab.js"
import { WatchAndFix } from "./watch.js"

export type DetailSurface = "global" | "thread"

/**
 * One pull request: the Summary and Changes tabs, the actions above them, and the chat button.
 * Code Review's global page and a Thread's pull request tab show this same view.
 */
export function PullRequestDetail({
  request,
  surface,
  viewerAvatarUrl,
}: Readonly<{ request: DetailRequest; surface: DetailSurface; viewerAvatarUrl: string | null }>) {
  const { i18n } = useLingui()
  const pullRequest = usePullRequest(request)
  const [tab, setTab] = useState<"summary" | "changes">("summary")
  const [focus, setFocus] = useState<{ path: string; line: number; side: "left" | "right" } | null>(
    null
  )
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const privateReview = usePrivateReview(request)
  const client = useQueryClient()
  const startReview = useMutation({
    mutationFn: (force: boolean) =>
      callTool("pull_requests.startReview", {
        account: request.account,
        force,
        pullRequest: request.pullRequest,
      }),
    onSettled: () => client.invalidateQueries({ queryKey: ["private-review"] }),
  })

  if (pullRequest.isLoading) return <Loading />
  if (pullRequest.error || !pullRequest.data) {
    const access = pullRequest.error instanceof ReadFailure && pullRequest.error.kind === "access"
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-muted-foreground text-sm">
          {access ? (
            <Trans id="codeReview.selectedAccountUnavailable">
              This review is unavailable for the selected account
            </Trans>
          ) : (
            <Trans id="pullRequestDetail.unavailable">Pull request details are unavailable</Trans>
          )}
        </p>
        <Button size="sm" variant="outline" onClick={() => void pullRequest.refetch()}>
          <Trans id="pullRequestDetail.retry">Try again</Trans>
        </Button>
      </div>
    )
  }
  const pr = pullRequest.data
  const additions = pr.additions ?? 0
  const deletions = pr.deletions ?? 0
  const running = ["queued", "running"].includes(privateReview.data?.review?.status ?? "")
  const openIn =
    request.provider === "gitlab"
      ? i18n._(msg({ id: "pullRequestDetail.openInGitLab", message: "Open in GitLab" }))
      : i18n._(msg({ id: "pullRequestDetail.openInGitHub", message: "Open in GitHub" }))
  const sidebarItem = {
    authorAvatarUrl: pr.authorAvatarUrl,
    authorLogin: pr.authorLogin,
    title: pr.title,
    updatedAt: null,
    url: pr.url,
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <div
          aria-label={i18n._(
            msg({ id: "pullRequestDetail.contentTabs", message: "Pull request content" })
          )}
          className="flex h-8 items-center rounded-full border border-border/70 bg-background p-0.5 shadow-xs"
          role="tablist"
        >
          <TabButton active={tab === "summary"} onClick={() => setTab("summary")}>
            <Trans id="pullRequestDetail.summary.title">Summary</Trans>
          </TabButton>
          <TabButton active={tab === "changes"} onClick={() => setTab("changes")}>
            <Trans id="pullRequestDetail.changes">Changes</Trans>
            {pr.additions != null ? (
              <span className="ml-1.5 text-emerald-600 dark:text-emerald-400">+{additions}</span>
            ) : null}
            {pr.deletions != null ? (
              <span className="ml-1 text-red-600 dark:text-red-400">−{deletions}</span>
            ) : null}
          </TabButton>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex h-8 items-center rounded-full border border-border/70 bg-background px-1 shadow-xs">
            {surface === "global" ? (
              <IconButton
                label={
                  pinned
                    ? i18n._(msg({ id: "codeReview.unpin", message: "Unpin from sidebar" }))
                    : i18n._(msg({ id: "codeReview.pin", message: "Pin to sidebar" }))
                }
                onClick={() =>
                  void host
                    .pin(sidebarItem, accountKey(request.account), !pinned)
                    .then((result) => setPinned(result.pinned))
                    .catch(() => undefined)
                }
              >
                <PinIcon className={cn("size-4", pinned && "fill-current")} />
              </IconButton>
            ) : null}
            <IconButton
              label={i18n._(msg({ id: "pullRequestDetail.copyUrl", message: "Copy URL" }))}
              onClick={() => void copyText(pr.url)}
            >
              <LinkIcon className="size-4" />
            </IconButton>
            <IconButton label={openIn} onClick={() => void host.openLink(pr.url)}>
              {request.provider === "gitlab" ? (
                <GitLabMark className="size-4" />
              ) : (
                <GitHubMark className="size-4" />
              )}
            </IconButton>
          </div>
          {surface === "thread" ? (
            <WatchAndFix
              target={{
                open: pr.state === "open",
                provider: request.provider,
                title: pr.title,
                url: pr.url,
              }}
            />
          ) : null}
          <div className="flex h-8 items-center rounded-full border border-border/70 bg-background shadow-xs">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    className="flex h-full items-center gap-1 rounded-l-full pr-2 pl-3 font-medium text-sm hover:bg-accent disabled:opacity-60"
                    disabled={running || startReview.isPending}
                    type="button"
                  />
                }
              >
                {running ? (
                  <Trans id="codeReview.sidebar.privateReviewWorking">
                    Private review in progress
                  </Trans>
                ) : (
                  <Trans id="privateReview.toolbar.start">Review with Codex</Trans>
                )}
                <ChevronDownIcon className="size-3.5 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuItem
                  onClick={() => startReview.mutate(Boolean(privateReview.data?.review))}
                >
                  <Trans id="privateReview.menu.private">Run a private review</Trans>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    void host.openChat({
                      intent: "review",
                      provider: request.provider,
                      pullRequest: request.pullRequest,
                      title: pr.title,
                      url: pr.url,
                    })
                  }
                >
                  <Trans id="privateReview.menu.chat">Review in a new chat</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className="h-4 w-px bg-border" />
            <IconButton
              label={i18n._(
                msg({ id: "privateReview.toolbar.instructions", message: "Review instructions" })
              )}
              onClick={() => setInstructionsOpen(true)}
            >
              <SettingsIcon className="size-4" />
            </IconButton>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {tab === "summary" ? (
          <SummaryTab
            privateReview={privateReview.data ?? null}
            pullRequest={pr}
            request={request}
            viewerAvatarUrl={viewerAvatarUrl}
            onOpenComment={(target) => {
              setFocus(target)
              setTab("changes")
            }}
          />
        ) : (
          <ChangesTab
            focus={focus}
            privateReview={privateReview.data?.review ?? null}
            pullRequest={pr}
            request={request}
          />
        )}
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              aria-label={i18n._(
                msg({
                  id: "codeReviewPlugin.reviewChat.open",
                  message: "Chat about this pull request",
                })
              )}
              className="absolute right-4 bottom-4 flex size-10 items-center justify-center rounded-full border border-border bg-background shadow-md hover:bg-accent"
              type="button"
              onClick={() =>
                void host.openChat({
                  intent: "chat",
                  provider: request.provider,
                  pullRequest: request.pullRequest,
                  title: pr.title,
                  url: pr.url,
                })
              }
            />
          }
        >
          <MessageCircleIcon className="size-4" />
        </TooltipTrigger>
        <TooltipContent>
          <Trans id="codeReviewPlugin.reviewChat.open">Chat about this pull request</Trans>
        </TooltipContent>
      </Tooltip>
      <ReviewInstructionsDialog
        open={instructionsOpen}
        onOpenChange={setInstructionsOpen}
        onRun={() => startReview.mutate(true)}
      />
    </div>
  )
}

function TabButton({
  active,
  children,
  onClick,
}: Readonly<{ active: boolean; children: ReactNode; onClick: () => void }>) {
  return (
    <button
      aria-selected={active}
      className={cn(
        "flex h-full items-center rounded-full px-3 text-sm transition-colors",
        active
          ? "bg-accent font-medium text-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
      role="tab"
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function IconButton({
  children,
  label,
  onClick,
  disabled,
}: Readonly<{ children: ReactNode; label: string; onClick: () => void; disabled?: boolean }>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            className="size-7 rounded-full"
            disabled={disabled}
            size="icon"
            variant="ghost"
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
