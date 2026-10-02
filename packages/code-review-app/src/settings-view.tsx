import type { CodeReviewSettings } from "@cypheria/protocol/code-review-app"
import { Button } from "@cypheria/ui/components/button"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@cypheria/ui/components/select"
import { SettingsRow, SettingsSection } from "@cypheria/ui/components/settings-rows"
import { Textarea } from "@cypheria/ui/components/textarea"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useEffect, useRef, useState } from "react"

import { useHostContext, useUpdateSettings } from "./data.js"
import { host } from "./host.js"
import { Loading } from "./root.js"

type Choice = { value: string; label: string }

function ChoiceSelect({
  choices,
  label,
  onChange,
  value,
}: Readonly<{
  choices: Choice[]
  label: string
  onChange: (value: string) => void
  value: string
}>) {
  return (
    <Select value={value} onValueChange={(next) => onChange(String(next))}>
      <SelectTrigger aria-label={label} className="w-56">
        {choices.find((choice) => choice.value === value)?.label ?? value}
      </SelectTrigger>
      <SelectContent className="w-max min-w-(--anchor-width)">
        {choices.map((choice) => (
          <SelectItem key={choice.value} value={choice.value}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Code Review's own settings page: provider, account, link target, and review instructions. */
export function SettingsView() {
  const { i18n } = useLingui()
  const { settings, setup } = useHostContext()
  const update = useUpdateSettings()
  if (settings.isLoading || setup.isLoading) return <Loading />
  if (!settings.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-muted-foreground text-sm">
          <Trans id="codeReview.settings.loadError">Unable to load app preferences</Trans>
        </p>
        <Button size="sm" variant="outline" onClick={() => void settings.refetch()}>
          <Trans id="codeReview.settings.retry">Retry</Trans>
        </Button>
      </div>
    )
  }
  const value = settings.data
  const save = (patch: Partial<CodeReviewSettings>) => update.mutate(patch)
  const connections = setup.data?.github.connections ?? []
  const instances = setup.data?.gitlab.instances ?? []
  const connectionValue = value.githubConnection
    ? `${value.githubConnection.hostname}|${value.githubConnection.connectorId}|${value.githubConnection.accountLinkId}`
    : "default"
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-6">
        <SettingsSection
          title={<Trans id="settings.codeReviewPlugin.appPreferences.title">App preferences</Trans>}
        >
          <SettingsRow
            control={
              <ChoiceSelect
                choices={[
                  {
                    label: i18n._(
                      msg({ id: "codeReview.settings.provider.github", message: "GitHub" })
                    ),
                    value: "github",
                  },
                  {
                    label: i18n._(
                      msg({ id: "codeReview.settings.provider.gitlab", message: "GitLab (beta)" })
                    ),
                    value: "gitlab",
                  },
                ]}
                label={i18n._(
                  msg({ id: "codeReview.settings.provider", message: "Review provider" })
                )}
                value={value.gitHostingProvider}
                onChange={(next) => save({ gitHostingProvider: next as "github" | "gitlab" })}
              />
            }
            label={<Trans id="codeReview.settings.provider">Review provider</Trans>}
          />
          {value.gitHostingProvider === "github" ? (
            <SettingsRow
              control={
                connections.length > 0 ? (
                  <ChoiceSelect
                    choices={[
                      { label: "github.com", value: "default" },
                      ...connections.map((connection) => ({
                        label: i18n._(
                          msg({
                            id: "codeReview.onboarding.useConnection",
                            message: `Use ${connection.hostname} — ${connection.name ?? connection.login ?? connection.accountLinkId}`,
                          })
                        ),
                        value: `${connection.hostname}|${connection.connectorId}|${connection.accountLinkId}`,
                      })),
                    ]}
                    label={i18n._(
                      msg({ id: "codeReview.settings.githubAccount", message: "GitHub account" })
                    )}
                    value={connectionValue}
                    onChange={(next) => {
                      if (next === "default") {
                        save({ githubConnection: null })
                        return
                      }
                      const [hostname, connectorId, accountLinkId] = next.split("|")
                      if (hostname && connectorId && accountLinkId) {
                        save({ githubConnection: { accountLinkId, connectorId, hostname } })
                      }
                    }}
                  />
                ) : (
                  <Button size="sm" variant="outline" onClick={() => void host.connect("github")}>
                    <Trans id="codex.pullRequests.inbox.connectGitHub">Connect GitHub</Trans>
                  </Button>
                )
              }
              label={<Trans id="codeReview.settings.githubAccount">GitHub account</Trans>}
            />
          ) : (
            <SettingsRow
              control={
                instances.length > 0 ? (
                  <ChoiceSelect
                    choices={[
                      { label: "gitlab.com", value: "default" },
                      ...instances.map((instance) => ({
                        label: `${instance.hostname} — ${instance.name}`,
                        value: instance.connectorId,
                      })),
                    ]}
                    label={i18n._(
                      msg({ id: "codeReview.settings.gitlabAccount", message: "GitLab account" })
                    )}
                    value={value.gitlabConnectorId ?? "default"}
                    onChange={(next) =>
                      save({ gitlabConnectorId: next === "default" ? null : next })
                    }
                  />
                ) : (
                  <Button size="sm" variant="outline" onClick={() => void host.connect("gitlab")}>
                    <Trans id="codeReview.settings.connectGitlab">Connect GitLab (beta)</Trans>
                  </Button>
                )
              }
              label={<Trans id="codeReview.settings.gitlabAccount">GitLab account</Trans>}
            />
          )}
          <SettingsRow
            control={
              <ChoiceSelect
                choices={[
                  {
                    label: i18n._(
                      msg({
                        id: "settings.codeReviewPlugin.githubLinks.codeReviewTab",
                        message: "Code Review tab",
                      })
                    ),
                    value: "code-review-tab",
                  },
                  {
                    label: i18n._(
                      msg({
                        id: "settings.codeReviewPlugin.reviewLinks.inAppBrowser",
                        message: "Web page in Cypheria",
                      })
                    ),
                    value: "in-app-browser",
                  },
                  {
                    label: i18n._(
                      msg({
                        id: "settings.codeReviewPlugin.reviewLinks.externalBrowser",
                        message: "Default browser",
                      })
                    ),
                    value: "external-browser",
                  },
                ]}
                label={i18n._(
                  msg({
                    id: "settings.codeReviewPlugin.githubLinks.label",
                    message: "Open review links in",
                  })
                )}
                value={value.githubLinkTarget}
                onChange={(next) =>
                  save({ githubLinkTarget: next as CodeReviewSettings["githubLinkTarget"] })
                }
              />
            }
            label={
              <Trans id="settings.codeReviewPlugin.githubLinks.label">Open review links in</Trans>
            }
          />
        </SettingsSection>
        <ReviewInstructions
          value={value.localReviewInstructions}
          onSave={(next) => update.mutateAsync({ localReviewInstructions: next })}
        />
        {update.error ? (
          <p className="text-destructive text-sm">
            <Trans id="codeReview.settings.saveError">
              Unable to save app preferences. Try again.
            </Trans>
          </p>
        ) : null}
      </div>
    </div>
  )
}

/** Review instructions save on their own after a pause, as Git instructions do. */
function ReviewInstructions({
  onSave,
  value,
}: Readonly<{ onSave: (value: string) => Promise<unknown>; value: string }>) {
  const { i18n } = useLingui()
  const [draft, setDraft] = useState(value)
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => setDraft(value), [value])
  const schedule = (next: string) => {
    setDraft(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setState("saving")
      onSave(next).then(
        () => setState("saved"),
        () => setState("error")
      )
    }, 800)
  }
  return (
    <SettingsSection
      actions={
        <span className="text-muted-foreground text-xs">
          {state === "saved" ? (
            <Trans id="settings.git.instructions.autoSave.saved">Saved</Trans>
          ) : state === "error" ? (
            <span className="text-destructive">
              <Trans id="settings.git.instructions.autoSave.error">
                Failed to save instructions
              </Trans>
            </span>
          ) : null}
        </span>
      }
      description={
        <Trans id="settings.codeReviewPlugin.localInstructions.description">
          Added to reviews you start in Code Review, across all repositories
        </Trans>
      }
      title={
        <Trans id="settings.codeReviewPlugin.localInstructions.title">Review instructions</Trans>
      }
    >
      <div className="p-3">
        <Textarea
          aria-label={i18n._(
            msg({
              id: "settings.codeReviewPlugin.localInstructions.title",
              message: "Review instructions",
            })
          )}
          className="min-h-36 border-0 shadow-none focus-visible:ring-0"
          placeholder={i18n._(
            msg({
              id: "settings.codeReviewPlugin.localInstructions.placeholder",
              message:
                "For example: I care most about the data model. Tell me where we might be overcomplicating things.",
            })
          )}
          value={draft}
          onChange={(event) => schedule(event.target.value)}
        />
      </div>
    </SettingsSection>
  )
}
