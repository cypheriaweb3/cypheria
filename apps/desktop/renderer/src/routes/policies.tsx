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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@cypheria/ui/components/field"
import { Input } from "@cypheria/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cypheria/ui/components/select"
import { Switch } from "@cypheria/ui/components/switch"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Pencil, Plus, ShieldCheck, ShieldOff } from "lucide-react"
import { type FormEvent, useState } from "react"
import type { SigningPolicyRecordView } from "../../../ipc/src/index.js"
import { WorkbenchFrame } from "../components/workbench-frame"

export const Route = createFileRoute("/policies")({ component: PoliciesRoute })

function parseList(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseChainIds(value: FormDataEntryValue | null): Array<number | `solana:${string}`> {
  return parseList(value).map((item) =>
    item.startsWith("solana:") ? (item as `solana:${string}`) : Number(item)
  )
}

function PoliciesRoute() {
  const queryClient = useQueryClient()
  const policies = useQuery({
    queryFn: () => window.cypheria?.policy.list() ?? [],
    queryKey: ["policy", "list"],
  })
  const wallets = useQuery({
    queryFn: () => window.cypheria?.wallet.list() ?? [],
    queryKey: ["wallet", "list"],
  })
  const disable = useMutation({
    mutationFn: async (record: SigningPolicyRecordView) => {
      if (!window.cypheria) throw new Error("Policies are only available in the desktop app.")
      return window.cypheria.policy.disable(record.policy.id, record.revision)
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["policy"] }),
  })
  return (
    <WorkbenchFrame>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <ShieldCheck className="size-5" />
            Signing policies
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Policies scope signing by wallet, chain, origin, method, contract, value, and expiry.
          </p>
        </div>
        <PolicyDialog
          wallets={wallets.data ?? []}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: ["policy"] })}
        />
      </header>
      {policies.data?.length ? (
        <div className="grid gap-3">
          {policies.data.map((record) => (
            <Card key={record.policy.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {record.policy.id}
                      <Badge variant={record.policy.enabled ? "secondary" : "outline"}>
                        {record.policy.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </CardTitle>
                    <CardDescription>
                      {record.policy.walletId} · revision {record.revision}
                    </CardDescription>
                  </div>
                  <div className="flex gap-1">
                    <PolicyDialog
                      record={record}
                      wallets={wallets.data ?? []}
                      onSaved={() => void queryClient.invalidateQueries({ queryKey: ["policy"] })}
                    />
                    {record.policy.enabled ? (
                      <Button
                        aria-label={`Disable ${record.policy.id}`}
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => disable.mutate(record)}
                      >
                        <ShieldOff className="size-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <div className="flex flex-wrap gap-2">
                  <Badge>{record.policy.effect}</Badge>
                  {record.policy.requireHumanApproval ? (
                    <Badge variant="outline">Human approval</Badge>
                  ) : null}
                  {record.policy.chainIds.map((chain) => (
                    <Badge key={chain} variant="outline">
                      {chain}
                    </Badge>
                  ))}
                </div>
                <p>
                  <span className="text-muted-foreground">Origins:</span>{" "}
                  {record.policy.origins.join(", ")}
                </p>
                <p>
                  <span className="text-muted-foreground">Methods:</span>{" "}
                  {record.policy.methods.join(", ")}
                </p>
                {record.policy.maxNativeValue ? (
                  <p>
                    <span className="text-muted-foreground">Max native value:</span>{" "}
                    {record.policy.maxNativeValue}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No signing policies</CardTitle>
            <CardDescription>
              Without an explicit allow policy, conditional auto-signing cannot authorize a
              signature.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      {disable.error ? <p className="text-sm text-destructive">{disable.error.message}</p> : null}
    </WorkbenchFrame>
  )
}

function PolicyDialog({
  record,
  wallets,
  onSaved,
}: Readonly<{
  record?: SigningPolicyRecordView
  wallets: Awaited<ReturnType<NonNullable<typeof window.cypheria>["wallet"]["list"]>>
  onSaved: () => void
}>) {
  const [open, setOpen] = useState(false)
  const save = useMutation({
    mutationFn: async (form: FormData) => {
      if (!window.cypheria) throw new Error("Policies are only available in the desktop app.")
      const values = {
        chainIds: parseChainIds(form.get("chainIds")),
        effect: String(form.get("effect")) as "allow" | "deny" | "require-human-approval",
        enabled: true,
        maxNativeValue: String(form.get("maxNativeValue") ?? "") || undefined,
        methods: parseList(form.get("methods")),
        origins: parseList(form.get("origins")),
        requireHumanApproval: form.get("requireHumanApproval") === "on",
      }
      if (record)
        return window.cypheria.policy.update({
          ...values,
          expectedRevision: record.revision,
          policyId: record.policy.id,
        })
      return window.cypheria.policy.create({
        ...values,
        walletId: String(form.get("walletId")) as `wallet_${string}`,
      })
    },
    onSuccess: () => {
      setOpen(false)
      onSaved()
    },
  })
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    save.mutate(new FormData(event.currentTarget))
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          record ? (
            <Button aria-label={`Edit ${record.policy.id}`} size="icon-sm" variant="ghost">
              <Pencil className="size-4" />
            </Button>
          ) : (
            <Button>
              <Plus className="size-4" />
              New policy
            </Button>
          )
        }
      />
      <DialogContent className="max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>{record ? "Edit policy" : "New signing policy"}</DialogTitle>
          <DialogDescription>
            Use * for every origin or method. Auto-signing remains off unless the active wallet mode
            enables it.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <FieldGroup>
            {record ? null : (
              <Field>
                <FieldLabel>Wallet</FieldLabel>
                <Select name="walletId" required>
                  <SelectTrigger>
                    <SelectValue placeholder="Select wallet" />
                  </SelectTrigger>
                  <SelectContent>
                    {wallets.map((wallet) => (
                      <SelectItem key={wallet.wallet.id} value={wallet.wallet.id}>
                        {wallet.wallet.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field>
              <FieldLabel>Chain IDs</FieldLabel>
              <Input
                name="chainIds"
                defaultValue={record?.policy.chainIds.join(", ") ?? "1"}
                required
              />
              <FieldDescription>Comma-separated EVM IDs or Solana identifiers.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Origins</FieldLabel>
              <Input
                name="origins"
                defaultValue={record?.policy.origins.join(", ") ?? "*"}
                required
              />
            </Field>
            <Field>
              <FieldLabel>Methods</FieldLabel>
              <Input
                name="methods"
                defaultValue={
                  record?.policy.methods.join(", ") ?? "personal_sign, eth_signTypedData_v4"
                }
                required
              />
            </Field>
            <Field>
              <FieldLabel>Decision</FieldLabel>
              <Select
                name="effect"
                defaultValue={record?.policy.effect ?? "require-human-approval"}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="allow">Allow</SelectItem>
                  <SelectItem value="require-human-approval">Require approval</SelectItem>
                  <SelectItem value="deny">Deny</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Maximum native value (optional)</FieldLabel>
              <Input
                name="maxNativeValue"
                defaultValue={record?.policy.maxNativeValue}
                placeholder="0 or 0x0"
              />
            </Field>
            <Field orientation="horizontal">
              <div>
                <FieldLabel>Always require human approval</FieldLabel>
                <FieldDescription>Overrides an allow decision for this scope.</FieldDescription>
              </div>
              <Switch
                name="requireHumanApproval"
                defaultChecked={record?.policy.requireHumanApproval}
              />
            </Field>
          </FieldGroup>
          <Button disabled={save.isPending} type="submit">
            {save.isPending ? "Saving…" : "Save policy"}
          </Button>
          {save.error ? <p className="text-sm text-destructive">{save.error.message}</p> : null}
        </form>
      </DialogContent>
    </Dialog>
  )
}
