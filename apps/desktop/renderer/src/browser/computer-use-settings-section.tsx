import type { ComputerUseSettings } from "@cypheria/protocol"
import { cn } from "@cypheria/ui"
import { Button } from "@cypheria/ui/components/button"
import { Switch } from "@cypheria/ui/components/switch"
import { Trans } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ReactNode } from "react"

import type { ComputerUseStatus } from "../../../ipc/src/computer-use.js"
import { ensureCypheriaClient } from "../cypheria-client.js"

const serverConfigKey = ["settings", "server-config"] as const
const statusKey = ["settings", "computer-use-status"] as const

type RowProps = Readonly<{
  children: ReactNode
  description: ReactNode
  title: ReactNode
  titleClassName: string
}>

function Row({ children, description, title, titleClassName }: RowProps) {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-4 border-t border-border py-2.5 first:border-t-0 max-sm:flex-col max-sm:items-stretch">
      <div className="min-w-0">
        <div className={cn("text-sm", titleClassName)}>{title}</div>
        <div className="mt-0.5 max-w-4xl text-xs text-muted-foreground">{description}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** macOS grants native app control needs, with a way to request each one. */
function PermissionRows({
  status,
  titleClassName,
}: Readonly<{ status: ComputerUseStatus; titleClassName: string }>) {
  const queryClient = useQueryClient()
  const request = useMutation({
    mutationFn: async (permission: "accessibility" | "screen-recording") => {
      const bridge = window.cypheria?.computerUse
      if (!bridge) throw new Error("Computer Use is available in Cypheria Desktop.")
      return bridge.requestPermission(permission)
    },
    onSuccess: (next) => queryClient.setQueryData(statusKey, next),
  })
  const restart = useMutation({
    mutationFn: async () => {
      const bridge = window.cypheria?.computerUse
      if (!bridge) throw new Error("Computer Use is available in Cypheria Desktop.")
      return bridge.restartDriver()
    },
    onSuccess: (next) => {
      queryClient.setQueryData(statusKey, next)
    },
  })
  const granted = <Trans id="settings.computerUse.granted">Granted</Trans>
  return (
    <>
      {status.accessibility !== null ? (
        <Row
          title={<Trans id="settings.computerUse.accessibility">Accessibility</Trans>}
          description={
            <Trans id="settings.computerUse.accessibilityDescription">
              Lets Cypheria read app windows and act in them.
            </Trans>
          }
          titleClassName={titleClassName}
        >
          {status.accessibility ? (
            <span className="text-xs text-muted-foreground">{granted}</span>
          ) : (
            <Button size="sm" variant="outline" onClick={() => request.mutate("accessibility")}>
              <Trans id="settings.computerUse.grant">Grant</Trans>
            </Button>
          )}
        </Row>
      ) : null}
      {status.screenRecording !== null ? (
        <Row
          title={<Trans id="settings.computerUse.screenRecording">Screen Recording</Trans>}
          description={
            <Trans id="settings.computerUse.screenRecordingDescription">
              Lets Cypheria take screenshots of the app windows it works in.
            </Trans>
          }
          titleClassName={titleClassName}
        >
          {status.screenRecording === "granted" ? (
            <span className="text-xs text-muted-foreground">{granted}</span>
          ) : (
            <Button size="sm" variant="outline" onClick={() => request.mutate("screen-recording")}>
              <Trans id="settings.computerUse.grant">Grant</Trans>
            </Button>
          )}
        </Row>
      ) : null}
      <Row
        title={<Trans id="settings.computerUse.service">Computer Use service</Trans>}
        description={
          status.driver === "missing" ? (
            <Trans id="settings.computerUse.serviceMissing">
              The cua-driver service is not included in this build.
            </Trans>
          ) : (
            <Trans id="settings.computerUse.serviceDescription">
              Restart it after changing a permission so it applies.
            </Trans>
          )
        }
        titleClassName={titleClassName}
      >
        <Button
          disabled={status.driver === "missing" || restart.isPending}
          size="sm"
          variant="outline"
          onClick={() => restart.mutate()}
        >
          {status.driver === "running" ? (
            <Trans id="settings.computerUse.restart">Restart</Trans>
          ) : (
            <Trans id="settings.computerUse.start">Start</Trans>
          )}
        </Button>
      </Row>
    </>
  )
}

/** Which UI Agents may operate through Computer Use. */
export function ComputerUseSettingsSection({
  headingClassName,
  titleClassName,
}: Readonly<{ headingClassName: string; titleClassName: string }>) {
  const queryClient = useQueryClient()
  const config = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).server.config(),
    queryKey: serverConfigKey,
    retry: false,
  })
  const status = useQuery({
    enabled: Boolean(window.cypheria?.computerUse),
    queryFn: async () => window.cypheria?.computerUse.status() ?? null,
    queryKey: statusKey,
    refetchOnWindowFocus: true,
  })
  const toggle = useMutation({
    mutationFn: async (patch: Partial<ComputerUseSettings>) =>
      (await ensureCypheriaClient()).server.patchConfig({ computerUse: patch }),
    onSuccess: (snapshot) => queryClient.setQueryData(serverConfigKey, snapshot),
  })
  const settings = config.data?.config.computerUse
  const error = toggle.error ?? config.error
  const surface = (key: keyof ComputerUseSettings, title: ReactNode, description: ReactNode) => (
    <Row title={title} description={description} titleClassName={titleClassName}>
      <Switch
        aria-label={key}
        checked={settings?.[key] ?? false}
        disabled={!settings || toggle.isPending}
        onCheckedChange={(checked) => toggle.mutate({ [key]: checked })}
      />
    </Row>
  )

  return (
    <section className="grid gap-3">
      <h2 className={cn("text-sm", headingClassName)}>
        <Trans id="settings.computerUse.section">Computer Use</Trans>
      </h2>
      <div className="rounded-xl border border-border bg-card px-4 shadow-xs">
        {surface(
          "inAppBrowser",
          <Trans id="settings.computerUse.inAppBrowser">Built-in browser</Trans>,
          <Trans id="settings.computerUse.inAppBrowserDescription">
            Lets Agents open and control tabs of the built-in browser in their own conversation,
            including dApp tabs. Wallet signing still follows your policies and approvals.
          </Trans>
        )}
        {surface(
          "externalBrowsers",
          <Trans id="settings.computerUse.externalBrowsers">Your browsers</Trans>,
          <Trans id="settings.computerUse.externalBrowsersDescription">
            Lets Agents use Chrome, Edge, Brave, Vivaldi, Opera, or Chromium with your signed-in
            sessions. Turn on remote debugging in the browser at its inspect page, for example
            chrome://inspect/#remote-debugging, and allow the connection when it asks.
          </Trans>
        )}
        {surface(
          "mcpApps",
          <Trans id="settings.computerUse.mcpApps">MCP Apps</Trans>,
          <Trans id="settings.computerUse.mcpAppsDescription">
            Lets Agents operate the plugin Apps shown in their conversation.
          </Trans>
        )}
        {surface(
          "desktopApps",
          <Trans id="settings.computerUse.desktopApps">Desktop apps</Trans>,
          <Trans id="settings.computerUse.desktopAppsDescription">
            Lets Agents read and operate apps on this computer in the background, with their own
            cursor. They may take screenshots while working.
          </Trans>
        )}
        {settings?.desktopApps && status.data && status.data.driver !== "unsupported" ? (
          <PermissionRows status={status.data} titleClassName={titleClassName} />
        ) : null}
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error.message}
        </p>
      ) : null}
    </section>
  )
}
