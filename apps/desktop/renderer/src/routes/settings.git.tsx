import type { GitSettings } from "@cypheria/protocol"
import { Alert, AlertDescription } from "@cypheria/ui/components/alert"
import { Button } from "@cypheria/ui/components/button"
import { Input } from "@cypheria/ui/components/input"
import { NativeSelect, NativeSelectOption } from "@cypheria/ui/components/native-select"
import { Switch } from "@cypheria/ui/components/switch"
import { Textarea } from "@cypheria/ui/components/textarea"
import { Trans } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { SettingsFrame } from "../components/settings-frame"
import { ensureCypheriaClient } from "../cypheria-client.js"

export const Route = createFileRoute("/settings/git")({ component: GitSettingsRoute })

function GitSettingsRoute() {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<GitSettings | null>(null)
  const settings = useQuery({
    queryKey: ["settings", "git"],
    queryFn: async () => (await ensureCypheriaClient()).server.config(),
    retry: false,
  })
  useEffect(() => {
    if (settings.data) setDraft(settings.data.config.git)
  }, [settings.data])
  const save = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("Git settings are unavailable")
      return (await ensureCypheriaClient()).server.patchConfig({ git: draft })
    },
    onSuccess: async (snapshot) => {
      setDraft(snapshot.config.git)
      await queryClient.invalidateQueries({ queryKey: ["settings", "git"] })
    },
  })
  const set = <K extends keyof GitSettings>(key: K, value: GitSettings[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current))

  return (
    <SettingsFrame>
      <div>
        <h1 className="text-xl font-semibold">
          <Trans id="settings.git.title">Git</Trans>
        </h1>
        <p className="text-sm text-muted-foreground">
          <Trans id="settings.git.description">Local Codex Git and pull request preferences</Trans>
        </p>
      </div>
      {settings.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{settings.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {draft ? (
        <>
          <section className="space-y-4 rounded-lg border p-4">
            <h2 className="text-sm font-medium">
              <Trans id="settings.git.branches">Branches and Review</Trans>
            </h2>
            <label htmlFor="git-branch-prefix" className="block space-y-1 text-sm">
              <span>
                <Trans id="settings.git.branchPrefix">Branch prefix</Trans>
              </span>
              <Input
                id="git-branch-prefix"
                value={draft.branchPrefix}
                onChange={(event) => set("branchPrefix", event.target.value)}
                maxLength={100}
              />
            </label>
            <label htmlFor="git-review-mode" className="block space-y-1 text-sm">
              <span>
                <Trans id="settings.git.reviewMode">Review mode</Trans>
              </span>
              <NativeSelect
                id="git-review-mode"
                value={draft.reviewMode}
                onChange={(event) =>
                  set("reviewMode", event.target.value as GitSettings["reviewMode"])
                }
              >
                <NativeSelectOption value="full">
                  <Trans id="settings.git.reviewFull">Full</Trans>
                </NativeSelectOption>
                <NativeSelectOption value="last-turn-only">
                  <Trans id="settings.git.reviewLastTurn">Last turn only</Trans>
                </NativeSelectOption>
              </NativeSelect>
            </label>
            <label
              htmlFor="git-force-push"
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span>
                <Trans id="settings.git.forcePush">Default to force push with lease</Trans>
              </span>
              <Switch
                id="git-force-push"
                checked={draft.alwaysForcePush}
                onCheckedChange={(value) => set("alwaysForcePush", value)}
              />
            </label>
            <label
              htmlFor="git-sidebar-pr-icons"
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span>
                <Trans id="settings.git.sidebarPrIcons">Show PR icons in sidebar</Trans>
              </span>
              <Switch
                id="git-sidebar-pr-icons"
                checked={draft.showSidebarPrIcons}
                onCheckedChange={(value) => set("showSidebarPrIcons", value)}
              />
            </label>
          </section>
          <section className="space-y-4 rounded-lg border p-4">
            <h2 className="text-sm font-medium">
              <Trans id="settings.git.pullRequests">Pull requests</Trans>
            </h2>
            <label
              htmlFor="git-github-connector"
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span>
                <Trans id="settings.git.githubConnector">
                  Use connected GitHub App tools when the CLI cannot serve an operation
                </Trans>
              </span>
              <Switch
                id="git-github-connector"
                checked={draft.githubConnectorEnabled}
                onCheckedChange={(value) => set("githubConnectorEnabled", value)}
              />
            </label>
            <label
              htmlFor="git-pr-draft"
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span>
                <Trans id="settings.git.prDraft">Create PRs as drafts by default</Trans>
              </span>
              <Switch
                id="git-pr-draft"
                checked={draft.createPullRequestAsDraft}
                onCheckedChange={(value) => set("createPullRequestAsDraft", value)}
              />
            </label>
            <label htmlFor="git-merge-method" className="block space-y-1 text-sm">
              <span>
                <Trans id="settings.git.mergeMethod">Merge method</Trans>
              </span>
              <NativeSelect
                id="git-merge-method"
                value={draft.pullRequestMergeMethod}
                onChange={(event) =>
                  set(
                    "pullRequestMergeMethod",
                    event.target.value as GitSettings["pullRequestMergeMethod"]
                  )
                }
              >
                <NativeSelectOption value="merge">
                  <Trans id="settings.git.mergeCommit">Merge commit</Trans>
                </NativeSelectOption>
                <NativeSelectOption value="squash">
                  <Trans id="settings.git.squash">Squash</Trans>
                </NativeSelectOption>
              </NativeSelect>
            </label>
            <label
              htmlFor="git-watch-auto-merge"
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span>
                <Trans id="settings.git.watchAutoMerge">Auto merge watched PRs</Trans>
              </span>
              <Switch
                id="git-watch-auto-merge"
                checked={draft.prWatchAutoMerge}
                onCheckedChange={(value) => set("prWatchAutoMerge", value)}
              />
            </label>
          </section>
          <section className="space-y-4 rounded-lg border p-4">
            <h2 className="text-sm font-medium">
              <Trans id="settings.git.worktrees">Worktrees</Trans>
            </h2>
            <label htmlFor="git-worktree-root" className="block space-y-1 text-sm">
              <span>
                <Trans id="settings.git.worktreeRoot">Worktree root</Trans>
              </span>
              <Input
                id="git-worktree-root"
                value={draft.worktreeRoot ?? ""}
                onChange={(event) => set("worktreeRoot", event.target.value.trim() || null)}
                placeholder="CYPHERIA_HOME/worktrees"
              />
            </label>
            <label htmlFor="git-upstream-refresh" className="block space-y-1 text-sm">
              <span>
                <Trans id="settings.git.upstreamRefresh">Upstream refresh</Trans>
              </span>
              <NativeSelect
                id="git-upstream-refresh"
                value={draft.upstreamRefreshMode}
                onChange={(event) =>
                  set(
                    "upstreamRefreshMode",
                    event.target.value as GitSettings["upstreamRefreshMode"]
                  )
                }
              >
                <NativeSelectOption value="best-effort">
                  <Trans id="settings.git.bestEffort">Best effort</Trans>
                </NativeSelectOption>
                <NativeSelectOption value="never">
                  <Trans id="settings.git.never">Never</Trans>
                </NativeSelectOption>
              </NativeSelect>
            </label>
            <label
              htmlFor="git-auto-cleanup"
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span>
                <Trans id="settings.git.autoCleanup">Automatic worktree cleanup</Trans>
              </span>
              <Switch
                id="git-auto-cleanup"
                checked={draft.worktreeAutoCleanupEnabled}
                onCheckedChange={(value) => set("worktreeAutoCleanupEnabled", value)}
              />
            </label>
            <label htmlFor="git-keep-count" className="block space-y-1 text-sm">
              <span>
                <Trans id="settings.git.keepCount">Worktrees to keep</Trans>
              </span>
              <Input
                id="git-keep-count"
                type="number"
                min={0}
                max={1000}
                value={draft.worktreeKeepCount}
                onChange={(event) => set("worktreeKeepCount", Number(event.target.value))}
              />
            </label>
          </section>
          <section className="space-y-4 rounded-lg border p-4">
            <h2 className="text-sm font-medium">
              <Trans id="settings.git.instructions">Agent instructions</Trans>
            </h2>
            {(
              [
                [
                  "commitInstructions",
                  <Trans key="commit" id="settings.git.commitInstructions">
                    Commit instructions
                  </Trans>,
                ],
                [
                  "prInstructions",
                  <Trans key="pr" id="settings.git.prInstructions">
                    PR instructions
                  </Trans>,
                ],
                [
                  "prWatchInstructions",
                  <Trans key="watch" id="settings.git.watchInstructions">
                    PR watch instructions
                  </Trans>,
                ],
              ] as const
            ).map(([key, label]) => (
              <label htmlFor={`git-${key}`} className="block space-y-1 text-sm" key={key}>
                <span>{label}</span>
                <Textarea
                  id={`git-${key}`}
                  value={draft[key]}
                  onChange={(event) => set(key, event.target.value)}
                  rows={3}
                  maxLength={100_000}
                />
              </label>
            ))}
          </section>
          {settings.data?.restartRequiredPaths.includes("git.worktreeRoot") ? (
            <p className="text-sm text-muted-foreground">
              <Trans id="settings.git.restartRoot">
                Restart Server to use the new worktree root.
              </Trans>
            </p>
          ) : null}
          {save.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{save.error.message}</AlertDescription>
            </Alert>
          ) : null}
          <div>
            <Button disabled={save.isPending} onClick={() => save.mutate()} type="button">
              <Trans id="settings.git.save">Save Git settings</Trans>
            </Button>
          </div>
        </>
      ) : null}
    </SettingsFrame>
  )
}
