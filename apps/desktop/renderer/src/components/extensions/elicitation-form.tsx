import { Button } from "@cypheria/ui/components/button"
import { Input } from "@cypheria/ui/components/input"
import { Switch } from "@cypheria/ui/components/switch"
import { cn } from "@cypheria/ui/lib/utils"
import { Trans } from "@lingui/react/macro"
import { Check, X } from "lucide-react"
import { useMemo, useState } from "react"

type Json = Record<string, unknown>
type Option = { description: string | null; thumbnail: string | null; title: string; value: string }
type Field =
  | {
      kind: "text"
      format: string | null
      max?: number
      min?: number
      pattern: string | null
      suggestions: Option[]
    }
  | { kind: "number"; integer: boolean; max?: number; min?: number }
  | { kind: "boolean" }
  | { kind: "choice"; options: Option[] }
  | { kind: "multi"; custom: boolean; max?: number; min?: number; options: Option[] }

type Parsed = {
  description: string | null
  field: Field
  key: string
  required: boolean
  title: string
}
type Value = string | number | boolean | string[] | undefined

const record = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {}
const text = (value: unknown): string | null => (typeof value === "string" ? value : null)
const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined

/** Thumbnails must be HTTPS or image data, as the extensions specification requires. */
const thumbnail = (value: unknown): string | null => {
  const src = text(record(value).src)
  return src && (src.startsWith("https://") || src.startsWith("data:image/")) ? src : null
}

/** Titled `const` options, `enum` values, or resource options of `x-openai-input`. */
const optionsOf = (schema: Json): Option[] | null => {
  const input = record(schema["x-openai-input"])
  if (input.type === "resource" || input.type === "file") {
    return (Array.isArray(input.options) ? input.options : []).flatMap((option) => {
      const item = record(option)
      const uri = text(item.uri)
      if (!uri) return []
      const meta = record(item._meta)
      return [
        {
          description: text(item.description),
          thumbnail: thumbnail(meta["openai/thumbnail"]),
          title: text(item.title) ?? text(item.name) ?? uri,
          value: uri,
        },
      ]
    })
  }
  const titled = schema.oneOf ?? schema.anyOf
  if (Array.isArray(titled)) {
    return titled.flatMap((option) => {
      const item = record(option)
      const value = text(item.const)
      if (value === null) return []
      return [
        {
          description: text(item.description),
          thumbnail: thumbnail(item["x-openai-thumbnail"]),
          title: text(item.title) ?? value,
          value,
        },
      ]
    })
  }
  if (Array.isArray(schema.enum)) {
    const names = Array.isArray(schema.enumNames) ? schema.enumNames : []
    return schema.enum.flatMap((value, index) =>
      typeof value === "string"
        ? [{ description: null, thumbnail: null, title: text(names[index]) ?? value, value }]
        : []
    )
  }
  return null
}

const suggestionsOf = (schema: Json): Option[] =>
  (Array.isArray(schema["x-openai-suggestions"]) ? schema["x-openai-suggestions"] : []).flatMap(
    (option) => {
      const item = record(option)
      const value = text(item.const)
      return value === null
        ? []
        : [
            {
              description: text(item.description),
              thumbnail: null,
              title: text(item.title) ?? value,
              value,
            },
          ]
    }
  )

/** A form field, or `null` when Cypheria cannot show it. */
const fieldOf = (schema: Json): Field | null => {
  const input = record(schema["x-openai-input"])
  if ((input.type === "resource" || input.type === "file") && input.selection === "implicit") {
    // Implicit selection adds and removes items, including uploads, which Cypheria cannot offer.
    return null
  }
  if (schema.type === "string") {
    const options = optionsOf(schema)
    if (options) return { kind: "choice", options }
    return {
      format: text(schema.format),
      kind: "text",
      ...(count(schema.maxLength) === undefined ? {} : { max: count(schema.maxLength) }),
      ...(count(schema.minLength) === undefined ? {} : { min: count(schema.minLength) }),
      pattern: text(schema.pattern),
      suggestions: suggestionsOf(schema),
    }
  }
  if (schema.type === "number" || schema.type === "integer") {
    return {
      integer: schema.type === "integer",
      kind: "number",
      ...(count(schema.maximum) === undefined ? {} : { max: count(schema.maximum) }),
      ...(count(schema.minimum) === undefined ? {} : { min: count(schema.minimum) }),
    }
  }
  if (schema.type === "boolean") return { kind: "boolean" }
  if (schema.type === "array") {
    const items = record(schema.items)
    const options = optionsOf({
      ...items,
      "x-openai-input": schema["x-openai-input"] ?? items["x-openai-input"],
    })
    const suggestions = suggestionsOf(items)
    if (!options && suggestions.length === 0) return null
    return {
      custom: !options,
      kind: "multi",
      ...(count(schema.maxItems) === undefined ? {} : { max: count(schema.maxItems) }),
      ...(count(schema.minItems) === undefined ? {} : { min: count(schema.minItems) }),
      options: options ?? suggestions,
    }
  }
  return null
}

/** Parses a requested schema; `null` when any field is unsupported, so nothing is shown partly. */
export const parseElicitationSchema = (
  schema: unknown
): { fields: Parsed[]; defaults: Record<string, Value> } | null => {
  const root = record(schema)
  const properties = record(root.properties)
  const required = new Set(Array.isArray(root.required) ? root.required.map(String) : [])
  const fields: Parsed[] = []
  const defaults: Record<string, Value> = {}
  for (const [key, raw] of Object.entries(properties)) {
    const property = record(raw)
    const field = fieldOf(property)
    if (!field) return null
    fields.push({
      description: text(property.description),
      field,
      key,
      required: required.has(key),
      title: text(property.title) ?? key,
    })
    if (property.default !== undefined) defaults[key] = property.default as Value
  }
  return { defaults, fields }
}

const invalid = (parsed: Parsed, value: Value): boolean => {
  const empty = value === undefined || value === "" || (Array.isArray(value) && value.length === 0)
  if (empty) return parsed.required
  const { field } = parsed
  switch (field.kind) {
    case "text": {
      if (typeof value !== "string") return true
      if (field.min !== undefined && value.length < field.min) return true
      if (field.max !== undefined && value.length > field.max) return true
      if (field.pattern) {
        try {
          if (!new RegExp(field.pattern, "u").test(value)) return true
        } catch {
          return true
        }
      }
      if (field.format === "email" && !/^[^@\s]+@[^@\s]+$/u.test(value)) return true
      if (field.format === "uri") {
        try {
          new URL(value)
        } catch {
          return true
        }
      }
      return false
    }
    case "number":
      return (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        (field.integer && !Number.isInteger(value)) ||
        (field.min !== undefined && value < field.min) ||
        (field.max !== undefined && value > field.max)
      )
    case "multi":
      return (
        !Array.isArray(value) ||
        (field.min !== undefined && value.length < field.min) ||
        (field.max !== undefined && value.length > field.max)
      )
    default:
      return false
  }
}

function OptionButton({
  option,
  selected,
  onClick,
}: Readonly<{ onClick: () => void; option: Option; selected: boolean }>) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-sm",
        selected ? "border-primary bg-primary/5" : "hover:bg-muted/50"
      )}
      type="button"
      onClick={onClick}
    >
      {option.thumbnail ? (
        <img alt="" className="size-10 shrink-0 rounded object-cover" src={option.thumbnail} />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{option.title}</span>
        {option.description ? (
          <span className="block truncate text-muted-foreground text-xs">{option.description}</span>
        ) : null}
      </span>
      {selected ? <Check className="size-4 shrink-0" /> : null}
    </button>
  )
}

/**
 * An MCP form elicitation with OpenAI's extended fields: option descriptions and thumbnails,
 * suggested values, patterns, and choosing among offered resources. A form with a field Cypheria
 * cannot show offers only Decline, as the specification asks.
 */
export function ElicitationForm({
  onRespond,
  schema,
}: Readonly<{
  onRespond: (action: "accept" | "decline" | "cancel", content?: Record<string, unknown>) => void
  schema: unknown
}>) {
  const parsed = useMemo(() => parseElicitationSchema(schema), [schema])
  const [values, setValues] = useState<Record<string, Value>>(parsed?.defaults ?? {})
  const [custom, setCustom] = useState<Record<string, string>>({})
  if (!parsed) {
    return (
      <div className="grid gap-3">
        <p className="text-muted-foreground text-sm">
          <Trans id="extension.form.unsupported">
            This form asks for input Cypheria cannot collect yet.
          </Trans>
        </p>
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onRespond("decline")}>
            <Trans id="chat.interaction.decline">Decline</Trans>
          </Button>
        </div>
      </div>
    )
  }
  const set = (key: string, value: Value) => setValues((current) => ({ ...current, [key]: value }))
  const blocked = parsed.fields.some((field) => invalid(field, values[field.key]))
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (blocked) return
        onRespond(
          "accept",
          Object.fromEntries(
            Object.entries(values).filter(([, value]) => value !== undefined && value !== "")
          )
        )
      }}
    >
      {parsed.fields.map((parsedField) => {
        const { field, key } = parsedField
        const value = values[key]
        const bad = value !== undefined && invalid(parsedField, value)
        return (
          <fieldset key={key} className="grid gap-1.5">
            <legend className="text-sm">
              {parsedField.title}
              {parsedField.required ? <span className="text-muted-foreground"> *</span> : null}
            </legend>
            {parsedField.description ? (
              <p className="text-muted-foreground text-xs">{parsedField.description}</p>
            ) : null}
            {field.kind === "text" ? (
              <>
                <Input
                  aria-invalid={bad}
                  aria-label={parsedField.title}
                  value={typeof value === "string" ? value : ""}
                  onChange={(event) => set(key, event.target.value)}
                />
                {field.suggestions.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {field.suggestions.map((option) => (
                      <Button
                        key={option.value}
                        size="xs"
                        variant="outline"
                        type="button"
                        onClick={() => set(key, option.value)}
                      >
                        {option.title}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : field.kind === "number" ? (
              <Input
                aria-invalid={bad}
                aria-label={parsedField.title}
                inputMode="decimal"
                value={value === undefined ? "" : String(value)}
                onChange={(event) =>
                  set(key, event.target.value === "" ? undefined : Number(event.target.value))
                }
              />
            ) : field.kind === "boolean" ? (
              <Switch
                aria-label={parsedField.title}
                checked={value === true}
                onCheckedChange={(checked) => set(key, checked)}
              />
            ) : field.kind === "choice" ? (
              <div className="grid gap-1 sm:grid-cols-2">
                {field.options.map((option) => (
                  <OptionButton
                    key={option.value}
                    option={option}
                    selected={value === option.value}
                    onClick={() => set(key, option.value)}
                  />
                ))}
              </div>
            ) : (
              <div className="grid gap-1">
                <div className="grid gap-1 sm:grid-cols-2">
                  {field.options.map((option) => {
                    const list = Array.isArray(value) ? value : []
                    const selected = list.includes(option.value)
                    return (
                      <OptionButton
                        key={option.value}
                        option={option}
                        selected={selected}
                        onClick={() =>
                          set(
                            key,
                            selected
                              ? list.filter((entry) => entry !== option.value)
                              : [...list, option.value]
                          )
                        }
                      />
                    )
                  })}
                </div>
                {field.custom ? (
                  <div className="flex flex-wrap items-center gap-1">
                    {(Array.isArray(value) ? value : [])
                      .filter((entry) => !field.options.some((option) => option.value === entry))
                      .map((entry) => (
                        <Button
                          key={entry}
                          size="xs"
                          type="button"
                          variant="secondary"
                          onClick={() =>
                            set(
                              key,
                              (Array.isArray(value) ? value : []).filter((item) => item !== entry)
                            )
                          }
                        >
                          {entry}
                          <X className="size-3" />
                        </Button>
                      ))}
                    <Input
                      aria-label={parsedField.title}
                      className="h-7 w-40"
                      value={custom[key] ?? ""}
                      onChange={(event) =>
                        setCustom((current) => ({ ...current, [key]: event.target.value }))
                      }
                      onKeyDown={(event) => {
                        const entry = (custom[key] ?? "").trim()
                        if (event.key !== "Enter" || !entry) return
                        event.preventDefault()
                        set(key, [...new Set([...(Array.isArray(value) ? value : []), entry])])
                        setCustom((current) => ({ ...current, [key]: "" }))
                      }}
                    />
                  </div>
                ) : null}
              </div>
            )}
          </fieldset>
        )
      })}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => onRespond("decline")}>
          <Trans id="chat.interaction.decline">Decline</Trans>
        </Button>
        <Button disabled={blocked} type="submit">
          <Trans id="common.continue">Continue</Trans>
        </Button>
      </div>
    </form>
  )
}
