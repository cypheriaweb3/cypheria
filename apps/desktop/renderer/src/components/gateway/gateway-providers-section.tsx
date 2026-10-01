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

export function GatewayProvidersSection() {
  const ready = useMagpieReady()
  const providers = useQuery({
    enabled: ready,
    queryFn: async () => (await ensureCypheriaClient()).magpie.listProviders(),
    queryKey: magpieKeys.providers,
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Providers</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            The subscriptions of the Agents Cypheria manages, signed in where those Agents keep
            their sign-in, and the providers added with a key.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {!ready ? (
          <p className="text-sm text-muted-foreground">
            <Trans>Turn the gateway on to see its providers.</Trans>
          </p>
        ) : providers.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : providers.isError ? (
          <p className="text-sm text-destructive">{errorText(providers.error)}</p>
        ) : providers.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>No provider yet.</Trans>
          </p>
        ) : (
          providers.data.map((provider) => (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              key={provider.id}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{provider.name}</span>
                  <Badge variant="secondary">
                    {provider.kind === "subscription" ? (
                      <Trans>Subscription</Trans>
                    ) : (
                      <Trans>Key</Trans>
                    )}
                  </Badge>
                  {provider.off ? (
                    <Badge variant="outline">
                      <Trans>Off</Trans>
                    </Badge>
                  ) : !provider.ready ? (
                    <Badge variant="outline">
                      <Trans>Not ready</Trans>
                    </Badge>
                  ) : null}
                </div>
                {provider.account ? (
                  <p className="truncate text-xs text-muted-foreground">
                    {provider.account.user}
                    {provider.account.plan ? ` · ${provider.account.plan}` : ""}
                  </p>
                ) : null}
              </div>
              <span className="text-xs text-muted-foreground">
                <Trans>{provider.exposedModels} models</Trans>
              </span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
