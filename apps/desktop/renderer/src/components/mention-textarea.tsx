import { Textarea } from "@cypheria/ui/components/textarea"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { useQuery } from "@tanstack/react-query"
import { type ComponentProps, useEffect, useRef, useState } from "react"

/** The `@query` being typed at the caret, when the caret ends a mention that has just begun. */
export const activeMention = (
  text: string,
  caret: number
): { start: number; query: string } | null => {
  const before = text.slice(0, caret)
  const match = /(^|[^\w`])@([\w-]{0,39})$/u.exec(before)
  if (!match) return null
  const query = match[2] ?? ""
  return { query, start: caret - query.length - 1 }
}

/** `text` with the mention starting at `start` replaced by `@login `, and the new caret. */
export const insertMention = (
  text: string,
  mention: { start: number; query: string },
  login: string
): { text: string; caret: number } => {
  const inserted = `@${login} `
  const end = mention.start + 1 + mention.query.length
  return {
    caret: mention.start + inserted.length,
    text: `${text.slice(0, mention.start)}${inserted}${text.slice(end)}`,
  }
}

type MentionTextareaProps = Omit<ComponentProps<typeof Textarea>, "onChange" | "value"> & {
  value: string
  onValueChange: (value: string) => void
  /** Users who can be mentioned, for a query; omit it to turn suggestions off. */
  searchUsers?: (query: string) => Promise<Array<{ login: string; avatarUrl: string | null }>>
  /** Identifies the source of `searchUsers`, such as a repository and pull request, for caching. */
  searchKey?: string
}

/** A comment field that suggests GitHub users after `@` and inserts the chosen login. */
export function MentionTextarea({
  onKeyDown,
  onValueChange,
  searchKey,
  searchUsers,
  value,
  ...props
}: MentionTextareaProps) {
  const { i18n } = useLingui()
  const ref = useRef<HTMLTextAreaElement>(null)
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [highlighted, setHighlighted] = useState(0)
  const pendingCaret = useRef<number | null>(null)
  const candidates = useQuery({
    enabled: Boolean(searchUsers && mention),
    queryKey: ["github-mentions", searchKey, mention?.query ?? ""],
    queryFn: async () => (searchUsers ? searchUsers(mention?.query ?? "") : []),
    retry: false,
    staleTime: 30_000,
  })
  const options = (candidates.data ?? []).slice(0, 8)
  useEffect(() => {
    if (pendingCaret.current === null || !ref.current) return
    ref.current.setSelectionRange(pendingCaret.current, pendingCaret.current)
    pendingCaret.current = null
  })
  const choose = (login: string) => {
    if (!mention) return
    const next = insertMention(value, mention, login)
    pendingCaret.current = next.caret
    setMention(null)
    onValueChange(next.text)
  }
  const open = Boolean(searchUsers && mention)
  return (
    <div className="relative">
      <Textarea
        {...props}
        aria-autocomplete={searchUsers ? "list" : undefined}
        aria-expanded={open}
        onChange={(event) => {
          onValueChange(event.target.value)
          setMention(activeMention(event.target.value, event.target.selectionStart))
          setHighlighted(0)
        }}
        onKeyDown={(event) => {
          if (open && options.length > 0) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault()
              const step = event.key === "ArrowDown" ? 1 : -1
              setHighlighted((index) => (index + step + options.length) % options.length)
              return
            }
            if (event.key === "Enter" || event.key === "Tab") {
              const option = options[highlighted]
              if (option) {
                event.preventDefault()
                choose(option.login)
                return
              }
            }
          }
          if (open && event.key === "Escape") {
            event.preventDefault()
            setMention(null)
            return
          }
          onKeyDown?.(event)
        }}
        ref={ref}
        value={value}
      />
      {open ? (
        <div
          aria-label={i18n._(msg({ id: "git.github.mentions", message: "Mention a GitHub user" }))}
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md"
          role="listbox"
        >
          {candidates.isPending ? (
            <p className="px-2 py-1 text-muted-foreground">
              {i18n._(
                msg({ id: "git.github.mentions.loading", message: "Searching GitHub users…" })
              )}
            </p>
          ) : candidates.isError ? (
            <p className="px-2 py-1 text-destructive">
              {i18n._(
                msg({ id: "git.github.mentions.error", message: "Couldn’t search GitHub users" })
              )}
            </p>
          ) : options.length === 0 ? (
            <p className="px-2 py-1 text-muted-foreground">
              {i18n._(msg({ id: "git.github.mentions.empty", message: "No GitHub users found" }))}
            </p>
          ) : (
            options.map((option, index) => (
              <button
                aria-selected={index === highlighted}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left aria-selected:bg-accent"
                key={option.login}
                onMouseDown={(event) => {
                  event.preventDefault()
                  choose(option.login)
                }}
                role="option"
                type="button"
              >
                {option.avatarUrl ? (
                  <img alt="" className="size-4 rounded-full" src={option.avatarUrl} />
                ) : null}
                <span className="font-mono text-xs">@{option.login}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
