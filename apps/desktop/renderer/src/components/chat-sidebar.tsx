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
import { Link, useNavigate } from "@tanstack/react-router"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  Archive,
  BellDot,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Folder,
  FolderInput,
  FolderOpen,
  GitFork,
  Globe2,
  LoaderCircle,
  Mail,
  MailOpen,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  ScrollText,
  ShieldCheck,
  SquarePen,
  Trash2,
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
  useSyncExternalStore,
} from "react"
import type {
  CodexProjectView,
  CodexThreadSectionView,
  CodexThreadView,
} from "../../../ipc/src/index.js"
import { unreadThreadMutationFromCodexEvent, unreadThreadStore } from "../chat-unread-state.js"
import {
  buildChatSidebarRows,
  type ChatSidebarRow,
  estimateChatSidebarRowSize,
  groupProjectThreads,
  SIDEBAR_BATCH_SIZE,
  type SidebarCustomSection,
  type SidebarSectionId,
} from "./chat-sidebar-model.js"
import { ProjectCreateDialog } from "./project-create-dialog"

const PINNED_THREAD_SECTION_ID = "01984de2-8f74-7c91-a3b2-5c5e937cf318"
const PROJECT_PIN_METADATA_KEY = "cypheria.sidebar.pinned"
const PROJECT_SECTION_METADATA_KEY = "cypheria.sidebar.sectionId"
const THREAD_PAGE_SIZE = 30
type SidebarSort = "priority" | "updated" | "created" | "manual"
type SectionDialogState =
  | { mode: "create"; target?: { id: string; kind: "project" | "thread" } }
  | { mode: "edit"; section: CodexThreadSectionView }

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
      : sort === "created"
        ? ({ sortDirection: "desc", sortKey: "created_at" } as const)
        : ({ sortDirection: "desc", sortKey: "updated_at" } as const)

const readPreference = <T extends string>(key: string, fallback: T): T => {
  try {
    return (globalThis.localStorage?.getItem(key) as T | null) ?? fallback
  } catch {
    return fallback
  }
}

export function ChatSidebar({
  activeThreadId,
  pendingCount,
}: Readonly<{ activeThreadId?: string; pendingCount: number }>) {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [expandedSections, setExpandedSections] = useState<Set<SidebarSectionId>>(
    () => new Set(["pinned", "projects", "recents"])
  )
  const [expandedCustomSections, setExpandedCustomSections] = useState<Set<string>>(new Set())
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => new Set())
  const [visibleProjectCount, setVisibleProjectCount] = useState(SIDEBAR_BATCH_SIZE)
  const [projectChatLimits, setProjectChatLimits] = useState<Record<string, number>>({})
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
  const [sectionDialog, setSectionDialog] = useState<SectionDialogState | null>(null)
  const [deletingSection, setDeletingSection] = useState<CodexThreadSectionView | null>(null)
  const [threadDialog, setThreadDialog] = useState<{
    kind: "archive" | "rename"
    thread: CodexThreadView
  } | null>(null)
  const [projectDialog, setProjectDialog] = useState<{
    kind: "archive" | "edit" | "remove"
    project: CodexProjectView
  } | null>(null)
  const [archivingSection, setArchivingSection] = useState<CodexThreadSectionView | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const unreadThreadIds = useSyncExternalStore(
    unreadThreadStore.subscribe,
    unreadThreadStore.getSnapshot,
    unreadThreadStore.getSnapshot
  )

  useEffect(() => {
    if (activeThreadId) unreadThreadStore.markRead(activeThreadId)
  }, [activeThreadId])

  useEffect(() => {
    const api = window.cypheria?.codex
    if (!api) return
    return api.onEvent((event) => {
      const mutation = unreadThreadMutationFromCodexEvent(event, activeThreadId)
      if (!mutation) return
      if (mutation.action === "unread") unreadThreadStore.markUnread(mutation.threadId)
      else unreadThreadStore.markRead(mutation.threadId)
    })
  }, [activeThreadId])

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
  const allProjectGroups = useMemo(
    () => groupProjectThreads(catalogThreads, projectsQuery.data?.data ?? []),
    [catalogThreads, projectsQuery.data?.data]
  )
  const pinnedProjectGroups = useMemo(
    () =>
      allProjectGroups.filter(
        ({ project }) => project.metadata[PROJECT_PIN_METADATA_KEY] === "true"
      ),
    [allProjectGroups]
  )
  const projectGroups = useMemo(
    () =>
      allProjectGroups.filter(
        ({ project }) =>
          project.metadata[PROJECT_PIN_METADATA_KEY] !== "true" &&
          !project.metadata[PROJECT_SECTION_METADATA_KEY]
      ),
    [allProjectGroups]
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
        projects: allProjectGroups.filter(
          ({ project }) =>
            project.metadata[PROJECT_PIN_METADATA_KEY] !== "true" &&
            project.metadata[PROJECT_SECTION_METADATA_KEY] === section.id
        ),
        threads: customThreadQueries[index]?.data?.data ?? [],
      })),
    [allProjectGroups, customThreadQueries, sections]
  )
  const expandedProjects = useMemo(
    () =>
      new Set(
        allProjectGroups
          .map(({ projectId }) => projectId)
          .filter((id) => !collapsedProjects.has(id))
      ),
    [allProjectGroups, collapsedProjects]
  )
  const rows = useMemo(
    () =>
      buildChatSidebarRows({
        customSections,
        expandedCustomSections,
        expandedProjects,
        expandedSections,
        navigationIds: virtualNavigationItems.map(({ id }) => id),
        pinnedHasMore: pinnedQuery.hasNextPage,
        pinnedProjects: pinnedProjectGroups,
        pinnedThreads,
        projectGroups,
        projectChatLimits,
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
      pinnedProjectGroups,
      pinnedThreads,
      projectGroups,
      projectChatLimits,
      recentThreads,
      visibleProjectCount,
    ]
  )
  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: (index) => estimateChatSidebarRowSize(rows[index] as ChatSidebarRow),
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
        ? allProjectGroups.length >= visibleProjectCount
        : (allProjectGroups.find(({ projectId }) => projectId === catalogLoadIntent)?.threads
            .length ?? 0) >= (projectChatLimits[catalogLoadIntent] ?? SIDEBAR_BATCH_SIZE)
    if (reached) return setCatalogLoadIntent(null)
    void catalogQuery.fetchNextPage()
  }, [allProjectGroups, catalogLoadIntent, catalogQuery, projectChatLimits, visibleProjectCount])
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
  const invalidateSidebar = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["codex", "projects"] }),
      queryClient.invalidateQueries({ queryKey: ["codex", "thread-sections"] }),
      queryClient.invalidateQueries({ queryKey: ["codex", "threads"] }),
    ])
  }
  const runSidebarMutation = async (mutation: () => Promise<unknown>) => {
    setMutationError(null)
    try {
      await mutation()
      await invalidateSidebar()
      return true
    } catch (reason) {
      setMutationError(reason instanceof Error ? reason.message : String(reason))
      return false
    }
  }
  const moveThreadToSection = (thread: CodexThreadView, sectionId: string | null) =>
    runSidebarMutation(async () => {
      await window.cypheria?.codex.moveThreadToSection({ sectionId, threadId: thread.id })
    })
  const moveThreadToProject = (thread: CodexThreadView, projectId: string | null) =>
    runSidebarMutation(async () => {
      await window.cypheria?.codex.moveThreadToProject(thread.id, projectId)
    })
  const forkThread = (thread: CodexThreadView) =>
    runSidebarMutation(async () => {
      const fork = await window.cypheria?.codex.forkThread(thread.id)
      if (!fork) throw new Error("Codex is only available in the Cypheria desktop app.")
      unreadThreadStore.markRead(fork.threadId)
      await navigate({ search: { thread: fork.threadId }, to: "/" })
    })
  const updateProjectSidebarMetadata = (
    project: CodexProjectView,
    update: (metadata: Record<string, string>) => void
  ) =>
    runSidebarMutation(async () => {
      const metadata = { ...project.metadata }
      update(metadata)
      await window.cypheria?.codex.updateProject({
        id: project.id,
        metadata,
        name: project.name,
      })
    })
  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
    } catch (reason) {
      setMutationError(reason instanceof Error ? reason.message : String(reason))
    }
  }
  const copyThreadMarkdown = async (thread: CodexThreadView) => {
    try {
      const detail = await window.cypheria?.codex.readThread(thread.id)
      if (!detail) return
      const markdown = detail.messages
        .map((message) => {
          const text = message.parts
            .flatMap((part) => (part.type === "text" ? [part.text] : []))
            .join("\n")
          return `## ${message.role === "user" ? "User" : "Assistant"}\n\n${text}`
        })
        .join("\n\n")
      await copyText(`# ${detail.title}\n\n${markdown}`)
    } catch (reason) {
      setMutationError(reason instanceof Error ? reason.message : String(reason))
    }
  }
  const archiveMatchingThreads = async (matches: (thread: CodexThreadView) => boolean) => {
    const api = window.cypheria?.codex
    if (!api) throw new Error("Codex is only available in the Cypheria desktop app.")
    let cursor: string | null = null
    const threadIds: string[] = []
    do {
      const page = await api.listThreads({ cursor, limit: 100 })
      threadIds.push(...page.data.filter(matches).map(({ id }) => id))
      cursor = page.nextCursor
    } while (cursor)
    for (const threadId of threadIds) await api.archiveThread(threadId)
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
                  <ChatSidebarRowView
                    catalogLoading={catalogQuery.isFetchingNextPage}
                    catalogLoadIntent={catalogLoadIntent}
                    chatSort={chatSort}
                    collapsedProjects={collapsedProjects}
                    expandedCustomSections={expandedCustomSections}
                    expandedSections={expandedSections}
                    organizeByProject={organizeByProject}
                    pendingCount={pendingCount}
                    projects={projectsQuery.data?.data ?? []}
                    pinnedLoading={pinnedQuery.isFetchingNextPage}
                    pinnedSort={pinnedSort}
                    row={row}
                    sections={sections}
                    onArchiveSection={setArchivingSection}
                    onCopyThread={(kind, thread) => {
                      if (kind === "cwd") void copyText(thread.cwd)
                      if (kind === "link")
                        void copyText(`cypheria://app/?thread=${encodeURIComponent(thread.id)}`)
                      if (kind === "markdown") void copyThreadMarkdown(thread)
                    }}
                    onCreateProject={() => setProjectDialogOpen(true)}
                    onCreateSection={() => setSectionDialog({ mode: "create" })}
                    onCreateSectionFor={(target) => setSectionDialog({ mode: "create", target })}
                    onDeleteSection={setDeletingSection}
                    onEditSection={(section) => setSectionDialog({ mode: "edit", section })}
                    onOrganizationChange={setOrganization}
                    onNewChatProject={(project) =>
                      void navigate({ search: { project: project.id }, to: "/" })
                    }
                    onProjectDialog={(kind, project) => setProjectDialog({ kind, project })}
                    onProjectMoveSection={(project, sectionId) =>
                      void updateProjectSidebarMetadata(project, (metadata) => {
                        delete metadata[PROJECT_PIN_METADATA_KEY]
                        if (sectionId) metadata[PROJECT_SECTION_METADATA_KEY] = sectionId
                        else delete metadata[PROJECT_SECTION_METADATA_KEY]
                      })
                    }
                    onProjectPin={(project, pinned) =>
                      void updateProjectSidebarMetadata(project, (metadata) => {
                        delete metadata[PROJECT_SECTION_METADATA_KEY]
                        if (pinned) metadata[PROJECT_PIN_METADATA_KEY] = "true"
                        else delete metadata[PROJECT_PIN_METADATA_KEY]
                      })
                    }
                    onRevealProject={(project) =>
                      void runSidebarMutation(async () => {
                        await window.cypheria?.codex.revealProject(project.id)
                      })
                    }
                    onPinnedSortChange={updatePinnedSort}
                    onShowMorePinned={() => void pinnedQuery.fetchNextPage()}
                    onShowMoreProjectChats={(projectId) => {
                      const target =
                        (projectChatLimits[projectId] ?? SIDEBAR_BATCH_SIZE) + SIDEBAR_BATCH_SIZE
                      setProjectChatLimits((current) => ({ ...current, [projectId]: target }))
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
                    onThreadFork={(thread) => void forkThread(thread)}
                    onThreadDialog={(kind, thread) => setThreadDialog({ kind, thread })}
                    onThreadMoveProject={(thread, projectId) =>
                      void moveThreadToProject(thread, projectId)
                    }
                    onThreadMoveSection={(thread, sectionId) =>
                      void moveThreadToSection(thread, sectionId)
                    }
                    onThreadReadState={(thread, unread) => {
                      if (unread) unreadThreadStore.markUnread(thread.id)
                      else unreadThreadStore.markRead(thread.id)
                    }}
                    onToggleCustomSection={(id) => toggleSet(setExpandedCustomSections, id)}
                    onToggleProject={(id) => toggleSet(setCollapsedProjects, id)}
                    onToggleSection={(id) => toggleSet(setExpandedSections, id)}
                    unreadThreadIds={unreadThreadIds}
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
        onCreated={async (section, target) => {
          if (!target) return
          if (target.kind === "thread") {
            await window.cypheria?.codex.moveThreadToSection({
              sectionId: section.id,
              threadId: target.id,
            })
            return
          }
          const project = projectsQuery.data?.data.find(({ id }) => id === target.id)
          if (!project) throw new Error("Project is no longer available.")
          const metadata: Record<string, string> = {
            ...project.metadata,
            [PROJECT_SECTION_METADATA_KEY]: section.id,
          }
          delete metadata[PROJECT_PIN_METADATA_KEY]
          await window.cypheria?.codex.updateProject({
            id: project.id,
            metadata,
            name: project.name,
          })
        }}
        onOpenChange={(open) => !open && setSectionDialog(null)}
      />
      <DeleteSectionDialog
        section={deletingSection}
        onOpenChange={(open) => !open && setDeletingSection(null)}
      />
      <SidebarMutationDialog
        confirmLabel={
          threadDialog?.kind === "rename"
            ? i18n._(msg({ id: "navigation.save", message: "Save" }))
            : i18n._(msg({ id: "navigation.archiveChat", message: "Archive chat" }))
        }
        description={
          threadDialog?.kind === "archive"
            ? i18n._(
                msg({
                  id: "navigation.archiveChatDescription",
                  message: "The chat will move to Archived chats.",
                })
              )
            : i18n._(
                msg({
                  id: "navigation.renameChatDescription",
                  message: "Keep the title short and recognizable.",
                })
              )
        }
        inputLabel={
          threadDialog?.kind === "rename"
            ? i18n._(msg({ id: "navigation.chatTitle", message: "Chat title" }))
            : undefined
        }
        initialValue={threadDialog?.thread.title}
        open={threadDialog != null}
        title={
          threadDialog?.kind === "rename"
            ? i18n._(msg({ id: "navigation.renameChat", message: "Rename chat" }))
            : i18n._(msg({ id: "navigation.archiveChat", message: "Archive chat" }))
        }
        onConfirm={async (value) => {
          if (!threadDialog) return false
          const { kind, thread } = threadDialog
          const succeeded = await runSidebarMutation(async () => {
            if (kind === "rename")
              await window.cypheria?.codex.renameThread(thread.id, value.trim())
            if (kind === "archive") await window.cypheria?.codex.archiveThread(thread.id)
          })
          if (succeeded && kind !== "rename") {
            const activeThread = new URL(globalThis.location.href).searchParams.get("thread")
            if (activeThread === thread.id) await navigate({ to: "/" })
          }
          if (succeeded) setThreadDialog(null)
          return succeeded
        }}
        onOpenChange={(open) => !open && setThreadDialog(null)}
      />
      <SidebarMutationDialog
        confirmLabel={
          projectDialog?.kind === "edit"
            ? i18n._(msg({ id: "navigation.save", message: "Save" }))
            : projectDialog?.kind === "archive"
              ? i18n._(msg({ id: "navigation.archiveProjectChats", message: "Archive chats" }))
              : i18n._(msg({ id: "navigation.removeProject", message: "Remove project" }))
        }
        description={
          projectDialog?.kind === "remove"
            ? i18n._(
                msg({
                  id: "navigation.removeProjectDescription",
                  message:
                    "This removes the project from Cypheria without deleting its files or chats.",
                })
              )
            : projectDialog?.kind === "archive"
              ? i18n._(
                  msg({
                    id: "navigation.archiveProjectDescription",
                    message: "Every chat in this project will move to Archived chats.",
                  })
                )
              : i18n._(
                  msg({
                    id: "navigation.editProjectDescription",
                    message: "Update the project name shown in the sidebar.",
                  })
                )
        }
        destructive={projectDialog?.kind === "remove"}
        inputLabel={
          projectDialog?.kind === "edit"
            ? i18n._(msg({ id: "navigation.projectName", message: "Project name" }))
            : undefined
        }
        initialValue={projectDialog?.project.name}
        open={projectDialog != null}
        title={
          projectDialog?.kind === "edit"
            ? i18n._(msg({ id: "navigation.editProject", message: "Edit project" }))
            : projectDialog?.kind === "archive"
              ? i18n._(msg({ id: "navigation.archiveProjectChats", message: "Archive chats" }))
              : i18n._(msg({ id: "navigation.removeProject", message: "Remove project" }))
        }
        onConfirm={async (value) => {
          if (!projectDialog) return false
          const { kind, project } = projectDialog
          const succeeded = await runSidebarMutation(async () => {
            if (kind === "edit")
              await window.cypheria?.codex.updateProject({
                id: project.id,
                metadata: project.metadata,
                name: value.trim(),
              })
            if (kind === "archive")
              await archiveMatchingThreads((thread) => thread.projectId === project.id)
            if (kind === "remove") await window.cypheria?.codex.deleteProject(project.id)
          })
          if (succeeded) setProjectDialog(null)
          return succeeded
        }}
        onOpenChange={(open) => !open && setProjectDialog(null)}
      />
      <SidebarMutationDialog
        confirmLabel={i18n._(
          msg({ id: "navigation.archiveSection", message: "Archive all chats" })
        )}
        description={i18n._(
          msg({
            id: "navigation.archiveSectionDescription",
            message: "Every chat in this section and its projects will move to Archived chats.",
          })
        )}
        open={archivingSection != null}
        title={i18n._(msg({ id: "navigation.archiveSection", message: "Archive all chats" }))}
        onConfirm={async () => {
          if (!archivingSection) return false
          const projectIds = new Set(
            allProjectGroups
              .filter(
                ({ project }) =>
                  project.metadata[PROJECT_SECTION_METADATA_KEY] === archivingSection.id
              )
              .map(({ projectId }) => projectId)
          )
          const succeeded = await runSidebarMutation(() =>
            archiveMatchingThreads(
              (thread) =>
                thread.sectionId === archivingSection.id ||
                (thread.projectId != null && projectIds.has(thread.projectId))
            )
          )
          if (succeeded) setArchivingSection(null)
          return succeeded
        }}
        onOpenChange={(open) => !open && setArchivingSection(null)}
      />
      <SidebarErrorDialog error={mutationError} onClose={() => setMutationError(null)} />
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
  projects: readonly CodexProjectView[]
  pinnedLoading: boolean
  pinnedSort: SidebarSort
  row: ChatSidebarRow
  sections: readonly CodexThreadSectionView[]
  unreadThreadIds: ReadonlySet<string>
  onArchiveSection: (section: CodexThreadSectionView) => void
  onCopyThread: (kind: "cwd" | "link" | "markdown", thread: CodexThreadView) => void
  onCreateProject: () => void
  onCreateSection: () => void
  onCreateSectionFor: (target: { id: string; kind: "project" | "thread" }) => void
  onDeleteSection: (section: CodexThreadSectionView) => void
  onEditSection: (section: CodexThreadSectionView) => void
  onOrganizationChange: (value: boolean) => void
  onNewChatProject: (project: CodexProjectView) => void
  onProjectDialog: (kind: "archive" | "edit" | "remove", project: CodexProjectView) => void
  onProjectMoveSection: (project: CodexProjectView, sectionId: string | null) => void
  onProjectPin: (project: CodexProjectView, pinned: boolean) => void
  onRevealProject: (project: CodexProjectView) => void
  onPinnedSortChange: (sort: SidebarSort) => void
  onShowMorePinned: () => void
  onShowMoreProjectChats: (id: string) => void
  onShowMoreProjects: () => void
  onSortChange: (sort: SidebarSort) => void
  onThreadDialog: (kind: "archive" | "rename", thread: CodexThreadView) => void
  onThreadFork: (thread: CodexThreadView) => void
  onThreadMoveProject: (thread: CodexThreadView, projectId: string | null) => void
  onThreadMoveSection: (thread: CodexThreadView, sectionId: string | null) => void
  onThreadReadState: (thread: CodexThreadView, unread: boolean) => void
  onToggleCustomSection: (id: string) => void
  onToggleProject: (id: string) => void
  onToggleSection: (id: SidebarSectionId) => void
}>

function ChatSidebarRowView(props: RowViewProps) {
  const { i18n } = useLingui()
  const { row } = props
  if (row.kind === "navigation") {
    const item = virtualNavigationItems.find(({ id }) => id === row.navigationId)
    if (!item) return null
    const Icon = item.icon
    const label = i18n._(item.label)
    return (
      <SidebarMenuButton render={<Link to={item.href} />} tooltip={label}>
        <Icon aria-hidden="true" className="size-4" strokeWidth={1.9} />
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
            archiveEnabled={row.archiveEnabled}
            section={section}
            onArchive={props.onArchiveSection}
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
    const expanded = !props.collapsedProjects.has(row.project.id)
    const Icon = expanded ? FolderOpen : Folder
    const hasUnread = row.threads.some(({ id }) => props.unreadThreadIds.has(id))
    const newChatLabel = i18n._({
      ...msg({
        id: "navigation.newChatInNamedProject",
        message: "New chat in {projectName}",
      }),
      values: { projectName: row.project.name },
    })
    return (
      <div className="group/project flex h-8 w-full items-center rounded-md hover:bg-sidebar-accent focus-within:bg-sidebar-accent">
        <button
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-0 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          type="button"
          onClick={() => props.onToggleProject(row.project.id)}
        >
          <Icon aria-hidden="true" className="size-4" strokeWidth={1.8} />
          <span className="truncate">{row.project.name}</span>
        </button>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                aria-label={newChatLabel}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:opacity-100 focus-visible:ring-2 group-focus-within/project:opacity-100 group-hover/project:opacity-100"
                type="button"
                onClick={() => props.onNewChatProject(row.project)}
              />
            }
          >
            <SquarePen aria-hidden="true" className="size-4" />
          </TooltipTrigger>
          <TooltipContent side="right">{newChatLabel}</TooltipContent>
        </Tooltip>
        <ProjectMenu
          archiveEnabled={row.threads.length > 0}
          project={row.project}
          sections={props.sections}
          onArchive={() => props.onProjectDialog("archive", row.project)}
          onCreateSection={() => props.onCreateSectionFor({ id: row.project.id, kind: "project" })}
          onEdit={() => props.onProjectDialog("edit", row.project)}
          onMarkRead={
            hasUnread
              ? () => {
                  for (const { id } of row.threads) unreadThreadStore.markRead(id)
                }
              : undefined
          }
          onMoveSection={(sectionId) => props.onProjectMoveSection(row.project, sectionId)}
          onPin={(pinned) => props.onProjectPin(row.project, pinned)}
          onRemove={() => props.onProjectDialog("remove", row.project)}
          onReveal={() => props.onRevealProject(row.project)}
        />
      </div>
    )
  }
  if (row.kind === "thread") {
    const isUnread = props.unreadThreadIds.has(row.thread.id)
    return (
      <div className="group/thread flex h-8 w-full items-center rounded-md hover:bg-sidebar-accent focus-within:bg-sidebar-accent">
        <SidebarMenuButton
          className={cn(
            "h-8 min-w-0 flex-1 bg-transparent hover:bg-transparent",
            row.source === "project" ? "pl-[calc(1rem+0.5rem)]" : "px-0.5"
          )}
          render={
            <Link
              to="/"
              search={{ thread: row.thread.id }}
              onClick={() => props.onThreadReadState(row.thread, false)}
            />
          }
          tooltip={row.thread.title}
        >
          <span className={cn("min-w-0 flex-1 truncate", isUnread && "font-semibold")}>
            {row.thread.title}
          </span>
          {isUnread ? (
            <>
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />
              <span className="sr-only">
                <Trans id="navigation.unread">Unread</Trans>
              </span>
            </>
          ) : null}
        </SidebarMenuButton>
        <ThreadMenu
          projects={props.projects}
          sections={props.sections}
          source={row.source}
          thread={row.thread}
          onArchive={() => props.onThreadDialog("archive", row.thread)}
          onCopy={(kind) => props.onCopyThread(kind, row.thread)}
          onCreateSection={() => props.onCreateSectionFor({ id: row.thread.id, kind: "thread" })}
          onFork={() => props.onThreadFork(row.thread)}
          onMoveProject={(projectId) => props.onThreadMoveProject(row.thread, projectId)}
          onMoveSection={(sectionId) => props.onThreadMoveSection(row.thread, sectionId)}
          onReadState={() => props.onThreadReadState(row.thread, !isUnread)}
          onRename={() => props.onThreadDialog("rename", row.thread)}
          unread={isUnread}
        />
      </div>
    )
  }
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
              : row.projectId && props.onShowMoreProjectChats(row.projectId)
        }
      >
        {loading ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
        <Trans id="navigation.showMore">Show more</Trans>
      </button>
    )
  }
  if (row.kind === "loading")
    return (
      <div className="flex h-9 items-center justify-center text-muted-foreground" role="status">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
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
        <Trans id="navigation.noPinnedChats">No pinned chats</Trans>
      ) : row.section === "projects" ? (
        <Trans id="navigation.noProjects">No projects yet</Trans>
      ) : (
        <Trans id="navigation.noChats">No chats yet</Trans>
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
          <ChevronDown aria-hidden="true" className="size-4" />
        ) : (
          <ChevronRight aria-hidden="true" className="size-4" />
        )}
      </button>
      <span className="ml-auto flex items-center gap-2">
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
    "relative flex size-4 items-center justify-center rounded text-muted-foreground outline-none after:absolute after:-inset-1 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2"
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          isProject ? (
            <button aria-label={tooltip} className={actionClass} type="button" onClick={action}>
              <Plus className="size-4" />
            </button>
          ) : (
            <Link
              aria-label={tooltip}
              className={actionClass}
              to="/"
              search={typeof action === "object" ? { section: action.sectionId } : {}}
            >
              <SquarePen className="size-4" />
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
          className="relative flex size-4 items-center justify-center rounded text-muted-foreground outline-none after:absolute after:-inset-1 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2"
          type="button"
        />
      }
    >
      <MoreHorizontal className="size-4" />
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
      <CheckItem active={sort === "created"} onClick={() => onSortChange("created")}>
        <Trans id="navigation.sort.created">Created</Trans>
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

function RowMenuButton({ label }: Readonly<{ label: string }>) {
  return (
    <DropdownMenuTrigger
      render={
        <button
          aria-label={label}
          className="mr-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:opacity-100 focus-visible:ring-2 group-focus-within/thread:opacity-100 group-focus-within/project:opacity-100 group-hover/thread:opacity-100 group-hover/project:opacity-100 data-popup-open:opacity-100"
          type="button"
        />
      }
    >
      <MoreHorizontal aria-hidden="true" className="size-4" />
    </DropdownMenuTrigger>
  )
}

function ThreadMenu({
  projects,
  sections,
  source,
  thread,
  onArchive,
  onCopy,
  onCreateSection,
  onFork,
  onMoveProject,
  onMoveSection,
  onReadState,
  onRename,
  unread,
}: Readonly<{
  projects: readonly CodexProjectView[]
  sections: readonly CodexThreadSectionView[]
  source: "pinned" | "project" | "recent"
  thread: CodexThreadView
  onArchive: () => void
  onCopy: (kind: "cwd" | "link" | "markdown") => void
  onCreateSection: () => void
  onFork: () => void
  onMoveProject: (projectId: string | null) => void
  onMoveSection: (sectionId: string | null) => void
  onReadState: () => void
  onRename: () => void
  unread: boolean
}>) {
  return (
    <DropdownMenu>
      <RowMenuButton label={`Options for ${thread.title}`} />
      <DropdownMenuContent align="start" className="min-w-56 rounded-2xl p-1.5" side="right">
        <DropdownMenuItem className="py-1.5" onClick={onRename}>
          <Pencil />
          <Trans id="navigation.rename">Rename</Trans>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="py-1.5"
          onClick={() => onMoveSection(source === "pinned" ? null : PINNED_THREAD_SECTION_ID)}
        >
          {source === "pinned" ? <PinOff /> : <Pin />}
          {source === "pinned" ? (
            <Trans id="navigation.unpin">Unpin</Trans>
          ) : (
            <Trans id="navigation.pin">Pin</Trans>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem className="py-1.5" onClick={onReadState}>
          {unread ? <MailOpen /> : <Mail />}
          {unread ? (
            <Trans id="navigation.markAsRead">Mark as read</Trans>
          ) : (
            <Trans id="navigation.markAsUnread">Mark as unread</Trans>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem className="py-1.5" onClick={onArchive}>
          <Archive />
          <Trans id="navigation.archive">Archive</Trans>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="py-1.5">
            <FolderInput />
            <Trans id="navigation.project">Project</Trans>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-48 rounded-2xl p-1.5">
            {projects.map((project) => (
              <DropdownMenuItem
                className="py-1.5"
                disabled={project.id === thread.projectId}
                key={project.id}
                onClick={() => onMoveProject(project.id)}
              >
                <span className="truncate">{project.name}</span>
              </DropdownMenuItem>
            ))}
            {thread.projectId ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="py-1.5" onClick={() => onMoveProject(null)}>
                  <Trans id="navigation.removeFromProject">Remove from project</Trans>
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="py-1.5">
            <Trans id="navigation.section">Section</Trans>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-48 rounded-2xl p-1.5">
            {sections.map((section) => (
              <DropdownMenuItem
                className="py-1.5"
                disabled={section.id === thread.sectionId}
                key={section.id}
                onClick={() => onMoveSection(section.id)}
              >
                <span className="truncate">{section.name}</span>
              </DropdownMenuItem>
            ))}
            {thread.sectionId && thread.sectionId !== PINNED_THREAD_SECTION_ID ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="py-1.5" onClick={() => onMoveSection(null)}>
                  <Trans id="navigation.removeFromSection">Remove from section</Trans>
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="py-1.5" onClick={onCreateSection}>
              <Plus />
              <Trans id="navigation.newSection">New section</Trans>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="py-1.5">
            <Copy />
            <Trans id="navigation.copy">Copy</Trans>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-52 rounded-2xl p-1.5">
            <DropdownMenuItem
              className="py-1.5"
              disabled={!thread.cwd}
              onClick={() => onCopy("cwd")}
            >
              <Trans id="navigation.copyWorkingDirectory">Copy working directory</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem className="py-1.5" onClick={() => onCopy("link")}>
              <Trans id="navigation.copyLink">Copy app link</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem className="py-1.5" onClick={() => onCopy("markdown")}>
              <Trans id="navigation.copyMarkdown">Copy chat as Markdown</Trans>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="py-1.5" onClick={onFork}>
          <GitFork />
          <Trans id="navigation.forkChat">Fork chat</Trans>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ProjectMenu({
  archiveEnabled,
  project,
  sections,
  onArchive,
  onCreateSection,
  onEdit,
  onMarkRead,
  onMoveSection,
  onPin,
  onRemove,
  onReveal,
}: Readonly<{
  archiveEnabled: boolean
  project: CodexProjectView
  sections: readonly CodexThreadSectionView[]
  onArchive: () => void
  onCreateSection: () => void
  onEdit: () => void
  onMarkRead?: () => void
  onMoveSection: (sectionId: string | null) => void
  onPin: (pinned: boolean) => void
  onRemove: () => void
  onReveal: () => void
}>) {
  const pinned = project.metadata[PROJECT_PIN_METADATA_KEY] === "true"
  const sectionId = project.metadata[PROJECT_SECTION_METADATA_KEY] ?? null
  return (
    <DropdownMenu>
      <RowMenuButton label={`Options for ${project.name}`} />
      <DropdownMenuContent align="start" className="min-w-56 rounded-2xl p-1.5" side="right">
        <DropdownMenuItem className="py-1.5" onClick={() => onPin(!pinned)}>
          {pinned ? <PinOff /> : <Pin />}
          {pinned ? (
            <Trans id="navigation.unpin">Unpin</Trans>
          ) : (
            <Trans id="navigation.pin">Pin</Trans>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem className="py-1.5" onClick={onEdit}>
          <Pencil />
          <Trans id="navigation.edit">Edit</Trans>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="py-1.5">
            <Trans id="navigation.section">Section</Trans>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-48 rounded-2xl p-1.5">
            {sections.map((section) => (
              <DropdownMenuItem
                className="py-1.5"
                disabled={section.id === sectionId}
                key={section.id}
                onClick={() => onMoveSection(section.id)}
              >
                <span className="truncate">{section.name}</span>
              </DropdownMenuItem>
            ))}
            {sectionId ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="py-1.5" onClick={() => onMoveSection(null)}>
                  <Trans id="navigation.removeFromSection">Remove from section</Trans>
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="py-1.5" onClick={onCreateSection}>
              <Plus />
              <Trans id="navigation.newSection">New section</Trans>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem
          className="py-1.5"
          disabled={project.roots.length === 0}
          onClick={onReveal}
        >
          <ExternalLink />
          <Trans id="navigation.revealProject">Reveal in Finder</Trans>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {onMarkRead ? (
          <DropdownMenuItem className="py-1.5" onClick={onMarkRead}>
            <MailOpen />
            <Trans id="navigation.markAllAsRead">Mark all as read</Trans>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem className="py-1.5" disabled={!archiveEnabled} onClick={onArchive}>
          <Archive />
          <Trans id="navigation.archiveProjectChats">Archive chats</Trans>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="py-1.5" onClick={onRemove}>
          <Trash2 />
          <Trans id="navigation.removeProject">Remove project</Trans>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CustomSectionMenu({
  archiveEnabled,
  section,
  onArchive,
  onDelete,
  onEdit,
}: Readonly<{
  archiveEnabled: boolean
  section: CodexThreadSectionView
  onArchive: (section: CodexThreadSectionView) => void
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
        <DropdownMenuItem
          className="py-1.5"
          disabled={!archiveEnabled}
          onClick={() => onArchive(section)}
        >
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
  onCreated,
  onOpenChange,
}: Readonly<{
  dialog: SectionDialogState | null
  onCreated: (
    section: CodexThreadSectionView,
    target?: { id: string; kind: "project" | "thread" }
  ) => Promise<void>
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
    onSuccess: async (section) => {
      if (dialog?.mode === "create") await onCreated(section, dialog.target)
      await queryClient.invalidateQueries({ queryKey: ["codex", "thread-sections"] })
      await queryClient.invalidateQueries({ queryKey: ["codex", "projects"] })
      await queryClient.invalidateQueries({ queryKey: ["codex", "threads"] })
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
            <Trans id="chat.cancel">Cancel</Trans>
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
            <Trans id="chat.cancel">Cancel</Trans>
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

function SidebarMutationDialog({
  confirmLabel,
  description,
  destructive = false,
  initialValue = "",
  inputLabel,
  open,
  title,
  onConfirm,
  onOpenChange,
}: Readonly<{
  confirmLabel: string
  description: string
  destructive?: boolean
  initialValue?: string
  inputLabel?: string
  open: boolean
  title: string
  onConfirm: (value: string) => Promise<boolean>
  onOpenChange: (open: boolean) => void
}>) {
  const [value, setValue] = useState(initialValue)
  const [pending, setPending] = useState(false)
  useEffect(() => setValue(initialValue), [initialValue])
  const submit = async () => {
    if (inputLabel && !value.trim()) return
    setPending(true)
    try {
      await onConfirm(value)
    } finally {
      setPending(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {inputLabel ? (
          <Input
            aria-label={inputLabel}
            autoFocus
            maxLength={200}
            onChange={(event) => setValue(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit()
            }}
            value={value}
          />
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            <Trans id="chat.cancel">Cancel</Trans>
          </Button>
          <Button
            disabled={pending || (Boolean(inputLabel) && !value.trim())}
            type="button"
            variant={destructive ? "destructive" : "default"}
            onClick={() => void submit()}
          >
            {pending ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SidebarErrorDialog({
  error,
  onClose,
}: Readonly<{ error: string | null; onClose: () => void }>) {
  return (
    <Dialog open={error != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>
            <Trans id="navigation.sidebarActionFailed">Couldn’t update the sidebar</Trans>
          </DialogTitle>
          <DialogDescription>{error}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            <Trans id="chat.done">Done</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
