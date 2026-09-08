import { cn } from "@cypheria/ui"
import { Button } from "@cypheria/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cypheria/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@cypheria/ui/components/dropdown-menu"
import { Input } from "@cypheria/ui/components/input"
import { SidebarMenuButton } from "@cypheria/ui/components/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@cypheria/ui/components/tooltip"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  Archive,
  BellDot,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Globe2,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  ScrollText,
  ShieldCheck,
  SquarePen,
  WalletCards,
  Workflow,
  X,
} from "lucide-react"
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { CodexThreadSectionView } from "../../../ipc/src/index.js"
import { ProjectCreateDialog } from "./project-create-dialog"
import {
  buildTaskSidebarRows,
  estimateTaskSidebarRowSize,
  groupProjectThreads,
  SIDEBAR_BATCH_SIZE,
  type SidebarCustomSection,
  type SidebarSectionId,
  type TaskSidebarRow,
} from "./task-sidebar-model.js"

const PINNED_THREAD_SECTION_ID = "01984de2-8f74-7c91-a3b2-5c5e937cf318"
const THREAD_PAGE_SIZE = 30
type SidebarSort = "priority" | "updated" | "manual"

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

const sortRequest = (sort: SidebarSort) =>
  sort === "manual"
    ? ({ sortDirection: "asc", sortKey: "section_position" } as const)
    : sort === "priority"
      ? ({ sortDirection: "desc", sortKey: "recency_at" } as const)
      : ({ sortDirection: "desc", sortKey: "updated_at" } as const)

const readPreference = <T extends string>(key: string, fallback: T): T => {
  try {
    return (globalThis.localStorage?.getItem(key) as T | null) ?? fallback
  } catch {
    return fallback
  }
}

export function TaskSidebar({ pendingCount }: Readonly<{ pendingCount: number }>) {
  const { i18n } = useLingui()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [expandedSections, setExpandedSections] = useState<Set<SidebarSectionId>>(
    () => new Set(["pinned", "projects", "recents"])
  )
  const [expandedCustomSections, setExpandedCustomSections] = useState<Set<string>>(new Set())
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => new Set())
  const [visibleProjectCount, setVisibleProjectCount] = useState(SIDEBAR_BATCH_SIZE)
  const [projectTaskLimits, setProjectTaskLimits] = useState<Record<string, number>>({})
  const [catalogLoadIntent, setCatalogLoadIntent] = useState<"projects" | string | null>(null)
  const [organizeByProject, setOrganizeByProject] = useState(
    () => readPreference("cypheria.sidebar.organization", "by-project") === "by-project"
  )
  const [pinnedSort, setPinnedSort] = useState<SidebarSort>(() =>
    readPreference("cypheria.sidebar.pinned-sort", "manual")
  )
  const [chatSort, setChatSort] = useState<SidebarSort>(() =>
    readPreference("cypheria.sidebar.chat-sort", "updated")
  )
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [sectionDialog, setSectionDialog] = useState<
    { mode: "create" } | { mode: "edit"; section: CodexThreadSectionView } | null
  >(null)
  const [deletingSection, setDeletingSection] = useState<CodexThreadSectionView | null>(null)

  const pinnedQuery = useInfiniteQuery({
    initialPageParam: null as string | null,
    queryKey: ["codex", "threads", "pinned", pinnedSort],
    queryFn: async ({ pageParam }) =>
      window.cypheria?.codex.listThreads({
        cursor: pageParam,
        limit: SIDEBAR_BATCH_SIZE,
        sectionId: PINNED_THREAD_SECTION_ID,
        ...sortRequest(pinnedSort),
      }) ?? { data: [], nextCursor: null },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: 15_000,
  })
  const catalogQuery = useInfiniteQuery({
    initialPageParam: null as string | null,
    queryKey: ["codex", "threads", "unsectioned", chatSort],
    queryFn: async ({ pageParam }) =>
      window.cypheria?.codex.listThreads({
        cursor: pageParam,
        limit: THREAD_PAGE_SIZE,
        sectionId: null,
        ...sortRequest(chatSort),
      }) ?? { data: [], nextCursor: null },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: 15_000,
  })
  const projectsQuery = useQuery({
    queryFn: () =>
      window.cypheria?.codex.listProjects({
        limit: 100,
        sortDirection: "asc",
        sortKey: "position",
      }) ?? { data: [], nextCursor: null },
    queryKey: ["codex", "projects"],
    refetchInterval: 15_000,
  })
  const sectionsQuery = useQuery({
    queryFn: () =>
      window.cypheria?.codex.listThreadSections({ limit: 100 }) ?? { data: [], nextCursor: null },
    queryKey: ["codex", "thread-sections"],
    refetchInterval: 15_000,
  })
  const sections = useMemo(
    () => (sectionsQuery.data?.data ?? []).filter(({ id }) => id !== PINNED_THREAD_SECTION_ID),
    [sectionsQuery.data?.data]
  )
  const customThreadQueries = useQueries({
    queries: sections.map((section) => ({
      queryFn: () =>
        window.cypheria?.codex.listThreads({
          limit: 100,
          sectionId: section.id,
          sortDirection: "asc",
          sortKey: "section_position",
        }) ?? { data: [], nextCursor: null },
      queryKey: ["codex", "threads", "section", section.id],
      refetchInterval: 15_000,
    })),
  })

  useEffect(() => {
    setExpandedCustomSections((current) => new Set([...current, ...sections.map(({ id }) => id)]))
  }, [sections])

  const pinnedThreads = pinnedQuery.data?.pages.flatMap((page) => page.data) ?? []
  const catalogThreads = catalogQuery.data?.pages.flatMap((page) => page.data) ?? []
  const projectGroups = useMemo(
    () => groupProjectThreads(catalogThreads, projectsQuery.data?.data ?? []),
    [catalogThreads, projectsQuery.data?.data]
  )
  const recentThreads = useMemo(
    () =>
      organizeByProject
        ? catalogThreads.filter((thread) => thread.projectId == null)
        : catalogThreads,
    [catalogThreads, organizeByProject]
  )
  const customSections = useMemo<SidebarCustomSection[]>(
    () =>
      sections.map((section, index) => ({
        ...section,
        threads: customThreadQueries[index]?.data?.data ?? [],
      })),
    [customThreadQueries, sections]
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
        customSections,
        expandedCustomSections,
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
        showProjects: organizeByProject,
        visibleProjectCount,
      }),
    [
      catalogLoadIntent,
      catalogQuery.hasNextPage,
      catalogQuery.isFetchingNextPage,
      customSections,
      expandedCustomSections,
      expandedProjects,
      expandedSections,
      organizeByProject,
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
    if (!catalogQuery.hasNextPage) return setCatalogLoadIntent(null)
    const reached =
      catalogLoadIntent === "projects"
        ? projectGroups.length >= visibleProjectCount
        : (projectGroups.find(({ projectId }) => projectId === catalogLoadIntent)?.threads.length ??
            0) >= (projectTaskLimits[catalogLoadIntent] ?? SIDEBAR_BATCH_SIZE)
    if (reached) return setCatalogLoadIntent(null)
    void catalogQuery.fetchNextPage()
  }, [catalogLoadIntent, catalogQuery, projectGroups, projectTaskLimits, visibleProjectCount])
  useEffect(() => {
    if (!catalogQuery.hasNextPage || catalogQuery.isFetchingNextPage || catalogLoadIntent != null)
      return
    if (virtualItems.some(({ index }) => rows[index]?.kind === "loading"))
      void catalogQuery.fetchNextPage()
  }, [catalogLoadIntent, catalogQuery, rows, virtualItems])

  const toggleSet = <T,>(setter: Dispatch<SetStateAction<Set<T>>>, value: T) =>
    setter((current) => {
      const next = new Set(current)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  const setOrganization = (byProject: boolean) => {
    setOrganizeByProject(byProject)
    globalThis.localStorage?.setItem(
      "cypheria.sidebar.organization",
      byProject ? "by-project" : "one-list"
    )
  }
  const updatePinnedSort = (sort: SidebarSort) => {
    setPinnedSort(sort)
    globalThis.localStorage?.setItem("cypheria.sidebar.pinned-sort", sort)
  }
  const updateChatSort = (sort: SidebarSort) => {
    setChatSort(sort)
    globalThis.localStorage?.setItem("cypheria.sidebar.chat-sort", sort)
  }

  return (
    <>
      <TooltipProvider delay={450}>
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
                  style={{
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <TaskSidebarRowView
                    catalogLoading={catalogQuery.isFetchingNextPage}
                    catalogLoadIntent={catalogLoadIntent}
                    chatSort={chatSort}
                    collapsedProjects={collapsedProjects}
                    expandedCustomSections={expandedCustomSections}
                    expandedSections={expandedSections}
                    organizeByProject={organizeByProject}
                    pendingCount={pendingCount}
                    pinnedLoading={pinnedQuery.isFetchingNextPage}
                    pinnedSort={pinnedSort}
                    row={row}
                    onCreateProject={() => setProjectDialogOpen(true)}
                    onCreateSection={() => setSectionDialog({ mode: "create" })}
                    onDeleteSection={setDeletingSection}
                    onEditSection={(section) => setSectionDialog({ mode: "edit", section })}
                    onOrganizationChange={setOrganization}
                    onPinnedSortChange={updatePinnedSort}
                    onShowMorePinned={() => void pinnedQuery.fetchNextPage()}
                    onShowMoreProjectTasks={(projectId) => {
                      const target =
                        (projectTaskLimits[projectId] ?? SIDEBAR_BATCH_SIZE) + SIDEBAR_BATCH_SIZE
                      setProjectTaskLimits((current) => ({ ...current, [projectId]: target }))
                      if (
                        (projectGroups.find((project) => project.projectId === projectId)?.threads
                          .length ?? 0) < target &&
                        catalogQuery.hasNextPage
                      )
                        setCatalogLoadIntent(projectId)
                    }}
                    onShowMoreProjects={() => {
                      const target = visibleProjectCount + SIDEBAR_BATCH_SIZE
                      setVisibleProjectCount(target)
                      if (projectGroups.length < target && catalogQuery.hasNextPage)
                        setCatalogLoadIntent("projects")
                    }}
                    onSortChange={updateChatSort}
                    onToggleCustomSection={(id) => toggleSet(setExpandedCustomSections, id)}
                    onToggleProject={(id) => toggleSet(setCollapsedProjects, id)}
                    onToggleSection={(id) => toggleSet(setExpandedSections, id)}
                  />
                </li>
              )
            })}
          </ul>
        </nav>
      </TooltipProvider>
      <ProjectCreateDialog onOpenChange={setProjectDialogOpen} open={projectDialogOpen} />
      <SectionDialog
        dialog={sectionDialog}
        onOpenChange={(open) => !open && setSectionDialog(null)}
      />
      <DeleteSectionDialog
        section={deletingSection}
        onOpenChange={(open) => !open && setDeletingSection(null)}
      />
    </>
  )
}

type RowViewProps = Readonly<{
  catalogLoading: boolean
  catalogLoadIntent: "projects" | string | null
  chatSort: SidebarSort
  collapsedProjects: ReadonlySet<string>
  expandedCustomSections: ReadonlySet<string>
  expandedSections: ReadonlySet<SidebarSectionId>
  organizeByProject: boolean
  pendingCount: number
  pinnedLoading: boolean
  pinnedSort: SidebarSort
  row: TaskSidebarRow
  onCreateProject: () => void
  onCreateSection: () => void
  onDeleteSection: (section: CodexThreadSectionView) => void
  onEditSection: (section: CodexThreadSectionView) => void
  onOrganizationChange: (value: boolean) => void
  onPinnedSortChange: (sort: SidebarSort) => void
  onShowMorePinned: () => void
  onShowMoreProjectTasks: (id: string) => void
  onShowMoreProjects: () => void
  onSortChange: (sort: SidebarSort) => void
  onToggleCustomSection: (id: string) => void
  onToggleProject: (id: string) => void
  onToggleSection: (id: SidebarSectionId) => void
}>

function TaskSidebarRowView(props: RowViewProps) {
  const { i18n } = useLingui()
  const { row } = props
  if (row.kind === "navigation") {
    const item = virtualNavigationItems.find(({ id }) => id === row.navigationId)
    if (!item) return null
    const Icon = item.icon
    const label = i18n._(item.label)
    return (
      <SidebarMenuButton render={<Link to={item.href} />} tooltip={label}>
        <Icon aria-hidden="true" size={16} strokeWidth={1.9} />
        <span>{label}</span>
        {item.id === "pending" && props.pendingCount > 0 ? (
          <span className="ml-auto rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
            {props.pendingCount}
          </span>
        ) : null}
      </SidebarMenuButton>
    )
  }
  if (row.kind === "section") {
    return (
      <SectionHeader
        expanded={props.expandedSections.has(row.section)}
        label={i18n._(sectionLabels[row.section])}
        menu={
          row.section === "pinned" ? (
            <SortMenu sort={props.pinnedSort} onSortChange={props.onPinnedSortChange} />
          ) : (
            <SidebarOrganizationMenu
              includeNewSection={row.section === "recents"}
              organizeByProject={props.organizeByProject}
              sort={props.chatSort}
              onCreateSection={props.onCreateSection}
              onOrganizationChange={props.onOrganizationChange}
              onSortChange={props.onSortChange}
            />
          )
        }
        newAction={
          row.section === "projects"
            ? props.onCreateProject
            : row.section === "recents"
              ? "new-chat"
              : undefined
        }
        onToggle={() => props.onToggleSection(row.section)}
      />
    )
  }
  if (row.kind === "customSection") {
    const section = { id: row.sectionId, name: row.sectionName }
    return (
      <SectionHeader
        expanded={props.expandedCustomSections.has(row.sectionId)}
        label={row.sectionName}
        menu={
          <CustomSectionMenu
            section={section}
            onDelete={props.onDeleteSection}
            onEdit={props.onEditSection}
          />
        }
        newAction={{ sectionId: row.sectionId }}
        onToggle={() => props.onToggleCustomSection(row.sectionId)}
      />
    )
  }
  if (row.kind === "project") {
    const expanded = !props.collapsedProjects.has(row.projectId)
    const Icon = expanded ? FolderOpen : Folder
    return (
      <button
        aria-expanded={expanded}
        className="flex h-8 w-full items-center gap-2 rounded-md px-0 text-left text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        type="button"
        onClick={() => props.onToggleProject(row.projectId)}
      >
        <Icon aria-hidden="true" size={17} strokeWidth={1.8} />
        <span className="truncate">{row.projectName}</span>
      </button>
    )
  }
  if (row.kind === "thread")
    return (
      <SidebarMenuButton
        className={cn(row.source === "project" ? "pl-[calc(17px+0.5rem)]" : "px-0.5")}
        render={<Link to="/" search={{ thread: row.thread.id }} />}
        tooltip={row.thread.title}
      >
        <span className="truncate">{row.thread.title}</span>
      </SidebarMenuButton>
    )
  if (row.kind === "showMore") {
    const loading =
      row.target === "pinned"
        ? props.pinnedLoading
        : props.catalogLoading &&
          (row.target === "projects"
            ? props.catalogLoadIntent === "projects"
            : props.catalogLoadIntent === row.projectId)
    return (
      <button
        className={cn(
          "flex h-[30px] w-full items-center gap-1 rounded-md px-2 text-left text-xs font-medium text-muted-foreground outline-none hover:bg-sidebar-accent disabled:opacity-60",
          row.target === "project" && "pl-8"
        )}
        disabled={loading}
        type="button"
        onClick={() =>
          row.target === "pinned"
            ? props.onShowMorePinned()
            : row.target === "projects"
              ? props.onShowMoreProjects()
              : row.projectId && props.onShowMoreProjectTasks(row.projectId)
        }
      >
        {loading ? <LoaderCircle aria-hidden="true" className="animate-spin" size={13} /> : null}
        <Trans id="navigation.showMore">Show more</Trans>
      </button>
    )
  }
  if (row.kind === "loading")
    return (
      <div className="flex h-9 items-center justify-center text-muted-foreground" role="status">
        <LoaderCircle aria-hidden="true" className="animate-spin" size={15} />
      </div>
    )
  if (row.kind === "customEmpty")
    return (
      <div className="flex h-9 items-center px-0 text-sm text-muted-foreground/55">
        <Trans id="navigation.section.empty">Drop chats or projects here</Trans>
      </div>
    )
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

function SectionHeader({
  expanded,
  label,
  menu,
  newAction,
  onToggle,
}: Readonly<{
  expanded: boolean
  label: string
  menu: ReactNode
  newAction?: (() => void) | "new-chat" | { sectionId: string }
  onToggle: () => void
}>) {
  return (
    <div className="flex h-full items-end gap-1 px-0 pb-1 text-sm text-sidebar-foreground/55 group-data-[collapsible=icon]:hidden">
      <button
        aria-expanded={expanded}
        className="flex min-w-0 items-center gap-1 rounded px-0.5 py-1 text-left font-medium outline-none hover:text-sidebar-foreground focus-visible:ring-2"
        type="button"
        onClick={onToggle}
      >
        <span className="truncate">{label}</span>
        {expanded ? (
          <ChevronDown aria-hidden="true" size={14} />
        ) : (
          <ChevronRight aria-hidden="true" size={14} />
        )}
      </button>
      <span className="ml-auto flex items-center gap-0.5">
        {menu}
        {newAction ? <NewChatOrProjectAction action={newAction} label={label} /> : null}
      </span>
    </div>
  )
}

function NewChatOrProjectAction({
  action,
  label,
}: Readonly<{ action: (() => void) | "new-chat" | { sectionId: string }; label: string }>) {
  const isProject = typeof action === "function"
  const tooltip = isProject
    ? "Create project"
    : typeof action === "object"
      ? `New chat in ${label}`
      : "New chat"
  const actionClass =
    "flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2"
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          isProject ? (
            <button aria-label={tooltip} className={actionClass} type="button" onClick={action}>
              <Plus size={16} />
            </button>
          ) : (
            <Link
              aria-label={tooltip}
              className={actionClass}
              to="/"
              search={typeof action === "object" ? { section: action.sectionId } : {}}
            >
              <SquarePen size={16} />
            </Link>
          )
        }
      />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

function MenuButton() {
  return (
    <DropdownMenuTrigger
      render={
        <button
          aria-label="More options"
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2"
          type="button"
        />
      }
    >
      <MoreHorizontal size={16} />
    </DropdownMenuTrigger>
  )
}
function CheckItem({
  active,
  children,
  onClick,
}: Readonly<{ active: boolean; children: ReactNode; onClick: () => void }>) {
  return (
    <DropdownMenuItem className="min-w-40 py-1.5" onClick={onClick}>
      <span className="w-4">{active ? <Check size={16} /> : null}</span>
      {children}
    </DropdownMenuItem>
  )
}
function SortItems({
  sort,
  onSortChange,
}: Readonly<{ sort: SidebarSort; onSortChange: (sort: SidebarSort) => void }>) {
  return (
    <>
      <CheckItem active={sort === "priority"} onClick={() => onSortChange("priority")}>
        <Trans id="navigation.sort.priority">Priority</Trans>
      </CheckItem>
      <CheckItem active={sort === "updated"} onClick={() => onSortChange("updated")}>
        <Trans id="navigation.sort.updated">Last updated</Trans>
      </CheckItem>
      <CheckItem active={sort === "manual"} onClick={() => onSortChange("manual")}>
        <Trans id="navigation.sort.manual">Manual order</Trans>
      </CheckItem>
    </>
  )
}
function SortMenu({
  sort,
  onSortChange,
}: Readonly<{ sort: SidebarSort; onSortChange: (sort: SidebarSort) => void }>) {
  return (
    <DropdownMenu>
      <MenuButton />
      <DropdownMenuContent
        align="start"
        className="w-auto rounded-2xl p-1.5"
        side="right"
        sideOffset={2}
      >
        <SortItems sort={sort} onSortChange={onSortChange} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SidebarOrganizationMenu({
  includeNewSection,
  organizeByProject,
  sort,
  onCreateSection,
  onOrganizationChange,
  onSortChange,
}: Readonly<{
  includeNewSection: boolean
  organizeByProject: boolean
  sort: SidebarSort
  onCreateSection: () => void
  onOrganizationChange: (value: boolean) => void
  onSortChange: (sort: SidebarSort) => void
}>) {
  return (
    <DropdownMenu>
      <MenuButton />
      <DropdownMenuContent
        align="start"
        className="w-auto min-w-52 rounded-2xl p-1.5"
        side="right"
        sideOffset={2}
      >
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="py-1.5">
            <Trans id="navigation.organizeSidebar">Organize sidebar</Trans>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="rounded-2xl p-1.5">
            <CheckItem active={organizeByProject} onClick={() => onOrganizationChange(true)}>
              <Trans id="navigation.byProject">By project</Trans>
            </CheckItem>
            <CheckItem active={!organizeByProject} onClick={() => onOrganizationChange(false)}>
              <Trans id="navigation.inOneList">In one list</Trans>
            </CheckItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="py-1.5">
            <Trans id="navigation.sortChatsBy">Sort chats by</Trans>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="rounded-2xl p-1.5">
            <SortItems sort={sort} onSortChange={onSortChange} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {includeNewSection ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="py-1.5" onClick={onCreateSection}>
              <Plus />
              <Trans id="navigation.newSection">New section</Trans>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CustomSectionMenu({
  section,
  onDelete,
  onEdit,
}: Readonly<{
  section: CodexThreadSectionView
  onDelete: (section: CodexThreadSectionView) => void
  onEdit: (section: CodexThreadSectionView) => void
}>) {
  return (
    <DropdownMenu>
      <MenuButton />
      <DropdownMenuContent
        align="start"
        className="w-auto min-w-48 rounded-2xl p-1.5"
        side="right"
        sideOffset={2}
      >
        <DropdownMenuItem className="py-1.5" onClick={() => onEdit(section)}>
          <Pencil />
          <Trans id="navigation.editSection">Edit section</Trans>
        </DropdownMenuItem>
        <DropdownMenuItem className="py-1.5" disabled>
          <Archive />
          <Trans id="navigation.archiveSection">Archive all chats</Trans>
        </DropdownMenuItem>
        <DropdownMenuItem className="py-1.5" onClick={() => onDelete(section)}>
          <X />
          <Trans id="navigation.deleteSection">Delete section</Trans>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SectionDialog({
  dialog,
  onOpenChange,
}: Readonly<{
  dialog: { mode: "create" } | { mode: "edit"; section: CodexThreadSectionView } | null
  onOpenChange: (open: boolean) => void
}>) {
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setName(dialog?.mode === "edit" ? dialog.section.name : "")
    setError(null)
  }, [dialog])
  const mutation = useMutation({
    mutationFn: async () => {
      const api = window.cypheria?.codex
      if (!api) throw new Error("Codex is only available in the Cypheria desktop app.")
      return dialog?.mode === "edit"
        ? api.updateThreadSection({ id: dialog.section.id, name: name.trim() })
        : api.createThreadSection({ name: name.trim() })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["codex", "thread-sections"] })
      onOpenChange(false)
    },
  })
  const submit = async () => {
    if (!name.trim()) return
    try {
      await mutation.mutateAsync()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }
  const editing = dialog?.mode === "edit"
  return (
    <Dialog open={dialog != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-5 rounded-[28px] p-7 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold">
            {editing ? (
              <Trans id="navigation.editSection">Edit section</Trans>
            ) : (
              <Trans id="navigation.newSection">New section</Trans>
            )}
          </DialogTitle>
          {!editing ? (
            <DialogDescription className="text-base">
              <Trans id="navigation.sectionDescription">
                Group chats and projects however you like
              </Trans>
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <Input
          autoFocus
          className="h-12 rounded-xl text-base"
          onChange={(event) => setName(event.target.value)}
          placeholder="Section name"
          value={name}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter className="gap-3 sm:justify-end">
          <Button
            className="rounded-xl"
            onClick={() => onOpenChange(false)}
            size="lg"
            type="button"
            variant="outline"
          >
            <Trans id="task.cancel">Cancel</Trans>
          </Button>
          <Button
            className="min-w-36 rounded-xl"
            disabled={!name.trim() || mutation.isPending}
            onClick={() => void submit()}
            size="lg"
            type="button"
          >
            {editing ? (
              <Trans id="navigation.saveSection">Save section</Trans>
            ) : (
              <Trans id="navigation.createSection">Create section</Trans>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteSectionDialog({
  section,
  onOpenChange,
}: Readonly<{ section: CodexThreadSectionView | null; onOpenChange: (open: boolean) => void }>) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async () => {
      if (section) await window.cypheria?.codex.deleteThreadSection(section.id)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["codex", "thread-sections"] })
      await queryClient.invalidateQueries({ queryKey: ["codex", "threads"] })
      onOpenChange(false)
    },
  })
  return (
    <Dialog open={section != null} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>
            <Trans id="navigation.deleteSection">Delete section</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans id="navigation.deleteSectionDescription">
              Chats in this section will return to Recents.
            </Trans>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <Trans id="task.cancel">Cancel</Trans>
          </Button>
          <Button
            variant="destructive"
            disabled={mutation.isPending}
            onClick={() => void mutation.mutateAsync()}
          >
            <Trans id="navigation.deleteSection">Delete section</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
