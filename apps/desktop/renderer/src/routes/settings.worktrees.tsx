import type { GitWorktree } from "@cypheria/protocol"
import { Alert, AlertDescription } from "@cypheria/ui/components/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@cypheria/ui/components/alert-dialog"
import { Button } from "@cypheria/ui/components/button"
import { Input } from "@cypheria/ui/components/input"
import { SettingsRow, SettingsSection } from "@cypheria/ui/components/settings-rows"
import { Switch } from "@cypheria/ui/components/switch"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { MessageSquare, RotateCw } from "lucide-react"
import { useEffect, useState } from "react"

import { useGitSettings } from "../components/git-settings"
import { SettingsFrame } from "../components/settings-frame"
import { ensureCypheriaClient } from "../cypheria-client.js"

export const Route = createFileRoute("/settings/worktrees")({ component: WorktreesSettingsRoute })

const insideOrEqual = (root: string, path: string) => path === root || path.startsWith(`${root}/`)

/** Worktree settings and the managed worktrees of every repository, as the official page shows. */
function WorktreesSettingsRoute() {
  const { i18n } = useLingui()
  const { error, restartRequired, save, settings } = useGitSettings()
  const [root, setRoot] = useState("")
  const [keep, setKeep] = useState("")
  const [confirmDisable, setConfirmDisable] = useState(false)
  const savedRoot = settings?.worktreeRoot
  const savedKeep = settings?.worktreeKeepCount
  useEffect(() => {
    if (savedRoot !== undefined) setRoot(savedRoot ?? "")
  }, [savedRoot])
  useEffect(() => {
    if (savedKeep !== undefined) setKeep(String(savedKeep))
  }, [savedKeep])
  const worktrees = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).git.managedWorktrees(),
    queryKey: ["git", "managed-worktrees"],
    retry: false,
  })
  const threads = useQuery({
    queryFn: async () => {
      const client = await ensureCypheriaClient()
      return (await client.threads.list({ archived: false, limit: 200 })).data
    },
    queryKey: ["git", "managed-worktrees", "threads"],
    retry: false,
  })

  return (
    <SettingsFrame>
      <h1 className="font-semibold text-xl">
        <Trans id="settings.section.worktrees">Worktrees</Trans>
      </h1>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : null}
      {settings ? (
        <SettingsSection>
          <SettingsRow
            control={
              <Input
                aria-label={i18n._(
                  msg({ id: "settings.worktrees.root.ariaLabel", message: "Worktree root" })
                )}
                className="w-72"
                placeholder="~/.cypheria/worktrees"
                value={root}
                onBlur={() => {
                  const next = root.trim() || null
                  if (next !== settings.worktreeRoot) void save({ worktreeRoot: next })
                }}
                onChange={(event) => setRoot(event.target.value)}
              />
            }
            description={
              <>
                <Trans id="settings.worktrees.root.description">
                  Directory where Cypheria creates managed worktrees. Leave blank to use the default
                  location
                </Trans>
                {restartRequired.includes("git.worktreeRoot") ? (
                  <span className="block text-amber-600 dark:text-amber-400">
                    <Trans id="settings.worktrees.root.restart">
                      Restart the Server to use the new root.
                    </Trans>
                  </span>
                ) : null}
              </>
            }
            label={<Trans id="settings.worktrees.root.label">Worktree root</Trans>}
          />
          <SettingsRow
            control={
              <Switch
                aria-label={i18n._(
                  msg({
                    id: "settings.worktrees.upstreamRefresh.ariaLabel",
                    message: "Always fetch upstream before creating worktrees",
                  })
                )}
                checked={settings.upstreamRefreshMode === "best-effort"}
                onCheckedChange={(checked) =>
                  void save({ upstreamRefreshMode: checked ? "best-effort" : "never" })
                }
              />
            }
            description={
              <Trans id="settings.worktrees.upstreamRefresh.description">
                Codex normally picks up branch updates during regular Git activity. This also
                fetches before each new worktree.
              </Trans>
            }
            label={
              <Trans id="settings.worktrees.upstreamRefresh.label">
                Always fetch upstream before creating worktrees
              </Trans>
            }
          />
          <SettingsRow
            control={
              <Switch
                aria-label={i18n._(
                  msg({
                    id: "settings.worktrees.autoCleanup.ariaLabel",
                    message: "Automatically delete old worktrees",
                  })
                )}
                checked={settings.worktreeAutoCleanupEnabled}
                onCheckedChange={(checked) => {
                  if (checked) void save({ worktreeAutoCleanupEnabled: true })
                  else setConfirmDisable(true)
                }}
              />
            }
            description={
              <Trans id="settings.worktrees.autoCleanup.description">
                Recommended for most users. Turn this off only if you want to manage old worktrees
                and disk usage yourself.
              </Trans>
            }
            label={
              <Trans id="settings.worktrees.autoCleanup.label">
                Automatically delete old worktrees
              </Trans>
            }
          />
          <SettingsRow
            control={
              <Input
                aria-label={i18n._(
                  msg({
                    id: "settings.worktrees.keepCount.ariaLabel",
                    message: "Auto-delete limit",
                  })
                )}
                className="w-24"
                disabled={!settings.worktreeAutoCleanupEnabled}
                min={1}
                type="number"
                value={keep}
                onBlur={() => {
                  const next = Math.max(
                    1,
                    Math.min(1000, Number.parseInt(keep, 10) || settings.worktreeKeepCount)
                  )
                  setKeep(String(next))
                  if (next !== settings.worktreeKeepCount) void save({ worktreeKeepCount: next })
                }}
                onChange={(event) => setKeep(event.target.value)}
              />
            }
            description={
              settings.worktreeAutoCleanupEnabled ? (
                <Trans id="settings.worktrees.keepCount.description">
                  Number of managed worktrees to keep before older ones are pruned automatically.
                  Cypheria snapshots worktrees before deleting, so pruned worktrees should always be
                  restorable.
                </Trans>
              ) : (
                <Trans id="settings.worktrees.keepCount.disabled">
                  Automatic deletion is disabled. Cypheria will not prune old worktrees
                  automatically. Re-enable it to use this saved limit again.
                </Trans>
              )
            }
            label={<Trans id="settings.worktrees.keepCount.label">Auto-delete limit</Trans>}
          />
        </SettingsSection>
      ) : null}
      <WorktreeList
        loading={worktrees.isLoading}
        error={worktrees.error}
        repositories={worktrees.data?.repositories ?? []}
        threads={threads.data ?? []}
        onRefresh={() => {
          void worktrees.refetch()
          void threads.refetch()
        }}
      />
      <AlertDialog open={confirmDisable} onOpenChange={setConfirmDisable}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans id="settings.worktrees.autoCleanup.confirm.title">
                Disable automatic worktree deletion?
              </Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans id="settings.worktrees.autoCleanup.confirm.description">
                We highly recommend keeping automatic deletion on so old worktrees do not build up
                and use unnecessary disk space. If you prefer to manage old worktrees yourself, you
                can turn this off and Cypheria will stop deleting them automatically.
              </Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans id="settings.worktrees.autoCleanup.confirm.keep">
                Keep automatic deletion
              </Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmDisable(false)
                void save({ worktreeAutoCleanupEnabled: false })
              }}
            >
              <Trans id="settings.worktrees.autoCleanup.confirm.disable">
                Disable automatic deletion
              </Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsFrame>
  )
}

type ThreadSummary = {
  id: string
  title: string | null
  roots: readonly string[]
  pinned?: boolean
}

function WorktreeList({
  error,
  loading,
  onRefresh,
  repositories,
  threads,
}: Readonly<{
  error: Error | null
  loading: boolean
  onRefresh: () => void
  repositories: readonly { root: string; worktrees: GitWorktree[] }[]
  threads: readonly ThreadSummary[]
}>) {
  const { i18n } = useLingui()
  const refresh = (
    <Button
      aria-label={i18n._(msg({ id: "settings.worktrees.refresh", message: "Refresh" }))}
      size="icon-sm"
      title={i18n._(msg({ id: "settings.worktrees.refresh", message: "Refresh" }))}
      variant="ghost"
      onClick={onRefresh}
    >
      <RotateCw className="size-4" />
    </Button>
  )
  if (loading) {
    return (
      <p className="text-muted-foreground text-sm">
        <Trans id="settings.worktrees.loading.body">Fetching worktree details…</Trans>
      </p>
    )
  }
  if (error) {
    return (
      <SettingsSection
        actions={refresh}
        title={<Trans id="settings.worktrees.error.title">Unable to load worktrees</Trans>}
      >
        <p className="px-4 py-3 text-muted-foreground text-sm">
          {error.message ||
            i18n._(
              msg({
                id: "settings.worktrees.error.body",
                message: "Something went wrong while loading worktrees.",
              })
            )}
        </p>
      </SettingsSection>
    )
  }
  if (repositories.length === 0) {
    return (
      <SettingsSection
        actions={refresh}
        title={<Trans id="settings.worktrees.empty.title">No worktrees yet</Trans>}
      >
        <p className="px-4 py-3 text-muted-foreground text-sm">
          <Trans id="settings.worktrees.empty.body">
            Worktrees created by Cypheria will appear here
          </Trans>
        </p>
      </SettingsSection>
    )
  }
  return (
    <>
      {repositories.map((repository, index) => (
        <SettingsSection
          key={repository.root}
          actions={index === 0 ? refresh : null}
          title={<span className="truncate font-mono text-sm">{repository.root}</span>}
        >
          {repository.worktrees.map((worktree) => (
            <WorktreeRow
              key={worktree.path}
              repositoryRoot={repository.root}
              threads={threads.filter((thread) =>
                thread.roots.some((root) => insideOrEqual(worktree.path, root))
              )}
              worktree={worktree}
              onChanged={onRefresh}
            />
          ))}
        </SettingsSection>
      ))}
    </>
  )
}

function WorktreeRow({
  onChanged,
  repositoryRoot,
  threads,
  worktree,
}: Readonly<{
  onChanged: () => void
  repositoryRoot: string
  threads: readonly ThreadSummary[]
  worktree: GitWorktree
}>) {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: async () =>
      (await ensureCypheriaClient()).git.deleteWorktree(repositoryRoot, worktree.path),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["git"] })
      onChanged()
    },
  })
  const newChat = useMutation({
    mutationFn: async () => {
      const client = await ensureCypheriaClient()
      const thread = await client.threads.create({ agentId: "codex" })
      await client.git.moveThreadToWorktree(repositoryRoot, worktree.path, thread.thread.id, {})
      return thread.thread.id
    },
    onSuccess: (threadId) => void navigate({ search: { thread: threadId }, to: "/" }),
  })
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm">
            <Trans id="settings.worktrees.worktree.label">Worktree</Trans>
            {worktree.branch ? (
              <span className="ml-2 font-mono text-muted-foreground text-xs">
                {worktree.branch}
              </span>
            ) : null}
            {!worktree.active ? (
              <span className="ml-2 text-muted-foreground text-xs">
                <Trans id="settings.worktrees.worktree.archived">Archived</Trans>
              </span>
            ) : null}
          </span>
          <span className="truncate font-mono text-muted-foreground text-xs">{worktree.path}</span>
        </div>
        {worktree.active ? (
          <Button
            disabled={newChat.isPending}
            size="sm"
            title={i18n._(
              msg({
                id: "settings.worktrees.worktree.newChatHint",
                message: "Starts a fresh chat using the same files and branch",
              })
            )}
            variant="outline"
            onClick={() => newChat.mutate()}
          >
            <Trans id="settings.worktrees.worktree.newChat">New chat in this worktree</Trans>
          </Button>
        ) : null}
        <Button
          disabled={remove.isPending || Boolean(worktree.ownerThreadId)}
          size="sm"
          title={
            worktree.ownerThreadId
              ? i18n._(
                  msg({
                    id: "settings.worktrees.worktree.ownerHint",
                    message: "Move the chat in this worktree elsewhere before deleting it",
                  })
                )
              : undefined
          }
          variant="ghost"
          onClick={() => remove.mutate()}
        >
          <Trans id="settings.worktrees.worktree.delete">Delete</Trans>
        </Button>
      </div>
      {remove.error || newChat.error ? (
        <p className="text-destructive text-xs">{(remove.error ?? newChat.error)?.message}</p>
      ) : null}
      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs">
          <Trans id="settings.worktrees.conversations.title">Conversations</Trans>
        </span>
        {threads.length === 0 ? (
          <span className="text-muted-foreground text-xs">
            <Trans id="settings.worktrees.conversations.empty">
              No conversations linked to this worktree.
            </Trans>
          </span>
        ) : (
          threads.map((thread) => (
            <button
              key={thread.id}
              className="flex items-center gap-2 text-left text-sm hover:underline"
              type="button"
              onClick={() => void navigate({ search: { thread: thread.id }, to: "/" })}
            >
              <MessageSquare className="size-3.5 text-muted-foreground" />
              <span className="truncate">
                {thread.title ?? (
                  <Trans id="settings.worktrees.conversations.untitled">
                    Untitled conversation
                  </Trans>
                )}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
