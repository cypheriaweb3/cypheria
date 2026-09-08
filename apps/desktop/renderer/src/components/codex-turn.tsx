import type { CodexTurnItemSnapshot } from "@cypheria/codex-bridge"
import { cn } from "@cypheria/ui"
import { CodeBlock } from "@cypheria/ui/ai-elements/code-block"
import { Message, MessageContent, MessageResponse } from "@cypheria/ui/ai-elements/message"
import { Task, TaskContent, TaskItem, TaskTrigger } from "@cypheria/ui/ai-elements/task"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@cypheria/ui/components/collapsible"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import {
  BookOpen,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  FilePenLine,
  FileSearch,
  ImageIcon,
  ListChecks,
  LoaderCircle,
  Search,
  TerminalSquare,
  Users,
  Wrench,
} from "lucide-react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"

import type { CodexUiMessage } from "../../../ipc/src/index.js"
import { type CodexActivityUnit, deriveCodexTurnView } from "./codex-turn-view.js"

const formatDuration = (durationMs: number): string => {
  const seconds = Math.max(0, Math.round(durationMs / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`
}

const useTurnDuration = (
  status: string,
  startedAt: number | null,
  completedAt: number | null,
  durationMs: number | null
): number => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (status !== "inProgress") return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [status])
  if (durationMs !== null) return durationMs
  if (startedAt === null) return 0
  const end = completedAt === null ? now : completedAt * 1000
  return Math.max(0, end - startedAt * 1000)
}

const isItemActive = (snapshot: CodexTurnItemSnapshot): boolean => {
  if (snapshot.lifecycle === "completed") return false
  const item = snapshot.item
  if ("status" in item && typeof item.status === "string") {
    return item.status === "inProgress" || item.status === "running"
  }
  return true
}

const itemIcon = (snapshot: CodexTurnItemSnapshot): ReactNode => {
  switch (snapshot.item.type) {
    case "commandExecution":
      return <TerminalSquare />
    case "fileChange":
      return <FilePenLine />
    case "webSearch":
      return <Search />
    case "imageView":
      return <FileSearch />
    case "imageGeneration":
      return <ImageIcon />
    case "collabAgentToolCall":
    case "subAgentActivity":
      return <Users />
    case "plan":
      return <ListChecks />
    case "reasoning":
      return <BookOpen />
    default:
      return <Wrench />
  }
}

const itemTitle = (
  snapshot: CodexTurnItemSnapshot,
  i18n: ReturnType<typeof useLingui>["i18n"]
): string => {
  const item = snapshot.item
  switch (item.type) {
    case "commandExecution": {
      const action = item.commandActions[0]
      if (action?.type === "read") {
        return i18n._({
          ...msg({ id: "chat.turn.readFile", message: "Read {name}" }),
          values: { name: action.name || action.path },
        })
      }
      if (action?.type === "search") {
        return i18n._({
          ...msg({ id: "chat.turn.searched", message: "Searched for {query}" }),
          values: { query: action.query ?? item.command },
        })
      }
      return isItemActive(snapshot)
        ? i18n._({
            ...msg({ id: "chat.turn.runningCommand", message: "Running {command}" }),
            values: { command: item.command },
          })
        : i18n._({
            ...msg({ id: "chat.turn.ranCommand", message: "Ran {command}" }),
            values: { command: item.command },
          })
    }
    case "fileChange":
      return isItemActive(snapshot)
        ? i18n._(msg({ id: "chat.turn.editingFiles", message: "Editing files" }))
        : i18n._(msg({ id: "chat.turn.editedFiles", message: "Edited files" }))
    case "webSearch":
      return i18n._({
        ...msg({ id: "chat.turn.searchedWeb", message: "Searched the web for {query}" }),
        values: { query: item.query },
      })
    case "mcpToolCall":
      return `${item.server} · ${item.tool}`
    case "dynamicToolCall":
      return item.namespace ? `${item.namespace} · ${item.tool}` : item.tool
    case "collabAgentToolCall":
      return i18n._({
        ...msg({ id: "chat.turn.agentActivity", message: "Agent {tool}" }),
        values: { tool: item.tool },
      })
    case "subAgentActivity":
      return `${item.agentPath} · ${item.kind}`
    case "functionCallOutput":
      return item.namespace ? `${item.namespace} · ${item.name}` : item.name
    case "imageView":
      return i18n._({
        ...msg({ id: "chat.turn.viewedImage", message: "Viewed {path}" }),
        values: { path: item.path },
      })
    case "imageGeneration":
      return isItemActive(snapshot)
        ? i18n._(msg({ id: "chat.turn.generatingImage", message: "Generating image" }))
        : i18n._(msg({ id: "chat.turn.generatedImage", message: "Generated image" }))
    case "plan":
      return i18n._(msg({ id: "chat.turn.proposedPlan", message: "Proposed plan" }))
    case "sleep":
      return i18n._({
        ...msg({ id: "chat.turn.waited", message: "Waited {time}" }),
        values: { time: formatDuration(item.durationMs) },
      })
    case "contextCompaction":
      return i18n._(msg({ id: "chat.turn.compacted", message: "Compacted conversation context" }))
    case "enteredReviewMode":
      return i18n._(msg({ id: "chat.turn.enteredReview", message: "Entered review mode" }))
    case "exitedReviewMode":
      return i18n._(msg({ id: "chat.turn.exitedReview", message: "Exited review mode" }))
    case "agentMessage":
      return i18n._(msg({ id: "chat.turn.update", message: "Update" }))
    case "reasoning":
      return (
        item.summary.find(Boolean) ?? i18n._(msg({ id: "chat.turn.thought", message: "Thought" }))
      )
    case "userMessage":
    case "hookPrompt":
      return item.type
  }
}

const groupTitle = (
  unit: Extract<CodexActivityUnit, { kind: "group" }>,
  i18n: ReturnType<typeof useLingui>["i18n"]
): string => {
  if (unit.reasoning?.item.type === "reasoning") {
    const summary = unit.reasoning.item.summary.filter(Boolean).join(" ").trim()
    if (summary) return summary
  }
  const active = unit.items.findLast(isItemActive)
  if (active) return itemTitle(active, i18n)
  const labels = new Set<string>()
  for (const snapshot of unit.items) {
    switch (snapshot.item.type) {
      case "commandExecution": {
        const actions = snapshot.item.commandActions
        if (actions.some((action) => action.type === "read")) {
          labels.add(i18n._(msg({ id: "chat.turn.readFiles", message: "Read files" })))
        } else if (actions.some((action) => action.type === "search")) {
          labels.add(i18n._(msg({ id: "chat.turn.searchedCode", message: "Searched code" })))
        } else {
          labels.add(i18n._(msg({ id: "chat.turn.ranCommands", message: "Ran commands" })))
        }
        break
      }
      case "fileChange":
        labels.add(i18n._(msg({ id: "chat.turn.editedFiles", message: "Edited files" })))
        break
      case "webSearch":
        labels.add(i18n._(msg({ id: "chat.turn.searchedWebShort", message: "Searched the web" })))
        break
      case "imageView":
        labels.add(i18n._(msg({ id: "chat.turn.viewedImages", message: "Viewed images" })))
        break
      case "imageGeneration":
        labels.add(i18n._(msg({ id: "chat.turn.generatedImages", message: "Generated images" })))
        break
      case "collabAgentToolCall":
      case "subAgentActivity":
        labels.add(
          i18n._(msg({ id: "chat.turn.coordinatedAgents", message: "Coordinated agents" }))
        )
        break
      case "plan":
        labels.add(i18n._(msg({ id: "chat.turn.updatedPlan", message: "Updated plan" })))
        break
      default:
        labels.add(i18n._(msg({ id: "chat.turn.usedTools", message: "Used tools" })))
    }
  }
  return [...labels].join(", ") || i18n._(msg({ id: "chat.turn.thought", message: "Thought" }))
}

const jsonValue = (value: unknown): string => JSON.stringify(value, null, 2)

function ActivityItem({ snapshot }: Readonly<{ snapshot: CodexTurnItemSnapshot }>) {
  const { i18n } = useLingui()
  const item = snapshot.item
  const active = isItemActive(snapshot)
  let detail: ReactNode = null
  switch (item.type) {
    case "commandExecution":
      detail = (
        <CodeBlock
          code={`$ ${item.command}\n${item.aggregatedOutput ?? snapshot.progress}`.trimEnd()}
          language="shell"
        />
      )
      break
    case "fileChange":
      detail = item.changes.map((change) => (
        <div className="space-y-1" key={`${change.path}:${change.kind}`}>
          <div className="font-mono text-xs">{change.path}</div>
          {change.diff ? <CodeBlock code={change.diff} language="diff" /> : null}
        </div>
      ))
      break
    case "mcpToolCall":
      detail = (
        <CodeBlock code={jsonValue(item.result ?? item.error ?? item.arguments)} language="json" />
      )
      break
    case "dynamicToolCall":
      detail = <CodeBlock code={jsonValue(item.contentItems ?? item.arguments)} language="json" />
      break
    case "collabAgentToolCall":
      detail = <CodeBlock code={jsonValue(item.agentsStates)} language="json" />
      break
    case "functionCallOutput":
      detail = <CodeBlock code={jsonValue(item.output)} language="json" />
      break
    case "webSearch":
      detail = item.results?.length ? (
        <CodeBlock code={jsonValue(item.results)} language="json" />
      ) : null
      break
    case "imageGeneration":
      detail =
        item.result && !item.failure ? (
          <img
            alt={item.revisedPrompt ?? "Generated"}
            className="max-h-80 rounded-lg"
            src={item.result}
          />
        ) : item.failure ? (
          <CodeBlock code={jsonValue(item.failure)} language="json" />
        ) : null
      break
    case "plan":
      detail = <MessageResponse>{item.text}</MessageResponse>
      break
    case "enteredReviewMode":
    case "exitedReviewMode":
      detail = <MessageResponse>{item.review}</MessageResponse>
      break
  }

  if (!detail) {
    return (
      <TaskItem className="flex min-w-0 items-start gap-2 py-1.5">
        <span className="mt-0.5 size-4 shrink-0 [&_svg]:size-4">{itemIcon(snapshot)}</span>
        <span className="min-w-0 break-words">{itemTitle(snapshot, i18n)}</span>
        {active ? <LoaderCircle className="ml-auto size-3.5 shrink-0 animate-spin" /> : null}
      </TaskItem>
    )
  }

  return (
    <Task className="min-w-0" defaultOpen={false}>
      <TaskTrigger className="w-full" title={itemTitle(snapshot, i18n)}>
        <div className="flex w-full min-w-0 cursor-pointer items-start gap-2 py-1.5 text-muted-foreground text-sm hover:text-foreground">
          <span className="mt-0.5 size-4 shrink-0 [&_svg]:size-4">{itemIcon(snapshot)}</span>
          <span className="min-w-0 flex-1 break-words text-left">{itemTitle(snapshot, i18n)}</span>
          {active ? (
            <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0 transition-transform group-data-panel-open:rotate-180" />
          )}
        </div>
      </TaskTrigger>
      <TaskContent className="pb-2">{detail}</TaskContent>
    </Task>
  )
}

function ActivityUnit({ unit }: Readonly<{ unit: CodexActivityUnit }>) {
  const { i18n } = useLingui()
  if (unit.kind === "commentary") {
    return unit.item.item.type === "agentMessage" && unit.item.item.text ? (
      <MessageResponse className="py-1">{unit.item.item.text}</MessageResponse>
    ) : null
  }
  const reasoning = unit.reasoning
  const reasoningBody =
    reasoning?.item.type === "reasoning"
      ? [...reasoning.item.summary.slice(1), ...reasoning.item.content].filter(Boolean).join("\n\n")
      : ""
  const active = Boolean(reasoning && isItemActive(reasoning)) || unit.items.some(isItemActive)
  return (
    <Task defaultOpen={active}>
      <TaskTrigger title={groupTitle(unit, i18n)}>
        <div className="flex w-full cursor-pointer items-center gap-2 py-1 text-muted-foreground text-sm transition-colors hover:text-foreground">
          {active ? (
            <LoaderCircle className="size-4 shrink-0 animate-spin" />
          ) : (
            <BookOpen className="size-4 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate text-left">{groupTitle(unit, i18n)}</span>
          <ChevronDown className="size-4 shrink-0 transition-transform group-data-panel-open:rotate-180" />
        </div>
      </TaskTrigger>
      <TaskContent>
        {reasoningBody ? (
          <div className="max-h-56 overflow-auto border-border border-b pb-3 text-muted-foreground text-sm">
            <MessageResponse>{reasoningBody}</MessageResponse>
          </div>
        ) : null}
        {unit.items.map((snapshot) => (
          <ActivityItem key={snapshot.item.id} snapshot={snapshot} />
        ))}
      </TaskContent>
    </Task>
  )
}

export function CodexTurnMessage({
  blockingContent,
  message,
}: Readonly<{ blockingContent?: ReactNode; message: CodexUiMessage }>) {
  const { i18n } = useLingui()
  const view = useMemo(() => deriveCodexTurnView(message), [message])
  const shouldCollapse = Boolean(
    view?.finalAnswer &&
      view.activity.length &&
      view.turn.status !== "inProgress" &&
      !blockingContent
  )
  const [activityOpen, setActivityOpen] = useState(!shouldCollapse)
  const userChangedOpen = useRef(false)

  useEffect(() => {
    if (blockingContent) setActivityOpen(true)
    else if (shouldCollapse && !userChangedOpen.current) setActivityOpen(false)
  }, [blockingContent, shouldCollapse])

  const duration = useTurnDuration(
    view?.turn.status ?? "completed",
    view?.turn.startedAt ?? null,
    view?.turn.completedAt ?? null,
    view?.turn.durationMs ?? null
  )

  if (!view) return null
  const elapsed = formatDuration(duration)
  const activityLabel =
    view.turn.status === "inProgress"
      ? duration > 0
        ? i18n._({
            ...msg({ id: "chat.turn.workingFor", message: "Working for {time}" }),
            values: { time: elapsed },
          })
        : i18n._(msg({ id: "chat.turn.working", message: "Working" }))
      : view.turn.status === "interrupted"
        ? i18n._({
            ...msg({ id: "chat.turn.stoppedAfter", message: "You stopped after {time}" }),
            values: { time: elapsed },
          })
        : view.turn.status === "failed"
          ? i18n._({
              ...msg({ id: "chat.turn.failedAfter", message: "Failed after {time}" }),
              values: { time: elapsed },
            })
          : i18n._({
              ...msg({ id: "chat.turn.workedFor", message: "Worked for {time}" }),
              values: { time: elapsed },
            })

  return (
    <Message from="assistant">
      <MessageContent className="gap-4">
        {view.activity.length || view.turn.status === "inProgress" || blockingContent ? (
          <Collapsible
            onOpenChange={(open) => {
              userChangedOpen.current = true
              setActivityOpen(open)
            }}
            open={activityOpen}
          >
            <div className="flex items-center gap-3 py-1 text-muted-foreground">
              <CollapsibleTrigger className="group flex shrink-0 items-center gap-2 text-sm hover:text-foreground">
                {view.turn.status === "inProgress" ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : view.turn.status === "failed" ? (
                  <CircleAlert className="size-4 text-destructive" />
                ) : view.turn.status === "interrupted" ? (
                  <Clock3 className="size-4" />
                ) : (
                  <Check className="size-4" />
                )}
                <span>{activityLabel}</span>
                <ChevronDown
                  className={cn("size-4 transition-transform", activityOpen && "rotate-180")}
                />
              </CollapsibleTrigger>
              <span className="h-px min-w-8 flex-1 bg-border" />
            </div>
            <CollapsibleContent className="space-y-4 pt-4 data-closed:animate-out data-open:animate-in">
              {view.activity.length ? (
                view.activity.map((unit) => <ActivityUnit key={unit.id} unit={unit} />)
              ) : (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <LoaderCircle className="size-4 animate-spin" />
                  {i18n._(msg({ id: "chat.turn.thinking", message: "Thinking" }))}
                </div>
              )}
              {view.plan ? (
                <Task defaultOpen={false}>
                  <TaskTrigger title={i18n._(msg({ id: "chat.turn.plan", message: "Plan" }))} />
                  <TaskContent>
                    {view.plan.explanation ? <TaskItem>{view.plan.explanation}</TaskItem> : null}
                    {view.plan.plan.map((step) => (
                      <TaskItem className="flex gap-2" key={step.step}>
                        {step.status === "completed" ? (
                          <Check className="mt-0.5 size-4 shrink-0" />
                        ) : step.status === "inProgress" ? (
                          <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin" />
                        ) : (
                          <span className="mt-1.5 size-2 shrink-0 rounded-full border" />
                        )}
                        {step.step}
                      </TaskItem>
                    ))}
                  </TaskContent>
                </Task>
              ) : null}
              {view.modelReroutes.map((reroute) => (
                <div
                  className="flex items-center gap-2 text-muted-foreground text-xs"
                  key={`${reroute.fromModel}:${reroute.toModel}`}
                >
                  <CircleAlert className="size-3.5" />
                  {i18n._({
                    ...msg({
                      id: "chat.turn.modelRerouted",
                      message: "Model changed from {fromModel} to {toModel}",
                    }),
                    values: { fromModel: reroute.fromModel, toModel: reroute.toModel },
                  })}
                </div>
              ))}
              {blockingContent}
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        {view.finalAnswer?.item.type === "agentMessage" ? (
          <MessageResponse>{view.finalAnswer.item.text}</MessageResponse>
        ) : null}

        {view.turn.error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm">
            {view.turn.error.message}
          </div>
        ) : null}

        {view.diff?.diff ? (
          <Task defaultOpen={false}>
            <TaskTrigger title={i18n._(msg({ id: "chat.turn.diff", message: "Turn changes" }))} />
            <TaskContent>
              <CodeBlock code={view.diff.diff} language="diff" />
            </TaskContent>
          </Task>
        ) : null}
      </MessageContent>
    </Message>
  )
}
