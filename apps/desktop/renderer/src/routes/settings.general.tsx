import { Button } from "@cypheria/ui/components/button"
import { Switch } from "@cypheria/ui/components/switch"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type {
  LanguagePreference,
  LanguageSettings,
  WorkspaceLayoutSettings,
  WorkspaceLayoutSettingsWrite,
} from "../../../ipc/src/index.js"
import { LanguageSelector } from "../components/language-selector.js"
import { SettingsFrame } from "../components/settings-frame"
import { activateLanguage } from "../i18n.js"

export const Route = createFileRoute("/settings/general")({ component: GeneralSettingsRoute })

const fallbackLanguageSettings: LanguageSettings = {
  configPath: "Browser preview",
  locale: "en",
  preference: "system",
}
const fallbackWorkspaceLayoutSettings: WorkspaceLayoutSettings = {
  configPath: "Browser preview",
  defaultTerminalLocation: "bottom",
  showBottomPanelControl: true,
}

function GeneralSettingsRoute() {
  const { i18n } = useLingui()
  const queryClient = useQueryClient()
  const languageQuery = useQuery({
    queryFn: () => window.cypheria?.settings.getLanguage() ?? fallbackLanguageSettings,
    queryKey: ["settings", "language"],
    staleTime: Number.POSITIVE_INFINITY,
  })
  const workspaceLayoutQuery = useQuery({
    queryFn: () =>
      window.cypheria?.settings.getWorkspaceLayout() ?? fallbackWorkspaceLayoutSettings,
    queryKey: ["settings", "workspace-layout"],
    staleTime: Number.POSITIVE_INFINITY,
  })
  const languageMutation = useMutation({
    mutationFn: (preference: LanguagePreference) =>
      window.cypheria?.settings.setLanguage({ preference }) ??
      Promise.resolve<LanguageSettings>({
        ...fallbackLanguageSettings,
        locale: preference === "zh-CN" ? "zh-CN" : "en",
        preference,
      }),
    onSuccess: (settings) => {
      queryClient.setQueryData(["settings", "language"], settings)
      activateLanguage(settings)
    },
  })
  const workspaceLayoutMutation = useMutation({
    mutationFn: (settings: WorkspaceLayoutSettingsWrite) =>
      window.cypheria?.settings.setWorkspaceLayout(settings) ??
      Promise.resolve<WorkspaceLayoutSettings>({
        ...settings,
        configPath: fallbackWorkspaceLayoutSettings.configPath,
      }),
    onSuccess: (settings) => {
      queryClient.setQueryData(["settings", "workspace-layout"], settings)
    },
  })
  const workspaceLayout = workspaceLayoutQuery.data ?? fallbackWorkspaceLayoutSettings
  const updateWorkspaceLayout = (update: Partial<WorkspaceLayoutSettingsWrite>) =>
    workspaceLayoutMutation.mutate({
      defaultTerminalLocation: workspaceLayout.defaultTerminalLocation,
      showBottomPanelControl: workspaceLayout.showBottomPanelControl,
      ...update,
    })

  return (
    <SettingsFrame>
      <div className="grid w-full content-start gap-10 pb-10 text-foreground">
        <header>
          <h1 className="text-2xl font-semibold leading-8">
            <Trans id="settings.general.title">General</Trans>
          </h1>
        </header>
        <section className="grid gap-4">
          <h2 className="text-base font-semibold">
            <Trans id="settings.general.section">General</Trans>
          </h2>
          <div className="rounded-2xl border border-border bg-card px-5 shadow-xs">
            <SettingRow
              description={
                <Trans id="settings.language.description">Language for the app UI</Trans>
              }
              title={<Trans id="settings.language.label">Display language</Trans>}
            >
              <LanguageSelector
                disabled={languageMutation.isPending}
                onChange={(value) => languageMutation.mutate(value)}
                value={languageQuery.data?.preference ?? "system"}
              />
            </SettingRow>
            <SettingRow
              description={
                <Trans id="settings.workspace.bottomPanelControl.description">
                  Show a quick terminal panel control in the chat title bar
                </Trans>
              }
              title={
                <Trans id="settings.workspace.bottomPanelControl.title">Bottom panel control</Trans>
              }
            >
              <Switch
                aria-label={i18n._(
                  msg({
                    id: "settings.workspace.bottomPanelControl.toggle",
                    message: "Show bottom panel control in the app title bar",
                  })
                )}
                checked={workspaceLayout.showBottomPanelControl}
                disabled={workspaceLayoutMutation.isPending}
                onCheckedChange={(showBottomPanelControl) =>
                  updateWorkspaceLayout({ showBottomPanelControl })
                }
              />
            </SettingRow>
            <SettingRow
              description={
                <Trans id="settings.workspace.terminalLocation.description">
                  Choose where the terminal opens when using the panel control or shortcut
                </Trans>
              }
              title={
                <Trans id="settings.workspace.terminalLocation.title">
                  Default terminal location
                </Trans>
              }
            >
              <fieldset
                aria-label={i18n._(
                  msg({
                    id: "settings.workspace.terminalLocation.label",
                    message: "Default terminal location",
                  })
                )}
                className="inline-flex rounded-lg border-0 bg-muted p-0.5"
              >
                {(["bottom", "right"] as const).map((location) => {
                  const selected = workspaceLayout.defaultTerminalLocation === location
                  return (
                    <Button
                      aria-pressed={selected}
                      className="h-7 rounded-md px-3 text-xs data-[selected=true]:bg-background data-[selected=true]:text-foreground data-[selected=true]:shadow-sm"
                      data-selected={selected}
                      disabled={workspaceLayoutMutation.isPending}
                      key={location}
                      onClick={() => updateWorkspaceLayout({ defaultTerminalLocation: location })}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {location === "bottom" ? (
                        <Trans id="settings.workspace.terminalLocation.bottom">Bottom</Trans>
                      ) : (
                        <Trans id="settings.workspace.terminalLocation.right">Right</Trans>
                      )}
                    </Button>
                  )
                })}
              </fieldset>
            </SettingRow>
          </div>
        </section>
        {languageMutation.isError || workspaceLayoutMutation.isError ? (
          <p className="text-[13px] text-destructive">
            {String(languageMutation.error?.message ?? workspaceLayoutMutation.error?.message)}
          </p>
        ) : null}
      </div>
    </SettingsFrame>
  )
}

function SettingRow({
  children,
  description,
  title,
}: Readonly<{ children: ReactNode; description: ReactNode; title: ReactNode }>) {
  return (
    <div className="flex min-h-[76px] items-center justify-between gap-6 border-b border-border py-3 last:border-b-0 max-sm:items-start">
      <div className="min-w-0">
        <div className="text-[15px] font-semibold">{title}</div>
        <div className="mt-1 max-w-4xl text-sm leading-5 text-muted-foreground">{description}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
