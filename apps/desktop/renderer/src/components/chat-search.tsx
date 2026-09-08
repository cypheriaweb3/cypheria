import { Button } from "@cypheria/ui/components/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@cypheria/ui/components/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@cypheria/ui/components/dialog"
import { SidebarMenuButton } from "@cypheria/ui/components/sidebar"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { MessageSquare, Search } from "lucide-react"
import { useEffect, useState } from "react"

export function ChatSearch() {
  const { i18n } = useLingui()
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <SidebarMenuButton
            tooltip={i18n._(msg({ id: "navigation.search", message: "Search" }))}
          />
        }
      >
        <Search className="size-4" strokeWidth={1.9} />
        <span>
          <Trans id="navigation.search">Search</Trans>
        </span>
      </DialogTrigger>
      <DialogContent className="overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>
            <Trans id="search.title">Search chats</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans id="search.description">Search your chats and select one to open it.</Trans>
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <ChatSearchCommands
            onSelect={(thread) => {
              setOpen(false)
              void navigate({ to: "/", search: { thread } })
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ChatSearchCommands({ onSelect }: Readonly<{ onSelect: (thread: string) => void }>) {
  const { i18n } = useLingui()
  const [input, setInput] = useState("")
  const [searchTerm, setSearchTerm] = useState("")
  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(input.trim()), 200)
    return () => clearTimeout(timer)
  }, [input])

  const results = useQuery({
    queryKey: ["codex", "threads", "search", searchTerm],
    queryFn: () =>
      window.cypheria?.codex.listThreads({
        limit: 100,
        ...(searchTerm ? { searchTerm } : {}),
      }) ?? { data: [], nextCursor: null },
  })
  const waiting = input.trim() !== searchTerm || results.isPending
  const threads = results.data?.data ?? []

  return (
    <Command shouldFilter={false}>
      <CommandInput
        aria-label={i18n._(msg({ id: "search.title", message: "Search chats" }))}
        autoFocus
        placeholder={i18n._(msg({ id: "search.placeholder", message: "Search chats…" }))}
        value={input}
        onValueChange={setInput}
      />
      <CommandList
        aria-label={i18n._(msg({ id: "search.chats", message: "Chats" }))}
        aria-busy={waiting}
      >
        {waiting ? (
          <div className="py-6 text-center text-sm text-muted-foreground" role="status">
            <Trans id="search.searching">Searching…</Trans>
          </div>
        ) : results.isError ? (
          <div className="grid justify-items-center gap-2 py-6" role="alert">
            <p className="text-sm text-muted-foreground">
              <Trans id="search.error">Could not search chats.</Trans>
            </p>
            <Button size="sm" variant="outline" onClick={() => void results.refetch()}>
              <Trans id="search.tryAgain">Try again</Trans>
            </Button>
          </div>
        ) : (
          <>
            <CommandEmpty>
              {searchTerm
                ? i18n._(msg({ id: "search.noMatches", message: "No matching chats." }))
                : i18n._(msg({ id: "search.noRecent", message: "No recent chats yet." }))}
            </CommandEmpty>
            {threads.length > 0 ? (
              <CommandGroup
                heading={
                  searchTerm
                    ? i18n._(msg({ id: "search.chats", message: "Chats" }))
                    : i18n._(msg({ id: "navigation.recentChats", message: "Recent chats" }))
                }
              >
                {threads.map((thread) => (
                  <CommandItem
                    key={thread.id}
                    value={thread.id}
                    onSelect={() => onSelect(thread.id)}
                  >
                    <MessageSquare aria-hidden="true" />
                    <div className="grid min-w-0 gap-0.5">
                      <span className="truncate">
                        {thread.title ||
                          i18n._(msg({ id: "search.untitled", message: "Untitled chat" }))}
                      </span>
                      {thread.cwd ? (
                        <span className="truncate text-xs text-muted-foreground">{thread.cwd}</span>
                      ) : null}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </>
        )}
      </CommandList>
      <div className="border-t px-3 py-2 text-xs text-muted-foreground">
        <Trans id="search.keyboardHelp">↑↓ Navigate · Enter Open · Esc Close</Trans>
      </div>
    </Command>
  )
}
