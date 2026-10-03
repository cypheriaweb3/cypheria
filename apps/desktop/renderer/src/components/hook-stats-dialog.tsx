import { useState } from "react"
import { Trans } from "@lingui/react/macro"
import { Button } from "@cypheria/ui/components/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@cypheria/ui/components/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@cypheria/ui/components/tooltip"
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  Webhook,
} from "lucide-react"

export type HookRunEntry = {
  kind: "error" | "feedback" | "stop" | "warning"
  text: string
}

export type HookRunRecord = {
  durationMs: number
  entries: HookRunEntry[]
  eventName: string
  id: string
  source: string
  status: "blocked" | "completed" | "failed"
  statusMessage: string | null
}

export type HookStats = {
  blockedCount: number
  count: number
  errorCount: number
  runs: HookRunRecord[]
}

export function HookStatsButton({ stats }: { stats?: HookStats | null }) {
  const [open, setOpen] = useState(false)
  if (!stats || stats.count === 0) return null

  const hasIssues = stats.blockedCount > 0 || stats.errorCount > 0

  return (
    <>
      <Tooltip>
        <TooltipTrigger>
          <div>
            <Button
              aria-label="Hook stats"
              className={`size-7 transition-opacity ${
                hasIssues
                  ? "text-amber-500 hover:text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              size="icon"
              variant="ghost"
              onClick={() => setOpen(true)}
            >
              <Webhook className="size-3.5" />
            </Button>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <Trans id="chat.message.hookStats">Hook stats</Trans>
        </TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Webhook className="size-4" />
              <Trans id="chat.hookStats.dialogTitle">Hook stats</Trans>
            </DialogTitle>
          </DialogHeader>

          {/* Summary numbers */}
          <div className="grid grid-cols-3 gap-3 border-y border-border py-3 text-center text-sm">
            <div>
              <div className="text-muted-foreground text-xs">
                <Trans id="chat.hookStats.runs">Runs</Trans>
              </div>
              <div className="font-semibold text-foreground text-lg">{stats.count}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">
                <Trans id="chat.hookStats.blocked">Blocked</Trans>
              </div>
              <div
                className={`font-semibold text-lg ${stats.blockedCount > 0 ? "text-amber-500" : "text-foreground"}`}
              >
                {stats.blockedCount}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">
                <Trans id="chat.hookStats.failed">Failed</Trans>
              </div>
              <div
                className={`font-semibold text-lg ${stats.errorCount > 0 ? "text-destructive" : "text-foreground"}`}
              >
                {stats.errorCount}
              </div>
            </div>
          </div>

          {/* History list */}
          <div className="flex-1 overflow-y-auto space-y-2 py-2 pr-1">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              <Trans id="chat.hookStats.runHistory">Run History</Trans>
            </div>
            {stats.runs.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                <Trans id="chat.hookStats.noRuns">No hook runs recorded for this turn.</Trans>
              </div>
            ) : (
              stats.runs.map((run) => <HookRunItem key={run.id} run={run} />)
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function HookRunItem({ run }: { run: HookRunRecord }) {
  const [expanded, setExpanded] = useState(false)

  const statusIcon =
    run.status === "completed" ? (
      <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
    ) : run.status === "blocked" ? (
      <ShieldAlert className="size-4 text-amber-500 shrink-0" />
    ) : (
      <AlertCircle className="size-4 text-destructive shrink-0" />
    )

  return (
    <div className="rounded-md border border-border bg-card p-2.5 text-xs">
      <div
        className="flex items-center justify-between cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 min-w-0">
          {statusIcon}
          <span className="font-mono font-medium text-foreground">{run.eventName}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase">
            {run.source}
          </span>
          <span className="text-muted-foreground text-[10px]">{run.durationMs}ms</span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <span className="capitalize">{run.status}</span>
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </div>
      </div>

      {expanded ? (
        <div className="mt-2.5 pt-2 border-t border-border/60 space-y-2">
          {run.statusMessage ? (
            <div className="text-muted-foreground font-mono bg-muted/40 p-2 rounded text-[11px] whitespace-pre-wrap break-words">
              {run.statusMessage}
            </div>
          ) : null}

          {run.entries.map((entry, idx) => (
            <div
              key={idx}
              className={`p-2 rounded font-mono text-[11px] whitespace-pre-wrap break-words ${
                entry.kind === "error"
                  ? "bg-destructive/10 text-destructive border border-destructive/20"
                  : entry.kind === "warning" || entry.kind === "stop"
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                    : "bg-muted/30 text-foreground"
              }`}
            >
              {entry.text}
            </div>
          ))}

          {run.entries.length === 0 && !run.statusMessage ? (
            <div className="text-muted-foreground italic text-[11px]">
              <Trans id="chat.hookStats.noOutput">
                Hook executed with no stdout/stderr output.
              </Trans>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
