import { Alert, AlertDescription } from "@cypheria/ui/components/alert"
import { Input } from "@cypheria/ui/components/input"
import { SettingsRow, SettingsSection } from "@cypheria/ui/components/settings-rows"
import { Switch } from "@cypheria/ui/components/switch"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"

import { InstructionsSetting, Segmented, useGitSettings } from "../components/git-settings"
import { SettingsFrame } from "../components/settings-frame"

export const Route = createFileRoute("/settings/git")({ component: GitSettingsRoute })

/** Git settings, laid out as the official desktop's Git page. */
function GitSettingsRoute() {
  const { i18n } = useLingui()
  const { error, save, saving, settings } = useGitSettings()
  const [prefix, setPrefix] = useState("")
  const savedPrefix = settings?.branchPrefix
  useEffect(() => {
    if (savedPrefix !== undefined) setPrefix(savedPrefix)
  }, [savedPrefix])
  const savePrefix = () => {
    if (settings && prefix !== settings.branchPrefix) void save({ branchPrefix: prefix })
  }

  return (
    <SettingsFrame>
      <h1 className="font-semibold text-xl">
        <Trans id="settings.section.git-settings">Git</Trans>
      </h1>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : null}
      {settings ? (
        <>
          <SettingsSection>
            <SettingsRow
              control={
                <Switch
                  aria-label={i18n._(
                    msg({
                      id: "settings.git.reviewMode.ariaLabel",
                      message: "Disable Git-based diffs",
                    })
                  )}
                  checked={settings.reviewMode === "last-turn-only"}
                  onCheckedChange={(checked) =>
                    void save({ reviewMode: checked ? "last-turn-only" : "full" })
                  }
                />
              }
              description={
                <Trans id="settings.git.reviewMode.description">
                  Only show "Last Turn" in the Changes panel and disable Unstaged/Staged/Branch to
                  avoid git operations
                </Trans>
              }
              label={<Trans id="settings.git.reviewMode.label">Disable Git-based diffs</Trans>}
            />
            <SettingsRow
              control={
                <Input
                  aria-label={i18n._(
                    msg({ id: "settings.git.branchPrefix.ariaLabel", message: "Branch prefix" })
                  )}
                  className="w-56"
                  disabled={saving}
                  maxLength={100}
                  placeholder={i18n._(
                    msg({ id: "settings.git.branchPrefix.placeholder", message: "cypheria/" })
                  )}
                  value={prefix}
                  onBlur={savePrefix}
                  onChange={(event) => setPrefix(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" ||
                      ((event.metaKey || event.ctrlKey) && event.key === "s")
                    ) {
                      event.preventDefault()
                      savePrefix()
                    }
                  }}
                />
              }
              description={
                <Trans id="settings.git.branchPrefix.description">
                  Prefix used when Cypheria creates new branches
                </Trans>
              }
              label={<Trans id="settings.git.branchPrefix.label">Branch prefix</Trans>}
            />
            <SettingsRow
              control={
                <Segmented
                  label={i18n._(
                    msg({
                      id: "settings.git.pullRequestMergeMethod.ariaLabel",
                      message: "Pull request merge method",
                    })
                  )}
                  options={[
                    {
                      label: <Trans id="settings.git.pullRequestMergeMethod.merge">Merge</Trans>,
                      value: "merge",
                    },
                    {
                      label: <Trans id="settings.git.pullRequestMergeMethod.squash">Squash</Trans>,
                      value: "squash",
                    },
                  ]}
                  value={settings.pullRequestMergeMethod}
                  onChange={(value) => void save({ pullRequestMergeMethod: value })}
                />
              }
              description={
                <Trans id="settings.git.pullRequestMergeMethod.description">
                  Choose how Cypheria merges pull requests
                </Trans>
              }
              label={
                <Trans id="settings.git.pullRequestMergeMethod.label">
                  Pull request merge method
                </Trans>
              }
            />
            <SettingsRow
              control={
                <Switch
                  aria-label={i18n._(
                    msg({ id: "settings.git.forcePush.ariaLabel", message: "Always force push" })
                  )}
                  checked={settings.alwaysForcePush}
                  onCheckedChange={(checked) => void save({ alwaysForcePush: checked })}
                />
              }
              description={
                <Trans id="settings.git.forcePush.description">
                  Use --force-with-lease when pushing from Cypheria
                </Trans>
              }
              label={<Trans id="settings.git.forcePush.label">Always force push</Trans>}
            />
            <SettingsRow
              control={
                <Switch
                  aria-label={i18n._(
                    msg({
                      id: "settings.git.createDraftPullRequest.ariaLabel",
                      message: "Create draft pull requests",
                    })
                  )}
                  checked={settings.createPullRequestAsDraft}
                  onCheckedChange={(checked) => void save({ createPullRequestAsDraft: checked })}
                />
              }
              description={
                <Trans id="settings.git.createDraftPullRequest.description">
                  Use draft pull requests by default when creating PRs from Cypheria
                </Trans>
              }
              label={
                <Trans id="settings.git.createDraftPullRequest.label">
                  Create draft pull requests
                </Trans>
              }
            />
            <SettingsRow
              control={
                <Switch
                  aria-label={i18n._(
                    msg({
                      id: "settings.git.sidebarPrIcons",
                      message: "Show pull request icons in the sidebar",
                    })
                  )}
                  checked={settings.showSidebarPullRequestIcons}
                  onCheckedChange={(checked) => void save({ showSidebarPullRequestIcons: checked })}
                />
              }
              label={
                <Trans id="settings.git.sidebarPrIcons">
                  Show pull request icons in the sidebar
                </Trans>
              }
            />
          </SettingsSection>
          <InstructionsSetting
            ariaLabel={i18n._(
              msg({
                id: "settings.git.pullRequestWatch.instructions.ariaLabel",
                message: "Pull request watch instructions",
              })
            )}
            placeholder={i18n._(
              msg({
                id: "settings.git.pullRequestWatch.instructions.placeholder",
                message:
                  "For example: Comment /merge after checks pass and approve unrelated Chromatic changes…",
              })
            )}
            rows={5}
            title={
              <Trans id="settings.git.pullRequestWatch.title">Watch and fix pull requests</Trans>
            }
            value={settings.pullRequestWatchInstructions}
            onSave={(value) => save({ pullRequestWatchInstructions: value })}
          >
            <SettingsRow
              control={
                <Switch
                  aria-label={i18n._(
                    msg({
                      id: "settings.git.pullRequestWatch.autoMerge.ariaLabel",
                      message: "Auto-merge when ready",
                    })
                  )}
                  checked={settings.pullRequestWatchAutoMerge}
                  onCheckedChange={(checked) => void save({ pullRequestWatchAutoMerge: checked })}
                />
              }
              description={
                <Trans id="settings.git.pullRequestWatch.autoMerge.description">
                  Continue watching until the pull request is merged
                </Trans>
              }
              label={
                <Trans id="settings.git.pullRequestWatch.autoMerge.label">
                  Auto-merge when ready
                </Trans>
              }
            />
          </InstructionsSetting>
          <InstructionsSetting
            ariaLabel={i18n._(
              msg({
                id: "settings.git.commitInstructions.ariaLabel",
                message: "Commit instructions",
              })
            )}
            description={
              <Trans id="settings.git.commitInstructions.description">
                Added to commit message generation prompts
              </Trans>
            }
            placeholder={i18n._(
              msg({
                id: "settings.git.commitInstructions.placeholder",
                message: "Add commit message guidance…",
              })
            )}
            title={<Trans id="settings.git.commitInstructions.label">Commit instructions</Trans>}
            value={settings.commitInstructions}
            onSave={(value) => save({ commitInstructions: value })}
          />
          <InstructionsSetting
            ariaLabel={i18n._(
              msg({
                id: "settings.git.prInstructions.ariaLabel",
                message: "Pull request instructions",
              })
            )}
            description={
              <Trans id="settings.git.prInstructions.description">
                Added to PR title/description generation prompts
              </Trans>
            }
            placeholder={i18n._(
              msg({
                id: "settings.git.prInstructions.placeholder",
                message: "Add pull request guidance…",
              })
            )}
            title={<Trans id="settings.git.prInstructions.label">Pull request instructions</Trans>}
            value={settings.pullRequestInstructions}
            onSave={(value) => save({ pullRequestInstructions: value })}
          />
        </>
      ) : null}
    </SettingsFrame>
  )
}
