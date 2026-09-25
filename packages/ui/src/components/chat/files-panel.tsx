import { Editor, type EditorOptions, type EditorType } from "@pierre/diffs/edit"
import {
  EditProvider,
  File,
  type FileEditCompleteEvent,
  type FileOptions,
  Virtualizer,
} from "@pierre/diffs/react"
import type {
  ContextMenuItem,
  ContextMenuOpenContext,
  FileTree as FileTreeModel,
  FileTreeMutationEvent,
  FileTreeOptions,
} from "@pierre/trees"
import { FileTree, useFileTree, useFileTreeSelection } from "@pierre/trees/react"
import {
  type CSSProperties,
  Fragment,
  type HTMLAttributes,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#components/breadcrumb"
import { Button } from "#components/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "#components/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#components/select"
import { useDocumentThemeMode } from "#hooks/use-document-theme-mode"
import { cn } from "#lib/utils"
import {
  CodeIcon,
  CopyIcon,
  EditIcon,
  EyeIcon,
  FileIcon,
  FolderIcon,
  FolderPlusIcon,
  FoldersIcon,
  SearchIcon,
  TrashIcon,
} from "../icons/index.js"

import {
  applyChatFileTreeMutation,
  type ChatFileTreeMutation,
  chatFileParentPath,
  isChatDirectoryPath,
  uniqueChatFilePath,
} from "./file-paths.js"
import {
  ChatFilePreview,
  type ChatFilePreviewKind,
  type ChatFilePreviewLabels,
  chatFilePreviewHasSource,
  chatFilePreviewKind,
} from "./file-preview.js"

export type ChatFileViewMode = "preview" | "source"

export type ChatFileGitStatus =
  | "added"
  | "deleted"
  | "ignored"
  | "modified"
  | "renamed"
  | "untracked"

export interface ChatFileGitStatusEntry {
  readonly path: string
  readonly status: ChatFileGitStatus
}

/**
 * A loaded file. Text files provide `contents`; binary files such as raster images provide a
 * renderer-safe `url` instead and are shown only in preview mode.
 */
export interface ChatFileContents {
  readonly path: string
  readonly contents?: string
  readonly url?: string
}

/** A workspace directory attached to the conversation. A Thread may use several. */
export interface ChatFileRoot {
  readonly id: string
  readonly label: string
  readonly description?: string
}

export interface ChatFilesPanelLabels extends ChatFilePreviewLabels {
  readonly cancel: string
  readonly copyPath: string
  readonly delete: string
  readonly edit: string
  readonly empty: string
  readonly filter: string
  readonly loading: string
  readonly newFile: string
  readonly newFolder: string
  readonly open: string
  readonly rename: string
  readonly root: string
  readonly save: string
  readonly showPreview: string
  readonly showSource: string
  readonly toggleTree: string
  readonly tree: string
}

const defaultLabels: ChatFilesPanelLabels = {
  cancel: "Cancel",
  copyPath: "Copy path",
  delete: "Delete",
  edit: "Edit file",
  empty: "Select a file to preview it.",
  filter: "Filter files…",
  loading: "Loading file…",
  newFile: "New file",
  newFolder: "New folder",
  open: "Open",
  previewUnavailable: "No preview is available for this file.",
  rename: "Rename",
  root: "Workspace folder",
  save: "Save",
  showPreview: "Show preview",
  showSource: "Show source",
  tableTruncated: (shown, total) => `Showing the first ${shown} of ${total} rows.`,
  toggleTree: "Toggle file tree",
  tree: "Files",
}

type ChatFilesPanelProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  /** Directories available to the conversation; `paths` belong to `activeRootId`. */
  roots: readonly ChatFileRoot[]
  activeRootId: string
  onActiveRootChange?: (rootId: string) => void
  /** Root-relative paths. Directories end with `/`; parents may be implicit. */
  paths: readonly string[]
  gitStatus?: readonly ChatFileGitStatusEntry[]
  selectedPath?: string | null
  onSelectedPathChange?: (path: string) => void
  /** Contents of `selectedPath`, loaded by the application. */
  file?: ChatFileContents | null
  fileLoading?: boolean
  /** Enables create, rename, drag-and-drop move, and delete. Receives the resulting path list. */
  onPathsChange?: (paths: string[], mutations: readonly ChatFileTreeMutation[]) => void
  /** Enables editing the open file. */
  onFileSave?: (file: { readonly contents: string; readonly path: string }) => void
  onCopyPath?: (path: string) => void
  /** Controlled tree visibility; omit it to let the panel own the toggle. */
  treeOpen?: boolean
  defaultTreeOpen?: boolean
  onTreeOpenChange?: (open: boolean) => void
  /** Trailing header content, such as an open-in-application menu. */
  headerActions?: ReactNode
  labels?: Partial<ChatFilesPanelLabels>
  treeWidth?: string
}

/** Bridges Cypheria theme tokens into the tree's shadow root through inherited custom properties. */
const treeThemeStyle = {
  "--trees-accent-override": "var(--primary)",
  "--trees-bg-muted-override": "var(--muted)",
  "--trees-bg-override": "var(--background)",
  "--trees-border-color-override": "var(--border)",
  "--trees-border-radius-override": "calc(var(--radius) - 2px)",
  "--trees-fg-muted-override": "var(--muted-foreground)",
  "--trees-fg-override": "var(--foreground)",
  "--trees-focus-ring-color-override": "var(--ring)",
  "--trees-font-family-override": "var(--font-sans)",
  "--trees-font-size-override": "var(--text-sm)",
  "--trees-git-added-color-override": "var(--diff-added)",
  "--trees-git-deleted-color-override": "var(--diff-removed)",
  "--trees-input-bg-override": "var(--background)",
  "--trees-padding-inline-override": "8px",
  "--trees-scrollbar-thumb-override": "var(--scrollbar-thumb)",
  "--trees-selected-bg-override": "var(--accent)",
  "--trees-selected-fg-override": "var(--accent-foreground)",
  "--trees-selected-focused-border-color-override": "var(--ring)",
  "--trees-status-added-override": "var(--diff-added)",
  "--trees-status-deleted-override": "var(--diff-removed)",
} as CSSProperties

/** Keeps syntax tokens from the Pierre themes while the surface, type, and gutters follow Cypheria. */
const fileThemeStyle = {
  "--diffs-bg-context-override": "var(--background)",
  "--diffs-bg-context-gutter-override": "var(--background)",
  "--diffs-bg-hover-override": "var(--accent)",
  "--diffs-bg-selection-override": "color-mix(in oklab, var(--ring) 22%, transparent)",
  "--diffs-dark": "var(--foreground)",
  "--diffs-dark-bg": "var(--background)",
  "--diffs-fg-number-override": "var(--muted-foreground)",
  "--diffs-font-family": "var(--font-mono)",
  "--diffs-font-size": "var(--font-mono-size)",
  "--diffs-header-font-family": "var(--font-sans)",
  "--diffs-light": "var(--foreground)",
  "--diffs-light-bg": "var(--background)",
  "--diffs-line-height": "calc(var(--font-mono-size) * 1.75)",
} as CSSProperties

const createEditor = <EType extends EditorType, LAnnotation, Caret>(
  editorType: EType,
  options: EditorOptions<EType, LAnnotation, Caret>,
  editStateKey?: string
) => new Editor(editorType, options, editStateKey)

const mutationsFromEvent = (event: FileTreeMutationEvent): ChatFileTreeMutation[] => {
  switch (event.operation) {
    case "add":
      return [{ path: event.path, type: "add" }]
    case "remove":
      return [{ path: event.path, type: "remove" }]
    case "move":
      return [{ from: event.from, to: event.to, type: "move" }]
    case "batch":
      return event.events.flatMap(mutationsFromEvent)
    case "reset":
      return []
  }
}

const samePathSet = (left: readonly string[], right: readonly string[]) => {
  if (left.length !== right.length) return false
  const set = new Set(left)
  return right.every((path) => set.has(path))
}

export function ChatFilesPanel({
  activeRootId,
  className,
  defaultTreeOpen = true,
  file,
  fileLoading = false,
  gitStatus,
  headerActions,
  labels,
  onActiveRootChange,
  onCopyPath,
  onFileSave,
  onPathsChange,
  onSelectedPathChange,
  onTreeOpenChange,
  paths,
  roots,
  selectedPath,
  treeOpen: treeOpenProp,
  treeWidth = "clamp(13rem, 34%, 22rem)",
  ...props
}: ChatFilesPanelProps) {
  const text = { ...defaultLabels, ...labels }
  const themeMode = useDocumentThemeMode()
  const [uncontrolledTreeOpen, setUncontrolledTreeOpen] = useState(defaultTreeOpen)
  const treeOpen = treeOpenProp ?? uncontrolledTreeOpen
  const [filter, setFilter] = useState("")
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const discardEdit = useRef(false)
  const openFile = file && file.path === selectedPath ? file : null
  const editing = openFile !== null && editingPath === openFile.path
  const activeRoot = roots.find((root) => root.id === activeRootId)
  const previewKind = openFile ? chatFilePreviewKind(openFile.path) : null
  const hasSource = openFile?.contents !== undefined && chatFilePreviewHasSource(previewKind)
  const [modeOverride, setModeOverride] = useState<{ mode: ChatFileViewMode; path: string }>()
  const viewMode: ChatFileViewMode =
    !previewKind || editing
      ? "source"
      : !hasSource
        ? "preview"
        : modeOverride?.path === openFile?.path
          ? modeOverride.mode
          : "preview"

  const setTreeOpen = (open: boolean) => {
    if (treeOpenProp === undefined) setUncontrolledTreeOpen(open)
    onTreeOpenChange?.(open)
  }
  const finishEdit = (discard: boolean) => {
    discardEdit.current = discard
    setEditingPath(null)
  }
  const handleEditComplete = (event: FileEditCompleteEvent<undefined, undefined>) => {
    const discard = discardEdit.current
    discardEdit.current = false
    if (discard) return "reject" as const
    if (event.file.contents !== event.originalFile.contents)
      onFileSave?.({ contents: event.file.contents, path: event.originalFile.name })
    return "accept" as const
  }

  return (
    <div
      data-slot="chat-files-panel"
      className={cn("flex size-full min-h-0 min-w-0 flex-col bg-background", className)}
      {...props}
    >
      <div
        data-slot="chat-files-header"
        className="flex min-h-11 shrink-0 items-center gap-1 border-b pr-2 pl-3"
      >
        <ChatFilesBreadcrumb path={openFile?.path ?? selectedPath} root={activeRoot?.label} />
        {openFile && previewKind && hasSource && !editing && (
          <Button
            aria-label={viewMode === "preview" ? text.showSource : text.showPreview}
            onClick={() =>
              setModeOverride({
                mode: viewMode === "preview" ? "source" : "preview",
                path: openFile.path,
              })
            }
            size="icon-sm"
            title={viewMode === "preview" ? text.showSource : text.showPreview}
            type="button"
            variant="ghost"
          >
            {viewMode === "preview" ? <CodeIcon /> : <EyeIcon />}
          </Button>
        )}
        {openFile &&
          hasSource &&
          onFileSave &&
          (editing ? (
            <>
              <Button onClick={() => finishEdit(true)} size="sm" type="button" variant="ghost">
                {text.cancel}
              </Button>
              <Button onClick={() => finishEdit(false)} size="sm" type="button">
                {text.save}
              </Button>
            </>
          ) : (
            <Button
              aria-label={text.edit}
              onClick={() => {
                setModeOverride({ mode: "source", path: openFile.path })
                setEditingPath(openFile.path)
              }}
              size="icon-sm"
              title={text.edit}
              type="button"
              variant="ghost"
            >
              <EditIcon />
            </Button>
          ))}
        <Button
          aria-label={text.toggleTree}
          aria-pressed={treeOpen}
          onClick={() => setTreeOpen(!treeOpen)}
          size="icon-sm"
          title={text.toggleTree}
          type="button"
          variant={treeOpen ? "secondary" : "ghost"}
        >
          <FoldersIcon />
        </Button>
        {headerActions}
      </div>
      <div className="flex min-h-0 flex-1">
        <ChatFileViewer
          editing={editing}
          file={openFile}
          labels={text}
          loading={fileLoading}
          onEditComplete={handleEditComplete}
          previewKind={previewKind}
          themeMode={themeMode}
          viewMode={viewMode}
        />
        {treeOpen && (
          <aside
            aria-label={text.tree}
            data-slot="chat-files-tree"
            className="flex h-full w-(--chat-files-tree-width) shrink-0 flex-col border-l"
            style={{ "--chat-files-tree-width": treeWidth } as CSSProperties}
          >
            <div className="shrink-0 border-b p-2">
              <Select
                disabled={!onActiveRootChange}
                onValueChange={(value) => {
                  if (typeof value === "string") onActiveRootChange?.(value)
                }}
                value={activeRootId}
              >
                <SelectTrigger aria-label={text.root} className="h-9 w-full">
                  <SelectValue>
                    <FolderIcon className="text-muted-foreground" />
                    <span className="truncate">{activeRoot?.label}</span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {roots.map((root) => (
                    <SelectItem key={root.id} value={root.id}>
                      <FolderIcon className="text-muted-foreground" />
                      <span className="min-w-0 truncate">{root.label}</span>
                      {root.description && (
                        <span className="ml-auto truncate text-xs text-muted-foreground">
                          {root.description}
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="shrink-0 p-2 pb-1">
              <InputGroup className="h-9">
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput
                  aria-label={text.filter}
                  onChange={(event) => setFilter(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setFilter("")
                  }}
                  placeholder={text.filter}
                  type="search"
                  value={filter}
                />
              </InputGroup>
            </div>
            <ChatFilesTree
              key={activeRootId}
              filter={filter}
              gitStatus={gitStatus}
              labels={text}
              onCopyPath={onCopyPath}
              onPathsChange={onPathsChange}
              onSelectedPathChange={onSelectedPathChange}
              paths={paths}
              selectedPath={selectedPath}
              themeMode={themeMode}
            />
          </aside>
        )}
      </div>
    </div>
  )
}

function ChatFilesBreadcrumb({ path, root }: { path?: string | null; root?: string }) {
  const segments = path ? path.replace(/\/$/, "").split("/") : []
  const hidden = segments.length > 3 ? segments.length - 2 : 0
  const items: { key: string; label: string | null }[] = [
    ...(root ? [{ key: "root", label: root }] : []),
    ...(hidden > 0 ? [{ key: "hidden", label: null }] : []),
    ...segments.slice(hidden).map((label, index) => ({
      key: segments.slice(0, hidden + index + 1).join("/"),
      label,
    })),
  ]
  return (
    <Breadcrumb className="min-w-0 flex-1" title={path ?? undefined}>
      <BreadcrumbList className="flex-nowrap gap-1 overflow-hidden">
        {items.map((item, index) => (
          <Fragment key={item.key}>
            {index > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem className="min-w-0">
              {item.label === null ? (
                <BreadcrumbEllipsis />
              ) : index === items.length - 1 ? (
                <BreadcrumbPage className="truncate">{item.label}</BreadcrumbPage>
              ) : (
                <span className="truncate">{item.label}</span>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

type ChatFilesTreeProps = Pick<
  ChatFilesPanelProps,
  "gitStatus" | "onCopyPath" | "onPathsChange" | "onSelectedPathChange" | "paths" | "selectedPath"
> & {
  filter: string
  labels: ChatFilesPanelLabels
  themeMode: "dark" | "light"
}

function ChatFilesTree({
  filter,
  gitStatus,
  labels,
  onCopyPath,
  onPathsChange,
  onSelectedPathChange,
  paths,
  selectedPath,
  themeMode,
}: ChatFilesTreeProps) {
  const mutable = onPathsChange !== undefined
  const knownPaths = useRef<readonly string[]>(paths)
  const handlers = useRef({ onPathsChange, onSelectedPathChange })
  useLayoutEffect(() => {
    handlers.current = { onPathsChange, onSelectedPathChange }
  })

  const { model } = useFileTree({
    dragAndDrop: mutable,
    fileTreeSearchMode: "hide-non-matches",
    flattenEmptyDirectories: true,
    gitStatus,
    icons: { colored: true, set: "complete" },
    initialExpansion: 1,
    ...(selectedPath
      ? {
          initialExpandedPaths: ancestorPaths(selectedPath),
          initialSelectedPaths: [selectedPath],
        }
      : {}),
    ...(filter ? { initialSearchQuery: filter } : {}),
    onSelectionChange: (selected) => {
      const next = selected.findLast((path) => !isChatDirectoryPath(path))
      if (next) handlers.current.onSelectedPathChange?.(next)
    },
    paths,
    renaming: mutable,
  } satisfies FileTreeOptions)

  useEffect(
    () =>
      model.onMutation("*", (event) => {
        const mutations = mutationsFromEvent(event)
        if (mutations.length === 0) return
        const next = mutations.reduce(applyChatFileTreeMutation, [...knownPaths.current])
        knownPaths.current = next
        handlers.current.onPathsChange?.(next, mutations)
      }),
    [model]
  )

  useEffect(() => {
    if (samePathSet(paths, knownPaths.current)) return
    knownPaths.current = paths
    const expanded = model
      .getVisibleRows(0, model.getVisibleCount())
      .filter((row) => row.isExpanded)
      .map((row) => row.path)
    model.resetPaths(paths, { initialExpandedPaths: expanded })
  }, [model, paths])

  useEffect(() => {
    model.setSearch(filter.trim() || null)
  }, [filter, model])

  const gitStatusApplied = useRef(gitStatus)
  useEffect(() => {
    if (gitStatusApplied.current === gitStatus) return
    gitStatusApplied.current = gitStatus
    model.setGitStatus(gitStatus)
  }, [gitStatus, model])

  const treeSelection = useFileTreeSelection(model)
  // Only an external selection change drives the tree; the current tree selection is only read.
  // biome-ignore lint/correctness/useExhaustiveDependencies: treeSelection is intentionally untracked
  useEffect(() => {
    if (!selectedPath || (treeSelection.length === 1 && treeSelection[0] === selectedPath)) return
    const item = model.getItem(selectedPath)
    if (!item) return
    for (const path of ancestorPaths(selectedPath)) expandDirectory(model, path)
    for (const path of treeSelection) if (path !== selectedPath) model.getItem(path)?.deselect()
    item.select()
    model.scrollToPath(selectedPath, { focus: false, offset: "nearest" })
  }, [model, selectedPath])

  const createEntry = (kind: "directory" | "file", near: string) => {
    const directory = isChatDirectoryPath(near) ? near : chatFileParentPath(near)
    const target = uniqueChatFilePath(
      knownPaths.current,
      directory,
      kind === "directory" ? "new-folder" : "untitled.txt",
      kind
    )
    if (directory) expandDirectory(model, directory)
    model.add(target)
    model.startRenaming(target, { removeIfCanceled: true })
  }

  const copyPath = (path: string) => {
    if (onCopyPath) onCopyPath(path)
    else void navigator.clipboard?.writeText(path)
  }

  const renderContextMenu = (item: ContextMenuItem, context: ContextMenuOpenContext) => {
    const run =
      (action: () => void, restoreFocus = true) =>
      () => {
        context.close({ restoreFocus })
        action()
      }
    const directory = item.kind === "directory"
    return (
      <div
        data-slot="chat-files-context-menu"
        role="menu"
        aria-label={item.name}
        className="min-w-40 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      >
        {!directory && (
          <ChatFilesMenuItem
            icon={<FileIcon />}
            onClick={run(() => onSelectedPathChange?.(item.path))}
          >
            {labels.open}
          </ChatFilesMenuItem>
        )}
        {mutable && (
          <>
            <ChatFilesMenuItem
              icon={<FileIcon />}
              onClick={run(() => createEntry("file", item.path), false)}
            >
              {labels.newFile}
            </ChatFilesMenuItem>
            <ChatFilesMenuItem
              icon={<FolderPlusIcon />}
              onClick={run(() => createEntry("directory", item.path), false)}
            >
              {labels.newFolder}
            </ChatFilesMenuItem>
            <ChatFilesMenuItem
              icon={<EditIcon />}
              onClick={run(() => model.startRenaming(item.path), false)}
            >
              {labels.rename}
            </ChatFilesMenuItem>
          </>
        )}
        <ChatFilesMenuItem icon={<CopyIcon />} onClick={run(() => copyPath(item.path))}>
          {labels.copyPath}
        </ChatFilesMenuItem>
        {mutable && (
          <>
            <hr className="-mx-1 my-1 h-px border-0 bg-border" />
            <ChatFilesMenuItem
              destructive
              icon={<TrashIcon />}
              onClick={run(() => model.remove(item.path, { recursive: directory }))}
            >
              {labels.delete}
            </ChatFilesMenuItem>
          </>
        )}
      </div>
    )
  }

  return (
    <FileTree
      aria-label={labels.tree}
      className="block min-h-0 flex-1"
      model={model}
      renderContextMenu={renderContextMenu}
      style={{ ...treeThemeStyle, colorScheme: themeMode }}
    />
  )
}

function expandDirectory(model: FileTreeModel, path: string) {
  const item = model.getItem(path)
  if (item && "expand" in item) item.expand()
}

function ancestorPaths(path: string): string[] {
  const segments = path.replace(/\/$/, "").split("/").slice(0, -1)
  return segments.map((_, index) => `${segments.slice(0, index + 1).join("/")}/`)
}

type ChatFilesMenuItemProps = {
  children: ReactNode
  destructive?: boolean
  icon: ReactNode
  onClick: () => void
}

function ChatFilesMenuItem({ children, destructive, icon, onClick }: ChatFilesMenuItemProps) {
  return (
    <button
      data-variant={destructive ? "destructive" : undefined}
      role="menuitem"
      type="button"
      onClick={onClick}
      className="flex w-full cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:hover:bg-destructive/10 [&_svg]:size-4 [&_svg]:shrink-0"
    >
      {icon}
      {children}
    </button>
  )
}

type ChatFileViewerProps = {
  editing: boolean
  file: ChatFileContents | null
  labels: ChatFilesPanelLabels
  loading: boolean
  onEditComplete: (event: FileEditCompleteEvent<undefined, undefined>) => "accept" | "reject"
  previewKind: ChatFilePreviewKind | null
  themeMode: "dark" | "light"
  viewMode: ChatFileViewMode
}

function ChatFileViewer({
  editing,
  file,
  labels,
  loading,
  onEditComplete,
  previewKind,
  themeMode,
  viewMode,
}: ChatFileViewerProps) {
  const options = useMemo<FileOptions<undefined, undefined>>(
    () => ({ disableFileHeader: true, overflow: "wrap", themeType: themeMode }),
    [themeMode]
  )
  const fileContents = useMemo(
    () => (file?.contents === undefined ? null : { contents: file.contents, name: file.path }),
    [file]
  )
  const editorOptions = useMemo<EditorOptions<"file", undefined, undefined>>(
    () => ({ onAttach: (editor) => editor.focus({ lineNumber: "first-visible" }) }),
    []
  )

  return (
    <div
      data-slot="chat-file-viewer"
      data-view-mode={viewMode}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      {file && previewKind && viewMode === "preview" ? (
        <ChatFilePreview
          key={file.path}
          contents={file.contents}
          kind={previewKind}
          labels={labels}
          path={file.path}
          url={file.url}
        />
      ) : fileContents ? (
        <EditProvider createEditor={createEditor}>
          <Virtualizer className="min-h-0 flex-1 overflow-auto bg-background py-1">
            <File
              key={fileContents.name}
              edit={editing}
              editorOptions={editorOptions}
              file={fileContents}
              onEditComplete={onEditComplete}
              options={options}
              style={fileThemeStyle}
            />
          </Virtualizer>
        </EditProvider>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          {loading ? labels.loading : file ? labels.previewUnavailable : labels.empty}
        </div>
      )}
    </div>
  )
}

export type { ChatFilesPanelProps }
