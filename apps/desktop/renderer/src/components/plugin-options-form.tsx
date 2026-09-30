import type { PluginConfigOption } from "@cypheria/protocol"
import { Button } from "@cypheria/ui/components/button"
import { Input } from "@cypheria/ui/components/input"
import { Switch } from "@cypheria/ui/components/switch"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { integrationApi, type PluginAgent } from "../integration-api.js"

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "The request could not be completed."

const shownValue = (option: PluginConfigOption, edited: Record<string, string>): string =>
  edited[option.key] ?? option.value ?? (option.configured ? "" : (option.default ?? ""))

function OptionField({
  edited,
  onChange,
  option,
}: {
  edited: Record<string, string>
  onChange: (value: string) => void
  option: PluginConfigOption
}) {
  const id = `plugin-option-${option.key}`
  const value = shownValue(option, edited)
  // Values with several entries are edited in Claude Code; the single-line form cannot carry them.
  const readOnly = option.multiple
  return (
    <div className="grid gap-2 py-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="font-medium">
          {option.title}
          {option.required && !option.configured && (
            <span className="ml-2 font-normal text-destructive">Required</span>
          )}
        </label>
        {option.type === "boolean" && (
          <Switch
            id={id}
            aria-label={option.title}
            checked={value === "true"}
            disabled={readOnly}
            onCheckedChange={(checked) => onChange(checked ? "true" : "false")}
          />
        )}
      </div>
      <p className="text-muted-foreground">{option.description}</p>
      {option.type !== "boolean" &&
        (option.options ? (
          <select
            id={id}
            className="h-9 rounded-xl border bg-background px-3 text-sm"
            disabled={readOnly}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          >
            {!option.required && <option value="" />}
            {option.options.map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>
        ) : (
          <Input
            id={id}
            type={option.sensitive ? "password" : option.type === "number" ? "number" : "text"}
            autoComplete="off"
            disabled={readOnly}
            value={value}
            placeholder={
              option.sensitive && option.configured ? "Saved — enter a new value to replace it" : ""
            }
            onChange={(event) => onChange(event.target.value.replace(/[\r\n]/g, ""))}
          />
        ))}
      {readOnly && (
        <p className="text-muted-foreground">
          This option takes several values. Edit it in Claude Code.
        </p>
      )}
    </div>
  )
}

/** Options a plugin declares (`userConfig`), for an Agent that stores them. */
export function PluginOptionsForm({ agent, pluginId }: { agent: PluginAgent; pluginId: string }) {
  const cache = useQueryClient()
  const [edited, setEdited] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const queryKey = ["plugins", agent, "config", pluginId]
  const config = useQuery({
    queryKey,
    queryFn: async () => (await integrationApi.plugins.readConfig(agent, pluginId)).options,
  })
  const save = useMutation({
    mutationFn: async () => {
      const options = config.data ?? []
      const values = Object.fromEntries(
        Object.entries(edited).filter(([key, value]) => {
          const option = options.find((entry) => entry.key === key)
          // A blank secret means "keep the saved one".
          return option && !(option.sensitive && value === "")
        })
      )
      if (Object.keys(values).length === 0) return
      await integrationApi.plugins.writeConfig(agent, pluginId, values)
    },
    onSuccess: async () => {
      setEdited({})
      setSaved(true)
      await cache.invalidateQueries({ queryKey })
    },
  })
  if (config.isPending || !config.data?.length) return null
  const dirty = Object.keys(edited).length > 0
  return (
    <section className="mt-9" aria-label="Plugin options">
      <div className="mb-3 flex min-h-9 items-center justify-between border-b border-border/50 pb-3">
        <h2 className="text-base font-medium">
          Options
          <span className="ml-2 font-normal text-muted-foreground">{config.data.length}</span>
        </h2>
        <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
      <div className="divide-y divide-border/50">
        {config.data.map((option) => (
          <OptionField
            key={option.key}
            edited={edited}
            option={option}
            onChange={(value) => {
              setSaved(false)
              setEdited((current) => ({ ...current, [option.key]: value }))
            }}
          />
        ))}
      </div>
      {save.error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {errorText(save.error)}
        </p>
      )}
      {saved && !dirty && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          Saved.
        </p>
      )}
    </section>
  )
}
