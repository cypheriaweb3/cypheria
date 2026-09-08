import { Button } from "@cypheria/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cypheria/ui/components/dialog"
import { Input } from "@cypheria/ui/components/input"
import { Skeleton } from "@cypheria/ui/components/skeleton"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Folder, LoaderCircle, RotateCcw, Search, Trash2 } from "lucide-react"
import { useDeferredValue, useMemo, useState } from "react"
import type { CodexThreadView } from "../../../ipc/src/index.js"
import { SettingsFrame } from "../components/settings-frame"

export const Route = createFileRoute("/settings/archived")({ component: ArchivedSettingsRoute })

const PAGE_SIZE = 30

function ArchivedSettingsRoute() {
  const { i18n } = useLingui()
  const queryClient = useQueryClient()
  const [query, setQuery] = useState("")
  const searchTerm = useDeferredValue(query.trim())
  const [deletingThread, setDeletingThread] = useState<CodexThreadView | null>(null)
  const archivedQuery = useInfiniteQuery({
    initialPageParam: null as string | null,
    queryKey: ["codex", "threads", "archived", searchTerm],
    queryFn: async ({ pageParam }) =>
      window.cypheria?.codex.listThreads({
        archived: true,
        cursor: pageParam,
        limit: PAGE_SIZE,
        searchTerm: searchTerm || undefined,
        sortDirection: "desc",
        sortKey: "updated_at",
      }) ?? { data: [], nextCursor: null },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })
  const projectsQuery = useQuery({
    queryFn: () =>
      window.cypheria?.codex.listProjects({ limit: 100 }) ?? { data: [], nextCursor: null },
    queryKey: ["codex", "projects"],
  })
  const projectNames = useMemo(
    () => new Map(projectsQuery.data?.data.map((project) => [project.id, project.name]) ?? []),
    [projectsQuery.data?.data]
  )
  const threads = archivedQuery.data?.pages.flatMap((page) => page.data) ?? []
  const restore = useMutation({
    mutationFn: async (thread: CodexThreadView) => {
      if (!window.cypheria) throw new Error("Archived chats are only available in the desktop app.")
      await window.cypheria.codex.unarchiveThread(thread.id)
      return thread
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["codex", "threads"] })
    },
  })
  const remove = useMutation({
    mutationFn: async (thread: CodexThreadView) => {
      if (!window.cypheria) throw new Error("Archived chats are only available in the desktop app.")
      await window.cypheria.codex.deleteThread(thread.id)
      return thread
    },
    onSuccess: async () => {
      setDeletingThread(null)
      await queryClient.invalidateQueries({ queryKey: ["codex", "threads"] })
    },
  })
  const error = archivedQuery.error ?? restore.error ?? remove.error

  return (
    <SettingsFrame wide>
      <div className="grid w-full content-start gap-8 pb-10 text-foreground">
        <header>
          <h1 className="text-[28px] font-semibold leading-9">
            <Trans id="settings.archived.title">Archived chats</Trans>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            <Trans id="settings.archived.description">
              Restore chats to the sidebar or permanently delete ones you no longer need.
            </Trans>
          </p>
        </header>

        <section className="grid gap-4">
          <div className="relative max-w-md">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label={i18n._(
                msg({ id: "settings.archived.search", message: "Search archived chats" })
              )}
              className="h-10 rounded-xl pl-9"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={i18n._(
                msg({ id: "settings.archived.search", message: "Search archived chats" })
              )}
              type="search"
              value={query}
            />
          </div>

          {archivedQuery.isPending ? (
            <div className="grid gap-2">
              {["first", "second", "third", "fourth"].map((key) => (
                <Skeleton className="h-[68px] w-full rounded-xl" key={key} />
              ))}
            </div>
          ) : threads.length > 0 ? (
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
              {threads.map((thread) => {
                const projectName = thread.projectId ? projectNames.get(thread.projectId) : null
                const restoring = restore.isPending && restore.variables?.id === thread.id
                return (
                  <div
                    className="flex min-h-[68px] items-center justify-between gap-5 border-b border-border px-5 py-3 last:border-b-0"
                    key={thread.id}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-medium">
                        {thread.title ||
                          i18n._(msg({ id: "chat.untitled", message: "Untitled chat" }))}
                      </p>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        {projectName ? (
                          <span className="flex min-w-0 items-center gap-1">
                            <Folder aria-hidden="true" className="size-3.5" />
                            <span className="truncate">{projectName}</span>
                          </span>
                        ) : (
                          <span>
                            <Trans id="settings.archived.noProject">No project</Trans>
                          </span>
                        )}
                        <span aria-hidden="true">·</span>
                        <span>{formatThreadDate(thread.updatedAt, i18n.locale)}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        aria-label={i18n._(
                          msg({ id: "settings.archived.restoreAria", message: "Restore chat" })
                        )}
                        disabled={restoring || remove.isPending}
                        onClick={() => restore.mutate(thread)}
                        size="sm"
                        variant="outline"
                      >
                        {restoring ? (
                          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                        ) : (
                          <RotateCcw aria-hidden="true" className="size-4" />
                        )}
                        <Trans id="settings.archived.restore">Restore</Trans>
                      </Button>
                      <Button
                        aria-label={i18n._(
                          msg({
                            id: "settings.archived.deleteAria",
                            message: "Delete archived chat",
                          })
                        )}
                        disabled={restore.isPending || remove.isPending}
                        onClick={() => setDeletingThread(thread)}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <Trash2 aria-hidden="true" className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border px-6 py-14 text-center text-sm text-muted-foreground">
              {searchTerm ? (
                <Trans id="settings.archived.noMatches">No matching archived chats</Trans>
              ) : (
                <Trans id="settings.archived.empty">No archived chats</Trans>
              )}
            </div>
          )}

          {archivedQuery.hasNextPage ? (
            <Button
              className="justify-self-center"
              disabled={archivedQuery.isFetchingNextPage}
              onClick={() => void archivedQuery.fetchNextPage()}
              variant="outline"
            >
              {archivedQuery.isFetchingNextPage ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              ) : null}
              <Trans id="navigation.showMore">Show more</Trans>
            </Button>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
        </section>
      </div>

      <Dialog
        open={deletingThread != null}
        onOpenChange={(open) => !open && setDeletingThread(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <Trans id="settings.archived.deleteConfirm.title">Delete archived chat?</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans id="settings.archived.deleteConfirm.description">
                This permanently deletes the chat and cannot be undone.
              </Trans>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              <Trans id="common.cancel">Cancel</Trans>
            </DialogClose>
            <Button
              disabled={!deletingThread || remove.isPending}
              onClick={() => deletingThread && remove.mutate(deletingThread)}
              variant="destructive"
            >
              <Trans id="settings.archived.delete">Delete</Trans>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsFrame>
  )
}

function formatThreadDate(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp * 1000))
}
