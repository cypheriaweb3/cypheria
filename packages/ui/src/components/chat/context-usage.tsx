import type { ButtonHTMLAttributes, ReactNode } from "react"

import { HoverCard, HoverCardContent, HoverCardTrigger } from "#components/hover-card"
import { Progress } from "#components/progress"
import { cn } from "#lib/utils"

export type ChatContextUsageAgent = "codex" | "claude" | "pi" | "opencode" | "acp"

export type ChatContextUsageTokenBreakdown = {
  cacheRead: number
  cacheWrite: number
  input: number
  output: number
  reasoning: number
  total: number
}

export type ChatContextUsageCategory = {
  kind: "used" | "free" | "buffer" | "deferred"
  label: ReactNode
  tokens: number
}

type ChatContextUsageProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  agent: ChatContextUsageAgent
  agentLabel: ReactNode
  categories?: readonly ChatContextUsageCategory[]
  costLabel?: ReactNode
  icon?: ReactNode
  maxTokens: number
  model?: ReactNode
  sessionTokens?: ChatContextUsageTokenBreakdown | null
  sourceLabel: ReactNode
  tokens?: ChatContextUsageTokenBreakdown | null
  usedTokens: number
}

const compactTokens = (value: number): string =>
  Intl.NumberFormat(undefined, { maximumFractionDigits: 1, notation: "compact" }).format(value)

const agentStroke = (agent: ChatContextUsageAgent): string => {
  if (agent === "claude") return "stroke-orange-500"
  if (agent === "pi") return "stroke-sky-500"
  if (agent === "opencode") return "stroke-cyan-500"
  if (agent === "acp") return "stroke-violet-500"
  return "stroke-primary/70"
}

const detailRows = ({
  agent,
  categories = [],
  sessionTokens,
  tokens,
}: Pick<ChatContextUsageProps, "agent" | "categories" | "sessionTokens" | "tokens">) => {
  if (agent === "claude") {
    return categories
      .filter((category) => category.tokens > 0 && category.kind !== "free")
      .slice(0, 5)
      .map((category) => ({
        id: `${category.kind}:${category.tokens}:${String(category.label)}`,
        label: category.label,
        value: compactTokens(category.tokens),
      }))
  }
  const source = agent === "pi" ? sessionTokens : tokens
  if (!source) return []
  const candidates = [
    ["Input", source.input],
    ["Cached", source.cacheRead],
    ["Reasoning", source.reasoning],
    ["Output", source.output],
  ] as const
  return candidates
    .filter(([, value]) => value > 0)
    .map(([label, value]) => ({ id: label, label, value: compactTokens(value) }))
}

export function ChatContextUsage({
  agent,
  agentLabel,
  categories,
  className,
  costLabel,
  icon,
  maxTokens,
  model,
  sessionTokens,
  sourceLabel,
  tokens,
  usedTokens,
  ...props
}: ChatContextUsageProps) {
  const percentage = maxTokens > 0 ? (usedTokens / maxTokens) * 100 : 0
  const displayPercentage = Math.round(percentage)
  const rows = detailRows({ agent, categories, sessionTokens, tokens })
  const remaining = Math.max(0, maxTokens - usedTokens)

  return (
    <HoverCard closeDelay={100} openDelay={180}>
      <HoverCardTrigger
        render={
          <button
            aria-label={`${String(agentLabel)} context ${displayPercentage}%`}
            className={cn(
              "group flex h-7 items-center gap-1.5 rounded-lg px-1.5 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
              className
            )}
            data-agent={agent}
            data-slot="chat-context-usage"
            type="button"
            {...props}
          />
        }
      >
        <span className="grid size-4 place-items-center [&_img]:size-3.5 [&_svg]:size-3.5">
          {icon}
        </span>
        <span className="relative grid size-5 shrink-0 place-items-center">
          <svg aria-hidden="true" className="absolute inset-0 -rotate-90" viewBox="0 0 20 20">
            <circle className="fill-none stroke-muted" cx="10" cy="10" r="8" strokeWidth="2" />
            <circle
              className={cn(
                "fill-none transition-all",
                percentage >= 90
                  ? "stroke-destructive"
                  : percentage >= 75
                    ? "stroke-amber-500"
                    : agentStroke(agent)
              )}
              cx="10"
              cy="10"
              pathLength="100"
              r="8"
              strokeDasharray="100"
              strokeDashoffset={100 - Math.min(100, percentage)}
              strokeLinecap="round"
              strokeWidth="2"
            />
          </svg>
          <span className="text-[8px] font-medium tabular-nums">{displayPercentage}</span>
        </span>
        <span className="tabular-nums">{compactTokens(usedTokens)}</span>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-72 p-3" side="top">
        <div className="flex items-start gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted [&_img]:size-5 [&_svg]:size-5">
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{agentLabel}</span>
              <span className="text-xs font-medium tabular-nums">{displayPercentage}%</span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              {model ? <span className="truncate">{model}</span> : null}
              {model ? <span aria-hidden="true">·</span> : null}
              <span className="shrink-0">{sourceLabel}</span>
            </div>
          </div>
        </div>
        <Progress className="mt-3 gap-0" value={Math.min(100, percentage)} />
        <div className="mt-2 flex justify-between text-[11px] text-muted-foreground tabular-nums">
          <span>{compactTokens(usedTokens)} used</span>
          <span>{compactTokens(remaining)} remaining</span>
          <span>{compactTokens(maxTokens)} total</span>
        </div>
        {rows.length ? (
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t pt-2 text-xs">
            {rows.map((row) => (
              <div className="flex min-w-0 items-center justify-between gap-2" key={row.id}>
                <span className="truncate text-muted-foreground">{row.label}</span>
                <span className="shrink-0 tabular-nums">{row.value}</span>
              </div>
            ))}
          </div>
        ) : null}
        {costLabel ? (
          <div className="mt-2 border-t pt-2 text-xs text-muted-foreground">{costLabel}</div>
        ) : null}
      </HoverCardContent>
    </HoverCard>
  )
}

export type { ChatContextUsageProps }
