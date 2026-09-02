import { Alert, AlertDescription, AlertTitle } from "@cypheria/ui/components/alert"
import { Card, CardDescription, CardHeader, CardTitle } from "@cypheria/ui/components/card"
import { createFileRoute } from "@tanstack/react-router"
import { BellDot, ShieldCheck } from "lucide-react"
import { WorkbenchFrame } from "../components/workbench-frame"

export const Route = createFileRoute("/approvals")({ component: ApprovalsRoute })

function ApprovalsRoute() {
  return (
    <WorkbenchFrame>
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <BellDot className="size-5" />
          Pending approvals
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review signing intents and sensitive runtime actions before they execute.
        </p>
      </header>
      <Alert>
        <ShieldCheck className="size-4" />
        <AlertTitle>No pending approvals</AlertTitle>
        <AlertDescription>
          Auto-signing is disabled by default. A request appears here only after the policy engine
          requires human approval.
        </AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>Approval boundary</CardTitle>
          <CardDescription>
            Transaction simulation, origin, chain, account, payload hash, matched policy, and expiry
            will be shown together when a signing request is pending.
          </CardDescription>
        </CardHeader>
      </Card>
    </WorkbenchFrame>
  )
}
