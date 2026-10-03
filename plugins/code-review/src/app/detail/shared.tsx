import { cn } from "@cypheria/ui/lib/utils"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import {
  CircleDotIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
} from "lucide-react"
import { type ComponentProps, useMemo } from "react"
import { Streamdown } from "streamdown"

import { host } from "../host.js"
import type { PullRequestState } from "../schemas.js"

/** Markdown from GitHub or GitLab: links open through the host, never inside the App frame. */
export function Markdown({
  children,
  className,
}: Readonly<{ children: string; className?: string }>) {
  const components = useMemo(
    () => ({
      a: ({ href, children: content, ...props }: ComponentProps<"a">) => (
        <a
          {...props}
          className="text-primary underline underline-offset-2"
          href={href}
          onClick={(event) => {
            event.preventDefault()
            if (href && /^https?:/iu.test(href)) void host.openLink(href)
          }}
        >
          {content}
        </a>
      ),
    }),
    []
  )
  return (
    <div
      className={cn(
        "w-full text-sm leading-6 text-foreground",
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1",
        "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:font-semibold [&_h1]:text-xl",
        "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:font-semibold [&_h2]:text-lg",
        "[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-semibold [&_h3]:text-base",
        "[&_p]:my-2 [&_img]:max-w-full [&_img]:rounded-md",
        "[&_blockquote]:border-border [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_code:not(pre_code)]:rounded-sm [&_code:not(pre_code)]:bg-muted [&_code:not(pre_code)]:px-1 [&_code:not(pre_code)]:text-[0.9em]",
        className
      )}
    >
      <Streamdown components={components}>{children}</Streamdown>
    </div>
  )
}

export function Avatar({
  className,
  login,
  src,
}: Readonly<{ className?: string; login?: string | null; src?: string | null }>) {
  return src ? (
    <img
      alt=""
      className={cn("size-5 shrink-0 rounded-full bg-muted object-cover", className)}
      src={src}
    />
  ) : (
    <span
      aria-hidden
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-[10px] text-muted-foreground uppercase",
        className
      )}
    >
      {login?.slice(0, 1) ?? "?"}
    </span>
  )
}

const units: [Intl.RelativeTimeFormatUnit, number, string][] = [
  ["year", 365 * 24 * 3600, "y"],
  ["month", 30 * 24 * 3600, "mo"],
  ["week", 7 * 24 * 3600, "w"],
  ["day", 24 * 3600, "d"],
  ["hour", 3600, "h"],
  ["minute", 60, "m"],
]

/** `4d`, `2w`: the compact age the official sidebar and activity rows show. */
export const compactAge = (value: string | number | null | undefined, now = Date.now()): string => {
  if (value == null) return ""
  const time = typeof value === "number" ? value : Date.parse(value)
  if (Number.isNaN(time)) return ""
  const seconds = Math.max(0, Math.round((now - time) / 1000))
  for (const [, size, suffix] of units) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${suffix}`
  }
  return "now"
}

/** `4d ago`, in the reader's language. */
export function RelativeTime({ value }: Readonly<{ value: string | null | undefined }>) {
  const { i18n } = useLingui()
  if (!value) return null
  const time = Date.parse(value)
  if (Number.isNaN(time)) return null
  const seconds = Math.round((time - Date.now()) / 1000)
  const format = new Intl.RelativeTimeFormat(i18n.locale, { numeric: "auto" })
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return (
        <time dateTime={value} title={new Date(time).toLocaleString(i18n.locale)}>
          {format.format(Math.round(seconds / size), unit)}
        </time>
      )
    }
  }
  return <time dateTime={value}>{format.format(0, "minute")}</time>
}

/** The state pill above the title: Open, Draft, Merged, or Closed. */
export function StatePill({
  isDraft,
  state,
}: Readonly<{ isDraft: boolean; state: PullRequestState }>) {
  const { i18n } = useLingui()
  const [label, Icon, tone] =
    state === "merged"
      ? [
          i18n._(msg({ id: "pullRequestSidePanel.state.merged", message: "Merged" })),
          GitMergeIcon,
          "bg-violet-500/12 text-violet-600 dark:text-violet-300",
        ]
      : state === "closed"
        ? [
            i18n._(msg({ id: "pullRequestSidePanel.state.closed", message: "Closed" })),
            GitPullRequestClosedIcon,
            "bg-red-500/12 text-red-600 dark:text-red-300",
          ]
        : isDraft
          ? [
              i18n._(msg({ id: "pullRequestSidePanel.state.draft", message: "Draft" })),
              GitPullRequestDraftIcon,
              "bg-muted text-muted-foreground",
            ]
          : [
              i18n._(msg({ id: "pullRequestDetail.header.openState", message: "Open" })),
              GitPullRequestIcon,
              "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300",
            ]
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 font-medium text-sm",
        tone
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </span>
  )
}

export function SectionHeading({ children }: Readonly<{ children: React.ReactNode }>) {
  return <h3 className="text-muted-foreground text-sm">{children}</h3>
}

export const StatusDot = CircleDotIcon

export const copyText = async (value: string) => {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    // The host may not grant clipboard access; copying is best effort.
  }
}
