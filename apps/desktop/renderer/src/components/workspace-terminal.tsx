import type { TerminalStream } from "@cypheria/client"
import type { TerminalInfo, TerminalSize } from "@cypheria/protocol"
import { cn } from "@cypheria/ui"
import { Button } from "@cypheria/ui/components/button"
import {
  CloseBoldIcon,
  DockIcon,
  PlusIcon,
  SidebarRightIcon,
  TerminalIcon,
} from "@cypheria/ui/components/icons"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { ensureCypheriaClient } from "../cypheria-client.js"
import { terminalAppearanceFromElement } from "./terminal-appearance.js"
import { normalizeWorkspaceTerminalSize } from "./workspace-terminal-size.js"
import "./workspace-terminal.css"

export function useWorkspaceTerminals(threadId?: string) {
  const [sessions, setSessions] = useState<TerminalInfo[]>([])
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSessions([])
    setActiveTerminalId(null)
    setError(null)
    if (!threadId) return
    let disposed = false
    let unsubscribe: () => void = () => undefined
    void ensureCypheriaClient()
      .then((client) =>
        client.terminals.watchThread(threadId, (next) => {
          if (disposed) return
          setSessions((current) => {
            const byId = new Map(next.map((terminal) => [terminal.terminalId, terminal]))
            const reconciled = current.flatMap((terminal) => {
              const updated = byId.get(terminal.terminalId)
              if (!updated) return []
              byId.delete(terminal.terminalId)
              return [updated]
            })
            return [...reconciled, ...byId.values()]
          })
          setActiveTerminalId((current) => {
            if (current && next.some((terminal) => terminal.terminalId === current)) return current
            return next[0]?.terminalId ?? null
          })
        })
      )
      .then((stop) => {
        if (disposed) stop()
        else unsubscribe = stop
      })
      .catch((cause) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [threadId])

  const openTerminal = useCallback(async () => {
    if (opening || !threadId) return
    setOpening(true)
    setError(null)
    try {
      const terminal = await (await ensureCypheriaClient()).terminals.create({ threadId })
      setActiveTerminalId(terminal.terminalId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setOpening(false)
    }
  }, [opening, threadId])

  const closeTerminal = useCallback(async (terminalId: string) => {
    try {
      await (await ensureCypheriaClient()).terminals.close(terminalId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  return {
    activeTerminalId,
    closeTerminal,
    error,
    openTerminal,
    opening,
    sessions,
    setActiveTerminalId,
    threadId,
  }
}

export type WorkspaceTerminalsController = ReturnType<typeof useWorkspaceTerminals>

export function WorkspaceTerminalView({
  active = true,
  controller,
  onHide,
  onMove,
  openWhenEmpty = true,
  placement = "bottom",
}: Readonly<{
  active?: boolean
  controller: WorkspaceTerminalsController
  onHide: () => void
  onMove?: () => void
  openWhenEmpty?: boolean
  placement?: "bottom" | "right"
}>) {
  const { i18n } = useLingui()
  const {
    activeTerminalId,
    closeTerminal,
    error,
    openTerminal,
    opening,
    sessions,
    setActiveTerminalId,
    threadId,
  } = controller

  useEffect(() => {
    if (active && threadId && openWhenEmpty && !sessions.length && !opening && !error) {
      void openTerminal()
    }
  }, [active, error, openTerminal, openWhenEmpty, opening, sessions.length, threadId])

  return (
    <section
      aria-hidden={!active}
      className={cn(
        "grid h-full min-h-0 grid-rows-[36px_minmax(0,1fr)] bg-background",
        !active && "invisible"
      )}
    >
      <div className="flex min-w-0 items-center justify-between border-b border-border px-1.5">
        <div className="flex min-w-0 flex-1 items-center">
          <div
            aria-label={i18n._(
              msg({ id: "chat.workspace.terminalTabs", message: "Terminal tabs" })
            )}
            className="flex min-w-0 items-center gap-0.5 overflow-x-auto"
            role="tablist"
          >
            {sessions.map((session) => (
              <div
                className={cn(
                  "group/tab flex h-7 max-w-60 shrink-0 items-center rounded-md text-xs",
                  session.terminalId === activeTerminalId
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
                key={session.terminalId}
              >
                <button
                  aria-selected={session.terminalId === activeTerminalId}
                  className="flex min-w-0 items-center gap-1.5 px-2"
                  onClick={() => setActiveTerminalId(session.terminalId)}
                  role="tab"
                  type="button"
                >
                  <TerminalIcon className="size-3.5 shrink-0" />
                  <span className="truncate">{session.name}</span>
                </button>
                <button
                  aria-label={i18n._(
                    msg({ id: "chat.workspace.closeTerminal", message: "Close terminal" })
                  )}
                  className="mr-1 rounded p-0.5 opacity-0 hover:bg-accent group-hover/tab:opacity-100 focus:opacity-100"
                  onClick={() => {
                    if (
                      window.confirm(
                        i18n._(
                          msg({
                            id: "chat.workspace.closeSharedTerminalConfirm",
                            message: "Close this shared terminal for every connected client?",
                          })
                        )
                      )
                    ) {
                      void closeTerminal(session.terminalId)
                    }
                  }}
                  type="button"
                >
                  <CloseBoldIcon className="size-3" />
                </button>
              </div>
            ))}
          </div>
          <Button
            aria-label={i18n._(
              placement === "bottom"
                ? msg({ id: "chat.workspace.openBottomPanelTab", message: "Open bottom panel tab" })
                : msg({ id: "chat.workspace.newTerminal", message: "New terminal" })
            )}
            className="shrink-0"
            disabled={opening || !threadId}
            onClick={() => void openTerminal()}
            size="icon-sm"
            variant="ghost"
          >
            <PlusIcon className="size-3.5" />
          </Button>
        </div>
        <div className="flex shrink-0 items-center">
          {onMove ? (
            <Button
              aria-label={
                placement === "bottom"
                  ? i18n._(
                      msg({
                        id: "chat.workspace.moveTerminalRight",
                        message: "Move terminal right",
                      })
                    )
                  : i18n._(
                      msg({
                        id: "chat.workspace.moveTerminalBottom",
                        message: "Move terminal to bottom",
                      })
                    )
              }
              onClick={onMove}
              size="icon-sm"
              variant="ghost"
            >
              {placement === "bottom" ? (
                <SidebarRightIcon className="size-3.5" />
              ) : (
                <DockIcon className="size-3.5" />
              )}
            </Button>
          ) : null}
          <Button
            aria-label={i18n._(
              placement === "bottom"
                ? sessions.length
                  ? msg({ id: "chat.workspace.hideBottomPanel", message: "Hide bottom panel" })
                  : msg({ id: "chat.workspace.closeBottomPanel", message: "Close" })
                : msg({ id: "chat.workspace.hideTerminalPanel", message: "Hide terminal panel" })
            )}
            onClick={onHide}
            size="icon-sm"
            variant="ghost"
          >
            <CloseBoldIcon className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="relative min-h-0 bg-background">
        {sessions.map((session) => (
          <WorkspaceTerminalSurface
            active={active && session.terminalId === activeTerminalId}
            key={session.terminalId}
            session={session}
          />
        ))}
        {error ? (
          <div className="absolute inset-0 grid place-content-center p-6 text-center text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {!sessions.length && !error ? (
          <div className="absolute inset-0 grid place-content-center text-sm text-muted-foreground">
            {!threadId
              ? i18n._(
                  msg({
                    id: "chat.workspace.saveThreadForTerminal",
                    message: "Save this conversation as a thread to use terminals.",
                  })
                )
              : opening
                ? i18n._(
                    msg({ id: "chat.workspace.openingTerminal", message: "Opening terminal…" })
                  )
                : i18n._(
                    msg({
                      id: "chat.workspace.terminalReady",
                      message: "Terminal is ready to open.",
                    })
                  )}
          </div>
        ) : null}
      </div>
    </section>
  )
}

type TerminalSurfaceSession = {
  cwd: string
  terminalId: string
  title: string | null
  name?: string
}

export function WorkspaceTerminalSurface({
  active,
  onExit,
  session,
}: Readonly<{
  active: boolean
  onExit?: (event: { exitCode: number | null; reason: string; signal: number | null }) => void
  session: TerminalSurfaceSession
}>) {
  const container = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const stream = useRef<TerminalStream | null>(null)
  const activeRef = useRef(active)
  const writingServerData = useRef(0)
  const lastInputClaimAt = useRef(0)
  activeRef.current = active

  useEffect(() => {
    if (!container.current) return
    const appearance = terminalAppearanceFromElement(container.current)
    const instance = new Terminal({
      allowTransparency: true,
      convertEol: true,
      cursorBlink: true,
      fontFamily: appearance.fontFamily,
      fontSize: appearance.fontSize,
      theme: appearance.theme,
    })
    const fitAddon = new FitAddon()
    instance.loadAddon(fitAddon)
    instance.open(container.current)
    terminal.current = instance
    fit.current = fitAddon

    const writeServerData = (data: Uint8Array) => {
      writingServerData.current += 1
      instance.write(data, () => {
        writingServerData.current = Math.max(0, writingServerData.current - 1)
      })
    }
    const data = instance.onData((value) => {
      if (writingServerData.current > 0) return
      const current = stream.current
      if (!current) return
      const now = Date.now()
      if (now - lastInputClaimAt.current > 1_000) {
        lastInputClaimAt.current = now
        const size = normalizeWorkspaceTerminalSize(instance.cols, instance.rows)
        void current
          .resize(size, { claim: true })
          .then(() => current.write(value))
          .catch(() => undefined)
      } else {
        void current.write(value).catch(() => undefined)
      }
    })
    let disposed = false
    void ensureCypheriaClient()
      .then((client) =>
        client.terminals.observe(
          session.terminalId,
          {
            onExit: (event) => {
              instance.write(
                `\r\n[process exited${event.exitCode === null ? "" : `: ${event.exitCode}`}]\r\n`
              )
              onExit?.(event)
            },
            onOutput: writeServerData,
            onRestore: ({ data: restored, start }) => {
              if (start) instance.reset()
              writeServerData(restored)
            },
          },
          { restore: "visible" }
        )
      )
      .then((connected) => {
        if (disposed) void connected.dispose()
        else {
          stream.current = connected
          requestAnimationFrame(() => fitAndResize(true))
        }
      })
      .catch((error) => {
        if (!disposed)
          instance.write(
            `\r\n[terminal unavailable: ${error instanceof Error ? error.message : String(error)}]\r\n`
          )
      })

    let lastSize: TerminalSize | undefined
    const fitAndResize = (claim = false) => {
      if (!activeRef.current) return
      fitAddon.fit()
      const size = normalizeWorkspaceTerminalSize(instance.cols, instance.rows)
      if (!claim && lastSize?.cols === size.cols && lastSize.rows === size.rows) return
      lastSize = size
      void stream.current?.resize(size, { claim }).catch(() => undefined)
    }
    const resize = new ResizeObserver(() => fitAndResize())
    resize.observe(container.current)
    const claim = () => fitAndResize(true)
    container.current.addEventListener("pointerdown", claim)
    const theme = new MutationObserver(() => {
      if (!container.current) return
      const next = terminalAppearanceFromElement(container.current)
      instance.options.fontFamily = next.fontFamily
      instance.options.fontSize = next.fontSize
      instance.options.theme = next.theme
      if (instance.rows > 0) instance.refresh(0, instance.rows - 1)
      requestAnimationFrame(() => fitAndResize())
    })
    theme.observe(document.documentElement, { attributes: true })
    requestAnimationFrame(() => fitAndResize(activeRef.current))
    return () => {
      disposed = true
      container.current?.removeEventListener("pointerdown", claim)
      theme.disconnect()
      resize.disconnect()
      data.dispose()
      void stream.current?.dispose()
      stream.current = null
      instance.dispose()
      terminal.current = null
      fit.current = null
    }
  }, [onExit, session.terminalId])

  useEffect(() => {
    if (!active) return
    requestAnimationFrame(() => {
      fit.current?.fit()
      terminal.current?.focus()
      const instance = terminal.current
      if (instance) {
        void stream.current
          ?.resize(normalizeWorkspaceTerminalSize(instance.cols, instance.rows), { claim: true })
          .catch(() => undefined)
      }
    })
  }, [active])

  const label = session.name ?? session.title ?? "Terminal"
  return (
    <div
      aria-label={`${label} — ${session.cwd}`}
      className={
        active
          ? "cypheria-terminal h-full p-2 font-mono text-[length:var(--font-mono-size)]"
          : "cypheria-terminal hidden font-mono text-[length:var(--font-mono-size)]"
      }
      ref={container}
      role="tabpanel"
    />
  )
}
