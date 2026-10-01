import { Badge } from "@cypheria/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cypheria/ui/components/card"
import { Skeleton } from "@cypheria/ui/components/skeleton"
import { Trans } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"

import { ensureCypheriaClient } from "../../cypheria-client.js"
import { errorText, magpieKeys, useMagpieReady } from "./magpie-queries"

export function GatewayRoutingSection() {
  const ready = useMagpieReady()
  const groups = useQuery({
    enabled: ready,
    queryFn: async () => (await ensureCypheriaClient()).magpie.listGroups(),
    queryKey: magpieKeys.groups,
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Routing groups</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            An Agent set to a routing group has each request served by one of its members, by the
            group's routing.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {!ready ? (
          <p className="text-sm text-muted-foreground">
            <Trans>Turn the gateway on to see its routing groups.</Trans>
          </p>
        ) : groups.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : groups.isError ? (
          <p className="text-sm text-destructive">{errorText(groups.error)}</p>
        ) : groups.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>No routing group yet.</Trans>
          </p>
        ) : (
          groups.data.map((group) => (
            <div className="grid gap-1.5 rounded-lg border p-3" key={group.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{group.name || group.id}</span>
                <span className="font-mono text-xs text-muted-foreground">group/{group.id}</span>
                {group.routing ? <Badge variant="secondary">{group.routing}</Badge> : null}
                {!group.ready ? (
                  <Badge variant="outline">
                    <Trans>Not ready</Trans>
                  </Badge>
                ) : null}
              </div>
              <p className="break-all font-mono text-[11px] text-muted-foreground">
                {group.members.join(" → ")}
              </p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
