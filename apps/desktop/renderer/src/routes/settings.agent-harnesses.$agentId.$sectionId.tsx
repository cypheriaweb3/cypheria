import { isAgentUpdateAvailable } from "@cypheria/client"
import type {
  AgentId,
  AgentOperation,
  AgentView,
  HarnessCatalogSnapshot,
  HarnessSettingSection,
  HarnessSettingValue,
} from "@cypheria/protocol"
import { Alert, AlertDescription, AlertTitle } from "@cypheria/ui/components/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@cypheria/ui/components/alert-dialog"
import { Badge } from "@cypheria/ui/components/badge"
import { Button } from "@cypheria/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cypheria/ui/components/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cypheria/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@cypheria/ui/components/dropdown-menu"
import { Field, FieldDescription, FieldLabel } from "@cypheria/ui/components/field"
import { Input } from "@cypheria/ui/components/input"
import { Progress, ProgressLabel, ProgressValue } from "@cypheria/ui/components/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cypheria/ui/components/select"
import { Skeleton } from "@cypheria/ui/components/skeleton"
import { Switch } from "@cypheria/ui/components/switch"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  Download,
  ExternalLink,
  LoaderCircle,
  MoreHorizontal,
  RefreshCw,
  RotateCw,
  Trash2,
  TriangleAlert,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { waitForAgentOperation } from "../components/agent-operation"
import { AuthenticationSection } from "../components/harness-authentication-section"
import { HarnessIcon } from "../components/harness-icon"
import { NetworkProxyCard } from "../components/network-proxy-card"
import { SettingsFrame } from "../components/settings-frame"
import { ensureCypheriaClient } from "../cypheria-client.js"

export const Route = createFileRoute("/settings/agent-harnesses/$agentId/$sectionId")({
  component: AgentHarnessSettingsRoute,
})

const baseSections = [
  { id: "authentication", label: "Authentication" },
  { id: "models", label: "Models" },
]

const agentOperationsQueryKey = ["cypheria", "agent-operations"] as const
const operationInProgress = ({ status }: AgentOperation) =>
  status === "queued" || status === "running"

const upsertAgentOperation = (
  operations: AgentOperation[] | undefined,
  operation: AgentOperation
): AgentOperation[] => [
  ...(operations ?? []).filter((candidate) => candidate.id !== operation.id),
  operation,
]

function AgentHarnessSettingsRoute() {
  const { agentId: routeAgentId, sectionId } = Route.useParams()
  const navigate = useNavigate()
  const agentsQuery = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).agents.list(),
    queryKey: ["cypheria", "agents"],
  })
  const agent = agentsQuery.data?.agents.find((item) => item.id === routeAgentId)
  const agentId = (agent?.id ?? "codex") as AgentId
  const catalogQuery = useQuery({
    enabled: Boolean(agent?.installed && agent.enabled) && sectionId !== "authentication",
    queryFn: async () => (await ensureCypheriaClient()).harnesses.settings.get({ agentId }),
    queryKey: ["harness", agentId, "catalog"],
  })
  const sections = useMemo(
    () => [
      ...baseSections,
      ...(catalogQuery.data?.settingSections ?? []).map(({ id, label }) => ({ id, label })),
    ],
    [catalogQuery.data?.settingSections]
  )

  useEffect(() => {
    if (!agentsQuery.data) return
    if (!agent) {
      void navigate({
        params: { agentId: "codex", sectionId: "authentication" },
        replace: true,
        to: "/settings/agent-harnesses/$agentId/$sectionId",
      })
      return
    }
    if (!sections.some((item) => item.id === sectionId) && !catalogQuery.isLoading) {
      void navigate({
        params: { agentId, sectionId: sections[0]?.id ?? "authentication" },
        replace: true,
        to: "/settings/agent-harnesses/$agentId/$sectionId",
      })
    }
  }, [agent, agentId, agentsQuery.data, catalogQuery.isLoading, navigate, sectionId, sections])

  return (
    <SettingsFrame wide>
      <NetworkProxyCard />
      {agentsQuery.isLoading || !agent ? (
        <Skeleton className="mt-4 h-96 w-full" />
      ) : (
        <div className="mt-4 grid gap-6">
          <header className="flex items-start gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border bg-card">
              <HarnessIcon
                agentId={agent.id}
                className="size-8"
                icon={agent.icon}
                name={agent.name}
              />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold">{agent.name}</h1>
                <Badge className="tabular-nums" variant="secondary">
                  v{agent.version}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{agent.description}</p>
            </div>
            <HarnessMaintenanceActions agent={agent} key={agent.id} />
          </header>
          {!agent.installed || !agent.enabled ? (
            <section className="min-w-0">
              {!agent.installed ? <InstallRequired agent={agent} key={agent.id} /> : null}
              {agent.installed && !agent.enabled ? (
                <EnableRequired agent={agent} key={agent.id} />
              ) : null}
            </section>
          ) : (
            <div className="grid min-h-[520px] gap-6 md:grid-cols-[190px_minmax(0,1fr)]">
              <Select
                value={sectionId}
                onValueChange={(value) =>
                  void navigate({
                    params: { agentId, sectionId: String(value) },
                    to: "/settings/agent-harnesses/$agentId/$sectionId",
                  })
                }
              >
                <SelectTrigger className="md:hidden">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sections.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <nav
                aria-label={`${agent.name} settings`}
                className="cypheria-scrollbar hidden max-h-[70vh] content-start gap-1 overflow-y-auto md:grid"
              >
                {sections.map((item) => (
                  <button
                    className={
                      item.id === sectionId
                        ? "rounded-md bg-muted px-3 py-2 text-left text-sm font-medium"
                        : "rounded-md px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    }
                    key={item.id}
                    type="button"
                    onClick={() =>
                      void navigate({
                        params: { agentId, sectionId: item.id },
                        to: "/settings/agent-harnesses/$agentId/$sectionId",
                      })
                    }
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
              <section className="min-w-0">
                {sectionId === "authentication" ? <AuthenticationSection agent={agent} /> : null}
                {sectionId === "models" ? (
                  <ModelsSection agentId={agentId} snapshot={catalogQuery.data} />
                ) : null}
                {!baseSections.some((item) => item.id === sectionId) ? (
                  <SettingsSection
                    agentId={agentId}
                    section={catalogQuery.data?.settingSections.find(
                      (item) => item.id === sectionId
                    )}
                    loading={catalogQuery.isLoading}
                  />
                ) : null}
              </section>
            </div>
          )}
        </div>
      )}
    </SettingsFrame>
  )
}

function HarnessMaintenanceActions({ agent }: { agent: AgentView }) {
  const queryClient = useQueryClient()
  const [restartOpen, setRestartOpen] = useState(false)
  const [uninstallOpen, setUninstallOpen] = useState(false)
  const [operation, setOperation] = useState<AgentOperation>()
  const update = useMutation({
    mutationFn: async () => {
      const client = await ensureCypheriaClient()
      return waitForAgentOperation(await client.agents.update(agent.id), setOperation)
    },
    onSuccess: async () => {
      setOperation(undefined)
      await queryClient.invalidateQueries({ queryKey: ["cypheria", "agents"] })
      await queryClient.invalidateQueries({ queryKey: ["harness", agent.id] })
    },
  })
  const restart = useMutation({
    mutationFn: async () => {
      const client = await ensureCypheriaClient()
      await client.agents.stop(agent.id, true)
      return client.agents.start(agent.id)
    },
    onSuccess: async () => {
      setRestartOpen(false)
      queryClient.removeQueries({ queryKey: ["harness", agent.id] })
      await queryClient.invalidateQueries({ queryKey: ["cypheria", "agents"] })
      await queryClient.invalidateQueries({ queryKey: ["harness", agent.id] })
    },
  })
  const uninstall = useMutation({
    mutationFn: async () => {
      const client = await ensureCypheriaClient()
      return waitForAgentOperation(await client.agents.uninstall(agent.id), setOperation)
    },
    onSuccess: async () => {
      setOperation(undefined)
      setUninstallOpen(false)
      queryClient.removeQueries({ queryKey: ["harness", agent.id] })
      await queryClient.invalidateQueries({ queryKey: ["cypheria", "agents"] })
    },
  })
  const disable = useMutation({
    mutationFn: async () => (await ensureCypheriaClient()).agents.disable(agent.id),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ["harness", agent.id] })
      await queryClient.invalidateQueries({ queryKey: ["cypheria", "agents"] })
    },
  })
  const setRestartDialogOpen = (open: boolean) => {
    if (restart.isPending) return
    if (!open) restart.reset()
    setRestartOpen(open)
  }
  const setUninstallDialogOpen = (open: boolean) => {
    if (uninstall.isPending) return
    if (!open) {
      uninstall.reset()
      setOperation(undefined)
    }
    setUninstallOpen(open)
  }
  const maintenancePending =
    disable.isPending || restart.isPending || update.isPending || uninstall.isPending
  const progress = Math.round((operation?.progress ?? 0) * 100)
  if (!agent.installed) return null
  const updateAvailable = isAgentUpdateAvailable(agent)
  return (
    <div className="grid justify-items-end gap-2">
      <div className="flex gap-2">
        {agent.enabled ? (
          <Switch
            aria-label={`Disable ${agent.name}`}
            checked
            className="self-center"
            disabled={maintenancePending}
            onCheckedChange={(checked) => {
              if (!checked) disable.mutate()
            }}
          />
        ) : null}
        {updateAvailable ? (
          <Button
            aria-label={
              update.error
                ? `Update ${agent.name} failed: ${update.error.message}`
                : `Update ${agent.name} to v${agent.availableVersion}`
            }
            disabled={maintenancePending}
            size={update.isPending ? "default" : "icon"}
            title={update.error?.message ?? `Update to v${agent.availableVersion}`}
            variant="outline"
            onClick={() => update.mutate()}
          >
            {update.isPending ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                <span className="tabular-nums">{progress}%</span>
              </>
            ) : (
              <Download className="size-4" />
            )}
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label={`More maintenance options for ${agent.name}`}
                disabled={maintenancePending}
                size="icon"
                variant="ghost"
              />
            }
          >
            <MoreHorizontal aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!agent.enabled} onClick={() => setRestartDialogOpen(true)}>
              <RotateCw aria-hidden="true" />
              Restart
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setUninstallDialogOpen(true)}>
              <Trash2 aria-hidden="true" />
              Uninstall
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {disable.error ? (
        <span className="text-xs text-destructive">{disable.error.message}</span>
      ) : null}
      <AlertDialog open={restartOpen} onOpenChange={setRestartDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <TriangleAlert aria-hidden="true" />
            </AlertDialogMedia>
            <AlertDialogTitle>Restart {agent.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This stops the harness, closes its active threads, and starts it again. Any
              in-progress work will be interrupted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {restart.error ? (
            <p className="text-sm text-destructive">{restart.error.message}</p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restart.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={restart.isPending}
              variant="destructive"
              onClick={() => restart.mutate()}
            >
              {restart.isPending ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  Restarting…
                </>
              ) : (
                "Restart"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={uninstallOpen} onOpenChange={setUninstallDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Uninstall {agent.name}?</DialogTitle>
            <DialogDescription>
              This removes the managed harness runtime. You can install it again from this settings
              page.
            </DialogDescription>
          </DialogHeader>
          {uninstall.isPending && operation ? (
            <Progress value={progress}>
              <ProgressLabel>{operation.message ?? "Removing harness…"}</ProgressLabel>
              <ProgressValue />
            </Progress>
          ) : null}
          {uninstall.error ? (
            <p className="text-sm text-destructive">{uninstall.error.message}</p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={uninstall.isPending}
              variant="outline"
              onClick={() => setUninstallDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={uninstall.isPending}
              variant="destructive"
              onClick={() => uninstall.mutate()}
            >
              {uninstall.isPending ? "Uninstalling…" : "Uninstall"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function InstallRequired({ agent }: { agent: AgentView }) {
  const queryClient = useQueryClient()
  const operations = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).agents.listOperations(),
    queryKey: agentOperationsQueryKey,
    refetchInterval: (query) => (query.state.data?.some(operationInProgress) ? 250 : false),
    refetchOnMount: "always",
    staleTime: 0,
  })
  const operation = useMemo(
    () =>
      [...(operations.data ?? [])]
        .reverse()
        .find(
          (candidate) =>
            candidate.kind === "install" &&
            candidate.target.kind === "agent" &&
            candidate.target.agentId === agent.id
        ),
    [agent.id, operations.data]
  )
  const installing = operation ? operationInProgress(operation) : false
  const install = useMutation({
    mutationFn: async () => (await ensureCypheriaClient()).agents.install(agent.id),
    onSuccess: (nextOperation) => {
      queryClient.setQueryData<AgentOperation[]>(agentOperationsQueryKey, (current) =>
        upsertAgentOperation(current, nextOperation)
      )
    },
  })
  useEffect(() => {
    if (operation?.status !== "succeeded") return
    void queryClient.invalidateQueries({ queryKey: ["cypheria", "agents"] })
  }, [operation?.status, queryClient])
  const progress = Math.round((operation?.progress ?? 0) * 100)
  const error = install.error?.message ?? (operation?.status === "failed" ? operation.error : null)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Install {agent.name}</CardTitle>
        <CardDescription>
          Install this harness before configuring authentication, models, and defaults.
        </CardDescription>
        <CardAction className="self-center">
          <Button disabled={install.isPending || installing} onClick={() => install.mutate()}>
            {install.isPending || installing ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            {install.isPending || installing ? `${progress}%` : "Install"}
          </Button>
        </CardAction>
      </CardHeader>
      {error ? (
        <CardContent>
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      ) : null}
    </Card>
  )
}

function EnableRequired({ agent }: { agent: AgentView }) {
  const queryClient = useQueryClient()
  const enable = useMutation({
    mutationFn: async () => (await ensureCypheriaClient()).agents.enable(agent.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["cypheria", "agents"] })
    },
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Enable {agent.name}</CardTitle>
        <CardDescription>
          Allow Cypheria to start this harness for new and existing sessions.
        </CardDescription>
        <CardAction className="self-center">
          <Switch
            aria-label={`Enable ${agent.name}`}
            checked={false}
            disabled={enable.isPending}
            onCheckedChange={(checked) => {
              if (checked) enable.mutate()
            }}
          />
        </CardAction>
      </CardHeader>
      {enable.error ? (
        <CardContent>
          <p className="text-sm text-destructive">{enable.error.message}</p>
        </CardContent>
      ) : null}
    </Card>
  )
}

function ModelsSection({
  agentId,
  snapshot,
}: {
  agentId: AgentId
  snapshot?: HarnessCatalogSnapshot
}) {
  const queryClient = useQueryClient()
  const [provider, setProvider] = useState("all")
  const scrollRef = useRef<HTMLDivElement>(null)
  const refresh = useMutation({
    mutationFn: async () =>
      (await ensureCypheriaClient()).harnesses.models.list({ agentId, refresh: true }),
    onSuccess: (value) => queryClient.setQueryData(["harness", agentId, "catalog"], value),
  })
  const providers = useMemo(
    () => [
      ...new Map(
        (snapshot?.models ?? [])
          .filter((model) => model.providerId)
          .map((model) => [
            model.providerId as string,
            model.providerLabel ?? (model.providerId as string),
          ])
      ).entries(),
    ],
    [snapshot?.models]
  )
  const models = useMemo(
    () =>
      (snapshot?.models ?? []).filter(
        (model) => provider === "all" || model.providerId === provider
      ),
    [provider, snapshot?.models]
  )
  const virtualizer = useVirtualizer({
    count: models.length,
    estimateSize: () => 78,
    getItemKey: (index) => models[index]?.id ?? index,
    getScrollElement: () => scrollRef.current,
    overscan: 8,
  })
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Models</CardTitle>
            <CardDescription>Read-only model catalog reported by the harness.</CardDescription>
          </div>
          <Button
            disabled={refresh.isPending}
            size="sm"
            variant="outline"
            onClick={() => refresh.mutate()}
          >
            <RefreshCw className={refresh.isPending ? "size-4 animate-spin" : "size-4"} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {snapshot?.status === "authentication-required" ? (
          <Alert>
            <AlertTitle>Authentication required</AlertTitle>
            <AlertDescription>
              Configure this harness from Authentication before refreshing its model catalog.
            </AlertDescription>
          </Alert>
        ) : null}
        {providers.length > 1 ? (
          <Select value={provider} onValueChange={(value) => setProvider(String(value))}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All providers</SelectItem>
              {providers.map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {snapshot?.stale ? (
          <Alert variant="destructive">
            <AlertTitle>Showing saved catalog</AlertTitle>
            <AlertDescription>{snapshot.error}</AlertDescription>
          </Alert>
        ) : null}
        <div
          className="cypheria-scrollbar h-[480px] overflow-y-auto rounded-md border"
          ref={scrollRef}
        >
          <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map((row) => {
              const model = models[row.index]
              if (!model) return null
              return (
                <div
                  className="absolute left-0 top-0 w-full px-4 py-3"
                  key={model.id}
                  style={{ transform: `translateY(${row.start}px)` }}
                >
                  <div className="flex items-start justify-between gap-3 border-b pb-3">
                    <div>
                      <div className="font-medium">{model.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {model.providerLabel ?? model.providerId ?? "Provider default"} · {model.id}
                      </div>
                      {model.description ? (
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                          {model.description}
                        </p>
                      ) : null}
                    </div>
                    {model.isDefault ? <Badge variant="secondary">Default</Badge> : null}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        {!models.length && snapshot?.status !== "authentication-required" ? (
          <p className="text-sm text-muted-foreground">
            No models reported. Authenticate this harness, then refresh.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function SettingsSection({
  agentId,
  loading,
  section,
}: {
  agentId: AgentId
  loading: boolean
  section?: HarnessSettingSection
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Record<string, HarnessSettingValue>>({})
  useEffect(() => {
    if (section) setDraft(Object.fromEntries(section.settings.map((item) => [item.id, item.value])))
  }, [section])
  const save = useMutation({
    mutationFn: async () =>
      (await ensureCypheriaClient()).harnesses.settings.update({ agentId, values: draft }),
    onSuccess: (value) => queryClient.setQueryData(["harness", agentId, "catalog"], value),
  })
  if (loading || !section) return <Skeleton className="h-72" />
  if (section.id === "advanced")
    return (
      <Card>
        <CardHeader>
          <CardTitle>Advanced</CardTitle>
          <CardDescription>
            Open the server configuration file for advanced Codex settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void window.cypheria?.app.openConfig()}>
            <ExternalLink className="size-4" />
            Open config.json
          </Button>
        </CardContent>
      </Card>
    )
  return (
    <Card>
      <CardHeader>
        <CardTitle>{section.label}</CardTitle>
        {section.description ? <CardDescription>{section.description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="grid gap-6">
        {section.settings.map((setting) => (
          <Field key={setting.id}>
            <FieldLabel htmlFor={`setting-${setting.id}`}>{setting.label}</FieldLabel>
            {setting.type === "boolean" ? (
              <Switch
                checked={Boolean(draft[setting.id])}
                id={`setting-${setting.id}`}
                onCheckedChange={(value) =>
                  setDraft((current) => ({ ...current, [setting.id]: value }))
                }
              />
            ) : setting.type === "number" ? (
              <Input
                id={`setting-${setting.id}`}
                max={setting.max ?? undefined}
                min={setting.min ?? undefined}
                step={setting.step ?? undefined}
                type="number"
                value={String(draft[setting.id] ?? "")}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    [setting.id]: event.currentTarget.value
                      ? Number(event.currentTarget.value)
                      : null,
                  }))
                }
              />
            ) : (
              <Select
                value={String(draft[setting.id] ?? "")}
                onValueChange={(value) =>
                  setDraft((current) => ({ ...current, [setting.id]: String(value) }))
                }
              >
                <SelectTrigger id={`setting-${setting.id}`}>
                  <SelectValue placeholder="Harness default" />
                </SelectTrigger>
                <SelectContent>
                  {setting.options.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {setting.description ? (
              <FieldDescription>{setting.description}</FieldDescription>
            ) : null}
            {setting.type === "select" &&
            draft[setting.id] &&
            setting.options.length > 0 &&
            !setting.options.some((item) => item.value === draft[setting.id]) ? (
              <FieldDescription className="text-destructive">
                The saved value is no longer available and will not be applied.
              </FieldDescription>
            ) : null}
          </Field>
        ))}
        {section.settings.length ? (
          <div className="flex justify-end">
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : "Save settings"}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            This harness does not expose configurable defaults in this category.
          </p>
        )}
        {save.error ? <p className="text-sm text-destructive">{save.error.message}</p> : null}
      </CardContent>
    </Card>
  )
}
