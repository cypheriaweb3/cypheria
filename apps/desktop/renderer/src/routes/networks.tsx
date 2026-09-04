import { Badge } from "@cypheria/ui/components/badge"
import { Button } from "@cypheria/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cypheria/ui/components/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@cypheria/ui/components/dialog"
import { Field, FieldGroup, FieldLabel } from "@cypheria/ui/components/field"
import { Input } from "@cypheria/ui/components/input"
import { Switch } from "@cypheria/ui/components/switch"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Activity, ArrowDown, ArrowUp, Globe2, Plus, RotateCw, Trash2 } from "lucide-react"
import { type FormEvent, useState } from "react"
import type { NetworkList } from "../../../ipc/src/web3.js"
import { WorkbenchFrame } from "../components/workbench-frame"

export const Route = createFileRoute("/networks")({ component: NetworksRoute })

type NetworkView = NetworkList[number]
type EndpointView = NetworkView["endpoints"][number]

const move = <T,>(items: readonly T[], from: number, to: number): T[] => {
  if (to < 0 || to >= items.length) return [...items]
  const next = [...items]
  const [item] = next.splice(from, 1)
  if (item !== undefined) next.splice(to, 0, item)
  return next
}

function NetworksRoute() {
  const queryClient = useQueryClient()
  const networks = useQuery({
    queryFn: () => window.cypheria?.network.list() ?? [],
    queryKey: ["network", "list"],
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["network"] })
  const setEnabled = useMutation({
    mutationFn: (view: NetworkView) => {
      if (!window.cypheria) throw new Error("Networks are only available in the desktop app.")
      return window.cypheria.network.setEnabled(
        view.network.id,
        !view.network.enabled,
        view.network.revision
      )
    },
    onSuccess: refresh,
  })
  const removeNetwork = useMutation({
    mutationFn: (view: NetworkView) => {
      if (!window.cypheria) throw new Error("Networks are only available in the desktop app.")
      return window.cypheria.network.remove(view.network.id, true)
    },
    onSuccess: refresh,
  })
  const reorder = useMutation({
    mutationFn: (ids: readonly string[]) => {
      if (!window.cypheria) throw new Error("Networks are only available in the desktop app.")
      return window.cypheria.network.reorder(ids)
    },
    onSuccess: refresh,
  })
  const ordered = networks.data ?? []
  const reorderNetwork = (index: number, target: number) =>
    reorder.mutate(move(ordered, index, target).map(({ network }) => network.id))

  return (
    <WorkbenchFrame>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Globe2 className="size-5" />
            Networks
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage trusted chain metadata, ordered RPC fallbacks, and disposable endpoint health.
          </p>
        </div>
        <CreateNetworkDialog onSaved={refresh} />
      </header>

      <div className="grid gap-4">
        {ordered.map((view, index) => (
          <Card key={view.network.id}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {view.network.name}
                    <Badge variant={view.network.enabled ? "secondary" : "outline"}>
                      {view.network.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                    <Badge variant="outline">{view.network.source}</Badge>
                    {view.network.testnet ? <Badge variant="outline">testnet</Badge> : null}
                  </CardTitle>
                  <CardDescription>
                    {view.network.chain.namespace}:{view.network.chain.reference} · revision{" "}
                    {view.network.revision}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    aria-label="Move network up"
                    disabled={index === 0}
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => reorderNetwork(index, index - 1)}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    aria-label="Move network down"
                    disabled={index === ordered.length - 1}
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => reorderNetwork(index, index + 1)}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                  <Switch
                    aria-label={`Toggle ${view.network.name}`}
                    checked={view.network.enabled}
                    onCheckedChange={() => setEnabled.mutate(view)}
                  />
                  {view.network.source === "custom" ? (
                    <Button
                      aria-label={`Delete ${view.network.name}`}
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => {
                        if (
                          globalThis.confirm(
                            `Delete ${view.network.name} connectivity and revoke its active grants? Historical records will be preserved.`
                          )
                        ) {
                          removeNetwork.mutate(view)
                        }
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid gap-2">
                {view.endpoints.map((endpoint, endpointIndex) => (
                  <EndpointRow
                    endpoint={endpoint}
                    index={endpointIndex}
                    key={endpoint.id}
                    network={view}
                    onChanged={refresh}
                  />
                ))}
              </div>
              <AddEndpointDialog network={view} onSaved={refresh} />
            </CardContent>
          </Card>
        ))}
      </div>
      {networks.error ? <p className="text-sm text-destructive">{networks.error.message}</p> : null}
    </WorkbenchFrame>
  )
}

function EndpointRow({
  endpoint,
  index,
  network,
  onChanged,
}: Readonly<{
  endpoint: EndpointView
  index: number
  network: NetworkView
  onChanged: () => void
}>) {
  const action = useMutation({
    mutationFn: async (kind: "probe" | "remove" | "toggle" | "up" | "down") => {
      if (!window.cypheria) throw new Error("Networks are only available in the desktop app.")
      if (kind === "probe") return window.cypheria.network.probeEndpoint(endpoint.id)
      if (kind === "remove") return window.cypheria.network.removeEndpoint(endpoint.id)
      if (kind === "toggle")
        return window.cypheria.network.setEndpointEnabled(
          endpoint.id,
          !endpoint.enabled,
          endpoint.revision
        )
      const target = kind === "up" ? index - 1 : index + 1
      return window.cypheria.network.reorderEndpoints(
        network.network.id,
        move(network.endpoints, index, target).map(({ id }) => id)
      )
    },
    onSuccess: onChanged,
  })
  const health = endpoint.health?.state ?? "unknown"
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-medium">
          <Activity className="size-4" />
          {endpoint.label}
          <Badge variant="outline">{health}</Badge>
          <Badge variant="outline">{endpoint.connection.kind}</Badge>
        </div>
        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
          {endpoint.connection.displayUrl}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {endpoint.transport}
          {endpoint.health?.latencyMs === undefined
            ? ""
            : ` · ${Math.round(endpoint.health.latencyMs)} ms`}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button
          aria-label="Move endpoint up"
          disabled={index === 0}
          size="icon-sm"
          variant="ghost"
          onClick={() => action.mutate("up")}
        >
          <ArrowUp className="size-4" />
        </Button>
        <Button
          aria-label="Move endpoint down"
          disabled={index === network.endpoints.length - 1}
          size="icon-sm"
          variant="ghost"
          onClick={() => action.mutate("down")}
        >
          <ArrowDown className="size-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={() => action.mutate("probe")}>
          <RotateCw className="size-4" />
          Probe
        </Button>
        <Switch
          aria-label={`Toggle ${endpoint.label}`}
          checked={endpoint.enabled}
          onCheckedChange={() => action.mutate("toggle")}
        />
        {endpoint.source === "custom" ? (
          <Button
            aria-label={`Delete ${endpoint.label}`}
            size="icon-sm"
            variant="ghost"
            onClick={() => action.mutate("remove")}
          >
            <Trash2 className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function CreateNetworkDialog({ onSaved }: Readonly<{ onSaved: () => void }>) {
  const [open, setOpen] = useState(false)
  const [namespace, setNamespace] = useState<"eip155" | "solana">("eip155")
  const create = useMutation({
    mutationFn: async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!window.cypheria) throw new Error("Networks are only available in the desktop app.")
      const data = new FormData(event.currentTarget)
      const reference = String(data.get("reference"))
      return window.cypheria.network.create({
        chain: { namespace, reference },
        enabled: true,
        endpoints: [
          {
            enabled: true,
            label: "Primary RPC",
            localDevelopment: false,
            transport: "http",
            url: String(data.get("rpcUrl")),
          },
        ],
        explorers: [],
        name: String(data.get("name")),
        nativeCurrency: {
          decimals: Number(data.get("decimals")),
          name: String(data.get("currencyName")),
          symbol: String(data.get("symbol")),
        },
        testnet: data.get("testnet") === "on",
        verification:
          namespace === "eip155"
            ? { kind: "evm-chain-id" }
            : { genesisHash: String(data.get("genesisHash")), kind: "solana-genesis-hash" },
      })
    },
    onSuccess: () => {
      setOpen(false)
      onSaved()
    },
  })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus className="size-4" />
        Add network
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add custom network</DialogTitle>
          <DialogDescription>
            The RPC is identity-probed before anything is saved.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => create.mutate(event)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="network-name">Name</FieldLabel>
              <Input id="network-name" name="name" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="network-namespace">Protocol</FieldLabel>
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm"
                id="network-namespace"
                value={namespace}
                onChange={(event) => setNamespace(event.target.value as "eip155" | "solana")}
              >
                <option value="eip155">Ethereum</option>
                <option value="solana">Solana</option>
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="network-reference">Canonical reference</FieldLabel>
              <Input
                id="network-reference"
                name="reference"
                placeholder={namespace === "eip155" ? "137" : "mainnet"}
                required
              />
            </Field>
            {namespace === "solana" ? (
              <Field>
                <FieldLabel htmlFor="network-genesis">Genesis hash</FieldLabel>
                <Input id="network-genesis" name="genesisHash" required />
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor="network-rpc">RPC URL</FieldLabel>
              <Input id="network-rpc" name="rpcUrl" placeholder="https://…" required type="url" />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field>
                <FieldLabel htmlFor="currency-name">Currency</FieldLabel>
                <Input id="currency-name" name="currencyName" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="currency-symbol">Symbol</FieldLabel>
                <Input id="currency-symbol" name="symbol" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="currency-decimals">Decimals</FieldLabel>
                <Input
                  defaultValue={namespace === "eip155" ? 18 : 9}
                  id="currency-decimals"
                  name="decimals"
                  required
                  type="number"
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input name="testnet" type="checkbox" /> Test network
            </label>
          </FieldGroup>
          <Button disabled={create.isPending} type="submit">
            Verify and add
          </Button>
          {create.error ? <p className="text-sm text-destructive">{create.error.message}</p> : null}
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AddEndpointDialog({
  network,
  onSaved,
}: Readonly<{ network: NetworkView; onSaved: () => void }>) {
  const [open, setOpen] = useState(false)
  const add = useMutation({
    mutationFn: async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!window.cypheria) throw new Error("Networks are only available in the desktop app.")
      const data = new FormData(event.currentTarget)
      const transport = data.get("transport") === "websocket" ? "websocket" : "http"
      return window.cypheria.network.addEndpoint({
        endpoint: {
          enabled: true,
          label: String(data.get("label")),
          localDevelopment: data.get("local") === "on",
          transport,
          url: String(data.get("url")),
        },
        networkId: network.network.id,
      })
    },
    onSuccess: () => {
      setOpen(false)
      onSaved()
    },
  })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Plus className="size-4" />
        Add RPC endpoint
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add RPC endpoint</DialogTitle>
          <DialogDescription>
            Credentials remain encrypted; only a redacted URL reaches this screen.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => add.mutate(event)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`endpoint-label-${network.network.id}`}>Label</FieldLabel>
              <Input id={`endpoint-label-${network.network.id}`} name="label" required />
            </Field>
            <Field>
              <FieldLabel htmlFor={`endpoint-url-${network.network.id}`}>URL</FieldLabel>
              <Input id={`endpoint-url-${network.network.id}`} name="url" required type="url" />
            </Field>
            <Field>
              <FieldLabel htmlFor={`endpoint-transport-${network.network.id}`}>
                Transport
              </FieldLabel>
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm"
                id={`endpoint-transport-${network.network.id}`}
                name="transport"
              >
                <option value="http">HTTP</option>
                <option value="websocket">WebSocket</option>
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input name="local" type="checkbox" /> Allow loopback development URL
            </label>
          </FieldGroup>
          <Button disabled={add.isPending} type="submit">
            Verify and add
          </Button>
          {add.error ? <p className="text-sm text-destructive">{add.error.message}</p> : null}
        </form>
      </DialogContent>
    </Dialog>
  )
}
