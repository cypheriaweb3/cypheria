import { cn } from "@cypheria/ui"
import { SidebarMenuButton } from "@cypheria/ui/components/sidebar"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  BellDot,
  Boxes,
  ChevronDown,
  ChevronRight,
  FolderGit2,
  Globe2,
  LoaderCircle,
  ScrollText,
  ShieldCheck,
  WalletCards,
  Workflow,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  buildTaskSidebarRows,
  estimateTaskSidebarRowSize,
  groupProjectThreads,
  SIDEBAR_BATCH_SIZE,
  type SidebarSectionId,
  type TaskSidebarRow,
} from "./task-sidebar-model.js"

const PINNED_THREAD_SECTION_ID = "01984de2-8f74-7c91-a3b2-5c5e937cf318"
const THREAD_PAGE_SIZE = 30

const virtualNavigationItems = [
  {
    href: "/approvals",
    icon: BellDot,
    id: "pending",
    label: msg({ id: "navigation.pending", message: "Pending" }),
  },
  {
    href: "/networks",
    icon: Globe2,
    id: "networks",
    label: msg({ id: "navigation.networks", message: "Networks" }),
  },
  {
    href: "/wallets",
    icon: WalletCards,
    id: "wallets",
    label: msg({ id: "navigation.wallets", message: "Wallets & assets" }),
  },
  {
    href: "/automations",
    icon: Workflow,
    id: "automations",
    label: msg({ id: "navigation.automations", message: "Automations" }),
  },
  {
    href: "/policies",
    icon: ShieldCheck,
    id: "policies",
    label: msg({ id: "navigation.signingPolicies", message: "Signing policies" }),
  },
  {
    href: "/audit",
    icon: ScrollText,
    id: "audit",
    label: msg({ id: "navigation.auditLog", message: "Audit log" }),
  },
  {
    href: "/plugins",
    icon: Boxes,
    id: "plugins",
    label: msg({ id: "navigation.pluginsAndSkills", message: "Plugins & skills" }),
  },
] as const

const sectionLabels = {
  pinned: msg({ id: "navigation.pinned", message: "Pinned" }),
  projects: msg({ id: "navigation.projects", message: "Projects" }),
  recents: msg({ id: "navigation.recents", message: "Recents" }),
} as const

export function TaskSidebar({ pendingCount }: Readonly<{ pendingCount: number }>) {
  const { i18n } = useLingui()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [expandedSections, setExpandedSections] = useState<Set<SidebarSectionId>>(
    () => new Set(["pinned", "projects", "recents"])
  )
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => new Set())
  const [visibleProjectCount, setVisibleProjectCount] = useState(SIDEBAR_BATCH_SIZE)
  const [projectTaskLimits, setProjectTaskLimits] = useState<Record<string, number>>({})
  const [catalogLoadIntent, setCatalogLoadIntent] = useState<"projects" | string | null>(null)

  const pinnedQuery = useInfiniteQuery({
    initialPageParam: null as string | null,
    queryKey: ["codex", "threads", "pinned"],
    queryFn: async ({ pageParam }) =>
      window.cypheria?.codex.listThreads({
        cursor: pageParam,
        limit: SIDEBAR_BATCH_SIZE,
        sectionId: PINNED_THREAD_SECTION_ID,
      }) ?? { data: [], nextCursor: null },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: 15_000,
  })
  const catalogQuery = useInfiniteQuery({
    initialPageParam: null as string | null,
    queryKey: ["codex", "threads", "unsectioned"],
    queryFn: async ({ pageParam }) =>
      window.cypheria?.codex.listThreads({
        cursor: pageParam,
        limit: THREAD_PAGE_SIZE,
        sectionId: null,
      }) ?? { data: [], nextCursor: null },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: 15_000,
  })
  const projectsQuery = useQuery({
    queryFn: () =>
      window.cypheria?.codex.listProjects({ limit: 100 }) ?? { data: [], nextCursor: null },
    queryKey: ["codex", "projects"],
    refetchInterval: 15_000,
  })

  const pinnedThreads = pinnedQuery.data?.pages.flatMap((page) => page.data) ?? []
  const catalogThreads = catalogQuery.data?.pages.flatMap((page) => page.data) ?? []
  const projectGroups = useMemo(
    () => groupProjectThreads(catalogThreads, projectsQuery.data?.data ?? []),
    [catalogThreads, projectsQuery.data?.data]
  )
  const recentThreads = useMemo(
    () => catalogThreads.filter((thread) => thread.projectId == null),
    [catalogThreads]
  )
  const expandedProjects = useMemo(
    () =>
      new Set(
        projectGroups.map(({ projectId }) => projectId).filter((id) => !collapsedProjects.has(id))
      ),
    [collapsedProjects, projectGroups]
  )

  const rows = useMemo(
    () =>
      buildTaskSidebarRows({
        expandedProjects,
        expandedSections,
        navigationIds: virtualNavigationItems.map(({ id }) => id),
        pinnedHasMore: pinnedQuery.hasNextPage,
        pinnedThreads,
        projectGroups,
        projectTaskLimits,
        projectsHasMore: catalogQuery.hasNextPage,
        recentHasMore: catalogQuery.hasNextPage,
        recentLoading: catalogQuery.isFetchingNextPage && catalogLoadIntent == null,
        recentThreads,
        visibleProjectCount,
      }),
    [
      catalogLoadIntent,
      catalogQuery.hasNextPage,
      catalogQuery.isFetchingNextPage,
      expandedProjects,
      expandedSections,
      pinnedQuery.hasNextPage,
      pinnedThreads,
      projectGroups,
      projectTaskLimits,
      recentThreads,
      visibleProjectCount,
    ]
  )

  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: (index) => estimateTaskSidebarRowSize(rows[index] as TaskSidebarRow),
    getItemKey: (index) => rows[index]?.key ?? index,
    getScrollElement: () => scrollRef.current,
    overscan: 8,
  })
  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    if (catalogLoadIntent == null || catalogQuery.isFetchingNextPage) return
    if (!catalogQuery.hasNextPage) {
      setCatalogLoadIntent(null)
      return
    }

    const targetReached =
      catalogLoadIntent === "projects"
        ? projectGroups.length >= visibleProjectCount
        : (projectGroups.find(({ projectId }) => projectId === catalogLoadIntent)?.threads.length ??
            0) >= (projectTaskLimits[catalogLoadIntent] ?? SIDEBAR_BATCH_SIZE)

    if (targetReached) {
      setCatalogLoadIntent(null)
      return
    }
    void catalogQuery.fetchNextPage()
  }, [
    catalogLoadIntent,
    catalogQuery.fetchNextPage,
    catalogQuery.hasNextPage,
    catalogQuery.isFetchingNextPage,
    projectGroups,
    projectTaskLimits,
    visibleProjectCount,
  ])

  useEffect(() => {
    if (!catalogQuery.hasNextPage || catalogQuery.isFetchingNextPage || catalogLoadIntent != null)
      return
    const recentLoaderVisible = virtualItems.some(
      ({ index }) => rows[index]?.kind === "loading" && rows[index]?.target === "recent"
    )
    if (recentLoaderVisible) void catalogQuery.fetchNextPage()
  }, [
    catalogLoadIntent,
    catalogQuery.fetchNextPage,
    catalogQuery.hasNextPage,
    catalogQuery.isFetchingNextPage,
    rows,
    virtualItems,
  ])

  const toggleSection = (section: SidebarSectionId) => {
    setExpandedSections((current) => {
      const next = new Set(current)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  const toggleProject = (projectId: string) => {
    setCollapsedProjects((current) => {
      const next = new Set(current)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  const showMoreProjects = () => {
    const target = visibleProjectCount + SIDEBAR_BATCH_SIZE
    setVisibleProjectCount(target)
    if (projectGroups.length < target && catalogQuery.hasNextPage) setCatalogLoadIntent("projects")
  }

  const showMoreProjectTasks = (projectId: string) => {
    const currentLimit = projectTaskLimits[projectId] ?? SIDEBAR_BATCH_SIZE
    const target = currentLimit + SIDEBAR_BATCH_SIZE
    setProjectTaskLimits((current) => ({ ...current, [projectId]: target }))
    const loaded =
      projectGroups.find((project) => project.projectId === projectId)?.threads.length ?? 0
    if (loaded < target && catalogQuery.hasNextPage) setCatalogLoadIntent(projectId)
  }

  return (
    <nav
      aria-label={i18n._(msg({ id: "navigation.workspace", message: "Workspace navigation" }))}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      ref={scrollRef}
    >
      <ul className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualItems.map((virtualRow) => {
          const row = rows[virtualRow.index]
          if (!row) return null
          return (
            <li
              className="absolute left-0 top-0 w-full px-2"
              data-index={virtualRow.index}
              key={row.key}
              style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
            >
              <TaskSidebarRowView
                catalogLoading={catalogQuery.isFetchingNextPage}
                catalogLoadIntent={catalogLoadIntent}
                collapsedProjects={collapsedProjects}
                expandedSections={expandedSections}
                pendingCount={pendingCount}
                pinnedLoading={pinnedQuery.isFetchingNextPage}
                row={row}
                onShowMorePinned={() => void pinnedQuery.fetchNextPage()}
                onShowMoreProjectTasks={showMoreProjectTasks}
                onShowMoreProjects={showMoreProjects}
                onToggleProject={toggleProject}
                onToggleSection={toggleSection}
              />
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function TaskSidebarRowView({
  catalogLoading,
  catalogLoadIntent,
  collapsedProjects,
  expandedSections,
  pendingCount,
  pinnedLoading,
  row,
  onShowMorePinned,
  onShowMoreProjectTasks,
  onShowMoreProjects,
  onToggleProject,
  onToggleSection,
}: Readonly<{
  catalogLoading: boolean
  catalogLoadIntent: "projects" | string | null
  collapsedProjects: ReadonlySet<string>
  expandedSections: ReadonlySet<SidebarSectionId>
  pendingCount: number
  pinnedLoading: boolean
  row: TaskSidebarRow
  onShowMorePinned: () => void
  onShowMoreProjectTasks: (projectId: string) => void
  onShowMoreProjects: () => void
  onToggleProject: (projectId: string) => void
  onToggleSection: (section: SidebarSectionId) => void
}>) {
  const { i18n } = useLingui()

  switch (row.kind) {
    case "navigation": {
      const item = virtualNavigationItems.find(({ id }) => id === row.navigationId)
      if (!item) return null
      const Icon = item.icon
      const label = i18n._(item.label)
      return (
        <SidebarMenuButton render={<Link to={item.href} />} tooltip={label}>
          <Icon aria-hidden="true" size={16} strokeWidth={1.9} />
          <span>{label}</span>
          {item.id === "pending" && pendingCount > 0 ? (
            <span className="ml-auto rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
              {pendingCount}
            </span>
          ) : null}
        </SidebarMenuButton>
      )
    }
    case "section": {
      const expanded = expandedSections.has(row.section)
      const label = i18n._(sectionLabels[row.section])
      return (
        <button
          aria-expanded={expanded}
          className="flex h-10 w-full items-end gap-1 rounded-md px-2 pb-1 text-left text-xs font-medium text-sidebar-foreground/70 outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden"
          type="button"
          onClick={() => onToggleSection(row.section)}
        >
          {expanded ? (
            <ChevronDown aria-hidden="true" size={13} />
          ) : (
            <ChevronRight aria-hidden="true" size={13} />
          )}
          <span>{label}</span>
        </button>
      )
    }
    case "project": {
      const expanded = !collapsedProjects.has(row.projectId)
      return (
        <button
          aria-expanded={expanded}
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-sidebar-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          type="button"
          onClick={() => onToggleProject(row.projectId)}
        >
          {expanded ? (
            <ChevronDown aria-hidden="true" size={13} />
          ) : (
            <ChevronRight aria-hidden="true" size={13} />
          )}
          <FolderGit2 aria-hidden="true" size={15} strokeWidth={1.9} />
          <span className="truncate">{row.projectName}</span>
        </button>
      )
    }
    case "thread":
      return (
        <SidebarMenuButton
          className={cn(row.source === "project" && "pl-8")}
          render={<Link to="/" search={{ thread: row.thread.id }} />}
          tooltip={row.thread.title}
        >
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full bg-muted-foreground/45",
              row.thread.status === "active" && "animate-pulse bg-primary",
              row.thread.status === "systemError" && "bg-destructive"
            )}
          />
          <span className="truncate">{row.thread.title}</span>
        </SidebarMenuButton>
      )
    case "showMore": {
      const loading =
        row.target === "pinned"
          ? pinnedLoading
          : catalogLoading &&
            (row.target === "projects"
              ? catalogLoadIntent === "projects"
              : catalogLoadIntent === row.projectId)
      return (
        <button
          className={cn(
            "flex h-[30px] w-full items-center gap-1 rounded-md px-2 text-left text-xs font-medium text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:pointer-events-none disabled:opacity-60",
            row.target === "project" && "pl-8"
          )}
          disabled={loading}
          type="button"
          onClick={() => {
            if (row.target === "pinned") onShowMorePinned()
            else if (row.target === "projects") onShowMoreProjects()
            else if (row.projectId) onShowMoreProjectTasks(row.projectId)
          }}
        >
          {loading ? <LoaderCircle aria-hidden="true" className="animate-spin" size={13} /> : null}
          <Trans id="navigation.showMore">Show more</Trans>
        </button>
      )
    }
    case "loading":
      return (
        <div
          aria-label={i18n._(msg({ id: "navigation.loadingMore", message: "Loading more" }))}
          className="flex h-9 items-center justify-center text-muted-foreground"
          role="status"
        >
          <LoaderCircle aria-hidden="true" className="animate-spin" size={15} />
        </div>
      )
    case "empty":
      return (
        <div className="flex h-9 items-center px-2 text-xs text-muted-foreground">
          {row.section === "pinned" ? (
            <Trans id="navigation.noPinned">No pinned tasks</Trans>
          ) : row.section === "projects" ? (
            <Trans id="navigation.noProjects">No projects yet</Trans>
          ) : (
            <Trans id="navigation.noTasks">No tasks yet</Trans>
          )}
        </div>
      )
  }
}
