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

export function useWorkspaceTerminals(projectId?: string) {
  const [sessions, setSessions] = useState<WorkspaceTerminalSession[]>([])
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openTerminal = useCallback(async () => {
    const api = window.cypheria?.workspaceTerminal
    if (!api || opening) return
    setOpening(true)
    setError(null)
    try {
      const session = await api.open(projectId)
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

  useEffect(
    () => () => {
      void window.cypheria?.workspaceTerminal.closeAll()
    },
    []
  )

  return {
    activeTerminalId,
    closeTerminal,
    error,
    openTerminal,
    opening,
    sessions,
    setActiveTerminalId,
  }
}

export type WorkspaceTerminalsController = ReturnType<typeof useWorkspaceTerminals>

export function WorkspaceTerminalView({
  controller,
  onHide,
  onMove,
  placement = "bottom",
}: Readonly<{
  controller: WorkspaceTerminalsController
  onHide: () => void
  onMove?: () => void
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
  } = controller

  useEffect(() => {
    if (!sessions.length && !opening && !error) void openTerminal()
  }, [error, openTerminal, opening, sessions.length])

  return (
    <section className="grid h-full min-h-0 grid-rows-[36px_minmax(0,1fr)] bg-background">
      <div className="flex min-w-0 items-center justify-between border-b border-border px-1.5">
        <div
          aria-label={i18n._(msg({ id: "chat.workspace.terminalTabs", message: "Terminal tabs" }))}
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
          <Button
            aria-label={i18n._(msg({ id: "chat.workspace.newTerminal", message: "New terminal" }))}
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
              msg({ id: "chat.workspace.hideTerminalPanel", message: "Hide terminal panel" })
            )}
            onClick={onHide}
            size="icon-sm"
            variant="ghost"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="relative min-h-0 bg-zinc-950">
        {sessions.map((session) => (
          <WorkspaceTerminalSurface
            active={session.terminalId === activeTerminalId}
            key={session.terminalId}
            session={session}
          />
        ))}
        {error ? (
          <div className="absolute inset-0 grid place-content-center p-6 text-center text-sm text-red-300">
            {error}
          </div>
        ) : null}
        {!sessions.length && !error ? (
          <div className="absolute inset-0 grid place-content-center text-sm text-zinc-500">
            {opening ? "Opening terminal…" : "Terminal is ready to open."}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function WorkspaceTerminalSurface({
  active,
  session,
}: Readonly<{ active: boolean; session: WorkspaceTerminalSession }>) {
  const container = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    if (!container.current) return
    const instance = new Terminal({
      allowTransparency: true,
      convertEol: true,
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 12,
      theme: { background: "#00000000", foreground: "#d4d4d8" },
    })
    const fitAddon = new FitAddon()
    instance.loadAddon(fitAddon)
    instance.open(container.current)
    terminal.current = instance
    fit.current = fitAddon

    const data = instance.onData((value) => {
      void window.cypheria?.workspaceTerminal.write(session.terminalId, value)
    })
    const unsubscribe = window.cypheria?.workspaceTerminal.onEvent(
      (event: WorkspaceTerminalEvent) => {
        if (event.terminalId !== session.terminalId) return
        if (event.type === "terminal.output") instance.write(event.data)
        else instance.write(`\r\n[process exited: ${event.exitCode}]\r\n`)
      }
    )
    const resize = new ResizeObserver(() => {
      if (!activeRef.current) return
      fitAddon.fit()
      void window.cypheria?.workspaceTerminal.resize(
        session.terminalId,
        instance.cols,
        instance.rows
      )
    })
    resize.observe(container.current)
    requestAnimationFrame(() => fitAddon.fit())
    return () => {
      resize.disconnect()
      unsubscribe?.()
      data.dispose()
      instance.dispose()
      terminal.current = null
      fit.current = null
    }
  }, [session.terminalId])

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
      className={active ? "h-full p-2" : "hidden"}
      ref={container}
      role="tabpanel"
    />
  )
}
