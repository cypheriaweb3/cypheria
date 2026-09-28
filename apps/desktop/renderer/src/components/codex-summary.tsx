import type { ThreadView } from "@cypheria/protocol"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@cypheria/ui/components/alert-dialog"
import {
  ChatSummaryBody,
  ChatSummaryGroup,
  ChatSummaryHeader,
  ChatSummaryMessage,
  type ChatSummaryMode,
  ChatSummaryMore,
  ChatSummaryRow,
  ChatSummaryStaticRow,
  ChatSummarySurface,
} from "@cypheria/ui/components/chat"
import { CloseBoldIcon, PinIcon } from "@cypheria/ui/components/icons"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useEffect, useState } from "react"

import { tabsForScope } from "../browser/state.js"
import { browserTabsStore, useBrowserTabsState } from "../browser/store.js"
import type { SummaryCheckpoint } from "../client-state.js"
import { ensureCypheriaClient } from "../cypheria-client.js"
import { useThreadAttachments } from "../thread-attachments.js"
import type { WorkspaceTerminalsController } from "./workspace-terminal.js"

type Props = {
  thread: ThreadView | null
  open: boolean
  mode: ChatSummaryMode
  checkpoint: SummaryCheckpoint
  onCheckpointChange: (next: SummaryCheckpoint) => void
  onOpenTab: (tabId: string) => void
  onOpenSchedule: () => void
  terminals: WorkspaceTerminalsController
}

export function CodexSummary({
  thread,
  open,
  mode,
  checkpoint,
  onCheckpointChange,
  onOpenTab,
  onOpenSchedule,
  terminals,
}: Props) {
  const { i18n } = useLingui()
  const queryClient = useQueryClient()
  const threadId = thread?.id
  const nativeThreadId = thread?.agentSessionId
  const browserState = useBrowserTabsState()
  const browserTabs = threadId ? tabsForScope(browserState, threadId) : []
  const attachments = useThreadAttachments("pull_request")
  const pullRequests = (attachments.data ?? []).filter(
    (attachment): attachment is Extract<typeof attachment, { attachmentType: "pull_request" }> =>
      attachment.threadId === threadId && attachment.attachmentType === "pull_request"
  )
  const summary = useQuery({
    enabled: open && Boolean(threadId),
    queryKey: ["thread", threadId, "summary"],
    queryFn: async () => (await ensureCypheriaClient()).threads.getSummary(threadId as string),
  })
  const schedules = useQuery({
    enabled: open && Boolean(threadId),
    queryKey: ["thread", threadId, "summary-schedules"],
    queryFn: async () =>
      (await (await ensureCypheriaClient()).schedules.list()).filter(
        (schedule) => schedule.target.type === "thread" && schedule.target.threadId === threadId
      ),
  })
  const processes = useQuery({
    enabled: open && Boolean(nativeThreadId),
    queryKey: ["thread", nativeThreadId, "summary-processes"],
    refetchInterval: open ? 5_000 : false,
    queryFn: async () =>
      (await ensureCypheriaClient()).harnesses.codex.threads.backgroundTerminals.list({
        threadId: nativeThreadId as string,
        limit: 50,
      }),
  })
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})
  const [processError, setProcessError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !threadId) return
    let disposed = false
    let timer: number | undefined
    let unsubscribe: () => void = () => undefined
    const refresh = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ["thread", threadId, "summary"] })
      }, 400)
    }
    void ensureCypheriaClient()
      .then((client) => {
        if (disposed) return
        const appended = client.on("thread.timeline.appended.notification", ({ payload }) => {
          if (payload.threadId === threadId) refresh()
        })
        const replaced = client.on("thread.timeline.replaced.notification", ({ payload }) => {
          if (payload.threadId === threadId) refresh()
        })
        const connection = client.subscribeConnectionStatus((state) => {
          if (state.status === "connected") refresh()
        })
        unsubscribe = () => {
          appended()
          replaced()
          connection()
        }
      })
      .catch(() => undefined)
    return () => {
      disposed = true
      if (timer !== undefined) window.clearTimeout(timer)
      unsubscribe()
    }
  }, [open, queryClient, threadId])

  useEffect(() => {
    if (!open || !threadId) return
    let disposed = false
    let unsubscribe: () => void = () => undefined
    void ensureCypheriaClient()
      .then((client) => {
        if (disposed) return
        const changed = client.on("schedule.changed.notification", () => {
          void queryClient.invalidateQueries({
            queryKey: ["thread", threadId, "summary-schedules"],
          })
        })
        const deleted = client.on("schedule.deleted.notification", () => {
          void queryClient.invalidateQueries({
            queryKey: ["thread", threadId, "summary-schedules"],
          })
        })
        unsubscribe = () => {
          changed()
          deleted()
        }
      })
      .catch(() => undefined)
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [open, queryClient, threadId])

  const group = (
    id: string,
    title: string,
    count: number,
    rows: ReactNode[],
    error?: string | null,
    loading?: boolean
  ) => {
    if (!count && !error && !loading) return null
    const showAll = expandedRows[id] ?? false
    return (
      <ChatSummaryGroup
        count={count}
        expanded={checkpoint.expanded[id] ?? true}
        key={id}
        onExpandedChange={(value) =>
          onCheckpointChange({ ...checkpoint, expanded: { ...checkpoint.expanded, [id]: value } })
        }
        title={title}
      >
        {error ? <ChatSummaryMessage role="alert">{error}</ChatSummaryMessage> : null}
        {loading ? (
          <ChatSummaryMessage role="status">
            {i18n._(msg({ id: "chat.summary.loading", message: "Loading…" }))}
          </ChatSummaryMessage>
        ) : null}
        {showAll ? rows : rows.slice(0, 6)}
        {rows.length > 6 ? (
          <ChatSummaryMore
            onClick={() => setExpandedRows((current) => ({ ...current, [id]: !showAll }))}
          >
            {showAll
              ? i18n._(msg({ id: "chat.summary.showLess", message: "Show less" }))
              : i18n._(msg({ id: "chat.summary.showMore", message: "Show more" }))}
          </ChatSummaryMore>
        ) : null}
      </ChatSummaryGroup>
    )
  }
  const openTab = (id: string) => () => onOpenTab(id)
  const outputRows =
    summary.data?.outputs.entries.map((entry) => (
      <ChatSummaryRow
        detail={entry.detail}
        key={`${entry.itemId}:${entry.label}`}
        onClick={openTab(entry.uri ? (entry.detail === "image" ? "images" : "files") : "review")}
        status={entry.status}
      >
        {entry.label}
      </ChatSummaryRow>
    )) ?? []
  const sourceRows =
    summary.data?.sources.entries.map((entry) => (
      <ChatSummaryRow
        detail={entry.detail}
        key={`${entry.itemId}:${entry.uri}`}
        onClick={openTab("sources")}
      >
        {entry.label}
      </ChatSummaryRow>
    )) ?? []
  const subagentRows =
    summary.data?.subagents.entries.map((entry) => (
      <ChatSummaryRow
        detail={entry.detail}
        key={entry.itemId}
        onClick={openTab("subagents")}
        status={entry.status}
      >
        {entry.label}
      </ChatSummaryRow>
    )) ?? []
  const planRows =
    summary.data?.plan.entries.map((entry) => (
      <ChatSummaryRow
        key={`${entry.itemId}:${entry.label}`}
        onClick={openTab("plan")}
        status={entry.status}
      >
        {entry.label}
      </ChatSummaryRow>
    )) ?? []
  const processRows =
    processes.data?.data.map((process) => (
      <div className="flex items-center" key={process.processId}>
        <ChatSummaryStaticRow
          status={i18n._(msg({ id: "chat.summary.running", message: "Running" }))}
        >
          {process.command}
        </ChatSummaryStaticRow>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <button
                aria-label={`${i18n._(msg({ id: "chat.summary.stop", message: "Stop" }))} ${process.command}`}
                className="rounded p-1 text-xs text-muted-foreground hover:bg-muted"
                type="button"
              />
            }
          >
            <CloseBoldIcon className="size-3" />
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {i18n._(
                  msg({ id: "chat.summary.stopConfirm", message: "Stop background process?" })
                )}
              </AlertDialogTitle>
              <AlertDialogDescription>{process.command}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {i18n._(msg({ id: "chat.summary.cancel", message: "Cancel" }))}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  void (async () => {
                    try {
                      setProcessError(null)
                      await (
                        await ensureCypheriaClient()
                      ).harnesses.codex.threads.backgroundTerminals.terminate({
                        threadId: nativeThreadId as string,
                        processId: process.processId,
                      })
                      await processes.refetch()
                    } catch (error) {
                      setProcessError(error instanceof Error ? error.message : String(error))
                    }
                  })()
                }}
              >
                {i18n._(msg({ id: "chat.summary.stop", message: "Stop" }))}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    )) ?? []
  const terminalRows = terminals.sessions.map((terminal) => (
    <ChatSummaryRow
      detail={terminal.cwd}
      key={terminal.terminalId}
      onClick={() => {
        terminals.setActiveTerminalId(terminal.terminalId)
        onOpenTab("terminal")
      }}
    >
      {terminal.title || terminal.name}
    </ChatSummaryRow>
  ))
  const isEmpty =
    (!threadId || !summary.isPending) &&
    !summary.error &&
    !summary.data?.outputs.count &&
    !summary.data?.sources.count &&
    !summary.data?.subagents.count &&
    !summary.data?.plan.count &&
    !processes.data?.data.length &&
    !terminalRows.length &&
    !pullRequests.length &&
    !schedules.data?.length &&
    !browserTabs.length

  return (
    <ChatSummarySurface mode={mode} open={open} pinned={checkpoint.pinned}>
      <ChatSummaryHeader>
        <span className="min-w-0 flex-1 truncate">
          {i18n._(msg({ id: "chat.panel.summary", message: "Summary" }))}
        </span>
        <button
          aria-label={
            checkpoint.pinned
              ? i18n._(msg({ id: "chat.summary.unpin", message: "Unpin summary" }))
              : i18n._(msg({ id: "chat.summary.pin", message: "Pin summary" }))
          }
          aria-pressed={checkpoint.pinned}
          className="rounded p-1 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => onCheckpointChange({ ...checkpoint, pinned: !checkpoint.pinned })}
          type="button"
        >
          <PinIcon className="size-4" />
        </button>
        <button
          aria-label={i18n._(msg({ id: "chat.summary.close", message: "Close summary" }))}
          className="rounded p-1 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => onCheckpointChange({ ...checkpoint, open: false })}
          type="button"
        >
          <CloseBoldIcon className="size-4" />
        </button>
      </ChatSummaryHeader>
      <ChatSummaryBody>
        {summary.error ? (
          <ChatSummaryMessage role="alert">{summary.error.message}</ChatSummaryMessage>
        ) : null}
        {summary.isPending && threadId ? (
          <ChatSummaryMessage role="status">
            {i18n._(msg({ id: "chat.summary.loading", message: "Loading…" }))}
          </ChatSummaryMessage>
        ) : null}
        {group(
          "outputs",
          i18n._(msg({ id: "chat.summary.outputs", message: "Outputs" })),
          summary.data?.outputs.count ?? 0,
          outputRows
        )}
        {group(
          "sources",
          i18n._(msg({ id: "chat.panel.sources", message: "Sources" })),
          summary.data?.sources.count ?? 0,
          sourceRows
        )}
        {group(
          "subagents",
          i18n._(msg({ id: "chat.panel.subagents", message: "Subagents" })),
          summary.data?.subagents.count ?? 0,
          subagentRows
        )}
        {group(
          "processes",
          i18n._(msg({ id: "chat.summary.processes", message: "Background processes" })),
          (processes.data?.data.length ?? 0) + terminalRows.length,
          [...processRows, ...terminalRows],
          processError ?? processes.error?.message,
          processes.isPending && Boolean(nativeThreadId)
        )}
        {group(
          "plan",
          i18n._(msg({ id: "chat.panel.plan", message: "Plan" })),
          summary.data?.plan.count ?? 0,
          planRows
        )}
        {group(
          "pullRequests",
          i18n._(msg({ id: "chat.summary.pullRequests", message: "Pull requests" })),
          pullRequests.length,
          pullRequests.map((pr) => (
            <ChatSummaryRow
              detail={pr.payload.repository}
              key={pr.identityKey}
              onClick={openTab("review")}
            >
              #{pr.payload.number}
            </ChatSummaryRow>
          )),
          attachments.error?.message,
          attachments.isPending
        )}
        {group(
          "schedules",
          i18n._(msg({ id: "chat.summary.schedules", message: "Schedules" })),
          schedules.data?.length ?? 0,
          schedules.data?.map((schedule) => (
            <ChatSummaryRow key={schedule.id} onClick={onOpenSchedule} status={schedule.status}>
              {schedule.name ?? schedule.cadence.type}
            </ChatSummaryRow>
          )) ?? [],
          schedules.error?.message,
          schedules.isPending && Boolean(threadId)
        )}
        {group(
          "browser",
          i18n._(msg({ id: "chat.panel.browser", message: "Browser" })),
          browserTabs.length,
          browserTabs.map((tab) => (
            <ChatSummaryRow
              detail={
                tab.isLoading
                  ? i18n._(msg({ id: "chat.summary.loading", message: "Loading…" }))
                  : undefined
              }
              key={tab.browserId}
              onClick={() => {
                browserTabsStore.activate(tab.browserId)
                onOpenTab("browser")
              }}
            >
              {tab.title || tab.url}
            </ChatSummaryRow>
          ))
        )}
        {isEmpty ? (
          <ChatSummaryMessage>
            {i18n._(msg({ id: "chat.summary.empty", message: "Nothing to summarize yet" }))}
          </ChatSummaryMessage>
        ) : null}
      </ChatSummaryBody>
    </ChatSummarySurface>
  )
}
