import type { MagpieAgentField, MagpieAgentView, MagpieServiceView } from "@cypheria/protocol"
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@cypheria/ui/components/select"
import { Skeleton } from "@cypheria/ui/components/skeleton"
import { Switch } from "@cypheria/ui/components/switch"
import { toast } from "@cypheria/ui/components/toast"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, RefreshCw, TriangleAlert } from "lucide-react"

import { ensureCypheriaClient } from "../../cypheria-client.js"
import { HarnessIcon } from "../harness-icon"
import { errorText, magpieKeys, useMagpieReady, useMagpieStatus } from "./magpie-queries"

export function GatewayGeneralSection() {
  const queryClient = useQueryClient()
  const { i18n } = useLingui()
  const status = useMagpieStatus()
  const view = status.data

  const setView = (next: MagpieServiceView) => queryClient.setQueryData(magpieKeys.status, next)
  const failed = (error: unknown) =>
    toast.add({
      description: errorText(error),
      title: i18n._(msg`The gateway could not be changed`),
      type: "error",
    })

  const enable = useMutation({
    mutationFn: async (enabled: boolean) =>
      (await ensureCypheriaClient()).magpie.setConfig({ enabled }),
    onError: failed,
    onSettled: () => void queryClient.invalidateQueries({ queryKey: magpieKeys.status }),
    onSuccess: setView,
  })
  const restart = useMutation({
    mutationFn: async () => (await ensureCypheriaClient()).magpie.restart(),
    onError: failed,
    onSuccess: setView,
  })

  if (!view) {
    return <Skeleton className="h-40 w-full" />
  }

  const busy = enable.isPending || view.status === "installing" || view.status === "starting"

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>AI gateway</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Runs magpie for Cypheria's Agents: one local endpoint for every model and
              subscription, with routing groups and usage. Turning it on installs magpie{" "}
              {view.version} the first time.
            </Trans>
          </CardDescription>
          <CardAction>
            <Switch
              aria-label={i18n._(msg`Enable the AI gateway`)}
              checked={view.config.enabled}
              disabled={busy}
              onCheckedChange={(checked) => enable.mutate(checked)}
            />
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={view.status} />
            {view.gatewayUrl ? (
              <span className="font-mono text-xs text-muted-foreground">{view.gatewayUrl}</span>
            ) : null}
          </div>
          <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3 sm:grid-cols-4">
            <Fact label={i18n._(msg`Version`)} value={view.installedVersion ?? "—"} />
            <Fact label={i18n._(msg`Gateway port`)} value={String(view.config.gatewayPort)} />
            <Fact label={i18n._(msg`API port`)} value={String(view.config.apiPort)} />
            <Fact
              label={i18n._(msg`Running since`)}
              value={
                view.startedAt ? new Date(view.startedAt).toLocaleTimeString(i18n.locale) : "—"
              }
            />
          </dl>
          {view.error ? (
            <p className="flex items-center gap-2 rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">
              <TriangleAlert className="size-4 shrink-0" />
              <span>{view.error}</span>
            </p>
          ) : null}
          {view.config.enabled ? (
            <div>
              <Button
                disabled={busy || restart.isPending}
                size="sm"
                variant="outline"
                onClick={() => restart.mutate()}
              >
                {restart.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                <Trans>Restart</Trans>
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <GatewayAgents />
    </div>
  )
}

function StatusBadge({ status }: { status: MagpieServiceView["status"] }) {
  switch (status) {
    case "ready":
      return <Badge>{<Trans>Running</Trans>}</Badge>
    case "installing":
      return <Badge variant="secondary">{<Trans>Installing…</Trans>}</Badge>
    case "starting":
      return <Badge variant="secondary">{<Trans>Starting…</Trans>}</Badge>
    case "error":
      return <Badge variant="destructive">{<Trans>Failed</Trans>}</Badge>
    case "missing":
      return <Badge variant="outline">{<Trans>Not installed</Trans>}</Badge>
    case "stopped":
      return <Badge variant="outline">{<Trans>Stopped</Trans>}</Badge>
  }
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono text-xs font-medium">{value}</dd>
    </div>
  )
}

function GatewayAgents() {
  const queryClient = useQueryClient()
  const { i18n } = useLingui()
  const ready = useMagpieReady()
  const agents = useQuery({
    enabled: ready,
    queryFn: async () => (await ensureCypheriaClient()).magpie.listAgents(),
    queryKey: magpieKeys.agents,
  })
  const onAgents = (next: MagpieAgentView[]) => queryClient.setQueryData(magpieKeys.agents, next)
  const failed = (error: unknown) =>
    toast.add({
      description: errorText(error),
      title: i18n._(msg`The Agent could not be changed`),
      type: "error",
    })
  const setField = useMutation({
    mutationFn: async (input: { agent: MagpieAgentView; field: string; value: string }) =>
      (await ensureCypheriaClient()).magpie.setAgentField(
        input.agent.agentId,
        input.field,
        input.value
      ),
    onError: failed,
    onSuccess: onAgents,
  })
  const reapply = useMutation({
    mutationFn: async (agent: MagpieAgentView) =>
      (await ensureCypheriaClient()).magpie.reapplyAgent(agent.agentId),
    onError: failed,
    onSuccess: onAgents,
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Agents</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            magpie edits the settings of the Agents Cypheria manages, in their Cypheria homes. Pick
            the model or routing group each one uses.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {!ready ? (
          <p className="text-sm text-muted-foreground">
            <Trans>Turn the gateway on to set up the Agents.</Trans>
          </p>
        ) : agents.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : agents.isError ? (
          <p className="text-sm text-destructive">{errorText(agents.error)}</p>
        ) : agents.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>No installed Agent is enabled.</Trans>
          </p>
        ) : (
          agents.data.map((agent) => (
            <div className="grid gap-3 rounded-lg border p-3" key={agent.agentId}>
              <div className="flex items-center gap-3">
                <HarnessIcon agentId={agent.agentId} className="size-5" name={agent.name} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{agent.name}</p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {agent.path}
                  </p>
                </div>
                {agent.drift ? (
                  <Button
                    disabled={reapply.isPending}
                    size="sm"
                    variant="outline"
                    onClick={() => reapply.mutate(agent)}
                  >
                    <Trans>Wire again</Trans>
                  </Button>
                ) : null}
              </div>
              {agent.drift ? (
                <p className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                  <TriangleAlert className="size-3.5 shrink-0" />
                  {agent.drift.kind === "unwired" ? (
                    <Trans>Its settings no longer send it through the gateway.</Trans>
                  ) : agent.drift.kind === "replaced" ? (
                    <Trans>Its model was changed outside the gateway.</Trans>
                  ) : (
                    <Trans>It was used without reaching the gateway.</Trans>
                  )}
                </p>
              ) : null}
              {agent.fields.map((field) => (
                <AgentField
                  disabled={setField.isPending}
                  field={field}
                  key={field.key}
                  onChange={(value) => setField.mutate({ agent, field: field.key, value })}
                />
              ))}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function AgentField(props: {
  disabled: boolean
  field: MagpieAgentField
  onChange: (value: string) => void
}) {
  const { field } = props
  const groups = new Map<string, MagpieAgentField["options"]>()
  for (const option of field.options) {
    const key = option.group ?? ""
    groups.set(key, [...(groups.get(key) ?? []), option])
  }
  const current = field.options.find((option) => option.value === field.value)
  return (
    <div className="grid gap-1.5 text-xs sm:grid-cols-[120px_minmax(0,1fr)] sm:items-center">
      <span className="text-muted-foreground">{field.label}</span>
      <Select
        disabled={props.disabled || field.options.length === 0}
        value={field.value}
        onValueChange={(value) => {
          if (value != null && String(value) !== field.value) props.onChange(String(value))
        }}
      >
        <SelectTrigger aria-label={field.label} className="h-8 text-xs">
          <SelectValue>{current?.label ?? field.value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {[...groups].map(([group, options]) => (
            <SelectGroup key={group}>
              {group ? <SelectLabel>{group}</SelectLabel> : null}
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
