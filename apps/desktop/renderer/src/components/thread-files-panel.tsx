import type { ThreadView, WorkspaceFileEntry } from "@cypheria/protocol"
import { Button } from "@cypheria/ui/components/button"
import {
  type ChatFileBlameLine,
  type ChatFileContents,
  ChatFilesPanel,
  type ChatFileTreeMutation,
} from "@cypheria/ui/components/chat"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@cypheria/ui/components/dropdown-menu"
import { CopyIcon } from "@cypheria/ui/components/icons"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { useAtom } from "jotai"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { threadFilesAtom } from "../client-state.js"
import { ensureCypheriaClient } from "../cypheria-client.js"

const directoryPath = (entry: WorkspaceFileEntry) =>
  entry.kind === "directory" || entry.hasChildren
    ? `${entry.path.replace(/\/$/u, "")}/`
    : entry.path

const joinHostPath = (root: string, path: string) => {
  const separator = root.includes("\\") ? "\\" : "/"
  return `${root.replace(/[\\/]$/u, "")}${separator}${path.replaceAll("/", separator)}`
}

/** `path` relative to `base` when it lies inside it, with `/` separators; otherwise null. */
export const relativeHostPath = (base: string, path: string): string | null => {
  const normalize = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/u, "")
  const from = normalize(base)
  const to = normalize(path)
  if (to === from) return ""
  return to.startsWith(`${from}/`) ? to.slice(from.length + 1) : null
}

const parentPath = (path: string) => {
  const parts = path.replace(/\/$/u, "").split("/")
  parts.pop()
  return parts.join("/")
}

/** A file of a Thread: one of its roots and a path relative to that root. */
export type ThreadFileRef = { readonly root: string; readonly path: string }

/**
 * A workspace file tab, or, without a file, the Open file tab: the source or preview of the file
 * with its breadcrumb, actions, and Git blame, beside the workspace tree. Choosing a file in the
 * tree opens it in its own tab.
 */
export function ThreadFilesPanel({
  file: openedFile,
  focusLine,
  onOpenFile,
  thread,
}: {
  file: ThreadFileRef | null
  focusLine?: { lineNumber: number; nonce: number } | null
  onOpenFile: (file: ThreadFileRef) => void
  thread: ThreadView
}) {
  const { i18n } = useLingui()
  const checkpointAtom = useMemo(() => threadFilesAtom(thread.id), [thread.id])
  const [checkpoint, setCheckpoint] = useAtom(checkpointAtom)
  const roots = useMemo(
    () =>
      thread.roots.map((root, index) => ({
        description: root,
        id: root,
        label: root.split(/[\\/]/u).filter(Boolean).at(-1) ?? root,
        ...(index === 0
          ? {
              description: `${root} · ${i18n._(
                msg({
                  id: "chat.summary.workspace.cwd",
                  message: "Current working directory",
                })
              )}`,
            }
          : {}),
      })),
    [i18n, thread.roots]
  )
  const [treeRoot, setTreeRoot] = useState<string | null>(openedFile?.root ?? null)
  const activeRoot = thread.roots.includes(treeRoot ?? "")
    ? (treeRoot as string)
    : thread.roots.includes(checkpoint.activeRoot ?? "")
      ? (checkpoint.activeRoot as string)
      : (thread.roots[0] as string)
  const fileRoot = openedFile?.root ?? activeRoot
  const [paths, setPaths] = useState<string[]>([])
  const [unloaded, setUnloaded] = useState<string[]>([])
  const selectedPath = openedFile?.path ?? null
  const treeSelection = openedFile?.root === activeRoot ? openedFile.path : null
  const [file, setFile] = useState<ChatFileContents | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [search, setSearch] = useState("")
  const [restoreToken, setRestoreToken] = useState<string | null>(null)
  const versions = useRef(new Map<string, string>())
  const requests = useRef(new Map<string, Promise<void>>())
  const requestControllers = useRef(new Map<string, AbortController>())
  const previewUrl = useRef<string | null>(null)

  const replacePreviewUrl = useCallback((next: string | null) => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    previewUrl.current = next
    return next
  }, [])

  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    },
    []
  )

  const loadDirectory = useCallback(
    (path: string, refresh = false) => {
      const key = `${activeRoot}\0${path}`
      const existing = requests.current.get(key)
      if (existing && !refresh) return existing
      if (refresh) requestControllers.current.get(key)?.abort()
      const controller = new AbortController()
      requestControllers.current.set(key, controller)
      const task = (async () => {
        const client = await ensureCypheriaClient()
        let cursor: string | undefined
        const entries: WorkspaceFileEntry[] = []
        do {
          const page = await client.threads.files.listDirectory(
            {
              cursor,
              limit: 200,
              path,
              root: activeRoot,
              threadId: thread.id,
            },
            { signal: controller.signal }
          )
          entries.push(...page.data)
          cursor = page.nextCursor ?? undefined
        } while (cursor)
        const prefix = path ? `${path.replace(/\/$/u, "")}/` : ""
        const direct = new Set(entries.map(directoryPath))
        setPaths((current) => {
          const retained = refresh
            ? current.filter((value) => {
                if (!value.startsWith(prefix)) return true
                const remainder = value.slice(prefix.length).replace(/\/$/u, "")
                return remainder.includes("/")
              })
            : current
          return [...new Set([...retained, ...direct])]
        })
        setUnloaded((current) => [
          ...new Set([
            ...current.filter((value) => value !== `${path.replace(/\/$/u, "")}/`),
            ...entries
              .filter((entry) => entry.hasChildren === true)
              .map((entry) => `${entry.path.replace(/\/$/u, "")}/`),
          ]),
        ])
      })().finally(() => {
        requests.current.delete(key)
        requestControllers.current.delete(key)
      })
      requests.current.set(key, task)
      return task
    },
    [activeRoot, thread.id]
  )

  useEffect(() => {
    for (const controller of requestControllers.current.values()) controller.abort()
    requestControllers.current.clear()
    setPaths([])
    setUnloaded([])
    void loadDirectory("").catch(() => undefined)
  }, [loadDirectory])

  useEffect(
    () => () => {
      for (const controller of requestControllers.current.values()) controller.abort()
    },
    []
  )

  useEffect(() => {
    if (checkpoint.activeRoot === activeRoot) return
    void setCheckpoint((current) => ({ ...current, activeRoot }))
  }, [activeRoot, checkpoint.activeRoot, setCheckpoint])

  useEffect(() => {
    let disposed = false
    let unsubscribe: () => void = () => undefined
    void ensureCypheriaClient().then((client) => {
      if (disposed) return
      unsubscribe = client.threads.files.subscribe(thread.id, (changes) => {
        const parents = new Set(
          changes
            .filter((change) => change.root === activeRoot)
            .flatMap((change) => [parentPath(change.path), parentPath(change.previousPath ?? "")])
        )
        for (const parent of parents) void loadDirectory(parent, true).catch(() => undefined)
      })
    })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [activeRoot, loadDirectory, thread.id])

  useEffect(() => {
    const query = search.trim()
    if (!query) return
    const abort = new AbortController()
    const timer = window.setTimeout(() => {
      void ensureCypheriaClient()
        .then((client) =>
          client.threads.files.search(
            { limit: 100, query, threadId: thread.id },
            { signal: abort.signal }
          )
        )
        .then(({ data }) => {
          const additions = data
            .filter((entry) => entry.root === activeRoot)
            .flatMap((entry) => {
              const segments = entry.path.split("/")
              const ancestors = segments
                .slice(0, -1)
                .map((_, index) => `${segments.slice(0, index + 1).join("/")}/`)
              return [...ancestors, directoryPath(entry)]
            })
          setPaths((current) => [...new Set([...current, ...additions])])
        })
        .catch(() => undefined)
    }, 250)
    return () => {
      window.clearTimeout(timer)
      abort.abort()
    }
  }, [activeRoot, search, thread.id])

  useEffect(() => {
    if (!selectedPath) {
      replacePreviewUrl(null)
      setFile(null)
      return
    }
    let disposed = false
    const abort = new AbortController()
    setFileLoading(true)
    void ensureCypheriaClient()
      .then((client) =>
        client.threads.files.read(
          {
            path: selectedPath,
            root: fileRoot,
            threadId: thread.id,
          },
          { signal: abort.signal }
        )
      )
      .then((result) => {
        if (disposed) return
        versions.current.set(selectedPath, result.version)
        if (result.kind !== "binary") replacePreviewUrl(null)
        if (result.kind === "text") setFile({ contents: result.content, path: selectedPath })
        else if (result.kind === "binary") {
          const url = URL.createObjectURL(
            new Blob([Uint8Array.from(result.bytes).buffer], { type: result.mimeType })
          )
          replacePreviewUrl(url)
          setFile({ path: selectedPath, url })
        } else setFile({ path: selectedPath })
      })
      .catch(() => {
        if (!disposed) setFile(null)
      })
      .finally(() => {
        if (!disposed) setFileLoading(false)
      })
    return () => {
      disposed = true
      abort.abort()
    }
  }, [fileRoot, replacePreviewUrl, selectedPath, thread.id])

  const mutate = async (mutations: readonly ChatFileTreeMutation[]) => {
    const client = await ensureCypheriaClient()
    for (const mutation of mutations) {
      if (mutation.type === "add") {
        await client.threads.files.create({
          kind: mutation.path.endsWith("/") ? "directory" : "file",
          path: mutation.path.replace(/\/$/u, ""),
          root: activeRoot,
          threadId: thread.id,
        })
      } else if (mutation.type === "move") {
        await client.threads.files.move({
          destinationPath: mutation.to.replace(/\/$/u, ""),
          path: mutation.from.replace(/\/$/u, ""),
          root: activeRoot,
          threadId: thread.id,
        })
      } else {
        const deleted = await client.threads.files.delete({
          path: mutation.path.replace(/\/$/u, ""),
          root: activeRoot,
          threadId: thread.id,
        })
        setRestoreToken(deleted.restoreToken)
      }
    }
  }

  const absoluteSelected = selectedPath ? joinHostPath(fileRoot, selectedPath) : null
  const repository = useQuery({
    enabled: Boolean(selectedPath),
    queryKey: ["git", fileRoot, "discover"],
    queryFn: async () => (await ensureCypheriaClient()).git.discover(fileRoot),
    retry: false,
    staleTime: 30_000,
  })
  const remote = useQuery({
    enabled: Boolean(repository.data),
    queryKey: ["git", fileRoot, "file-remote"],
    queryFn: async () => {
      const git = (await ensureCypheriaClient()).git
      const [remotes, context] = await Promise.all([
        git.remotes(fileRoot),
        git.branchContext(fileRoot),
      ])
      const [remoteName, ...branch] = context.upstream?.split("/") ?? []
      const identity =
        remotes.find((entry) => entry.name === (remoteName ?? "origin")) ??
        remotes.find((entry) => entry.name === "origin")
      const ref = branch.length > 0 ? branch.join("/") : context.defaultBranch
      return identity && ref && /(^|\.)github\.com$/iu.test(identity.host)
        ? { base: `https://${identity.host}/${identity.repository}`, ref }
        : null
    },
    retry: false,
    staleTime: 30_000,
  })
  const [blameOn, setBlameOn] = useState(false)
  const blame = useQuery({
    enabled: blameOn && Boolean(absoluteSelected && file?.contents !== undefined),
    queryKey: ["git", fileRoot, "blame", absoluteSelected, file?.contents],
    queryFn: async () => {
      if (!absoluteSelected) throw new Error("A file is required")
      return (await ensureCypheriaClient()).git.blameFile(fileRoot, absoluteSelected)
    },
    retry: false,
  })
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.locale, { dateStyle: "medium" }),
    [i18n.locale]
  )
  const blameByLine = useMemo(() => {
    if (!blameOn || !blame.data) return null
    return new Map<number, ChatFileBlameLine>(
      blame.data.map((line) => {
        const author = line.authorLogin ?? line.author ?? "?"
        const date =
          line.authorTime === null ? "" : dateFormat.format(new Date(line.authorTime * 1000))
        return [
          line.lineNumber,
          {
            details: [
              `${i18n._(msg({ id: "files.blame.author", message: "Author" }))}: ${line.author ?? author}`,
              `${i18n._(msg({ id: "files.blame.commit", message: "Commit" }))}: ${line.commitSha.slice(0, 12)}`,
              ...(date
                ? [`${i18n._(msg({ id: "files.blame.date", message: "Date" }))}: ${date}`]
                : []),
              ...(line.summary ? ["", line.summary] : []),
            ].join("\n"),
            label: date ? `${author} · ${date}` : author,
          },
        ]
      })
    )
  }, [blame.data, blameOn, dateFormat, i18n])
  const repoRelative =
    absoluteSelected && repository.data
      ? relativeHostPath(repository.data.root, absoluteSelected)
      : null
  const githubUrl =
    remote.data && repoRelative
      ? `${remote.data.base}/blob/${remote.data.ref.split("/").map(encodeURIComponent).join("/")}/${repoRelative.split("/").map(encodeURIComponent).join("/")}`
      : null
  const copy = (text: string) => void navigator.clipboard.writeText(text).catch(() => undefined)

  return (
    <ChatFilesPanel
      activeRootId={activeRoot}
      labels={{
        goToLine: i18n._(msg({ id: "files.goToLine", message: "Go to line" })),
        goToLineInvalid: i18n._(
          msg({ id: "files.goToLine.invalid", message: "Enter a valid whole line number" })
        ),
        browserDescription: i18n._(
          msg({ id: "files.browser.description", message: "Select a file from the workspace tree" })
        ),
        browserHeading: i18n._(msg({ id: "files.browser.heading", message: "Open file" })),
        goToLineRange: (lineCount) =>
          i18n._({
            ...msg({ id: "files.goToLine.range", message: "1–{lineCount}" }),
            values: { lineCount },
          }),
      }}
      blame={blameByLine}
      focusLine={focusLine ?? null}
      expandedPaths={checkpoint.expandedByRoot[activeRoot] ?? []}
      file={openedFile && file?.path === openedFile.path ? file : null}
      fileLoading={fileLoading}
      fileRootId={fileRoot}
      headerActions={
        <>
          {restoreToken ? (
            <Button
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => {
                void ensureCypheriaClient()
                  .then((client) =>
                    client.threads.files.restore({ restoreToken, threadId: thread.id })
                  )
                  .then((entry) => {
                    setRestoreToken(null)
                    void loadDirectory(parentPath(entry.path), true).catch(() => undefined)
                  })
                  .catch(() => undefined)
              }}
            >
              <Trans id="files.undoDelete">Undo delete</Trans>
            </Button>
          ) : null}
          {selectedPath && file?.contents !== undefined && repository.data ? (
            <Button
              aria-pressed={blameOn}
              onClick={() => setBlameOn((value) => !value)}
              size="sm"
              title={
                blame.isError
                  ? blame.error.message
                  : i18n._(
                      msg({
                        id: "files.blame.tooltip",
                        message: "Show author, date, and commit details in the line gutter",
                      })
                    )
              }
              type="button"
              variant={blameOn ? "secondary" : "ghost"}
            >
              {blameOn ? (
                <Trans id="files.blame.hide">Hide git blame</Trans>
              ) : (
                <Trans id="files.blame.show">Show git blame</Trans>
              )}
            </Button>
          ) : null}
          {selectedPath && absoluteSelected ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    aria-label={i18n._(msg({ id: "files.copyMenu", message: "Copy" }))}
                    size="icon-sm"
                    title={i18n._(msg({ id: "files.copyMenu", message: "Copy" }))}
                    type="button"
                    variant="ghost"
                  />
                }
              >
                <CopyIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuItem onClick={() => copy(absoluteSelected)}>
                  <Trans id="files.copyAbsolutePath">Copy absolute path</Trans>
                </DropdownMenuItem>
                {repoRelative ? (
                  <DropdownMenuItem onClick={() => copy(repoRelative)}>
                    <Trans id="files.copyRepoPath">Copy path relative to repository</Trans>
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onClick={() => copy(selectedPath)}>
                  <Trans id="files.copyRootPath">Copy path relative to folder</Trans>
                </DropdownMenuItem>
                {file?.path === selectedPath && file.contents !== undefined ? (
                  <DropdownMenuItem onClick={() => copy(file.contents ?? "")}>
                    <Trans id="files.copyContents">Copy file contents</Trans>
                  </DropdownMenuItem>
                ) : null}
                {githubUrl ? (
                  <DropdownMenuItem onClick={() => copy(githubUrl)}>
                    <Trans id="files.copyGitHubLink">Copy GitHub link</Trans>
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {selectedPath ? (
            <Button
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => {
                void window.cypheria?.app
                  .workspaceFileAction({
                    action: "open",
                    path: selectedPath,
                    root: fileRoot,
                    threadId: thread.id,
                  })
                  .catch(() => undefined)
              }}
            >
              <Trans id="files.open">Open</Trans>
            </Button>
          ) : null}
          {githubUrl ? (
            <Button
              size="sm"
              type="button"
              variant="ghost"
              onClick={() =>
                void window.cypheria?.app.openExternal(githubUrl).catch(() => undefined)
              }
            >
              <Trans id="files.openInGitHub">Open in GitHub</Trans>
            </Button>
          ) : null}
        </>
      }
      onActiveRootChange={(root) => {
        setTreeRoot(root)
        void setCheckpoint((current) => ({ ...current, activeRoot: root }))
      }}
      onDirectoryExpand={(path) =>
        void loadDirectory(path.replace(/\/$/u, "")).catch(() => undefined)
      }
      onExpandedPathsChange={(expanded) =>
        void setCheckpoint((current) => ({
          ...current,
          expandedByRoot: { ...current.expandedByRoot, [activeRoot]: expanded },
        }))
      }
      onFileSave={({ contents, path }) => {
        void ensureCypheriaClient()
          .then((client) =>
            client.threads.files.write({
              content: contents,
              path,
              root: fileRoot,
              threadId: thread.id,
              version: versions.current.get(path) ?? null,
            })
          )
          .then((result) => {
            versions.current.set(path, result.version)
            if (result.kind === "text") setFile({ contents: result.content, path })
          })
          .catch(() => undefined)
      }}
      onFilterChange={setSearch}
      onPathsChange={(next, mutations) => {
        const previous = paths
        setPaths(next)
        void mutate(mutations).catch(() => {
          setPaths(previous)
          for (const mutation of mutations) {
            const affected =
              mutation.type === "move"
                ? [parentPath(mutation.from), parentPath(mutation.to)]
                : [parentPath(mutation.path)]
            for (const parent of affected) void loadDirectory(parent, true).catch(() => undefined)
          }
        })
      }}
      onCopyPath={(path) => copy(joinHostPath(activeRoot, path))}
      onSelectedPathChange={(path) => {
        if (path !== treeSelection) onOpenFile({ path, root: activeRoot })
      }}
      onTreeOpenChange={(treeOpen) => void setCheckpoint((current) => ({ ...current, treeOpen }))}
      onTreeWidthChange={(treeWidth) =>
        void setCheckpoint((current) => ({ ...current, treeWidth }))
      }
      paths={paths}
      roots={roots}
      selectedPath={treeSelection}
      treeOpen={openedFile ? checkpoint.treeOpen : true}
      treeWidth={checkpoint.treeWidth}
      unloadedDirectories={unloaded}
    />
  )
}
