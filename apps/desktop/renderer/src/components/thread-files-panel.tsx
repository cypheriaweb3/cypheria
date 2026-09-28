import type { ThreadView, WorkspaceFileEntry } from "@cypheria/protocol"
import { Button } from "@cypheria/ui/components/button"
import {
  type ChatFileContents,
  ChatFilesPanel,
  type ChatFileTreeMutation,
} from "@cypheria/ui/components/chat"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useAtom } from "jotai"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { threadFilesAtom } from "../client-state.js"
import { ensureCypheriaClient } from "../cypheria-client.js"

const directoryPath = (entry: WorkspaceFileEntry) =>
  entry.kind === "directory" || entry.hasChildren
    ? `${entry.path.replace(/\/$/u, "")}/`
    : entry.path

const parentPath = (path: string) => {
  const parts = path.replace(/\/$/u, "").split("/")
  parts.pop()
  return parts.join("/")
}

export function ThreadFilesPanel({ thread }: { thread: ThreadView }) {
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
  const activeRoot = thread.roots.includes(checkpoint.activeRoot ?? "")
    ? (checkpoint.activeRoot as string)
    : (thread.roots[0] as string)
  const [paths, setPaths] = useState<string[]>([])
  const [unloaded, setUnloaded] = useState<string[]>([])
  const selectedPath = checkpoint.selectedByRoot[activeRoot] ?? null
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
    setFile(null)
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
            root: activeRoot,
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
  }, [activeRoot, replacePreviewUrl, selectedPath, thread.id])

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

  return (
    <ChatFilesPanel
      activeRootId={activeRoot}
      expandedPaths={checkpoint.expandedByRoot[activeRoot] ?? []}
      file={file}
      fileLoading={fileLoading}
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
                    root: activeRoot,
                    threadId: thread.id,
                  })
                  .catch(() => undefined)
              }}
            >
              <Trans id="files.open">Open</Trans>
            </Button>
          ) : null}
        </>
      }
      onActiveRootChange={(root) =>
        void setCheckpoint((current) => ({ ...current, activeRoot: root }))
      }
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
              root: activeRoot,
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
      onCopyPath={(path) => {
        const separator = activeRoot.includes("\\") ? "\\" : "/"
        void navigator.clipboard.writeText(
          `${activeRoot.replace(/[\\/]$/u, "")}${separator}${path.replaceAll("/", separator)}`
        )
      }}
      onSelectedPathChange={(path) =>
        void setCheckpoint((current) => ({
          ...current,
          selectedByRoot: { ...current.selectedByRoot, [activeRoot]: path },
        }))
      }
      onTreeOpenChange={(treeOpen) => void setCheckpoint((current) => ({ ...current, treeOpen }))}
      onTreeWidthChange={(treeWidth) =>
        void setCheckpoint((current) => ({ ...current, treeWidth }))
      }
      paths={paths}
      roots={roots}
      selectedPath={selectedPath}
      treeOpen={checkpoint.treeOpen}
      treeWidth={checkpoint.treeWidth}
      unloadedDirectories={unloaded}
    />
  )
}
