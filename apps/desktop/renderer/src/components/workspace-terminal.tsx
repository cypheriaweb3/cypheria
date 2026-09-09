import { cn } from "@cypheria/ui"
import { Button } from "@cypheria/ui/components/button"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { PanelBottomOpen, PanelRightOpen, Plus, TerminalSquare, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { WorkspaceTerminalEvent, WorkspaceTerminalSession } from "../../../ipc/src/index.js"
import { terminalAppearanceFromElement } from "./terminal-appearance.js"
import { normalizeWorkspaceTerminalSize } from "./workspace-terminal-size.js"
import "./workspace-terminal.css"

const terminalReplayLimit = 1_000_000

const terminalEventText = (event: WorkspaceTerminalEvent): string =>
  event.type === "terminal.output" ? event.data : `\r\n[process exited: ${event.exitCode}]\r\n`

export function useWorkspaceTerminals(projectId?: string) {
  const [sessions, setSessions] = useState<WorkspaceTerminalSession[]>([])
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const replayByTerminal = useRef(new Map<string, string>())

  const openTerminal = useCallback(async () => {
    const api = window.cypheria?.workspaceTerminal
    if (!api || opening) return
    setOpening(true)
    setError(null)
    try {
      const session = await api.open(projectId)
      replayByTerminal.current.set(session.terminalId, "")
      setSessions((current) => {
        const number = current.filter((item) => item.title.startsWith(session.title)).length + 1
        return [
          ...current,
          { ...session, title: number === 1 ? session.title : `${session.title} ${number}` },
        ]
      })
      setActiveTerminalId(session.terminalId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setOpening(false)
    }
  }, [opening, projectId])

  const closeTerminal = useCallback(async (terminalId: string) => {
    await window.cypheria?.workspaceTerminal.close(terminalId)
    replayByTerminal.current.delete(terminalId)
    setSessions((current) => {
      const index = current.findIndex((session) => session.terminalId === terminalId)
      const next = current.filter((session) => session.terminalId !== terminalId)
      setActiveTerminalId((active) =>
        active === terminalId
          ? (next[Math.min(index, next.length - 1)]?.terminalId ?? null)
          : active
      )
      return next
    })
  }, [])

  const getTerminalReplay = useCallback(
    (terminalId: string) => replayByTerminal.current.get(terminalId) ?? "",
    []
  )

  useEffect(
    () =>
      window.cypheria?.workspaceTerminal.onEvent((event) => {
        const current = replayByTerminal.current.get(event.terminalId)
        if (current === undefined) return
        const next = `${current}${terminalEventText(event)}`
        replayByTerminal.current.set(
          event.terminalId,
          next.length > terminalReplayLimit ? next.slice(-terminalReplayLimit) : next
        )
      }),
    []
  )

  useEffect(
    () => () => {
      replayByTerminal.current.clear()
      void window.cypheria?.workspaceTerminal.closeAll()
    },
    []
  )

  return {
    activeTerminalId,
    closeTerminal,
    error,
    getTerminalReplay,
    openTerminal,
    opening,
    sessions,
    setActiveTerminalId,
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
    getTerminalReplay,
    openTerminal,
    opening,
    sessions,
    setActiveTerminalId,
  } = controller

  useEffect(() => {
    if (active && openWhenEmpty && !sessions.length && !opening && !error) void openTerminal()
  }, [active, error, openTerminal, openWhenEmpty, opening, sessions.length])

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
                  <TerminalSquare className="size-3.5 shrink-0" />
                  <span className="truncate">{session.title}</span>
                </button>
                <button
                  aria-label={i18n._(
                    msg({ id: "chat.workspace.closeTerminal", message: "Close terminal" })
                  )}
                  className="mr-1 rounded p-0.5 opacity-0 hover:bg-accent group-hover/tab:opacity-100 focus:opacity-100"
                  onClick={() => void closeTerminal(session.terminalId)}
                  type="button"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
          <Button
            aria-label={i18n._(
              placement === "bottom"
                ? msg({
                    id: "chat.workspace.openBottomPanelTab",
                    message: "Open bottom panel tab",
                  })
                : msg({ id: "chat.workspace.newTerminal", message: "New terminal" })
            )}
            className="shrink-0"
            disabled={opening}
            onClick={() => void openTerminal()}
            size="icon-sm"
            variant="ghost"
          >
            <Plus className="size-3.5" />
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
                <PanelRightOpen className="size-3.5" />
              ) : (
                <PanelBottomOpen className="size-3.5" />
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
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="relative min-h-0 bg-background">
        {sessions.map((session) => (
          <WorkspaceTerminalSurface
            active={active && session.terminalId === activeTerminalId}
            getReplay={getTerminalReplay}
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
            {opening ? "Opening terminal…" : "Terminal is ready to open."}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function WorkspaceTerminalSurface({
  active,
  getReplay,
  session,
}: Readonly<{
  active: boolean
  getReplay: (terminalId: string) => string
  session: WorkspaceTerminalSession
}>) {
  const container = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const activeRef = useRef(active)
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
    const replay = getReplay(session.terminalId)
    if (replay) instance.write(replay)
    terminal.current = instance
    fit.current = fitAddon

    const data = instance.onData((value) => {
      void window.cypheria?.workspaceTerminal.write(session.terminalId, value)
    })
    const unsubscribe = window.cypheria?.workspaceTerminal.onEvent(
      (event: WorkspaceTerminalEvent) => {
        if (event.terminalId !== session.terminalId) return
        instance.write(terminalEventText(event))
      }
    )
    let lastSize: { cols: number; rows: number } | undefined
    const fitAndResize = () => {
      if (!activeRef.current) return
      fitAddon.fit()
      const size = normalizeWorkspaceTerminalSize(instance.cols, instance.rows)
      if (lastSize?.cols === size.cols && lastSize.rows === size.rows) return
      lastSize = size
      void window.cypheria?.workspaceTerminal
        .resize(session.terminalId, size.cols, size.rows)
        .catch(() => undefined)
    }
    const resize = new ResizeObserver(fitAndResize)
    resize.observe(container.current)
    const theme = new MutationObserver(() => {
      if (!container.current) return
      const appearance = terminalAppearanceFromElement(container.current)
      instance.options.fontFamily = appearance.fontFamily
      instance.options.fontSize = appearance.fontSize
      instance.options.theme = appearance.theme
      if (instance.rows > 0) instance.refresh(0, instance.rows - 1)
      requestAnimationFrame(fitAndResize)
    })
    theme.observe(document.documentElement, { attributes: true })
    requestAnimationFrame(fitAndResize)
    return () => {
      theme.disconnect()
      resize.disconnect()
      unsubscribe?.()
      data.dispose()
      instance.dispose()
      terminal.current = null
      fit.current = null
    }
  }, [getReplay, session.terminalId])

  useEffect(() => {
    if (!active) return
    requestAnimationFrame(() => {
      fit.current?.fit()
      terminal.current?.focus()
    })
  }, [active])

  return (
    <div
      aria-label={`${session.title} — ${session.cwd}`}
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
