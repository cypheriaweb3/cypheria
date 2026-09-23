import { cn } from "@cypheria/ui"
import { Button } from "@cypheria/ui/components/button"
import { Switch } from "@cypheria/ui/components/switch"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { X } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import type {
  DesktopPreferences,
  DesktopPreferencesWrite,
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
const fallbackPreferences: DesktopPreferences = {
  configPath: "Browser preview",
  projectlessWorkspaceRoot: null,
  openInTargetPreference: "system",
  macMenuBarEnabled: false,
  preventSleepWhileRunning: false,
  pluginsEnabled: true,
  composerPlainTextMode: false,
  showContextWindowUsage: false,
  composerEnterBehavior: "enter",
  followUpQueueMode: "steer",
  hotkeyWindowHotkey: null,
  hotkeyWindowProjectlessDefaultEnabled: false,
  notificationsTurnMode: "unfocused",
  notificationsPermissionsEnabled: true,
  notificationsQuestionsEnabled: true,
  notificationSound: "default",
  notificationCustomSoundPath: null,
}
const uiFontMediumClass =
  "[font-stretch:var(--font-sans-stretch)] [font-style:var(--font-sans-style)] [font-weight:max(500,var(--font-sans-weight))]"
const uiFontSemiboldClass =
  "[font-stretch:var(--font-sans-stretch)] [font-style:var(--font-sans-style)] [font-weight:max(600,var(--font-sans-weight))]"

function GeneralSettingsRoute() {
  const { i18n } = useLingui()
  const [capturingHotkey, setCapturingHotkey] = useState(false)
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
  const preferencesQuery = useQuery({
    queryFn: () => window.cypheria?.settings.getPreferences() ?? fallbackPreferences,
    queryKey: ["settings", "preferences"],
    staleTime: Number.POSITIVE_INFINITY,
  })
  const openTargetsQuery = useQuery({
    queryFn: () =>
      window.cypheria?.settings.listOpenTargets() ?? [{ id: "system", label: "Default app" }],
    queryKey: ["settings", "open-targets"],
  })
  const systemSoundsQuery = useQuery({
    queryFn: () => window.cypheria?.settings.listNotificationSounds() ?? [],
    queryKey: ["settings", "notification-sounds"],
  })
  useEffect(
    () =>
      window.cypheria?.settings.onPreferencesChanged((settings) => {
        queryClient.setQueryData(["settings", "preferences"], settings)
      }),
    [queryClient]
  )
  const preferencesMutation = useMutation({
    mutationFn: (settings: DesktopPreferencesWrite) =>
      window.cypheria?.settings.setPreferences(settings) ??
      Promise.resolve({ ...settings, configPath: fallbackPreferences.configPath }),
    onSuccess: (settings) => queryClient.setQueryData(["settings", "preferences"], settings),
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
  const workspaceLayoutDisabled = !workspaceLayoutQuery.data || workspaceLayoutMutation.isPending
  const preferences = preferencesQuery.data ?? fallbackPreferences
  const preferencesDisabled = !preferencesQuery.data || preferencesMutation.isPending
  const updatePreferences = (update: Partial<DesktopPreferencesWrite>) => {
    const { configPath: _configPath, ...current } = preferences
    preferencesMutation.mutate({ ...current, ...update })
  }
  const updateNotificationSound = async (update: Partial<DesktopPreferencesWrite>) => {
    const { configPath: _configPath, ...current } = preferences
    await preferencesMutation.mutateAsync({ ...current, ...update })
    await window.cypheria?.settings.previewNotificationSound()
  }
  const preferenceSwitch = (key: keyof DesktopPreferencesWrite, label: string) => (
    <Switch
      aria-label={label}
      checked={Boolean(preferences[key])}
      disabled={preferencesDisabled}
      onCheckedChange={(checked) => updatePreferences({ [key]: checked })}
    />
  )
  const preferenceSelect = (
    key: keyof DesktopPreferencesWrite,
    options: readonly (readonly [string, string])[],
    label: string
  ) => (
    <select
      aria-label={label}
      className="h-8 rounded-md border border-border bg-background px-2 text-sm"
      disabled={preferencesDisabled}
      onChange={(event) => updatePreferences({ [key]: event.target.value })}
      value={String(preferences[key])}
    >
      {options.map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  )
  const updateWorkspaceLayout = (update: Partial<WorkspaceLayoutSettingsWrite>) =>
    workspaceLayoutMutation.mutate({
      defaultTerminalLocation: workspaceLayout.defaultTerminalLocation,
      showBottomPanelControl: workspaceLayout.showBottomPanelControl,
      ...update,
    })

  return (
    <SettingsFrame>
      <div className="grid w-full content-start gap-6 pb-10 text-foreground">
        <header>
          <h1 className={cn("text-[25px] leading-8", uiFontSemiboldClass)}>
            <Trans id="settings.general.title">General</Trans>
          </h1>
        </header>
        <section className="grid gap-3">
          <h2 className={cn("text-sm", uiFontSemiboldClass)}>
            <Trans id="settings.general.section">General</Trans>
          </h2>
          <div className="rounded-xl border border-border bg-card px-4 shadow-xs">
            <SettingRow
              title={<Trans id="settings.general.projectlessFolder">Projectless task folder</Trans>}
              description={
                <Trans id="settings.general.projectlessFolderDescription">
                  The location where tasks started outside of projects store their data by default.
                </Trans>
              }
            >
              <div className="flex items-center gap-2">
                <input
                  aria-label="Projectless task folder"
                  className="w-72 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
                  placeholder="Default"
                  defaultValue={preferences.projectlessWorkspaceRoot ?? ""}
                  disabled={preferencesDisabled}
                  key={preferences.projectlessWorkspaceRoot}
                  onBlur={(event) => {
                    if (event.target.value !== (preferences.projectlessWorkspaceRoot ?? ""))
                      updatePreferences({ projectlessWorkspaceRoot: event.target.value || null })
                  }}
                />
                <Button
                  disabled={preferencesDisabled}
                  onClick={async () => {
                    const result = await window.cypheria?.app.pickDirectory()
                    if (result?.path) updatePreferences({ projectlessWorkspaceRoot: result.path })
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Trans id="settings.general.chooseFolder">Choose…</Trans>
                </Button>
              </div>
            </SettingRow>
            <SettingRow
              title={
                <Trans id="settings.general.openDestination">Default file open destination</Trans>
              }
              description={
                <Trans id="settings.general.openDestinationDescription">
                  Where files and folders open by default
                </Trans>
              }
            >
              {preferenceSelect(
                "openInTargetPreference",
                [
                  ...(openTargetsQuery.data ?? [{ id: "system", label: "Default app" }]).map(
                    ({ id, label }) => [id, label] as const
                  ),
                  ...((openTargetsQuery.data ?? [{ id: "system", label: "Default app" }]).some(
                    ({ id }) => id === preferences.openInTargetPreference
                  )
                    ? []
                    : [[preferences.openInTargetPreference, "Unavailable"] as const]),
                ],
                i18n._(
                  msg({
                    id: "settings.general.openDestination",
                    message: "Default file open destination",
                  })
                )
              )}
            </SettingRow>
            <SettingRow
              description={
                <Trans id="settings.language.description">Language for the app UI</Trans>
              }
              title={<Trans id="settings.general.languageLabel">Language</Trans>}
            >
              <LanguageSelector
                disabled={!languageQuery.data || languageMutation.isPending}
                onChange={(value) => languageMutation.mutate(value)}
                value={languageQuery.data?.preference ?? "system"}
              />
            </SettingRow>
            <SettingRow
              title={<Trans id="settings.general.menuBar">Show in menu bar</Trans>}
              description={
                <Trans id="settings.general.menuBarDescription">
                  Keep ChatGPT in the macOS menu bar when the main window is closed
                </Trans>
              }
            >
              {preferenceSwitch("macMenuBarEnabled", "Show in menu bar")}
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
                disabled={workspaceLayoutDisabled}
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
                      disabled={workspaceLayoutDisabled}
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
            <SettingRow
              title={<Trans id="settings.general.preventSleep">Prevent sleep while running</Trans>}
              description={
                <Trans id="settings.general.preventSleepDescription">
                  Keep your computer awake while ChatGPT is running a task
                </Trans>
              }
            >
              {preferenceSwitch("preventSleepWhileRunning", "Prevent sleep while running")}
            </SettingRow>
            <SettingRow
              title={<Trans id="settings.general.plugins">Plugins</Trans>}
              description={
                <Trans id="settings.general.pluginsDescription">
                  Allow ChatGPT to use installed plugins
                </Trans>
              }
            >
              {preferenceSwitch("pluginsEnabled", "Plugins")}
            </SettingRow>
          </div>
        </section>
        <section className="grid gap-3">
          <h2 className={cn("text-sm", uiFontSemiboldClass)}>
            <Trans id="settings.general.composerSection">Composer</Trans>
          </h2>
          <div className="rounded-xl border border-border bg-card px-4 shadow-xs">
            <SettingRow
              title={<Trans id="settings.general.plainText">Plain text composer</Trans>}
              description={
                <Trans id="settings.general.plainTextDescription">
                  Keep code, Markdown, and links as literal text while writing messages
                </Trans>
              }
            >
              {preferenceSwitch("composerPlainTextMode", "Plain text composer")}
            </SettingRow>
            <SettingRow
              title={<Trans id="settings.general.contextUsage">Show context window usage</Trans>}
              description={
                <Trans id="settings.general.contextUsageDescription">
                  Show token usage in the composer
                </Trans>
              }
            >
              {preferenceSwitch("showContextWindowUsage", "Show context window usage")}
            </SettingRow>
            <SettingRow
              title={<Trans id="settings.general.sendShortcut">Send shortcut</Trans>}
              description={
                <Trans id="settings.general.sendShortcutDescription">
                  Choose when Enter sends a prompt or inserts a new line
                </Trans>
              }
            >
              {preferenceSelect(
                "composerEnterBehavior",
                [
                  ["enter", i18n._(msg({ id: "settings.general.enterOption", message: "Enter" }))],
                  [
                    "cmdIfMultiline",
                    i18n._(
                      msg({
                        id: "settings.general.cmdIfMultiline",
                        message: "⌘ + Enter for multiline prompts",
                      })
                    ),
                  ],
                  [
                    "cmdAlways",
                    i18n._(msg({ id: "settings.general.cmdAlways", message: "⌘ + Enter always" })),
                  ],
                ],
                i18n._(msg({ id: "settings.general.sendShortcut", message: "Send shortcut" }))
              )}
            </SettingRow>
            <SettingRow
              title={<Trans id="settings.general.followUp">Follow-up behavior</Trans>}
              description={
                <Trans id="settings.general.followUpDescription">
                  Queue follow-ups while ChatGPT runs or steer the current run. Press ⇧⌘⏎ to do the
                  opposite for one message
                </Trans>
              }
            >
              {preferenceSelect(
                "followUpQueueMode",
                [
                  ["steer", i18n._(msg({ id: "settings.general.steerOption", message: "Steer" }))],
                  ["queue", i18n._(msg({ id: "settings.general.queueOption", message: "Queue" }))],
                ],
                i18n._(msg({ id: "settings.general.followUp", message: "Follow-up behavior" }))
              )}
            </SettingRow>
          </div>
        </section>
        <section className="grid gap-3">
          <h2 className={cn("text-sm", uiFontSemiboldClass)}>
            <Trans id="settings.general.popoutSection">Popout Window</Trans>
          </h2>
          <div className="rounded-xl border border-border bg-card px-4 shadow-xs">
            <SettingRow
              title={<Trans id="settings.general.popoutHotkey">Popout Window hotkey</Trans>}
              description={
                <Trans id="settings.general.popoutHotkeyDescription">
                  Set a global shortcut for Popout Window. Leave unset to keep it off.
                </Trans>
              }
            >
              <div className="flex items-center gap-1">
                <Button
                  aria-label="Popout Window hotkey capture"
                  className="h-8 min-w-36 justify-center font-mono text-xs"
                  disabled={preferencesDisabled}
                  onBlur={() => setCapturingHotkey(false)}
                  onClick={() => setCapturingHotkey(true)}
                  onKeyDown={(event) => {
                    if (!capturingHotkey) return
                    event.preventDefault()
                    event.stopPropagation()
                    if (event.key === "Escape") {
                      setCapturingHotkey(false)
                      return
                    }
                    if (["Alt", "Control", "Meta", "Shift"].includes(event.key)) return
                    if (!event.metaKey && !event.ctrlKey && !event.altKey) return
                    const key = event.key.length === 1 ? event.key.toUpperCase() : event.key
                    const modifiers = [
                      event.metaKey ? "Command" : null,
                      event.ctrlKey ? "Control" : null,
                      event.altKey ? "Alt" : null,
                      event.shiftKey ? "Shift" : null,
                    ].filter((part): part is string => part !== null)
                    setCapturingHotkey(false)
                    updatePreferences({ hotkeyWindowHotkey: [...modifiers, key].join("+") })
                  }}
                  type="button"
                  variant="outline"
                >
                  {capturingHotkey ? (
                    <Trans id="settings.general.hotkeyCapturePrompt">Press shortcut…</Trans>
                  ) : preferences.hotkeyWindowHotkey ? (
                    preferences.hotkeyWindowHotkey
                      .replaceAll("Command+", "⌘")
                      .replaceAll("Control+", "⌃")
                      .replaceAll("Alt+", "⌥")
                      .replaceAll("Shift+", "⇧")
                  ) : (
                    <Trans id="settings.general.offOption">Off</Trans>
                  )}
                </Button>
                {preferences.hotkeyWindowHotkey ? (
                  <Button
                    aria-label="Clear Popout Window hotkey"
                    className="size-8"
                    disabled={preferencesDisabled}
                    onClick={() => updatePreferences({ hotkeyWindowHotkey: null })}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <X className="size-3.5" />
                  </Button>
                ) : null}
              </div>
            </SettingRow>
            <SettingRow
              title={<Trans id="settings.general.standaloneChat">Default to standalone chat</Trans>}
              description={
                <Trans id="settings.general.standaloneChatDescription">
                  Start new chats outside of any project
                </Trans>
              }
            >
              {preferenceSwitch(
                "hotkeyWindowProjectlessDefaultEnabled",
                "Default to standalone chat"
              )}
            </SettingRow>
          </div>
        </section>
        <section className="grid gap-3">
          <h2 className={cn("text-sm", uiFontSemiboldClass)}>
            <Trans id="settings.general.notificationsSection">Notifications</Trans>
          </h2>
          <div className="rounded-xl border border-border bg-card px-4 shadow-xs">
            <SettingRow
              title={
                <Trans id="settings.general.turnNotifications">Turn completion notifications</Trans>
              }
              description={
                <Trans id="settings.general.turnNotificationsDescription">
                  Set when ChatGPT alerts you that it's finished
                </Trans>
              }
            >
              {preferenceSelect(
                "notificationsTurnMode",
                [
                  ["off", i18n._(msg({ id: "settings.general.offOption", message: "Off" }))],
                  [
                    "unfocused",
                    i18n._(
                      msg({ id: "settings.general.unfocusedOption", message: "When unfocused" })
                    ),
                  ],
                  [
                    "always",
                    i18n._(msg({ id: "settings.general.alwaysOption", message: "Always" })),
                  ],
                ],
                i18n._(
                  msg({
                    id: "settings.general.turnNotifications",
                    message: "Turn completion notifications",
                  })
                )
              )}
            </SettingRow>
            <SettingRow
              title={
                <Trans id="settings.general.permissionNotifications">
                  Enable permission notifications
                </Trans>
              }
              description={
                <Trans id="settings.general.permissionNotificationsDescription">
                  Show alerts when notification permissions are required
                </Trans>
              }
            >
              {preferenceSwitch(
                "notificationsPermissionsEnabled",
                "Enable permission notifications"
              )}
            </SettingRow>
            <SettingRow
              title={
                <Trans id="settings.general.questionNotifications">
                  Enable question notifications
                </Trans>
              }
              description={
                <Trans id="settings.general.questionNotificationsDescription">
                  Show alerts when input is needed to continue
                </Trans>
              }
            >
              {preferenceSwitch("notificationsQuestionsEnabled", "Enable question notifications")}
            </SettingRow>
            <SettingRow
              title={<Trans id="settings.general.notificationSound">Notification sound</Trans>}
              description={
                <Trans id="settings.general.notificationSoundDescription">
                  Sound for task completion, permission requests, and questions
                </Trans>
              }
            >
              <select
                aria-label={i18n._(
                  msg({ id: "settings.general.notificationSound", message: "Notification sound" })
                )}
                className="h-8 rounded-md border border-border bg-background px-2 text-sm"
                disabled={preferencesDisabled}
                onChange={async (event) => {
                  const select = event.currentTarget
                  const value = select.value
                  try {
                    if (value === "choose") {
                      const file = await window.cypheria?.app.pickSoundFile()
                      if (file?.path) {
                        await updateNotificationSound({
                          notificationSound: "custom",
                          notificationCustomSoundPath: file.path,
                        })
                      } else {
                        select.value = preferences.notificationSound
                      }
                    } else {
                      await updateNotificationSound({
                        notificationSound: value as DesktopPreferencesWrite["notificationSound"],
                      })
                    }
                  } catch {
                    select.value = preferences.notificationSound
                  }
                }}
                value={preferences.notificationSound}
              >
                <option value="default">Default</option>
                <option value="classic">Classic</option>
                <option value="none">None</option>
                {(systemSoundsQuery.data ?? []).map((sound) => (
                  <option key={sound} value={sound}>
                    {sound}
                  </option>
                ))}
                {preferences.notificationCustomSoundPath ? (
                  <option value="custom">
                    {preferences.notificationCustomSoundPath.split("/").at(-1)}
                  </option>
                ) : null}
                <option value="choose">
                  {i18n._(
                    msg({
                      id: "settings.general.chooseCustomSound",
                      message: "Choose custom sound…",
                    })
                  )}
                </option>
              </select>
            </SettingRow>
          </div>
        </section>
        {languageMutation.isError ||
        workspaceLayoutMutation.isError ||
        preferencesMutation.isError ? (
          <p className="text-[13px] text-destructive">
            {String(
              languageMutation.error?.message ??
                workspaceLayoutMutation.error?.message ??
                preferencesMutation.error?.message
            )}
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
    <div className="flex min-h-[52px] items-center justify-between gap-4 border-t border-border py-2.5 first:border-t-0 max-sm:flex-col max-sm:items-stretch">
      <div className="min-w-0">
        <div className={cn("text-sm", uiFontMediumClass)}>{title}</div>
        <div className="mt-0.5 max-w-4xl text-xs text-muted-foreground">{description}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
