import { Tooltip, TooltipContent, TooltipTrigger } from "@cypheria/ui/components/tooltip"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { EyeIcon, PauseIcon } from "lucide-react"

import { host, type WatchTarget } from "../host.js"

/**
 * Watch and fix, shown for the pull request of a chat: the host keeps a schedule that asks the
 * chat's Agent to fix checks, comments, and conflicts until the pull request closes.
 */
export function WatchAndFix({ target }: Readonly<{ target: WatchTarget }>) {
  const { i18n } = useLingui()
  const client = useQueryClient()
  const queryKey = ["watch", target.url, target.open]
  const watch = useQuery({ queryFn: () => host.watch(target), queryKey, retry: false })
  const change = useMutation({
    mutationFn: (enabled: boolean) => host.setWatch(target, enabled),
    onSuccess: (data) => client.setQueryData(queryKey, data),
  })
  const status = watch.data?.status
  if (!status) return null
  const unavailable =
    status === "unavailable"
      ? watch.data?.reason === "pull-request-closed"
        ? i18n._(
            msg({
              id: "pullRequestSidePanel.autoFix.closed",
              message: "Automatic fixes are unavailable for closed pull requests",
            })
          )
        : i18n._(
            msg({
              id: "pullRequestSidePanel.autoFix.missingConversation",
              message: "Fix is only available in an active chat",
            })
          )
      : null
  const button = (
    <button
      className="flex h-full items-center gap-1.5 rounded-l-full pr-2 pl-3 font-medium text-sm hover:bg-accent disabled:opacity-60"
      disabled={unavailable != null || change.isPending}
      type="button"
      onClick={() => change.mutate(true)}
    >
      <EyeIcon className="size-3.5" />
      {status === "active" ? (
        <Trans id="pullRequestSidePanel.prepareToMerge.running">Fixing…</Trans>
      ) : (
        <Trans id="pullRequestSidePanel.prepareToMerge.watching">Watch and fix</Trans>
      )}
    </button>
  )
  const pause = i18n._(
    msg({ id: "pullRequestSidePanel.prepareToMerge.pause", message: "Pause watch and fix" })
  )
  return (
    <div className="flex h-8 items-center rounded-full border border-border/70 bg-background shadow-xs">
      {unavailable ? (
        <Tooltip>
          <TooltipTrigger render={<span className="h-full" />}>{button}</TooltipTrigger>
          <TooltipContent>{unavailable}</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
      <span className="h-4 w-px bg-border" />
      <button
        aria-label={pause}
        className="flex h-full items-center rounded-r-full px-2.5 hover:bg-accent disabled:opacity-40"
        disabled={status !== "active" || change.isPending}
        title={pause}
        type="button"
        onClick={() => change.mutate(false)}
      >
        <PauseIcon className="size-3.5" />
      </button>
    </div>
  )
}
