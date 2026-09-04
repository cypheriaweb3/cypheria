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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { BellDot, Check, Clock3, ShieldCheck, X } from "lucide-react"
import type { ApprovalRequestView } from "../../../ipc/src/index.js"
import { WorkbenchFrame } from "../components/workbench-frame"

export const Route = createFileRoute("/approvals")({ component: ApprovalsRoute })

const stringify = (value: unknown) =>
  JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item), 2)

function ApprovalsRoute() {
  const queryClient = useQueryClient()
  const approvals = useQuery({
    queryFn: () => window.cypheria?.approval.list("pending") ?? [],
    queryKey: ["approval", "pending"],
    refetchInterval: 5_000,
  })
  const decide = useMutation({
    mutationFn: async ({
      decision,
      view,
    }: {
      decision: "approved" | "rejected"
      view: ApprovalRequestView
    }) => {
      if (!window.cypheria) throw new Error("Approvals are only available in the desktop app.")
      return window.cypheria.approval.decide({
        approvalId: view.approval.id,
        decision,
        expectedRevision: view.approval.revision,
        reviewer: "desktop-user",
      })
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["approval"] }),
  })
  return (
    <WorkbenchFrame>
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <BellDot className="size-5" />
          Pending approvals
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Inspect the exact signing intent before allowing a privileged wallet action.
        </p>
      </header>
      {approvals.data?.length ? (
        <div className="grid gap-4">
          {approvals.data.map((view) => (
            <Card key={view.approval.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>{view.intent.intent.kind}</CardTitle>
                    <CardDescription>
                      {view.intent.intent.origin ?? view.intent.source} · {view.approval.id}
                    </CardDescription>
                  </div>
                  <Badge>
                    <Clock3 className="size-3" />
                    Pending
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Wallet</dt>
                  <dd className="font-mono text-xs">{view.intent.intent.account.walletId}</dd>
                  <dt className="text-muted-foreground">Account</dt>
                  <dd className="font-mono text-xs">{view.intent.intent.account.address}</dd>
                  <dt className="text-muted-foreground">Chain</dt>
                  <dd>{view.intent.intent.account.chainKey}</dd>
                  <dt className="text-muted-foreground">Expires</dt>
                  <dd>{new Date(view.approval.expiresAt).toLocaleString()}</dd>
                  <dt className="text-muted-foreground">Payload hash</dt>
                  <dd className="break-all font-mono text-xs">{view.intent.payloadHash}</dd>
                </dl>
                <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs">
                  {stringify(view.intent.intent)}
                </pre>
                <div className="flex justify-end gap-2">
                  <Button
                    disabled={decide.isPending}
                    variant="outline"
                    onClick={() => decide.mutate({ decision: "rejected", view })}
                  >
                    <X className="size-4" />
                    Reject
                  </Button>
                  <Button
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ decision: "approved", view })}
                  >
                    <Check className="size-4" />
                    Approve
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Alert>
          <ShieldCheck className="size-4" />
          <AlertTitle>No pending approvals</AlertTitle>
          <AlertDescription>
            Requests that require human review will appear here automatically.
          </AlertDescription>
        </Alert>
      )}
      {decide.error ? <p className="text-sm text-destructive">{decide.error.message}</p> : null}
    </WorkbenchFrame>
  )
}
