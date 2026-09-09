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
import { Switch } from "@cypheria/ui/components/switch"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"
import type {
  CodexPermissionsCatalog,
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
const fallbackPermissionsCatalog: CodexPermissionsCatalog = {
  autoReviewAvailable: true,
  availableAgentModes: ["read-only", "auto", "guardian-approvals", "full-access"],
  configPath: "Browser preview",
  fullAccessCanBeShown: true,
  profiles: [],
  selected: { agentMode: "auto", kind: "agent-mode" },
  showFullAccess: false,
  source: "server-default",
}
const fallbackWorkspaceLayoutSettings: WorkspaceLayoutSettings = {
  configPath: "Browser preview",
  defaultTerminalLocation: "bottom",
  showBottomPanelControl: true,
}

function GeneralSettingsRoute() {
  const { i18n } = useLingui()
  const queryClient = useQueryClient()
  const [confirmFullAccess, setConfirmFullAccess] = useState(false)
  const languageQuery = useQuery({
    queryFn: () => window.cypheria?.settings.getLanguage() ?? fallbackLanguageSettings,
    queryKey: ["settings", "language"],
    staleTime: Number.POSITIVE_INFINITY,
  })
  const permissionsQuery = useQuery({
    queryFn: () => window.cypheria?.codex.getPermissionsCatalog() ?? fallbackPermissionsCatalog,
    queryKey: ["codex", "permissions", null],
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
  const fullAccessMutation = useMutation({
    mutationFn: (enabled: boolean) => {
      if (!window.cypheria) throw new Error("Permissions are only available in the desktop app.")
      return window.cypheria.codex.setShowFullAccess(enabled)
    },
    onSuccess: (catalog) => {
      if (catalog) queryClient.setQueryData(["codex", "permissions", null], catalog)
      setConfirmFullAccess(false)
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
            <Trans id="settings.permissions.title">Permissions</Trans>
          </h2>
          <div className="rounded-2xl border border-border bg-card px-5 shadow-xs">
            <SettingRow
              description={
                <Trans id="settings.permissions.default.description">
                  By default, ChatGPT can read and edit files in its workspace. It can ask for
                  additional access when needed.
                </Trans>
              }
              title={<Trans id="settings.permissions.default.title">Default permissions</Trans>}
            >
              <Switch
                checked
                disabled
                aria-label={i18n._(
                  msg({
                    id: "settings.permissions.default.toggle",
                    message: "Default permissions are always shown",
                  })
                )}
              />
            </SettingRow>
            <SettingRow
              description={
                <Trans id="settings.permissions.full.description">
                  When ChatGPT runs with full access, it can edit any file on your computer and run
                  commands with network access, without your approval. This significantly increases
                  the risk of data loss, leaks, or unexpected behavior.
                </Trans>
              }
              title={<Trans id="settings.permissions.full.title">Full access</Trans>}
            >
              <Switch
                aria-label={i18n._(
                  msg({
                    id: "settings.permissions.full.toggle",
                    message: "Show Full access in the composer",
                  })
                )}
                checked={permissionsQuery.data?.showFullAccess ?? false}
                disabled={
                  !permissionsQuery.data?.fullAccessCanBeShown || fullAccessMutation.isPending
                }
                onCheckedChange={(enabled) =>
                  enabled ? setConfirmFullAccess(true) : fullAccessMutation.mutate(false)
                }
              />
            </SettingRow>
          </div>
        </section>
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
        {languageMutation.isError ||
        fullAccessMutation.isError ||
        workspaceLayoutMutation.isError ? (
          <p className="text-[13px] text-destructive">
            {String(
              languageMutation.error?.message ??
                fullAccessMutation.error?.message ??
                workspaceLayoutMutation.error?.message
            )}
          </p>
        ) : null}
      </div>
      <Dialog onOpenChange={setConfirmFullAccess} open={confirmFullAccess}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <Trans id="settings.permissions.full.confirm.title">
                Make Full Access available?
              </Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans id="settings.permissions.full.confirm.body">
                When selected, ChatGPT can access the internet and read and edit files without
                asking for approval — including potentially destructive commands.
              </Trans>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              <Trans id="common.cancel">Cancel</Trans>
            </DialogClose>
            <Button
              disabled={fullAccessMutation.isPending}
              onClick={() => fullAccessMutation.mutate(true)}
            >
              <Trans id="common.confirm">Confirm</Trans>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
