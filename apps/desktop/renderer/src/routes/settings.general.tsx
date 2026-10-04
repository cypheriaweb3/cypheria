import { cn } from "@cypheria/ui"
import { Button } from "@cypheria/ui/components/button"
import { Switch } from "@cypheria/ui/components/switch"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useAtomValue } from "jotai"
import { type ReactNode, useState } from "react"
import type { ClientPreferencesSnapshot, NotificationSound } from "../../../ipc/src/index.js"
import { BrowserSettingsSection } from "../browser/browser-settings-section.js"
import { ComputerUseSettingsSection } from "../browser/computer-use-settings-section.js"
import {
  clientStateStore,
  composerEnterBehaviorAtom,
  composerPlainTextModeAtom,
  defaultTerminalLocationAtom,
  followUpQueueModeAtom,
  localeOverrideAtom,
  macMenuBarEnabledAtom,
  notificationSoundAtom,
  notificationsPermissionsEnabledAtom,
  notificationsQuestionsEnabledAtom,
  notificationsTurnModeAtom,
  openInTargetPreferenceAtom,
  preventSleepWhileRunningAtom,
  showBottomPanelControlAtom,
  showContextWindowUsageAtom,
} from "../client-state.js"
import { LanguageSelector } from "../components/language-selector.js"
import { SettingsFrame } from "../components/settings-frame"
import { ensureCypheriaClient } from "../cypheria-client.js"

export const Route = createFileRoute("/settings/general")({ component: GeneralSettingsRoute })

const uiFontMediumClass =
  "[font-stretch:var(--font-sans-stretch)] [font-style:var(--font-sans-style)] [font-weight:max(500,var(--font-sans-weight))]"
const uiFontSemiboldClass =
  "[font-stretch:var(--font-sans-stretch)] [font-style:var(--font-sans-style)] [font-weight:max(600,var(--font-sans-weight))]"

const notificationSoundValue = (sound: NotificationSound): string => {
  if (sound.type === "none") return "none"
  if (sound.type === "bundled") return sound.sound
  if (sound.type === "custom") return "custom"
  return sound.name
}

function GeneralSettingsRoute() {
  const { i18n } = useLingui()
  const [saveError, setSaveError] = useState<Error | null>(null)
  const localeOverride = useAtomValue(localeOverrideAtom)
  const defaultTerminalLocation = useAtomValue(defaultTerminalLocationAtom)
  const showBottomPanelControl = useAtomValue(showBottomPanelControlAtom)
  const openInTargetPreference = useAtomValue(openInTargetPreferenceAtom)
  const macMenuBarEnabled = useAtomValue(macMenuBarEnabledAtom)
  const preventSleepWhileRunning = useAtomValue(preventSleepWhileRunningAtom)
  const composerPlainTextMode = useAtomValue(composerPlainTextModeAtom)
  const showContextWindowUsage = useAtomValue(showContextWindowUsageAtom)
  const composerEnterBehavior = useAtomValue(composerEnterBehaviorAtom)
  const followUpQueueMode = useAtomValue(followUpQueueModeAtom)
  const notificationsTurnMode = useAtomValue(notificationsTurnModeAtom)
  const notificationsPermissionsEnabled = useAtomValue(notificationsPermissionsEnabledAtom)
  const notificationsQuestionsEnabled = useAtomValue(notificationsQuestionsEnabledAtom)
  const notificationSound = useAtomValue(notificationSoundAtom)
  const openTargetsQuery = useQuery({
    queryFn: () =>
      window.cypheria?.settings.listOpenTargets() ?? [{ id: "system", label: "Default app" }],
    queryKey: ["settings", "open-targets"],
  })
  const systemSoundsQuery = useQuery({
    queryFn: () => window.cypheria?.settings.listNotificationSounds() ?? [],
    queryKey: ["settings", "notification-sounds"],
  })
  const workspaceLayout = { defaultTerminalLocation, showBottomPanelControl }
  const workspaceLayoutDisabled = false
  const preferences = {
    openInTargetPreference,
    macMenuBarEnabled,
    preventSleepWhileRunning,
    composerPlainTextMode,
    showContextWindowUsage,
    composerEnterBehavior,
    followUpQueueMode,
    notificationsTurnMode,
    notificationsPermissionsEnabled,
    notificationsQuestionsEnabled,
    notificationSound,
  }
  const preferencesDisabled = false
  type PreferenceUpdate = Partial<ClientPreferencesSnapshot>
  const updatePreferences = async (update: PreferenceUpdate) => {
    setSaveError(null)
    try {
      const operations: Promise<unknown>[] = []
      for (const [key, value] of Object.entries(update)) {
        switch (key) {
          case "openInTargetPreference":
            operations.push(
              Promise.resolve(clientStateStore.set(openInTargetPreferenceAtom, value as string))
            )
            break
          case "macMenuBarEnabled":
            operations.push(
              Promise.resolve(clientStateStore.set(macMenuBarEnabledAtom, value as boolean))
            )
            break
          case "preventSleepWhileRunning":
            operations.push(
              Promise.resolve(clientStateStore.set(preventSleepWhileRunningAtom, value as boolean))
            )
            break
          case "composerPlainTextMode":
            operations.push(
              Promise.resolve(clientStateStore.set(composerPlainTextModeAtom, value as boolean))
            )
            break
          case "showContextWindowUsage":
            operations.push(
              Promise.resolve(clientStateStore.set(showContextWindowUsageAtom, value as boolean))
            )
            break
          case "composerEnterBehavior":
            operations.push(
              Promise.resolve(
                clientStateStore.set(
                  composerEnterBehaviorAtom,
                  value as typeof composerEnterBehavior
                )
              )
            )
            break
          case "followUpQueueMode":
            operations.push(
              Promise.resolve(
                clientStateStore.set(followUpQueueModeAtom, value as typeof followUpQueueMode)
              )
            )
            break
          case "notificationsTurnMode":
            operations.push(
              Promise.resolve(
                clientStateStore.set(
                  notificationsTurnModeAtom,
                  value as typeof notificationsTurnMode
                )
              )
            )
            break
          case "notificationsPermissionsEnabled":
            operations.push(
              Promise.resolve(
                clientStateStore.set(notificationsPermissionsEnabledAtom, value as boolean)
              )
            )
            break
          case "notificationsQuestionsEnabled":
            operations.push(
              Promise.resolve(
                clientStateStore.set(notificationsQuestionsEnabledAtom, value as boolean)
              )
            )
            break
          case "notificationSound":
            operations.push(
              Promise.resolve(
                clientStateStore.set(notificationSoundAtom, value as NotificationSound)
              )
            )
            break
        }
      }
      await Promise.all(operations)
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      setSaveError(normalized)
      throw normalized
    }
  }
  const updateNotificationSound = async (sound: NotificationSound) => {
    await updatePreferences({ notificationSound: sound })
    await window.cypheria?.settings.previewNotificationSound()
  }
  const preferenceSwitch = (key: keyof typeof preferences, label: string) => (
    <Switch
      aria-label={label}
      checked={Boolean(preferences[key])}
      disabled={preferencesDisabled}
      onCheckedChange={(checked) => updatePreferences({ [key]: checked })}
    />
  )
  const preferenceSelect = (
    key: keyof typeof preferences,
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
  const updateWorkspaceLayout = (update: Partial<typeof workspaceLayout>) => {
    if (update.defaultTerminalLocation)
      void clientStateStore.set(defaultTerminalLocationAtom, update.defaultTerminalLocation)
    if (update.showBottomPanelControl !== undefined)
      void clientStateStore.set(showBottomPanelControlAtom, update.showBottomPanelControl)
  }

  return (
    <SettingsFrame>
      <div className="grid w-full content-start gap-6 pb-10 text-foreground">
        <header>
          <h1 className={cn("text-[25px] leading-8", uiFontSemiboldClass)}>
            <Trans id="settings.general.title">General</Trans>
          </h1>
        </header>
        <ComputerUseSettingsSection
          headingClassName={uiFontSemiboldClass}
          titleClassName={uiFontMediumClass}
        />
        <BrowserSettingsSection
          headingClassName={uiFontSemiboldClass}
          titleClassName={uiFontMediumClass}
        />
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
              <ProjectlessFolderControl />
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
                disabled={false}
                onChange={(value) =>
                  void clientStateStore.set(localeOverrideAtom, value === "system" ? null : value)
                }
                value={localeOverride ?? "system"}
              />
            </SettingRow>
            <SettingRow
              title={<Trans id="settings.general.menuBar">Show in menu bar</Trans>}
              description={
                <Trans id="settings.general.menuBarDescription">
                  Keep Cypheria in the macOS menu bar when the main window is closed
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
                  Keep your computer awake while Cypheria is running a task
                </Trans>
              }
            >
              {preferenceSwitch("preventSleepWhileRunning", "Prevent sleep while running")}
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
                  Queue follow-ups while Cypheria runs or steer the current run. Press ⇧⌘⏎ to do the
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
            <Trans id="settings.general.notificationsSection">Notifications</Trans>
          </h2>
          <div className="rounded-xl border border-border bg-card px-4 shadow-xs">
            <SettingRow
              title={
                <Trans id="settings.general.turnNotifications">Turn completion notifications</Trans>
              }
              description={
                <Trans id="settings.general.turnNotificationsDescription">
                  Set when Cypheria alerts you that it's finished
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
                        await updateNotificationSound({ type: "custom", path: file.path })
                      } else {
                        select.value = notificationSoundValue(preferences.notificationSound)
                      }
                    } else {
                      await updateNotificationSound(
                        value === "none"
                          ? { type: "none" }
                          : value === "default" || value === "classic"
                            ? { type: "bundled", sound: value }
                            : { type: "system", name: value }
                      )
                    }
                  } catch {
                    select.value = notificationSoundValue(preferences.notificationSound)
                  }
                }}
                value={notificationSoundValue(preferences.notificationSound)}
              >
                <option value="default">Default</option>
                <option value="classic">Classic</option>
                <option value="none">None</option>
                {(systemSoundsQuery.data ?? []).map((sound) => (
                  <option key={sound} value={sound}>
                    {sound}
                  </option>
                ))}
                {preferences.notificationSound.type === "custom" ? (
                  <option value="custom">
                    {preferences.notificationSound.path.split("/").at(-1)}
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
        {saveError ? <p className="text-[13px] text-destructive">{saveError.message}</p> : null}
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

const serverConfigKey = ["settings", "server-config"] as const

/**
 * The folder tasks outside any project start in. It is a path on the Server's host, so it lives
 * in Server configuration (`workspace.projectlessRoot`); empty uses the Server's default.
 */
function ProjectlessFolderControl() {
  const queryClient = useQueryClient()
  const config = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).server.config(),
    queryKey: serverConfigKey,
    retry: false,
  })
  const save = useMutation({
    mutationFn: async (projectlessRoot: string | null) =>
      (await ensureCypheriaClient()).server.patchConfig({ workspace: { projectlessRoot } }),
    onSuccess: (snapshot) => queryClient.setQueryData(serverConfigKey, snapshot),
  })
  const current = config.data?.config.workspace.projectlessRoot ?? null
  return (
    <div className="grid justify-items-end gap-1">
      <div className="flex items-center gap-2">
        <input
          aria-label="Projectless task folder"
          className="w-72 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
          placeholder="~/Documents/Cypheria"
          defaultValue={current ?? ""}
          disabled={!config.data || save.isPending}
          key={current}
          onBlur={(event) => {
            const next = event.target.value.trim() || null
            if (next !== current) save.mutate(next)
          }}
        />
        <Button
          disabled={!config.data || save.isPending}
          onClick={async () => {
            const result = await window.cypheria?.app.pickDirectory()
            if (result?.path) save.mutate(result.path)
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          <Trans id="settings.general.chooseFolder">Choose…</Trans>
        </Button>
      </div>
      {save.error ? <p className="text-xs text-destructive">{save.error.message}</p> : null}
    </div>
  )
}
