import { cn } from "@cypheria/ui"
import { Button } from "@cypheria/ui/components/button"
import { Trans } from "@lingui/react/macro"
import { useMutation } from "@tanstack/react-query"
import type { ReactNode } from "react"

import type { BrowserClearData } from "../../../ipc/src/browser.js"

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

/** Browser controls for General settings: clearing the built-in browser profiles. */
export function BrowserSettingsSection({
  headingClassName,
  titleClassName,
}: Readonly<{ headingClassName: string; titleClassName: string }>) {
  const clear = useMutation({
    mutationFn: async (input: BrowserClearData) => {
      const bridge = window.cypheria?.browser
      if (!bridge) throw new Error("The browser is available in the main Desktop window.")
      return bridge.clearData(input)
    },
  })
  const error = clear.error

  return (
    <section className="grid gap-3">
      <h2 className={cn("text-sm", headingClassName)}>
        <Trans id="settings.browser.section">Browser</Trans>
      </h2>
      <div className="rounded-xl border border-border bg-card px-4 shadow-xs">
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
