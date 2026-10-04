import type { HookSource, HookTrustStatus, HookView } from "@cypheria/protocol"
import { Alert, AlertDescription, AlertTitle } from "@cypheria/ui/components/alert"
import { Badge } from "@cypheria/ui/components/badge"
import { Button } from "@cypheria/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cypheria/ui/components/dialog"
import { Input } from "@cypheria/ui/components/input"
import { Switch } from "@cypheria/ui/components/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@cypheria/ui/components/tooltip"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  FileCode,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Webhook,
} from "lucide-react"
import { useMemo, useState } from "react"

import { ensureCypheriaClient } from "../cypheria-client.js"
import { SettingsFrame } from "./settings-frame.js"

type SourceFilter = "all" | "project" | "plugin" | "user" | "admin"

const isReviewNeeded = (status: HookTrustStatus): boolean =>
  status === "untrusted" || status === "modified"

const formatSourceLabel = (source: HookSource): string => {
  switch (source) {
    case "project":
      return "Project"
    case "plugin":
      return "Plugin"
    case "user":
      return "User"
    case "system":
    case "mdm":
    case "cloudRequirements":
    case "cloudManagedConfig":
    case "legacyManagedConfigFile":
    case "legacyManagedConfigMdm":
      return "Managed"
    default:
      return source
  }
}

export function HooksPage() {
  const { i18n } = useLingui()
  const queryClient = useQueryClient()
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedHook, setSelectedHook] = useState<HookView | null>(null)

  const { data, error, isFetching, isLoading, refetch } = useQuery({
    queryFn: async () => {
      const client = await ensureCypheriaClient()
      return client.integrations.hooks.list({ agentId: "codex" })
    },
    queryKey: ["hooks", "list"],
    retry: 1,
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ enabled, key }: { key: string; enabled: boolean }) => {
      const client = await ensureCypheriaClient()
      await client.integrations.hooks.setEnabled({ agentId: "codex", enabled, key })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hooks"] }),
  })

  const trustMutation = useMutation({
    mutationFn: async ({ currentHash, key }: { key: string; currentHash: string }) => {
      const client = await ensureCypheriaClient()
      await client.integrations.hooks.trust({ agentId: "codex", key, trustedHash: currentHash })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hooks"] }),
  })

  const hooks = data?.hooks ?? []
  const reviewCount = useMemo(
    () => hooks.filter((h: HookView) => isReviewNeeded(h.trustStatus)).length,
    [hooks]
  )

  const filteredHooks = useMemo(() => {
    return hooks.filter((hook: HookView) => {
      if (sourceFilter !== "all") {
        if (sourceFilter === "admin") {
          const isManagedSource =
            hook.source === "system" ||
            hook.source === "mdm" ||
            hook.source === "cloudRequirements" ||
            hook.source === "cloudManagedConfig" ||
            hook.source === "legacyManagedConfigFile" ||
            hook.source === "legacyManagedConfigMdm"
          if (!isManagedSource && !hook.isManaged) return false
        } else if (hook.source !== sourceFilter) {
          return false
        }
      }
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase()
        const matchKey = hook.key.toLowerCase().includes(query)
        const matchEvent = hook.eventName.toLowerCase().includes(query)
        const matchCmd = hook.command?.toLowerCase().includes(query)
        const matchMcp =
          hook.mcpServer?.toLowerCase().includes(query) ||
          hook.mcpTool?.toLowerCase().includes(query)
        const matchMatcher = hook.matcher?.toLowerCase().includes(query)
        const matchPath = hook.sourcePath.toLowerCase().includes(query)
        if (!matchKey && !matchEvent && !matchCmd && !matchMcp && !matchMatcher && !matchPath) {
          return false
        }
      }
      return true
    })
  }, [hooks, sourceFilter, searchQuery])

  // Group hooks by eventName
  const groupedHooks = useMemo(() => {
    const groups = new Map<string, HookView[]>()
    for (const hook of filteredHooks) {
      const list = groups.get(hook.eventName) ?? []
      list.push(hook)
      groups.set(hook.eventName, list)
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [filteredHooks])

  return (
    <SettingsFrame wide>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Webhook className="size-6 text-foreground" />
              <h1 className="font-semibold text-2xl tracking-tight">
                <Trans id="settings.hooks.title">Lifecycle Hooks</Trans>
              </h1>
            </div>
            <p className="text-muted-foreground text-sm">
              <Trans id="settings.hooks.description">
                Intercept and extend Agent turns, tool calls, and lifecycle events using custom
                scripts or MCP tools.
              </Trans>
            </p>
          </div>
          <Button
            className="gap-2"
            disabled={isFetching || isLoading}
            size="sm"
            variant="outline"
            onClick={() => void refetch()}
          >
            <RefreshCw className={isFetching ? "size-4 animate-spin" : "size-4"} />
            <Trans id="settings.hooks.refresh">Refresh</Trans>
          </Button>
        </div>

        {/* Review Needed Alert Banner */}
        {reviewCount > 0 ? (
          <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-200">
            <ShieldAlert className="size-5 text-amber-600 dark:text-amber-400" />
            <div className="flex-1">
              <AlertTitle className="font-medium text-amber-900 dark:text-amber-200">
                <Trans id="settings.hooks.reviewBanner.title">
                  {reviewCount} {reviewCount === 1 ? "hook needs" : "hooks need"} review
                </Trans>
              </AlertTitle>
              <AlertDescription className="text-amber-800/90 dark:text-amber-300/90 text-sm">
                <Trans id="settings.hooks.reviewBanner.description">
                  New or modified hooks must be reviewed and trusted before Codex will run them.
                  Inspect the command or tool below, then click Trust to authorize execution.
                </Trans>
              </AlertDescription>
            </div>
          </Alert>
        ) : null}

        {/* Global Errors or Warnings from hooks discovery */}
        {data?.errors?.length ? (
          <Alert variant="destructive">
            <AlertTriangle className="size-5" />
            <AlertTitle>
              <Trans id="settings.hooks.loadErrors.title">Configuration Errors</Trans>
            </AlertTitle>
            <AlertDescription className="space-y-1 text-sm">
              {data.errors.map((err: { message: string; path: string | null }, idx: number) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: load errors are a static list and may repeat
                <div key={idx}>
                  {err.path ? <span className="font-mono">{err.path}: </span> : null}
                  {err.message}
                </div>
              ))}
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertTriangle className="size-5" />
            <AlertTitle>
              <Trans id="settings.hooks.error.title">Failed to load hooks</Trans>
            </AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        ) : null}

        {/* Controls: Search and Source Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
            {(
              [
                {
                  id: "all",
                  label: i18n._(msg({ id: "settings.hooks.filter.all", message: "All" })),
                },
                {
                  id: "project",
                  label: i18n._(msg({ id: "settings.hooks.filter.project", message: "Project" })),
                },
                {
                  id: "plugin",
                  label: i18n._(msg({ id: "settings.hooks.filter.plugin", message: "Plugins" })),
                },
                {
                  id: "user",
                  label: i18n._(msg({ id: "settings.hooks.filter.user", message: "User" })),
                },
                {
                  id: "admin",
                  label: i18n._(msg({ id: "settings.hooks.filter.managed", message: "Managed" })),
                },
              ] as const
            ).map((filter) => (
              <button
                key={filter.id}
                className={`rounded-md px-3 py-1.5 font-medium text-xs transition-colors ${
                  sourceFilter === filter.id
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                type="button"
                onClick={() => setSourceFilter(filter.id)}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className="relative min-w-[240px] flex-1 max-w-sm">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-9 text-xs"
              placeholder={i18n._(
                msg({ id: "settings.hooks.searchPlaceholder", message: "Filter hooks..." })
              )}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Hooks List */}
        {isLoading ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground text-sm">
            <RefreshCw className="mr-2 size-4 animate-spin" />
            <Trans id="settings.hooks.loading">Discovering configured hooks...</Trans>
          </div>
        ) : groupedHooks.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center">
            <Code2 className="mb-3 size-10 text-muted-foreground/60" />
            <h3 className="font-semibold text-foreground text-base">
              <Trans id="settings.hooks.empty.title">No hooks found</Trans>
            </h3>
            <p className="mt-1 max-w-sm text-muted-foreground text-xs">
              <Trans id="settings.hooks.empty.desc">
                Hooks can be configured in ~/.codex/hooks.json, in your project's .codex/ directory,
                or bundled within enabled plugins.
              </Trans>
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {groupedHooks.map(([eventName, eventHooks]) => (
              <div key={eventName} className="space-y-3">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-foreground text-sm">{eventName}</h2>
                  <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {eventHooks.length}
                  </span>
                </div>

                <div className="grid gap-3">
                  {eventHooks.map((hook) => (
                    <HookCard
                      key={hook.key}
                      hook={hook}
                      isTrusting={trustMutation.isPending}
                      onSelect={() => setSelectedHook(hook)}
                      onToggle={(enabled) => toggleMutation.mutate({ enabled, key: hook.key })}
                      onTrust={() =>
                        trustMutation.mutate({ currentHash: hook.currentHash, key: hook.key })
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Hook Detail Dialog */}
        <HookDetailDialog
          hook={selectedHook}
          open={Boolean(selectedHook)}
          onClose={() => setSelectedHook(null)}
          onTrust={(hook) => {
            trustMutation.mutate({ currentHash: hook.currentHash, key: hook.key })
            setSelectedHook(null)
          }}
        />
      </div>
    </SettingsFrame>
  )
}

function HookCard({
  hook,
  onToggle,
  onTrust,
  onSelect,
  isTrusting,
}: {
  hook: HookView
  onToggle: (enabled: boolean) => void
  onTrust: () => void
  onSelect: () => void
  isTrusting: boolean
}) {
  const needsReview = isReviewNeeded(hook.trustStatus)

  return (
    <div
      className={`group relative flex flex-col gap-3 rounded-xl border p-4 transition-colors ${
        needsReview
          ? "border-amber-500/40 bg-amber-500/5 hover:border-amber-500/60"
          : "border-border bg-card hover:border-border/80"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Handler Type Badge */}
          <Badge className="gap-1 font-mono text-[11px]" variant="secondary">
            {hook.handlerType === "command" ? (
              <>
                <Terminal className="size-3" />
                command
              </>
            ) : hook.handlerType === "mcpTool" ? (
              <>
                <Code2 className="size-3" />
                mcp_tool
              </>
            ) : (
              hook.handlerType
            )}
          </Badge>

          {/* Matcher Badge */}
          {hook.matcher ? (
            <Badge className="font-mono text-[11px]" variant="outline">
              matcher: {hook.matcher}
            </Badge>
          ) : null}

          {/* Source Badge */}
          <Badge className="text-[11px]" variant="outline">
            {formatSourceLabel(hook.source)}
            {hook.pluginId ? ` (${hook.pluginId})` : ""}
          </Badge>

          {/* Async Indicator */}
          {hook.async ? (
            <Badge className="text-[11px]" variant="outline">
              async
            </Badge>
          ) : null}

          {/* Trust Status Badge */}
          {hook.isManaged ? (
            <span className="inline-flex items-center gap-1 font-medium text-[11px] text-blue-600 dark:text-blue-400">
              <Lock className="size-3" />
              Managed
            </span>
          ) : hook.trustStatus === "trusted" ? (
            <span className="inline-flex items-center gap-1 font-medium text-[11px] text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-3" />
              Trusted
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 font-medium text-[11px] text-amber-600 dark:text-amber-400">
              <ShieldAlert className="size-3" />
              {hook.trustStatus === "modified" ? "Modified" : "Needs Review"}
            </span>
          )}
        </div>

        {/* Actions: Trust button and Enable Switch */}
        <div className="flex items-center gap-3">
          {needsReview ? (
            <Button
              className="h-7 gap-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs dark:bg-amber-500 dark:hover:bg-amber-600"
              disabled={isTrusting}
              size="sm"
              onClick={onTrust}
            >
              <ShieldCheck className="size-3.5" />
              <Trans id="settings.hooks.trustButton">Trust</Trans>
            </Button>
          ) : null}

          <Tooltip>
            <TooltipTrigger>
              <div>
                <Switch
                  aria-label={hook.key}
                  checked={hook.enabled}
                  disabled={hook.isManaged}
                  onCheckedChange={onToggle}
                />
              </div>
            </TooltipTrigger>
            {hook.isManaged ? (
              <TooltipContent>Managed hooks cannot be disabled locally.</TooltipContent>
            ) : null}
          </Tooltip>
        </div>
      </div>

      {/* Command or Tool Display */}
      <button
        className="block w-full cursor-pointer rounded-lg bg-muted/60 p-2.5 text-left font-mono text-xs text-foreground transition-colors hover:bg-muted/90"
        type="button"
        onClick={onSelect}
      >
        {hook.handlerType === "command" ? (
          <div className="truncate">{hook.command ?? "(no command specified)"}</div>
        ) : hook.handlerType === "mcpTool" ? (
          <div className="truncate">
            {hook.mcpServer} / {hook.mcpTool}
          </div>
        ) : (
          <div className="text-muted-foreground">(unsupported handler type)</div>
        )}
      </button>

      {/* Meta Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5 truncate">
          <FileCode className="size-3 shrink-0" />
          <span className="truncate" title={hook.sourcePath}>
            {hook.sourcePath}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {hook.statusMessage ? <span className="italic">"{hook.statusMessage}"</span> : null}
          <span>timeout: {hook.timeoutSec}s</span>
          <button className="text-foreground hover:underline" type="button" onClick={onSelect}>
            Details
          </button>
        </div>
      </div>
    </div>
  )
}

function HookDetailDialog({
  hook,
  open,
  onClose,
  onTrust,
}: {
  hook: HookView | null
  open: boolean
  onClose: () => void
  onTrust: (hook: HookView) => void
}) {
  if (!hook) return null
  const needsReview = isReviewNeeded(hook.trustStatus)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Webhook className="size-4" />
            {hook.eventName} Hook Details
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">{hook.key}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-xs">
          {needsReview ? (
            <Alert className="border-amber-500/40 bg-amber-500/10">
              <ShieldAlert className="size-4 text-amber-600" />
              <AlertTitle className="text-xs font-medium text-amber-900 dark:text-amber-200">
                Security Review Required
              </AlertTitle>
              <AlertDescription className="text-[11px] text-amber-800 dark:text-amber-300">
                This hook has not been authorized. Ensure you inspect and trust the command and file
                source before approving.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-1">
            <span className="font-semibold text-muted-foreground">Execution Command / Target:</span>
            <div className="rounded-md bg-muted p-2 font-mono text-xs break-all">
              {hook.command ?? `${hook.mcpServer} / ${hook.mcpTool}`}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="font-semibold text-muted-foreground">Handler Type:</span>
              <p className="font-mono">{hook.handlerType}</p>
            </div>
            <div>
              <span className="font-semibold text-muted-foreground">Execution Mode:</span>
              <p className="font-mono">{hook.async ? "Background (async)" : "Synchronous"}</p>
            </div>
            <div>
              <span className="font-semibold text-muted-foreground">Event Name:</span>
              <p className="font-mono">{hook.eventName}</p>
            </div>
            <div>
              <span className="font-semibold text-muted-foreground">Matcher:</span>
              <p className="font-mono">{hook.matcher ?? "(none - matches all)"}</p>
            </div>
            <div>
              <span className="font-semibold text-muted-foreground">Source Layer:</span>
              <p className="capitalize">{formatSourceLabel(hook.source)}</p>
            </div>
            <div>
              <span className="font-semibold text-muted-foreground">Timeout:</span>
              <p>{hook.timeoutSec} seconds</p>
            </div>
          </div>

          <div className="space-y-1">
            <span className="font-semibold text-muted-foreground">Source File Path:</span>
            <div className="rounded-md bg-muted/60 p-1.5 font-mono text-[11px] break-all">
              {hook.sourcePath}
            </div>
          </div>

          <div className="space-y-1">
            <span className="font-semibold text-muted-foreground">SHA-256 Current Hash:</span>
            <div className="rounded-md bg-muted/60 p-1.5 font-mono text-[11px] break-all">
              {hook.currentHash}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {needsReview ? (
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white dark:bg-amber-500"
              onClick={() => onTrust(hook)}
            >
              <ShieldCheck className="mr-1.5 size-4" />
              Trust This Hook
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
