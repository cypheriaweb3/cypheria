import type { HTMLAttributes, ReactNode } from "react"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "#components/select"
import { cn } from "#lib/utils"
import { BrainIcon } from "../icons/index.js"

export type ChatModelSelectorOption = {
  description?: ReactNode
  icon?: ReactNode
  label: ReactNode
  value: string
}

type SelectorProps = {
  ariaLabel: string
  icon?: ReactNode
  options: readonly ChatModelSelectorOption[]
  placeholder: ReactNode
  value: string | null
  onValueChange: (value: string) => void
}

function Selector({ ariaLabel, icon, onValueChange, options, placeholder, value }: SelectorProps) {
  if (options.length === 0) return null
  const selected = options.find((option) => option.value === value)
  return (
    <Select onValueChange={(next) => next && onValueChange(String(next))} value={value}>
      <SelectTrigger
        aria-label={ariaLabel}
        className="h-7 max-w-44 border-0 bg-transparent px-1.5 text-xs shadow-none"
        size="sm"
      >
        {selected?.icon ?? icon}
        <SelectValue>{selected?.label ?? placeholder}</SelectValue>
      </SelectTrigger>
      <SelectContent align="start" className="min-w-48">
        <SelectGroup>
          <SelectLabel>{ariaLabel}</SelectLabel>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.icon}
              <span className="min-w-0">
                <span className="block truncate">{option.label}</span>
                {option.description ? (
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

type ChatModelSelectorProps = Omit<HTMLAttributes<HTMLDivElement>, "onChange"> & {
  agent: string
  agentLabel: string
  agentOptions: readonly ChatModelSelectorOption[]
  labels: { agent: string; model: string; reasoning: string; speed: string }
  model: string | null
  modelOptions: readonly ChatModelSelectorOption[]
  onAgentChange: (value: string) => void
  onModelChange: (value: string) => void
  onReasoningChange: (value: string) => void
  onSpeedChange: (value: string) => void
  reasoning: string | null
  reasoningOptions: readonly ChatModelSelectorOption[]
  speed: string | null
  speedOptions: readonly ChatModelSelectorOption[]
}

export function ChatModelSelector({
  agent,
  agentLabel,
  agentOptions,
  className,
  labels,
  model,
  modelOptions,
  onAgentChange,
  onModelChange,
  onReasoningChange,
  onSpeedChange,
  reasoning,
  reasoningOptions,
  speed,
  speedOptions,
  ...props
}: ChatModelSelectorProps) {
  return (
    <div
      className={cn("flex min-w-0 items-center gap-0.5", className)}
      data-slot="chat-model-selector"
      {...props}
    >
      <Selector
        ariaLabel={labels.agent}
        onValueChange={onAgentChange}
        options={agentOptions}
        placeholder={agentLabel}
        value={agent}
      />
      <Selector
        ariaLabel={labels.model}
        icon={<BrainIcon />}
        onValueChange={onModelChange}
        options={modelOptions}
        placeholder={labels.model}
        value={model}
      />
      <Selector
        ariaLabel={labels.reasoning}
        onValueChange={onReasoningChange}
        options={reasoningOptions}
        placeholder={labels.reasoning}
        value={reasoning}
      />
      <Selector
        ariaLabel={labels.speed}
        onValueChange={onSpeedChange}
        options={speedOptions}
        placeholder={labels.speed}
        value={speed}
      />
    </div>
  )
}

export type { ChatModelSelectorProps }
