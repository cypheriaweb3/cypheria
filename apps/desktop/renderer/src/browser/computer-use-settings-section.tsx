import type { ComputerUseSettings } from "@cypheria/protocol"
import { cn } from "@cypheria/ui"
import { Button } from "@cypheria/ui/components/button"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@cypheria/ui/components/select"
import { Switch } from "@cypheria/ui/components/switch"
import { Trans } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ReactNode } from "react"

import type {
  ChromeImplementationType,
  ComputerBackend,
  ComputerUseStatus,
} from "../../../ipc/src/computer-use.js"
import { ensureCypheriaClient } from "../cypheria-client.js"

const serverConfigKey = ["settings", "server-config"] as const

/** The Chromium families the `chrome` backend drives, by the IDs browsers report. */
const BROWSER_FAMILIES = [
  { id: "chrome", name: "Google Chrome" },
  { id: "edge", name: "Microsoft Edge" },
  { id: "brave", name: "Brave" },
  { id: "vivaldi", name: "Vivaldi" },
  { id: "opera", name: "Opera" },
  { id: "chromium", name: "Chromium" },
] as const
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

/**
 * How this device drives the person's browsers. Only this device knows; Agents and the Server see
 * the same browsers either way.
 */
function ChromeImplementationTypeRow({
  status,
  titleClassName,
}: Readonly<{ status: ComputerUseStatus; titleClassName: string }>) {
  const queryClient = useQueryClient()
  const select = useMutation({
    mutationFn: async (type: ChromeImplementationType) => {
      const bridge = window.cypheria?.computerUse
      if (!bridge) throw new Error("Computer Use is available in Cypheria Desktop.")
      return bridge.setChromeImplementationType(type)
    },
    onSuccess: (next) => queryClient.setQueryData(statusKey, next),
  })
  const choices: { value: ChromeImplementationType; label: ReactNode; description: ReactNode }[] = [
    {
      description: (
        <Trans id="settings.computerUse.chromeExtensionDescription">
          Works through the Cypheria extension in each browser profile.
        </Trans>
      ),
      label: <Trans id="settings.computerUse.chromeExtension">Cypheria extension</Trans>,
      value: "extension",
    },
    {
      description: (
        <Trans id="settings.computerUse.chromeCdpDescription">
          Connects to running browsers that allow remote debugging. Turn it on at the browser's
          inspect page, for example chrome://inspect/#remote-debugging, and allow the connection
          when it asks.
        </Trans>
      ),
      label: <Trans id="settings.computerUse.chromeCdp">Remote debugging (CDP)</Trans>,
      value: "cdp",
    },
  ]
  const current = status.chromeImplementationType.selected
  return (
    <Row
      title={<Trans id="settings.computerUse.chromeImplementationType">Browser connection</Trans>}
      description={
        <>
          {choices.find((choice) => choice.value === current)?.description}
          {select.error ? (
            <span className="block text-destructive">{select.error.message}</span>
          ) : null}
        </>
      }
      titleClassName={titleClassName}
    >
      <Select
        disabled={select.isPending}
        value={current}
        onValueChange={(next) => select.mutate(next as ChromeImplementationType)}
      >
        <SelectTrigger aria-label="chromeImplementationType" className="w-56 max-sm:w-full">
          {choices.find((choice) => choice.value === current)?.label}
        </SelectTrigger>
        <SelectContent className="w-max min-w-(--anchor-width) max-w-[min(90vw,36rem)]">
          {choices.map((choice) => {
            const available = status.chromeImplementationType.available.includes(choice.value)
            return (
              <SelectItem key={choice.value} disabled={!available} value={choice.value}>
                <div className="grid gap-0.5">
                  <span>{choice.label}</span>
                  <span className="text-xs whitespace-normal text-muted-foreground">
                    {available ? (
                      choice.description
                    ) : (
                      <Trans id="settings.computerUse.chromeUnavailable">
                        Not available in this build yet.
                      </Trans>
                    )}
                  </span>
                </div>
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
    </Row>
  )
}

/**
 * How this device operates native apps: Cypheria's cua-driver service, or the Computer Use runtime
 * of the person's installed ChatGPT on macOS, which keeps its own permissions and app policy.
 */
function ComputerBackendRow({
  status,
  titleClassName,
}: Readonly<{ status: ComputerUseStatus; titleClassName: string }>) {
  const queryClient = useQueryClient()
  const select = useMutation({
    mutationFn: async (backend: ComputerBackend) => {
      const bridge = window.cypheria?.computerUse
      if (!bridge) throw new Error("Computer Use is available in Cypheria Desktop.")
      return bridge.setComputerBackend(backend)
    },
    onSuccess: (next) => queryClient.setQueryData(statusKey, next),
  })
  const { codex, selected } = status.computerBackend
  const choices: { value: ComputerBackend; label: ReactNode; description: ReactNode }[] = [
    {
      description: (
        <Trans id="settings.computerUse.backendCuaDriverDescription">
          Cypheria's own service, with the permissions you grant Cypheria.
        </Trans>
      ),
      label: <Trans id="settings.computerUse.backendCuaDriver">Cypheria (cua-driver)</Trans>,
      value: "cua-driver",
    },
    {
      description: (
        <Trans id="settings.computerUse.backendCodexDescription">
          Uses Computer Use from your installed ChatGPT app. Its Accessibility and Screen Recording
          permissions belong to Codex Computer Use, which asks for them itself.
        </Trans>
      ),
      label: <Trans id="settings.computerUse.backendCodex">ChatGPT Computer Use</Trans>,
      value: "codex",
    },
  ]
  return (
    <Row
      title={<Trans id="settings.computerUse.backend">Desktop app control</Trans>}
      description={
        <>
          {choices.find((choice) => choice.value === selected)?.description}
          {selected === "codex" && codex?.version ? (
            <span className="block">
              <Trans id="settings.computerUse.backendCodexVersion">
                ChatGPT runtime {codex.version}
              </Trans>
            </span>
          ) : null}
          {selected === "codex" && codex?.unavailableReason ? (
            <span className="block text-destructive">{codex.unavailableReason}</span>
          ) : null}
          {select.error ? (
            <span className="block text-destructive">{select.error.message}</span>
          ) : null}
        </>
      }
      titleClassName={titleClassName}
    >
      <Select
        disabled={select.isPending}
        value={selected}
        onValueChange={(next) => select.mutate(next as ComputerBackend)}
      >
        <SelectTrigger aria-label="computerBackend" className="w-56 max-sm:w-full">
          {choices.find((choice) => choice.value === selected)?.label}
        </SelectTrigger>
        <SelectContent className="w-max min-w-(--anchor-width) max-w-[min(90vw,36rem)]">
          {choices.map((choice) => {
            // ChatGPT's runtime is offered on macOS only; detection runs when it is chosen.
            const offered = choice.value === "cua-driver" || codex !== null
            return (
              <SelectItem key={choice.value} disabled={!offered} value={choice.value}>
                <div className="grid gap-0.5">
                  <span>{choice.label}</span>
                  <span className="text-xs whitespace-normal text-muted-foreground">
                    {choice.value === "codex" && codex?.unavailableReason
                      ? codex.unavailableReason
                      : choice.description}
                  </span>
                </div>
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
    </Row>
  )
}

/** The Cypheria extension on this device: the profiles connected now, or how to connect one. */
function BrowserExtensionRow({
  status,
  titleClassName,
}: Readonly<{ status: ComputerUseStatus; titleClassName: string }>) {
  const extension = status.browserExtension
  const problems = [
    ...extension.hostErrors,
    ...(extension.endpointError ? [extension.endpointError] : []),
  ]
  return (
    <Row
      title={<Trans id="settings.computerUse.extension">Cypheria extension</Trans>}
      description={
        <>
          {extension.browsers.length > 0 ? (
            <Trans id="settings.computerUse.extensionConnected">
              Connected: {extension.browsers.map((browser) => browser.name).join(", ")}.
            </Trans>
          ) : extension.unpackedPath ? (
            <Trans id="settings.computerUse.extensionUnpacked">
              No browser is connected. Turn on Developer mode at your browser's extensions page,
              choose Load unpacked, and select {extension.unpackedPath}.
            </Trans>
          ) : (
            <Trans id="settings.computerUse.extensionMissing">
              No browser is connected. Add the Cypheria extension to each browser profile Agents may
              use.
            </Trans>
          )}
          {problems.map((problem) => (
            <span key={problem} className="block text-destructive">
              {problem}
            </span>
          ))}
        </>
      }
      titleClassName={titleClassName}
    >
      <span className="text-xs text-muted-foreground">
        {extension.host === "installed" ? (
          <Trans id="settings.computerUse.extensionHostInstalled">Host installed</Trans>
        ) : extension.host === "pending" ? (
          <Trans id="settings.computerUse.extensionHostPending">Installing host</Trans>
        ) : (
          <Trans id="settings.computerUse.extensionHostMissing">Host missing</Trans>
        )}
      </span>
    </Row>
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
  const surface = (
    key: Exclude<keyof ComputerUseSettings, "blockedBrowserFamilies">,
    title: ReactNode,
    description: ReactNode
  ) => (
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
            sessions.
          </Trans>
        )}
        {settings?.externalBrowsers ? (
          <Row
            title={<Trans id="settings.computerUse.browserFamilies">Allowed browsers</Trans>}
            description={
              <Trans id="settings.computerUse.browserFamiliesDescription">
                Agents use only the browsers turned on here.
              </Trans>
            }
            titleClassName={titleClassName}
          >
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 max-sm:grid-cols-1">
              {BROWSER_FAMILIES.map((family) => {
                const blocked = settings.blockedBrowserFamilies
                return (
                  <div key={family.id} className="flex items-center justify-between gap-3 text-xs">
                    <span>{family.name}</span>
                    <Switch
                      aria-label={family.name}
                      checked={!blocked.includes(family.id)}
                      disabled={toggle.isPending}
                      onCheckedChange={(checked) =>
                        toggle.mutate({
                          blockedBrowserFamilies: checked
                            ? blocked.filter((id) => id !== family.id)
                            : [...blocked, family.id],
                        })
                      }
                    />
                  </div>
                )
              })}
            </div>
          </Row>
        ) : null}
        {settings?.externalBrowsers && status.data ? (
          <ChromeImplementationTypeRow status={status.data} titleClassName={titleClassName} />
        ) : null}
        {settings?.externalBrowsers &&
        status.data?.chromeImplementationType.selected === "extension" ? (
          <BrowserExtensionRow status={status.data} titleClassName={titleClassName} />
        ) : null}
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
        {settings?.desktopApps && status.data?.computerBackend.codex ? (
          <ComputerBackendRow status={status.data} titleClassName={titleClassName} />
        ) : null}
        {settings?.desktopApps &&
        status.data &&
        status.data.driver !== "unsupported" &&
        status.data.computerBackend.selected === "cua-driver" ? (
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
