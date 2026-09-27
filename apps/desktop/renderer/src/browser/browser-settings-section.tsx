import { cn } from "@cypheria/ui"
import { Button } from "@cypheria/ui/components/button"
import { Switch } from "@cypheria/ui/components/switch"
import { Trans } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ReactNode } from "react"

import type { BrowserClearData } from "../../../ipc/src/browser.js"
import { ensureCypheriaClient } from "../cypheria-client.js"

const serverConfigKey = ["settings", "server-config"] as const

type SettingRowProps = Readonly<{
  children: ReactNode
  description: ReactNode
  title: ReactNode
  titleClassName: string
}>

function SettingRow({ children, description, title, titleClassName }: SettingRowProps) {
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

/** Browser controls for General settings: Agent access and clearing browser profiles. */
export function BrowserSettingsSection({
  headingClassName,
  titleClassName,
}: Readonly<{ headingClassName: string; titleClassName: string }>) {
  const queryClient = useQueryClient()
  const config = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).server.config(),
    queryKey: serverConfigKey,
    retry: false,
  })
  const toggle = useMutation({
    mutationFn: async (enabled: boolean) =>
      (await ensureCypheriaClient()).server.patchConfig({ browserTools: { enabled } }),
    onSuccess: (snapshot) => queryClient.setQueryData(serverConfigKey, snapshot),
  })
  const clear = useMutation({
    mutationFn: async (input: BrowserClearData) => {
      const bridge = window.cypheria?.browser
      if (!bridge) throw new Error("The browser is available in the main Desktop window.")
      return bridge.clearData(input)
    },
  })
  const enabled = config.data?.config.browserTools.enabled ?? false
  const error = toggle.error ?? clear.error ?? config.error

  return (
    <section className="grid gap-3">
      <h2 className={cn("text-sm", headingClassName)}>
        <Trans id="settings.browser.section">Browser</Trans>
      </h2>
      <div className="rounded-xl border border-border bg-card px-4 shadow-xs">
        <SettingRow
          title={<Trans id="settings.browser.agentTools">Agent browser tools</Trans>}
          description={
            <Trans id="settings.browser.agentToolsDescription">
              Lets Agents open and control browser tabs in their own conversation, including
              signed-in pages and dApp tabs. Wallet signing still follows your policies and
              approvals.
            </Trans>
          }
          titleClassName={titleClassName}
        >
          <Switch
            aria-label="Agent browser tools"
            checked={enabled}
            disabled={!config.data || toggle.isPending}
            onCheckedChange={(checked) => toggle.mutate(checked)}
          />
        </SettingRow>
        <SettingRow
          title={<Trans id="settings.browser.clearWeb">Web browsing data</Trans>}
          description={
            <Trans id="settings.browser.clearWebDescription">
              Clears cookies, storage, and cache used by web tabs.
            </Trans>
          }
          titleClassName={titleClassName}
        >
          <Button
            disabled={clear.isPending}
            onClick={() => clear.mutate({ scope: "web" })}
            size="sm"
            variant="outline"
          >
            <Trans id="settings.browser.clear">Clear</Trans>
          </Button>
        </SettingRow>
        <SettingRow
          title={<Trans id="settings.browser.clearDapp">dApp browsing data</Trans>}
          description={
            <Trans id="settings.browser.clearDappDescription">
              Clears cookies, storage, and cache used by dApp tabs. Wallet permissions are kept.
            </Trans>
          }
          titleClassName={titleClassName}
        >
          <Button
            disabled={clear.isPending}
            onClick={() => clear.mutate({ scope: "dapp" })}
            size="sm"
            variant="outline"
          >
            <Trans id="settings.browser.clear">Clear</Trans>
          </Button>
        </SettingRow>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error.message}
        </p>
      ) : null}
    </section>
  )
}
