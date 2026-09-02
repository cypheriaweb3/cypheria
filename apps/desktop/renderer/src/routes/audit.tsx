import { Badge } from "@cypheria/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cypheria/ui/components/card"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { ScrollText } from "lucide-react"
import { WorkbenchFrame } from "../components/workbench-frame"

export const Route = createFileRoute("/audit")({ component: AuditRoute })

function AuditRoute() {
  const logs = useQuery({
    queryFn: () => window.cypheria?.audit.list(200) ?? [],
    queryKey: ["audit", "logs"],
    refetchInterval: 10_000,
  })
  return (
    <WorkbenchFrame>
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <ScrollText className="size-5" />
          Audit log
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Wallet changes, policy decisions, signatures, approvals, and automation runs are recorded
          locally.
        </p>
      </header>
      {logs.data?.length ? (
        <div className="grid gap-2">
          {logs.data.map((record) => (
            <Card key={record.id}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-sm">{record.eventType}</CardTitle>
                    <CardDescription>
                      {record.source} · {record.actor}
                    </CardDescription>
                  </div>
                  <Badge variant="outline">{new Date(record.createdAt).toLocaleString()}</Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-1 text-xs">
                <p>{record.payloadSummary ?? "No payload summary"}</p>
                {record.correlationId ? (
                  <p className="font-mono text-muted-foreground">
                    Correlation: {record.correlationId}
                  </p>
                ) : null}
                {record.payloadHash ? (
                  <p className="break-all font-mono text-muted-foreground">{record.payloadHash}</p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No audit events</CardTitle>
            <CardDescription>
              Events will appear after wallet, policy, approval, signing, browser, or automation
              activity.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </WorkbenchFrame>
  )
}
