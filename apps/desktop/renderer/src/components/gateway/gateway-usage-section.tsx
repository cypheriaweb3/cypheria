import type { MagpieUsagePeriod } from "@cypheria/protocol"
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cypheria/ui/components/select"
import { Skeleton } from "@cypheria/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@cypheria/ui/components/table"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { ensureCypheriaClient } from "../../cypheria-client.js"
import { errorText, magpieKeys, useMagpieReady } from "./magpie-queries"

export function GatewayUsageSection() {
  const { i18n } = useLingui()
  const ready = useMagpieReady()
  const [period, setPeriod] = useState<MagpieUsagePeriod>("7d")
  const usage = useQuery({
    enabled: ready,
    queryFn: async () => (await ensureCypheriaClient()).magpie.getUsage(period),
    queryKey: magpieKeys.usage(period),
  })
  const periods: Array<{ id: MagpieUsagePeriod; label: string }> = [
    { id: "today", label: i18n._(msg`Today`) },
    { id: "7d", label: i18n._(msg`Last 7 days`) },
    { id: "30d", label: i18n._(msg`Last 30 days`) },
    { id: "all", label: i18n._(msg`All time`) },
  ]
  const number = new Intl.NumberFormat(i18n.locale)
  const money = new Intl.NumberFormat(i18n.locale, { currency: "USD", style: "currency" })

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Usage</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>The requests the gateway served, their tokens and their cost.</Trans>
        </CardDescription>
        <CardAction>
          <Select
            value={period}
            onValueChange={(value) => value && setPeriod(value as MagpieUsagePeriod)}
          >
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue>{periods.find((item) => item.id === period)?.label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {periods.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        {!ready ? (
          <p className="text-sm text-muted-foreground">
            <Trans>Turn the gateway on to see its usage.</Trans>
          </p>
        ) : usage.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : usage.isError ? (
          <p className="text-sm text-destructive">{errorText(usage.error)}</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3 sm:grid-cols-4">
              <Total label={i18n._(msg`Requests`)} value={number.format(usage.data.totals.calls)} />
              <Total label={i18n._(msg`Errors`)} value={number.format(usage.data.totals.errors)} />
              <Total
                label={i18n._(msg`Tokens`)}
                value={number.format(
                  usage.data.totals.inputTokens + usage.data.totals.outputTokens
                )}
              />
              <Total label={i18n._(msg`Cost`)} value={money.format(usage.data.totals.costUsd)} />
            </dl>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Trans>Model</Trans>
                  </TableHead>
                  <TableHead className="text-right">
                    <Trans>Requests</Trans>
                  </TableHead>
                  <TableHead className="text-right">
                    <Trans>Cost</Trans>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage.data.byModel.map((row) => (
                  <TableRow key={`${row.provider}/${row.model}`}>
                    <TableCell>
                      <span className="font-mono text-xs">{row.model}</span>
                      {row.provider ? (
                        <span className="ml-2 text-xs text-muted-foreground">{row.provider}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">{number.format(row.calls)}</TableCell>
                    <TableCell className="text-right">{money.format(row.costUsd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium">{value}</dd>
    </div>
  )
}
