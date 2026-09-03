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
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { MessageSquare, Search } from "lucide-react"
import { useEffect, useState } from "react"

export function TaskSearch() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<SidebarMenuButton tooltip="Search" />}>
        <Search size={16} strokeWidth={1.9} />
        <span>Search</span>
      </DialogTrigger>
      <DialogContent className="overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>Search tasks</DialogTitle>
          <DialogDescription>Search your tasks and select one to open it.</DialogDescription>
        </DialogHeader>
        {open ? (
          <TaskSearchCommands
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

function TaskSearchCommands({ onSelect }: Readonly<{ onSelect: (thread: string) => void }>) {
  const [input, setInput] = useState("")
  const [searchTerm, setSearchTerm] = useState("")
  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(input.trim()), 200)
    return () => clearTimeout(timer)
  }, [input])

  const results = useQuery({
    queryKey: ["codex", "threads", "search", searchTerm],
    queryFn: () => window.cypheria?.codex.listThreads(searchTerm ? { searchTerm } : {}) ?? [],
  })
  const waiting = input.trim() !== searchTerm || results.isPending
  const threads = results.data ?? []

  return (
    <Command shouldFilter={false}>
      <CommandInput
        aria-label="Search tasks"
        autoFocus
        placeholder="Search tasks…"
        value={input}
        onValueChange={setInput}
      />
      <CommandList aria-label="Tasks" aria-busy={waiting}>
        {waiting ? (
          <div className="py-6 text-center text-sm text-muted-foreground" role="status">
            Searching…
          </div>
        ) : results.isError ? (
          <div className="grid justify-items-center gap-2 py-6" role="alert">
            <p className="text-sm text-muted-foreground">Could not search tasks.</p>
            <Button size="sm" variant="outline" onClick={() => void results.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            <CommandEmpty>
              {searchTerm ? "No matching tasks." : "No recent tasks yet."}
            </CommandEmpty>
            {threads.length > 0 ? (
              <CommandGroup heading={searchTerm ? "Tasks" : "Recent tasks"}>
                {threads.map((thread) => (
                  <CommandItem
                    key={thread.id}
                    value={thread.id}
                    onSelect={() => onSelect(thread.id)}
                  >
                    <MessageSquare aria-hidden="true" />
                    <div className="grid min-w-0 gap-0.5">
                      <span className="truncate">{thread.title || "Untitled task"}</span>
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
        ↑↓ Navigate · Enter Open · Esc Close
      </div>
    </Command>
  )
}
