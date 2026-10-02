import type { GitHubPullRequestChecks } from "@cypheria/protocol"
import { Button } from "@cypheria/ui/components/button"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { CircleCheck, CircleMinus, CircleSlash, CircleX, Clock, ExternalLink } from "lucide-react"
import type { ReactNode } from "react"

type Check = GitHubPullRequestChecks[number]
type Bucket = Check["bucket"]

/** Failing first, then what still runs, then the rest, as the official desktop orders them. */
const ORDER: readonly Bucket[] = ["fail", "pending", "cancel", "pass", "skipping"]

const ICONS: Record<Bucket, ReactNode> = {
  cancel: <CircleSlash aria-hidden="true" className="size-3.5 text-muted-foreground" />,
  fail: <CircleX aria-hidden="true" className="size-3.5 text-destructive" />,
  pass: <CircleCheck aria-hidden="true" className="size-3.5 text-emerald-600" />,
  pending: <Clock aria-hidden="true" className="size-3.5 text-amber-500" />,
  skipping: <CircleMinus aria-hidden="true" className="size-3.5 text-muted-foreground" />,
}

/** `1m 5s` for a check that finished, `null` while it runs or without timestamps. */
export const checkDuration = (check: Pick<Check, "completedAt" | "startedAt">): string | null => {
  if (!check.startedAt || !check.completedAt) return null
  const ms = Date.parse(check.completedAt) - Date.parse(check.startedAt)
  if (!Number.isFinite(ms) || ms < 0) return null
  const seconds = Math.round(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`
}

export const sortChecks = (checks: readonly Check[]): Check[] =>
  [...checks].sort(
    (left, right) =>
      ORDER.indexOf(left.bucket) - ORDER.indexOf(right.bucket) ||
      left.name.localeCompare(right.name)
  )

/** A pull request's checks with a status summary, failures first, and a way to fix failures. */
export function PullRequestChecks({
  checks,
  complete,
  onFixFailing,
  onOpen,
}: Readonly<{
  checks: readonly Check[]
  complete: boolean
  /** Asks the Agent to fix the failing checks; absent when that is not possible. */
  onFixFailing?: () => void
  onOpen: (url: string) => void
}>) {
  const { i18n } = useLingui()
  const count = (bucket: Bucket) => checks.filter((check) => check.bucket === bucket).length
  const failing = count("fail")
  const pending = count("pending")
  const passed = count("pass")
  if (checks.length === 0 && complete) {
    return (
      <p className="text-muted-foreground text-xs">
        <Trans id="git.github.noChecks">No checks</Trans>
      </p>
    )
  }
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {ICONS[failing ? "fail" : pending ? "pending" : "pass"]}
        <span className="min-w-0 flex-1">
          {i18n._({
            ...msg({
              id: "git.github.checksSummary",
              message:
                "{failing, plural, =0 {} other {# failing · }}{pending, plural, =0 {} other {# pending · }}{passed} passed",
            }),
            values: { failing, passed, pending },
          })}
        </span>
        {failing > 0 && onFixFailing ? (
          <Button onClick={onFixFailing} size="sm" type="button" variant="outline">
            <Trans id="git.github.fixFailingChecks">Fix failing checks</Trans>
          </Button>
        ) : null}
      </div>
      <ul className="divide-y rounded border">
        {sortChecks(checks).map((check) => {
          const duration = checkDuration(check)
          return (
            <li
              className="flex items-center gap-2 px-2 py-1 text-xs"
              key={`${check.name}:${check.link}`}
            >
              {ICONS[check.bucket]}
              <div className="min-w-0 flex-1">
                <p className="truncate">{check.name}</p>
                {check.workflow || duration ? (
                  <p className="truncate text-muted-foreground">
                    {[check.workflow, duration].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
              </div>
              {check.link ? (
                <Button
                  aria-label={i18n._(
                    msg({ id: "git.github.openCheck", message: "Open check details" })
                  )}
                  onClick={() => check.link && onOpen(check.link)}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <ExternalLink aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          )
        })}
      </ul>
      {!complete ? (
        <p className="text-muted-foreground text-xs">
          <Trans id="git.github.checksIncomplete">Some check details couldn’t be loaded.</Trans>
        </p>
      ) : null}
    </div>
  )
}
