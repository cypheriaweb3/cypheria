import { Alert, AlertDescription, AlertTitle } from "@cypheria/ui/components/alert"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cypheria/ui/components/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@cypheria/ui/components/tabs"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  Eye,
  Globe2,
  KeyRound,
  LockKeyhole,
  Plus,
  ShieldCheck,
  Trash2,
  UnlockKeyhole,
  WalletCards,
} from "lucide-react"
import { type FormEvent, type ReactNode, useState } from "react"
import { WorkbenchFrame } from "../components/workbench-frame"

export const Route = createFileRoute("/wallets")({ component: WalletsRoute })

type WalletAction =
  | { kind: "delete"; walletId: string }
  | { kind: "lock"; walletId: string }
  | { kind: "unlock"; walletId: string }
  | {
      kind: "active"
      walletId: string
      walletAccountId: string
      chainAccountId: string
      mode: "read-only" | "human-approval" | "conditional-auto-signing"
    }

function WalletsRoute() {
  const queryClient = useQueryClient()
  const wallets = useQuery({
    queryFn: () => window.cypheria?.wallet.list() ?? [],
    queryKey: ["wallet", "list"],
  })
  const active = useQuery({
    queryFn: () => window.cypheria?.wallet.getActive(),
    queryKey: ["wallet", "active"],
  })
  const [unlocked, setUnlocked] = useState(() => new Set<string>())
  const action = useMutation({
    mutationFn: async (input: WalletAction) => {
      if (!window.cypheria)
        throw new Error("Wallet management is only available in the desktop app.")
      if (input.kind === "delete") return window.cypheria.wallet.delete(input.walletId)
      if (input.kind === "lock") return window.cypheria.wallet.lock(input.walletId)
      if (input.kind === "unlock") return window.cypheria.wallet.unlock(input.walletId)
      const { kind: _, ...context } = input
      return window.cypheria.wallet.setActive(context)
    },
    onSuccess: async (_, input) => {
      if (input.kind === "unlock" || input.kind === "lock")
        setUnlocked((current) => {
          const next = new Set(current)
          if (input.kind === "unlock") next.add(input.walletId)
          else next.delete(input.walletId)
          return next
        })
      await queryClient.invalidateQueries({ queryKey: ["wallet"] })
    },
  })

  return (
    <WorkbenchFrame>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <WalletCards className="size-5" />
            Wallets & accounts
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Public state is shown here. Secret material is sent once to Electron main and never
            persisted in browser storage.
          </p>
        </div>
        <AddWalletDialog
          onCreated={() => void queryClient.invalidateQueries({ queryKey: ["wallet"] })}
        />
      </header>
      <Alert>
        <ShieldCheck className="size-4" />
        <AlertTitle>Policy-controlled signing</AlertTitle>
        <AlertDescription>
          The active mode scopes requests. Conditional auto-signing still requires an explicit
          matching policy.
        </AlertDescription>
      </Alert>
      {wallets.data?.length ? (
        <div className="grid gap-4">
          {wallets.data.map((view) => (
            <Card key={view.wallet.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {view.wallet.name}
                      <Badge variant="outline">{view.wallet.kind}</Badge>
                      {active.data?.wallet?.wallet.id === view.wallet.id ? (
                        <Badge>Active</Badge>
                      ) : null}
                    </CardTitle>
                    <CardDescription>
                      {view.wallet.provider} · {view.wallet.status}
                    </CardDescription>
                  </div>
                  <div className="flex gap-1">
                    {view.wallet.provider === "local-vault" ? (
                      unlocked.has(view.wallet.id) ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => action.mutate({ kind: "lock", walletId: view.wallet.id })}
                        >
                          <LockKeyhole className="size-4" />
                          Lock
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            action.mutate({ kind: "unlock", walletId: view.wallet.id })
                          }
                        >
                          <UnlockKeyhole className="size-4" />
                          Unlock
                        </Button>
                      )
                    ) : null}
                    <Button
                      aria-label={`Delete ${view.wallet.name}`}
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => {
                        if (
                          globalThis.confirm(`Delete ${view.wallet.name}? This cannot be undone.`)
                        )
                          action.mutate({ kind: "delete", walletId: view.wallet.id })
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3">
                {view.accounts.map(({ account, chainAccounts }) => (
                  <div className="grid gap-2 rounded-lg border p-3" key={account.id}>
                    <div className="text-sm font-medium">{account.name}</div>
                    {chainAccounts.map((chainAccount) => (
                      <div
                        className="flex flex-wrap items-center justify-between gap-3"
                        key={chainAccount.id}
                      >
                        <div className="min-w-0">
                          <div className="truncate font-mono text-xs">{chainAccount.address}</div>
                          <div className="text-xs text-muted-foreground">
                            Chain {chainAccount.chainId}
                          </div>
                        </div>
                        <Select
                          defaultValue={
                            view.wallet.provider === "read-only" ? "read-only" : "human-approval"
                          }
                          onValueChange={(mode) =>
                            action.mutate({
                              chainAccountId: chainAccount.id,
                              kind: "active",
                              mode: mode as
                                | "read-only"
                                | "human-approval"
                                | "conditional-auto-signing",
                              walletAccountId: account.id,
                              walletId: view.wallet.id,
                            })
                          }
                        >
                          <SelectTrigger className="w-44">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="read-only">Read only</SelectItem>
                            {view.wallet.provider !== "read-only" ? (
                              <>
                                <SelectItem value="human-approval">Human approval</SelectItem>
                                <SelectItem value="conditional-auto-signing">
                                  Policy auto-sign
                                </SelectItem>
                              </>
                            ) : null}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No wallets yet</CardTitle>
            <CardDescription>
              Add a watch-only address or create/import a local encrypted wallet.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      {action.error ? <p className="text-sm text-destructive">{action.error.message}</p> : null}
      <DappLauncher />
    </WorkbenchFrame>
  )
}

function AddWalletDialog({ onCreated }: Readonly<{ onCreated: () => void }>) {
  const [open, setOpen] = useState(false)
  const create = useMutation({
    mutationFn: async ({ kind, values }: { kind: string; values: FormData }) => {
      if (!window.cypheria)
        throw new Error("Wallet management is only available in the desktop app.")
      const name = String(values.get("name") ?? "")
      if (kind === "generate") return window.cypheria.wallet.generateHd({ name })
      if (kind === "watch")
        return window.cypheria.wallet.addWatch({
          address: String(values.get("address") ?? "") as `0x${string}`,
          name,
        })
      if (kind === "mnemonic")
        return window.cypheria.wallet.importHd({
          mnemonic: String(values.get("mnemonic") ?? ""),
          name,
          ...(values.get("passphrase") ? { passphrase: String(values.get("passphrase")) } : {}),
        })
      return window.cypheria.wallet.importPrivateKey({
        name,
        privateKey: String(values.get("privateKey") ?? "") as `0x${string}`,
      })
    },
    onSuccess: () => {
      setOpen(false)
      onCreated()
    },
  })
  const submit = (kind: string) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    create.mutate({ kind, values: new FormData(form) })
    form.reset()
  }
  const form = (kind: string, fields: ReactNode) => (
    <form className="grid gap-4 pt-4" onSubmit={submit(kind)}>
      <FieldGroup>
        <Field>
          <FieldLabel>Wallet name</FieldLabel>
          <Input name="name" required />
        </Field>
        {fields}
      </FieldGroup>
      <Button disabled={create.isPending} type="submit">
        {create.isPending ? "Saving…" : "Continue"}
      </Button>
    </form>
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <Plus className="size-4" />
            Add wallet
          </Button>
        }
      />
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add wallet</DialogTitle>
          <DialogDescription>
            Local secrets cross typed IPC once and are encrypted immediately by the OS-backed vault.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="watch">
          <TabsList className="grid grid-cols-4">
            <TabsTrigger value="watch">
              <Eye className="size-4" />
              Watch
            </TabsTrigger>
            <TabsTrigger value="generate">
              <WalletCards className="size-4" />
              Create
            </TabsTrigger>
            <TabsTrigger value="mnemonic">
              <KeyRound className="size-4" />
              Phrase
            </TabsTrigger>
            <TabsTrigger value="key">
              <KeyRound className="size-4" />
              Key
            </TabsTrigger>
          </TabsList>
          <TabsContent value="watch">
            {form(
              "watch",
              <Field>
                <FieldLabel>Address</FieldLabel>
                <Input name="address" placeholder="0x…" required />
              </Field>
            )}
          </TabsContent>
          <TabsContent value="generate">
            {form(
              "generate",
              <p className="text-sm text-muted-foreground">
                Creates a new HD wallet directly inside the encrypted local vault.
              </p>
            )}
          </TabsContent>
          <TabsContent value="mnemonic">
            {form(
              "mnemonic",
              <>
                <Field>
                  <FieldLabel>Recovery phrase</FieldLabel>
                  <Input name="mnemonic" autoComplete="off" required />
                </Field>
                <Field>
                  <FieldLabel>Optional passphrase</FieldLabel>
                  <Input name="passphrase" type="password" autoComplete="off" />
                </Field>
              </>
            )}
          </TabsContent>
          <TabsContent value="key">
            {form(
              "key",
              <Field>
                <FieldLabel>Private key</FieldLabel>
                <Input
                  name="privateKey"
                  type="password"
                  autoComplete="off"
                  placeholder="0x…"
                  required
                />
              </Field>
            )}
          </TabsContent>
        </Tabs>
        {create.error ? <p className="text-sm text-destructive">{create.error.message}</p> : null}
      </DialogContent>
    </Dialog>
  )
}

function DappLauncher() {
  const [url, setUrl] = useState("")
  const open = useMutation({
    mutationFn: async () => {
      if (!window.cypheria)
        throw new Error("The dApp browser is only available in the desktop app.")
      return window.cypheria.browser.openDapp(new URL(url).toString())
    },
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe2 className="size-4" />
          Isolated dApp session
        </CardTitle>
        <CardDescription>
          Each origin receives a separate session and explicit wallet permissions.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            open.mutate()
          }}
        >
          <Input
            placeholder="https://app.example"
            type="url"
            value={url}
            onChange={(event) => setUrl(event.currentTarget.value)}
          />
          <Button type="submit">Open</Button>
        </form>
        {open.error ? <p className="mt-3 text-sm text-destructive">{open.error.message}</p> : null}
      </CardContent>
    </Card>
  )
}
