import { cn } from "@cypheria/ui"
import { Button } from "@cypheria/ui/components/button"
import { ChatBrowserPanel, ChatPreviewToolbar } from "@cypheria/ui/components/chat"
import { Input } from "@cypheria/ui/components/input"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import {
  ArrowLeft,
  ArrowRight,
  Globe,
  Plus,
  RotateCw,
  SquareTerminal,
  Trash2,
  Wallet,
  WalletMinimal,
  X,
} from "lucide-react"
import { type FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import {
  ensureResidentBrowserWebview,
  getResidentBrowserWebview,
  isBrowserAvailable,
  parkBrowserWebview,
  presentBrowserWebview,
  removeResidentBrowserWebview,
} from "./resident-webviews.js"
import {
  type BrowserTabKind,
  type BrowserTabRecord,
  normalizeBrowserUrl,
  tabsForThread,
} from "./state.js"
import { browserTabsStore, useBrowserTabsState } from "./store.js"

export type BrowserPaneProps = {
  readonly threadId: string
  readonly className?: string
}

const originOf = (url: string): string | null => {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null
  } catch {
    return null
  }
}

const tabLabel = (tab: BrowserTabRecord) =>
  tab.title || (tab.url === "about:blank" ? "" : (originOf(tab.url) ?? tab.url))

/** Keeps the active tab's resident webview aligned with the pane body while it is visible. */
const usePresentedTab = (
  tab: BrowserTabRecord | undefined,
  anchor: React.RefObject<HTMLDivElement | null>,
  clip: React.RefObject<HTMLDivElement | null>
) => {
  const latest = useRef(tab)
  latest.current = tab
  const browserId = tab?.browserId
  const kind = tab?.kind
  const viewportKey = tab ? JSON.stringify(tab.viewport) : ""
  // biome-ignore lint/correctness/useExhaustiveDependencies: kind and viewport rebuild or resize the guest.
  useLayoutEffect(() => {
    const tab = latest.current
    if (!tab || !browserId) return
    ensureResidentBrowserWebview(tab)
    let frame = 0
    let last = ""
    const place = () => {
      const anchorElement = anchor.current
      const clipElement = clip.current
      if (anchorElement && clipElement) {
        const a = anchorElement.getBoundingClientRect()
        const c = clipElement.getBoundingClientRect()
        const key = `${a.left},${a.top},${a.width},${a.height},${c.left},${c.top},${c.width},${c.height}`
        if (key !== last) {
          last = key
          presentBrowserWebview(tab.browserId, anchorElement, clipElement, tab.viewport)
        }
      }
      frame = requestAnimationFrame(place)
    }
    place()
    return () => {
      cancelAnimationFrame(frame)
      parkBrowserWebview(tab.browserId)
    }
  }, [anchor, browserId, clip, kind, viewportKey])
}

export function BrowserPane({ threadId, className }: BrowserPaneProps) {
  const { i18n } = useLingui()
  const state = useBrowserTabsState()
  const tabs = useMemo(() => tabsForThread(state, threadId), [state, threadId])
  const activeId = state.activeByThread[threadId] ?? tabs[0]?.browserId
  const active = tabs.find((tab) => tab.browserId === activeId)
  const anchor = useRef<HTMLDivElement>(null)
  const clip = useRef<HTMLDivElement>(null)
  const address = useRef<HTMLInputElement>(null)
  // Drafts and errors belong to one tab; switching tabs shows that tab's own address.
  const [draftState, setDraftState] = useState<{ browserId?: string; value: string } | null>(null)
  const [errorState, setErrorState] = useState<{ browserId?: string; message: string } | null>(null)
  const draft = draftState?.browserId === active?.browserId ? (draftState?.value ?? null) : null
  const addressError =
    errorState?.browserId === active?.browserId ? (errorState?.message ?? null) : null
  const setDraft = (value: string | null) =>
    setDraftState(value === null ? null : { browserId: active?.browserId, value })
  const setAddressError = (message: string | null) =>
    setErrorState(message === null ? null : { browserId: active?.browserId, message })
  const available = isBrowserAvailable()

  usePresentedTab(active, anchor, clip)

  useEffect(() => {
    if (!active) return
    void window.cypheria?.browser
      ?.setActive({ browserId: active.browserId, threadId })
      .catch(() => undefined)
  }, [active, threadId])

  useEffect(
    () =>
      window.cypheria?.browser?.onReservedShortcut(({ browserId }) => {
        if (browserId !== active?.browserId) return
        address.current?.focus()
        address.current?.select()
      }),
    [active?.browserId]
  )

  const unsupported = i18n._(
    msg({ id: "browser.address.unsupported", message: "Only http and https pages can be opened." })
  )

  const openNew = (kind: BrowserTabKind, url?: string) => {
    const normalized = normalizeBrowserUrl(url)
    if (!normalized) {
      setAddressError(unsupported)
      return
    }
    browserTabsStore.create({
      activate: true,
      kind,
      threadId,
      url: normalized,
      ...(active ? { afterBrowserId: active.browserId } : {}),
    })
  }

  const navigate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const target = normalizeBrowserUrl(draft ?? active?.url)
    if (!target) {
      setAddressError(unsupported)
      return
    }
    setAddressError(null)
    setDraft(null)
    if (!active) {
      openNew("web", target)
      return
    }
    const webview = getResidentBrowserWebview(active.browserId)
    browserTabsStore.patch(active.browserId, { lastError: null, url: target })
    void webview?.loadURL(target).catch(() => undefined)
  }

  const setKind = (kind: BrowserTabKind) => {
    if (!active || active.kind === kind) return
    // A partition cannot change after a guest attaches, so the tab is rebuilt in the new profile.
    browserTabsStore.patch(active.browserId, { kind, lastError: null })
  }

  const close = (browserId: string) => {
    browserTabsStore.remove(browserId)
    removeResidentBrowserWebview(browserId)
  }

  const webview = active ? getResidentBrowserWebview(active.browserId) : null
  const dappOrigin = active?.kind === "dapp" ? originOf(active.url) : null
  const loadError = active?.lastError ?? ""

  if (!available) {
    return (
      <ChatBrowserPanel className={className}>
        <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
          <Trans id="browser.unavailable">
            The browser is available in the main Desktop window.
          </Trans>
        </div>
      </ChatBrowserPanel>
    )
  }

  return (
    <ChatBrowserPanel
      className={className}
      toolbar={
        <>
          <div
            aria-label={i18n._(msg({ id: "browser.tabs", message: "Browser tabs" }))}
            className="flex min-h-9 shrink-0 items-center gap-1 overflow-x-auto border-b px-1.5"
            role="tablist"
          >
            {tabs.map((tab) => (
              <div
                className={cn(
                  "group flex h-7 max-w-44 min-w-0 shrink-0 items-center gap-1.5 rounded-md pl-2 pr-1 text-xs",
                  tab.browserId === active?.browserId
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60"
                )}
                key={tab.browserId}
              >
                <button
                  aria-selected={tab.browserId === active?.browserId}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  onClick={() => browserTabsStore.activate(tab.browserId)}
                  role="tab"
                  type="button"
                >
                  {tab.faviconUrl ? (
                    <img alt="" className="size-3.5 shrink-0" src={tab.faviconUrl} />
                  ) : tab.kind === "dapp" ? (
                    <Wallet aria-hidden="true" className="size-3.5 shrink-0" />
                  ) : (
                    <Globe aria-hidden="true" className="size-3.5 shrink-0" />
                  )}
                  <span className="truncate">
                    {tabLabel(tab) || i18n._(msg({ id: "browser.tab.new", message: "New tab" }))}
                  </span>
                </button>
                <Button
                  aria-label={i18n._(msg({ id: "browser.tab.close", message: "Close tab" }))}
                  className="opacity-60 group-hover:opacity-100"
                  onClick={() => close(tab.browserId)}
                  size="icon-xs"
                  variant="ghost"
                >
                  <X />
                </Button>
              </div>
            ))}
            <Button
              aria-label={i18n._(msg({ id: "browser.tab.open", message: "Open tab" }))}
              onClick={() => openNew("web")}
              size="icon-xs"
              variant="ghost"
            >
              <Plus />
            </Button>
            <Button
              aria-label={i18n._(msg({ id: "browser.tab.openDapp", message: "Open dApp tab" }))}
              onClick={() => openNew("dapp")}
              size="icon-xs"
              title={i18n._(msg({ id: "browser.tab.openDapp", message: "Open dApp tab" }))}
              variant="ghost"
            >
              <WalletMinimal />
            </Button>
          </div>
          <ChatPreviewToolbar>
            <Button
              aria-label={i18n._(msg({ id: "browser.back", message: "Back" }))}
              disabled={!active?.canGoBack}
              onClick={() => webview?.goBack()}
              size="icon-xs"
              variant="ghost"
            >
              <ArrowLeft />
            </Button>
            <Button
              aria-label={i18n._(msg({ id: "browser.forward", message: "Forward" }))}
              disabled={!active?.canGoForward}
              onClick={() => webview?.goForward()}
              size="icon-xs"
              variant="ghost"
            >
              <ArrowRight />
            </Button>
            <Button
              aria-label={
                active?.isLoading
                  ? i18n._(msg({ id: "browser.stop", message: "Stop" }))
                  : i18n._(msg({ id: "browser.reload", message: "Reload" }))
              }
              disabled={!active}
              onClick={() => (active?.isLoading ? webview?.stop() : webview?.reload())}
              size="icon-xs"
              variant="ghost"
            >
              {active?.isLoading ? <X /> : <RotateCw />}
            </Button>
            <form className="min-w-0 flex-1" onSubmit={navigate}>
              <Input
                aria-invalid={addressError ? true : undefined}
                aria-label={i18n._(msg({ id: "browser.address", message: "Address" }))}
                className="h-7 text-xs"
                onChange={(event) => setDraft(event.currentTarget.value)}
                placeholder={i18n._(
                  msg({ id: "browser.address.placeholder", message: "Enter a URL" })
                )}
                ref={address}
                spellCheck={false}
                value={draft ?? (active?.url === "about:blank" ? "" : (active?.url ?? ""))}
              />
            </form>
            <Button
              aria-label={
                active?.kind === "dapp"
                  ? i18n._(msg({ id: "browser.mode.web", message: "Open as web page" }))
                  : i18n._(msg({ id: "browser.mode.dapp", message: "Open as dApp" }))
              }
              aria-pressed={active?.kind === "dapp"}
              disabled={!active}
              onClick={() => setKind(active?.kind === "dapp" ? "web" : "dapp")}
              size="xs"
              title={
                active?.kind === "dapp"
                  ? i18n._(
                      msg({
                        id: "browser.mode.dapp.hint",
                        message: "dApp tabs share a separate profile and can use your wallet.",
                      })
                    )
                  : i18n._(
                      msg({
                        id: "browser.mode.web.hint",
                        message: "Web tabs never receive a wallet.",
                      })
                    )
              }
              variant={active?.kind === "dapp" ? "secondary" : "ghost"}
            >
              <Wallet data-icon="inline-start" />
              dApp
            </Button>
            {window.cypheria?.bootstrap.development && active ? (
              <Button
                aria-label={i18n._(
                  msg({ id: "browser.devtools", message: "Open developer tools" })
                )}
                onClick={() => void window.cypheria?.browser?.openDevTools(active.browserId)}
                size="icon-xs"
                variant="ghost"
              >
                <SquareTerminal />
              </Button>
            ) : null}
          </ChatPreviewToolbar>
          {dappOrigin ? (
            <div className="flex min-h-8 shrink-0 items-center gap-2 border-b px-2.5 text-xs text-muted-foreground">
              <Wallet aria-hidden="true" className="size-3.5" />
              <span className="min-w-0 flex-1 truncate">
                <Trans id="browser.dapp.origin">Wallet requests are scoped to {dappOrigin}</Trans>
              </span>
              <Button
                onClick={() =>
                  void window.cypheria?.browser
                    ?.clearData({ origin: dappOrigin, scope: "dapp-origin" })
                    .catch(() => undefined)
                }
                size="xs"
                variant="ghost"
              >
                <Trash2 data-icon="inline-start" />
                <Trans id="browser.dapp.clearSite">Clear site data</Trans>
              </Button>
            </div>
          ) : null}
          {addressError || loadError ? (
            <div className="shrink-0 border-b px-2.5 py-1.5 text-xs text-destructive">
              {addressError ?? (
                <Trans id="browser.loadFailed">This page could not be loaded: {loadError}</Trans>
              )}
            </div>
          ) : null}
        </>
      }
    >
      <div className="relative size-full min-h-0 overflow-hidden" ref={clip}>
        {active ? (
          <div className="absolute inset-0" ref={anchor} />
        ) : (
          <div className="flex size-full items-center justify-center p-6 text-sm text-muted-foreground">
            <Trans id="browser.empty">Enter a URL to open a page.</Trans>
          </div>
        )}
      </div>
    </ChatBrowserPanel>
  )
}
