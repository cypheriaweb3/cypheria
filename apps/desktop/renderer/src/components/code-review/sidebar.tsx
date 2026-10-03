import type { CodeReviewSettings, CodeReviewSidebarItem } from "@cypheria/protocol"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@cypheria/ui/components/dropdown-menu"
import { Input } from "@cypheria/ui/components/input"
import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@cypheria/ui/components/sidebar"
import { cn } from "@cypheria/ui/lib/utils"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useAtomValue } from "jotai"
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleX,
  GitMerge,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MoreHorizontal,
  Search,
} from "lucide-react"
import { type ReactNode, useEffect, useMemo, useState } from "react"

import { clientStateStore, codeReviewSidebarCollapsedAtom } from "../../client-state.js"
import { ensureCypheriaClient } from "../../cypheria-client.js"
import { codeReviewNotifierAtom, codeReviewSidebarAtom } from "./host.js"
import { setPullRequestPinned, usePullRequestList } from "./pull-request-lists.js"

const compactAge = (value: string | null | undefined): string => {
  if (!value) return ""
  const seconds = Math.max(0, (Date.now() - Date.parse(value)) / 1000)
  for (const [size, suffix] of [
    [365 * 86400, "y"],
    [30 * 86400, "mo"],
    [7 * 86400, "w"],
    [86400, "d"],
    [3600, "h"],
    [60, "m"],
  ] as const) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${suffix}`
  }
  return "now"
}

const SECTION_IDS = [
  "recents",
  "waiting_for_review",
  "needs_my_review",
  "needs_my_teams_review",
  "merged",
] as const

/**
 * The Code Review page's sidebar: search, pinned pull requests, and the sections the Code Review
 * App reads for the selected account. Choosing a pull request opens it in the App.
 */
export function CodeReviewSidebar({
  header,
  onSelect,
  selectedUrl,
}: Readonly<{ header: ReactNode; onSelect: (url: string) => void; selectedUrl: string | null }>) {
  const { i18n } = useLingui()
  const state = useAtomValue(codeReviewSidebarAtom)
  const notifier = useAtomValue(codeReviewNotifierAtom)
  const accountKey = state?.accountKey ?? null
  const pins = usePullRequestList("pinned", accountKey).data ?? []
  const recents = usePullRequestList("recent", accountKey).data ?? []
  const [query, setQuery] = useState("")
  const collapsed = new Set(useAtomValue(codeReviewSidebarCollapsedAtom))
  const queryClient = useQueryClient()
  const config = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).settings.get(),
    queryKey: ["settings", "server-config"],
  })
  const settings = config.data?.config.codeReview
  const update = useMutation({
    mutationFn: async (patch: Partial<CodeReviewSettings>) =>
      (await ensureCypheriaClient()).settings.update({ codeReview: patch }),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(["settings", "server-config"], snapshot)
      notifier?.notify("cypheria/codeReview/settings", { settings: snapshot.config.codeReview })
    },
  })

  useEffect(() => {
    const timer = setTimeout(() => notifier?.notify("cypheria/codeReview/search", { query }), 250)
    return () => clearTimeout(timer)
  }, [notifier, query])

  const labels: Record<string, string> = {
    approved: i18n._(msg({ id: "codeReview.sidebar.section.approved", message: "Approved" })),
    drafts: i18n._(msg({ id: "codeReview.sidebar.section.drafts", message: "Drafts" })),
    merged: i18n._(msg({ id: "codeReview.sidebar.section.merged", message: "Recently merged" })),
    needs_my_review: i18n._(
      msg({ id: "codeReview.sidebar.section.needsMyReview", message: "Needs my review" })
    ),
    needs_my_teams_review: i18n._(
      msg({
        id: "codeReview.sidebar.section.needsMyTeamsReview",
        message: "Needs my team's review",
      })
    ),
    pinned: i18n._(msg({ id: "codeReview.sidebar.section.pinned", message: "Pinned" })),
    recents: i18n._(msg({ id: "codeReview.sidebar.section.recents", message: "Recent" })),
    search: i18n._(msg({ id: "codeReview.sidebar.section.results", message: "Results" })),
    waiting_for_review: i18n._(
      msg({ id: "codeReview.sidebar.section.authored", message: "Authored by me" })
    ),
  }
  const pinnedUrls = useMemo(() => new Set(pins.map((pin) => pin.url.toLowerCase())), [pins])
  const layout = settings?.sidebarLayout ?? "detailed"
  const toggle = (id: string) =>
    void clientStateStore.set(codeReviewSidebarCollapsedAtom, (current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
    )
  const showRecents = settings?.sidebarSections.includes("recents") ?? false
  const sections: {
    id: string
    items: readonly CodeReviewSidebarItem[]
    loading?: boolean
    hasMore?: boolean
    failed?: boolean
  }[] =
    query.trim() && state?.search
      ? [{ ...state.search, id: "search" }]
      : [
          ...(showRecents && recents.length > 0 ? [{ id: "recents", items: recents }] : []),
          ...(pins.length > 0 ? [{ id: "pinned", items: pins }] : []),
          ...(state?.sections ?? []),
        ]

  return (
    <Sidebar className="border-r border-sidebar-border" collapsible="icon">
      {header}
      <SidebarContent className="min-h-0 overflow-hidden pt-0.5 pb-3">
        <SidebarMenu className="px-2.5">
          <SidebarMenuItem>
            <SidebarMenuButton
              render={
                <Link to="/">
                  <ChevronLeft aria-hidden="true" className="size-4" strokeWidth={1.9} />
                  <span>
                    <Trans id="settings.backToWorkspace">Back to workspace</Trans>
                  </span>
                </Link>
              }
            />
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="flex items-center justify-between px-4 pt-2 pb-2 group-data-[collapsible=icon]:hidden">
          <h2 className="font-semibold text-lg">
            <Trans id="codeReview.sidebar.title">Code Review</Trans>
          </h2>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={i18n._(
                msg({ id: "codeReview.sidebar.options", message: "Sidebar display options" })
              )}
              render={
                <button
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                  type="button"
                />
              }
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuLabel>
                <Trans id="codeReview.sidebar.options.sections">Sections</Trans>
              </DropdownMenuLabel>
              {SECTION_IDS.map((id) => (
                <DropdownMenuCheckboxItem
                  key={id}
                  checked={settings?.sidebarSections.includes(id) ?? false}
                  disabled={id === "merged" && settings?.gitHostingProvider === "gitlab"}
                  onCheckedChange={(checked) => {
                    const current = settings?.sidebarSections ?? []
                    update.mutate({
                      sidebarSections: checked
                        ? SECTION_IDS.filter(
                            (section) => section === id || current.includes(section)
                          )
                        : current.filter((section) => section !== id),
                    })
                  }}
                >
                  {labels[id]}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>
                <Trans id="codeReview.sidebar.options.layout">Layout</Trans>
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={layout}
                onValueChange={(value) =>
                  update.mutate({ sidebarLayout: value as "compact" | "detailed" })
                }
              >
                <DropdownMenuRadioItem value="detailed">
                  <Trans id="codeReview.sidebar.options.detailed">Detailed</Trans>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="compact">
                  <Trans id="codeReview.sidebar.options.compact">Compact</Trans>
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="relative mx-2.5 mb-3 group-data-[collapsible=icon]:hidden">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label={i18n._(
              msg({ id: "codeReview.sidebar.search", message: "Search pull requests" })
            )}
            className="h-9 rounded-full bg-sidebar-accent/70 pl-8 text-sm shadow-none"
            placeholder={i18n._(
              msg({
                id: "codeReview.sidebar.searchPlaceholder",
                message: "Search or paste a PR link",
              })
            )}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="cypheria-scrollbar min-h-0 flex-1 overflow-y-auto px-2.5 group-data-[collapsible=icon]:hidden">
          {sections.map((section) => (
            <section key={section.id} className="mb-3">
              <button
                className="flex h-8 items-center gap-1 px-1.5 text-muted-foreground text-sm hover:text-foreground"
                type="button"
                onClick={() => toggle(section.id)}
              >
                {labels[section.id] ?? section.id}
                {collapsed.has(section.id) || section.items.length === 0 ? (
                  <ChevronRight className="size-3.5" />
                ) : (
                  <ChevronDown className="size-3.5" />
                )}
              </button>
              {collapsed.has(section.id) ? null : (
                <ul className="flex flex-col gap-0.5">
                  {section.items.map((item) => (
                    <SidebarRow
                      key={item.url}
                      accountKey={accountKey}
                      item={item}
                      layout={layout}
                      pinned={pinnedUrls.has(item.url.toLowerCase())}
                      selected={selectedUrl?.toLowerCase() === item.url.toLowerCase()}
                      onSelect={() => onSelect(item.url)}
                    />
                  ))}
                  {section.loading ? (
                    <li className="px-2 py-1 text-muted-foreground text-xs">
                      <Trans id="codeReview.sidebar.loading">Loading…</Trans>
                    </li>
                  ) : null}
                  {section.failed ? (
                    <li>
                      <button
                        className="px-2 py-1 text-destructive text-xs hover:underline"
                        type="button"
                        onClick={() =>
                          notifier?.notify("cypheria/codeReview/sidebarAction", {
                            action: "retry",
                            sectionId: section.id,
                          })
                        }
                      >
                        <Trans id="codeReview.sidebar.retry">Couldn’t load. Try again</Trans>
                      </button>
                    </li>
                  ) : section.hasMore ? (
                    <li>
                      <button
                        className="px-2 py-1 text-muted-foreground text-xs hover:text-foreground"
                        type="button"
                        onClick={() =>
                          notifier?.notify("cypheria/codeReview/sidebarAction", {
                            action: "more",
                            sectionId: section.id,
                          })
                        }
                      >
                        <Trans id="sidebarElectron.showMore">Show more</Trans>
                      </button>
                    </li>
                  ) : null}
                </ul>
              )}
            </section>
          ))}
        </div>
      </SidebarContent>
    </Sidebar>
  )
}

function StatusIcon({ status }: Readonly<{ status: CodeReviewSidebarItem["status"] }>) {
  const { i18n } = useLingui()
  const [Icon, tone, label] =
    status === "merged"
      ? [
          GitMerge,
          "text-violet-600 dark:text-violet-300",
          i18n._(msg({ id: "codeReview.sidebar.mergedBadge", message: "Merged" })),
        ]
      : status === "closed"
        ? [
            GitPullRequestClosed,
            "text-red-600 dark:text-red-400",
            i18n._(msg({ id: "codeReview.sidebar.closedBadge", message: "Closed" })),
          ]
        : status === "draft"
          ? [
              GitPullRequestDraft,
              "text-muted-foreground",
              i18n._(msg({ id: "codeReview.sidebar.draftBadge", message: "Draft" })),
            ]
          : status === "approved"
            ? [
                CircleCheck,
                "text-emerald-600 dark:text-emerald-400",
                i18n._(msg({ id: "codeReview.sidebar.approvedBadge", message: "Approved" })),
              ]
            : status === "changes_requested"
              ? [
                  CircleX,
                  "text-red-600 dark:text-red-400",
                  i18n._(
                    msg({
                      id: "codeReview.sidebar.changesRequestedBadge",
                      message: "Changes requested",
                    })
                  ),
                ]
              : status === "review_required"
                ? [
                    CircleDashed,
                    "text-amber-600 dark:text-amber-400",
                    i18n._(
                      msg({ id: "codeReview.sidebar.waitingBadge", message: "Waiting for review" })
                    ),
                  ]
                : [CircleDot, "text-emerald-600 dark:text-emerald-400", ""]
  return (
    <span className={cn("shrink-0", tone)} title={label}>
      <Icon className="size-3.5" />
    </span>
  )
}

function SidebarRow({
  accountKey,
  item,
  layout,
  onSelect,
  pinned,
  selected,
}: Readonly<{
  accountKey: string | null
  item: CodeReviewSidebarItem
  layout: "compact" | "detailed"
  onSelect: () => void
  pinned: boolean
  selected: boolean
}>) {
  const { i18n } = useLingui()
  const togglePin = async () => {
    if (!accountKey) return
    const { savedAt: _savedAt, ...stored } = item as CodeReviewSidebarItem & { savedAt?: number }
    await setPullRequestPinned(accountKey, stored, !pinned).catch(() => undefined)
  }
  return (
    <li className="group relative">
      <button
        className={cn(
          "flex w-full flex-col gap-1 rounded-lg px-2 py-1.5 text-left hover:bg-sidebar-accent",
          selected && "bg-sidebar-accent"
        )}
        type="button"
        onClick={onSelect}
      >
        <span className="flex items-start gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 text-sm",
              layout === "detailed" ? "line-clamp-2" : "truncate"
            )}
          >
            {item.title}
          </span>
          <StatusIcon status={item.status} />
        </span>
        {layout === "detailed" ? (
          <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
            {item.authorAvatarUrl ? (
              <img alt="" className="size-4 rounded-full" src={item.authorAvatarUrl} />
            ) : null}
            <span className="truncate">{item.authorLogin}</span>
            {item.updatedAt ? <span>· {compactAge(item.updatedAt)}</span> : null}
          </span>
        ) : null}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={i18n._(
            msg({ id: "codeReview.menu.actions", message: "Pull request actions" })
          )}
          render={
            <button
              className="absolute top-1.5 right-7 hidden size-6 items-center justify-center rounded-md bg-sidebar-accent text-muted-foreground hover:text-foreground group-hover:flex"
              type="button"
            />
          }
        >
          <MoreHorizontal className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => void togglePin()}>
            {pinned ? (
              <Trans id="codeReview.menu.unpin">Unpin pull request</Trans>
            ) : (
              <Trans id="codeReview.menu.pin">Pin pull request</Trans>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void navigator.clipboard.writeText(item.url)}>
            <Trans id="codeReview.menu.copy">Copy link</Trans>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void window.cypheria?.app.openExternal(item.url)}>
            {item.url.includes("/-/merge_requests/") ? (
              <Trans id="codeReview.menu.gitlab">Open in GitLab</Trans>
            ) : (
              <Trans id="codeReview.menu.github">Open in GitHub</Trans>
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}
