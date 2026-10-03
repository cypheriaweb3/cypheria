import type { GitSettings } from "@cypheria/protocol"
import { SettingsSection } from "@cypheria/ui/components/settings-rows"
import { Textarea } from "@cypheria/ui/components/textarea"
import { ToggleGroup, ToggleGroupItem } from "@cypheria/ui/components/toggle-group"
import { Trans } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useEffect, useRef, useState } from "react"

import { ensureCypheriaClient } from "../cypheria-client.js"

/** Git and worktree settings from Server configuration; each change saves at once. */
export const useGitSettings = () => {
  const queryClient = useQueryClient()
  const config = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).settings.get(),
    queryKey: ["settings", "server-config"],
    retry: false,
  })
  const save = useMutation({
    mutationFn: async (patch: Partial<GitSettings>) =>
      (await ensureCypheriaClient()).settings.update({ git: patch }),
    onSuccess: (snapshot) => queryClient.setQueryData(["settings", "server-config"], snapshot),
  })
  return {
    error: config.error ?? save.error,
    restartRequired: config.data?.restartRequiredPaths ?? [],
    save: (patch: Partial<GitSettings>) => save.mutateAsync(patch),
    saving: save.isPending,
    settings: config.data?.config.git ?? null,
  }
}

/** A two- or three-way choice drawn as a segmented control. */
export function Segmented<Value extends string>({
  label,
  onChange,
  options,
  value,
  disabled,
}: Readonly<{
  label: string
  onChange: (value: Value) => void
  options: readonly { value: Value; label: ReactNode }[]
  value: Value
  disabled?: boolean
}>) {
  return (
    <ToggleGroup
      aria-label={label}
      className="rounded-lg border border-border p-0.5"
      disabled={disabled}
      value={[value]}
      onValueChange={(next) => {
        const selected = next[0]
        if (selected && selected !== value) onChange(selected as Value)
      }}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} className="h-7 px-3 text-sm" value={option.value}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/** Instructions that save themselves after typing pauses, with a Saved or failure note. */
export function InstructionsSetting({
  ariaLabel,
  children,
  description,
  onSave,
  placeholder,
  rows = 4,
  title,
  value,
}: Readonly<{
  ariaLabel: string
  children?: ReactNode
  description?: ReactNode
  onSave: (value: string) => Promise<unknown>
  placeholder: string
  rows?: number
  title: ReactNode
  value: string
}>) {
  const [draft, setDraft] = useState(value)
  const [state, setState] = useState<"idle" | "saved" | "error">("idle")
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirty = useRef(false)
  useEffect(() => {
    if (!dirty.current) setDraft(value)
  }, [value])
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )
  const schedule = (next: string) => {
    dirty.current = true
    setDraft(next)
    setState("idle")
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      onSave(next).then(
        () => {
          dirty.current = false
          setState("saved")
        },
        () => setState("error")
      )
    }, 800)
  }
  return (
    <SettingsSection
      actions={
        state === "saved" ? (
          <span className="text-muted-foreground text-xs">
            <Trans id="settings.git.instructions.autoSave.saved">Saved</Trans>
          </span>
        ) : state === "error" ? (
          <span className="text-destructive text-xs">
            <Trans id="settings.git.instructions.autoSave.error">Failed to save instructions</Trans>
          </span>
        ) : null
      }
      description={description}
      title={title}
    >
      <div className="p-1">
        <Textarea
          aria-label={ariaLabel}
          className="resize-y border-0 shadow-none focus-visible:ring-0"
          placeholder={placeholder}
          rows={rows}
          value={draft}
          onChange={(event) => schedule(event.target.value)}
        />
      </div>
      {children}
    </SettingsSection>
  )
}
