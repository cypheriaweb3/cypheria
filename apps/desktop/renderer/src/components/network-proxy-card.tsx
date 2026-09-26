import type {
  NetworkProxyProtocol,
  NetworkProxySettings,
  NetworkProxySnapshot,
  NetworkProxyTestResult,
} from "@cypheria/protocol"
import { Alert, AlertDescription, AlertTitle } from "@cypheria/ui/components/alert"
import { Badge } from "@cypheria/ui/components/badge"
import { Button } from "@cypheria/ui/components/button"
import { Card, CardContent } from "@cypheria/ui/components/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@cypheria/ui/components/collapsible"
import { Field, FieldDescription, FieldLabel } from "@cypheria/ui/components/field"
import { Input } from "@cypheria/ui/components/input"
import { RadioGroup, RadioGroupItem } from "@cypheria/ui/components/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cypheria/ui/components/select"
import { Skeleton } from "@cypheria/ui/components/skeleton"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, ChevronDown, CircleAlert, Network } from "lucide-react"
import { useEffect, useState } from "react"

import { ensureCypheriaClient } from "../cypheria-client.js"

type ProxyDraft = {
  bypass: string
  host: string
  mode: NetworkProxySettings["mode"]
  password: string
  port: string
  protocol: NetworkProxyProtocol
  username: string
}

const defaultDraft: ProxyDraft = {
  bypass: "localhost, 127.0.0.1, ::1",
  host: "127.0.0.1",
  mode: "system",
  password: "",
  port: "7890",
  protocol: "http",
  username: "",
}

const toDraft = (settings: NetworkProxySnapshot): ProxyDraft =>
  settings.mode === "manual"
    ? {
        ...settings,
        bypass: settings.bypass.join(", "),
        password: "",
        port: String(settings.port),
        username: settings.username ?? "",
      }
    : { ...defaultDraft, mode: settings.mode }

const toSettings = (draft: ProxyDraft): NetworkProxySettings =>
  draft.mode === "manual"
    ? {
        bypass: draft.bypass.split(/[\s,]+/u).filter(Boolean),
        host: draft.host.trim(),
        mode: "manual",
        password: draft.password || undefined,
        port: Number(draft.port),
        protocol: draft.protocol,
        username: draft.username || undefined,
      }
    : { mode: draft.mode }

const manualSettingsChanged = (
  settings: NetworkProxySettings,
  saved: NetworkProxySnapshot | null
): boolean => {
  if (settings.mode !== "manual" || saved?.mode !== "manual") return settings.mode === "manual"
  return (
    settings.host !== saved.host ||
    settings.port !== saved.port ||
    settings.protocol !== saved.protocol ||
    settings.username !== saved.username ||
    JSON.stringify(settings.bypass) !== JSON.stringify(saved.bypass) ||
    Boolean(settings.password)
  )
}

export function NetworkProxyCard() {
  const queryClient = useQueryClient()
  const proxy = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).server.networkProxy(),
    queryKey: ["server", "network-proxy"],
  })
  const [draft, setDraft] = useState(defaultDraft)
  const [saved, setSaved] = useState<NetworkProxySnapshot | null>(null)
  const [testResult, setTestResult] = useState<NetworkProxyTestResult | null>(null)

  useEffect(() => {
    if (!proxy.data) return
    setDraft(toDraft(proxy.data))
    setSaved(proxy.data)
  }, [proxy.data])

  const save = useMutation({
    mutationFn: async (settings: NetworkProxySettings) =>
      (await ensureCypheriaClient()).server.setNetworkProxy(settings),
    onSuccess: (settings) => {
      setDraft(toDraft(settings))
      setSaved(settings)
      queryClient.setQueryData(["server", "network-proxy"], settings)
    },
  })
  const test = useMutation({
    mutationFn: async (settings: NetworkProxySettings) =>
      (await ensureCypheriaClient()).server.testNetworkProxy(settings),
    onMutate: () => setTestResult(null),
    onSuccess: setTestResult,
  })
  const update = <K extends keyof ProxyDraft>(key: K, value: ProxyDraft[K]) => {
    setTestResult(null)
    save.reset()
    setDraft((current) => ({ ...current, [key]: value }))
  }
  const chooseMode = (mode: ProxyDraft["mode"]) => {
    const next = { ...draft, mode }
    setDraft(next)
    setTestResult(null)
    save.mutate(toSettings(next))
  }
  const settings = toSettings(draft)
  const changed = manualSettingsChanged(settings, saved)
  const invalid =
    draft.mode === "manual" &&
    (!draft.host.trim() ||
      !/^\d+$/u.test(draft.port) ||
      Number(draft.port) < 1 ||
      Number(draft.port) > 65_535)
  const modeLabel =
    draft.mode === "system"
      ? "System proxy"
      : draft.mode === "direct"
        ? "Direct"
        : `${draft.protocol.toUpperCase()} ${draft.host}:${draft.port}`
  const error = proxy.error?.message ?? save.error?.message ?? test.error?.message

  return (
    <Card className="py-0">
      <Collapsible defaultOpen={false}>
        <CollapsibleTrigger className="group flex w-full items-center gap-4 p-4 text-left hover:bg-muted/30">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted">
            <Network className="size-5" />
          </span>
          <div className="grid min-w-0 flex-1 gap-1">
            <span className="font-semibold leading-none">Network proxy</span>
            <span className="text-sm text-muted-foreground">
              Configure the proxy used by every agent harness.
            </span>
          </div>
          <Badge variant="outline">
            {proxy.isLoading ? "Loading…" : save.isPending ? "Reconnecting…" : modeLabel}
          </Badge>
          <ChevronDown className="size-4 transition-transform group-data-panel-open:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="grid gap-5 px-4 pb-4">
            {proxy.isLoading ? (
              <Skeleton className="h-32" />
            ) : (
              <>
                <RadioGroup
                  className="grid gap-2 md:grid-cols-3"
                  disabled={save.isPending}
                  value={draft.mode}
                  onValueChange={(value) => chooseMode(value as ProxyDraft["mode"])}
                >
                  {[
                    ["system", "Use system proxy", "Follow the Server process proxy settings."],
                    ["direct", "Connect directly", "Do not use a proxy."],
                    ["manual", "Manual proxy", "Use the proxy configured below."],
                  ].map(([value, title, description]) => (
                    <Field
                      className="rounded-md border p-3 has-data-checked:border-primary/30 has-data-checked:bg-primary/5"
                      key={value}
                      orientation="horizontal"
                    >
                      <RadioGroupItem id={`proxy-${value}`} value={value} />
                      <FieldLabel
                        className="cursor-pointer flex-col items-start gap-1"
                        htmlFor={`proxy-${value}`}
                      >
                        <span>{title}</span>
                        <span className="text-xs font-normal text-muted-foreground">
                          {description}
                        </span>
                      </FieldLabel>
                    </Field>
                  ))}
                </RadioGroup>
                {draft.mode === "manual" ? (
                  <div className="grid gap-4 rounded-md border bg-muted/20 p-4">
                    <div className="grid gap-4 sm:grid-cols-[140px_minmax(0,1fr)_140px]">
                      <Field>
                        <FieldLabel htmlFor="proxy-protocol">Protocol</FieldLabel>
                        <Select
                          value={draft.protocol}
                          onValueChange={(value) =>
                            update("protocol", value as NetworkProxyProtocol)
                          }
                        >
                          <SelectTrigger id="proxy-protocol">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="http">HTTP</SelectItem>
                            <SelectItem value="https">HTTPS</SelectItem>
                            <SelectItem value="socks4">SOCKS4</SelectItem>
                            <SelectItem value="socks5">SOCKS5</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="proxy-host">Host</FieldLabel>
                        <Input
                          id="proxy-host"
                          value={draft.host}
                          onChange={(event) => update("host", event.currentTarget.value)}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="proxy-port">Port</FieldLabel>
                        <Input
                          id="proxy-port"
                          inputMode="numeric"
                          max={65_535}
                          min={1}
                          type="number"
                          value={draft.port}
                          onChange={(event) => update("port", event.currentTarget.value)}
                        />
                      </Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field>
                        <FieldLabel htmlFor="proxy-username">Username</FieldLabel>
                        <Input
                          autoComplete="off"
                          id="proxy-username"
                          value={draft.username}
                          onChange={(event) => update("username", event.currentTarget.value)}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="proxy-password">Password</FieldLabel>
                        <Input
                          autoComplete="new-password"
                          id="proxy-password"
                          placeholder={
                            saved?.mode === "manual" && saved.passwordConfigured
                              ? "Leave blank to keep saved password"
                              : undefined
                          }
                          type="password"
                          value={draft.password}
                          onChange={(event) => update("password", event.currentTarget.value)}
                        />
                      </Field>
                    </div>
                    <Field>
                      <FieldLabel htmlFor="proxy-bypass">Bypass proxy for</FieldLabel>
                      <Input
                        id="proxy-bypass"
                        value={draft.bypass}
                        onChange={(event) => update("bypass", event.currentTarget.value)}
                      />
                      <FieldDescription>Separate hosts with commas or spaces.</FieldDescription>
                    </Field>
                  </div>
                ) : null}
                {testResult ? (
                  <Alert variant={testResult.ok ? "default" : "destructive"}>
                    {testResult.ok ? (
                      <CheckCircle2 className="size-4" />
                    ) : (
                      <CircleAlert className="size-4" />
                    )}
                    <AlertTitle>
                      {testResult.ok ? "Connection successful" : "Connection failed"}
                    </AlertTitle>
                    <AlertDescription>
                      {testResult.message} {testResult.latencyMs} ms
                    </AlertDescription>
                  </Alert>
                ) : null}
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
                <div className="flex gap-2">
                  <Button
                    disabled={invalid || test.isPending || save.isPending}
                    type="button"
                    variant="outline"
                    onClick={() => test.mutate(settings)}
                  >
                    {test.isPending ? "Testing…" : "Test connection"}
                  </Button>
                  {changed ? (
                    <Button
                      disabled={invalid || save.isPending}
                      type="button"
                      onClick={() => save.mutate(settings)}
                    >
                      Save proxy
                    </Button>
                  ) : null}
                </div>
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
