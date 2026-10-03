import type { AgentId, ThreadView } from "@cypheria/protocol"
import { Button } from "@cypheria/ui/components/button"
import {
  ChatComposerBody,
  ChatComposerFooter,
  ChatComposerForm,
  ChatComposerFrame,
  ChatComposerSubmit,
  ChatComposerTextarea,
  ChatComposerUtilityBar,
  ChatMarkdownHostContext,
} from "@cypheria/ui/components/chat"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@cypheria/ui/components/dropdown-menu"
import { cn } from "@cypheria/ui/lib/utils"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { atom, useAtom } from "jotai"
import { ChevronDown, Maximize2, Minus, SquarePen } from "lucide-react"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"

import { useThreadMarkdownHost } from "../chat-markdown-host.js"
import { clientStateStore } from "../client-state.js"
import { cypheriaClient, ensureCypheriaClient } from "../cypheria-client.js"
import { ThreadConversationController } from "../thread-conversation-controller.js"
import { VirtualTimeline } from "./conversation-workspace.js"
import { ExtensionContextAttachments } from "./extensions/model-context.js"

const workspaceThreadKey = (workspaceKey: string | null) =>
  ["workspace-thread", workspaceKey] as const

/**
 * The chat a workspace page shows beside its App. The Server keeps it, so every client of the
 * Server reopens the same chat on the page, and a change on one client shows on the others.
 */
export const useWorkspaceThread = (workspaceKey: string | null) => {
  const queryClient = useQueryClient()
  useEffect(
    () =>
      cypheriaClient.threads.workspaceThreads.subscribe((chat) => {
        queryClient.setQueryData(workspaceThreadKey(chat.workspaceKey), chat.threadId)
      }),
    [queryClient]
  )
  useEffect(
    () =>
      cypheriaClient.on("thread.deleted.notification", () => {
        void queryClient.invalidateQueries({ queryKey: ["workspace-thread"] })
      }),
    [queryClient]
  )
  return useQuery({
    enabled: workspaceKey !== null,
    queryFn: async () =>
      (await (await ensureCypheriaClient()).threads.workspaceThreads.get(workspaceKey as string))
        .threadId,
    queryKey: workspaceThreadKey(workspaceKey),
  })
}

/** Text to put in a workspace page's composer, such as a prompt Code Review prepared. */
export const workspaceThreadPromptAtom = atom<{ workspaceKey: string; text: string } | null>(null)

/** Starts a new chat on a workspace page with a prepared message in its composer. */
export const startWorkspaceThread = async (workspaceKey: string, text: string) => {
  clientStateStore.set(workspaceThreadPromptAtom, { text, workspaceKey })
  await setWorkspaceThread(workspaceKey, null)
}

/** Shows a chat on a workspace page, or none to start a new one there. */
export const setWorkspaceThread = async (workspaceKey: string, threadId: string | null) => {
  await (await ensureCypheriaClient()).threads.workspaceThreads.set(workspaceKey, threadId)
}

type WorkspaceChatProps = {
  /** The page the chat belongs to, such as `mcp-app:<entry point>`; null shows no chat. */
  readonly workspaceKey: string | null
  readonly agentId: AgentId
  /** A chat to show when the page has none recorded, such as one linked to the pull request. */
  readonly fallbackThreadId?: string | null
  readonly placeholder: string
  /** Runs before the first message of a new chat is sent, such as moving the App to it. */
  readonly onThreadCreated?: (threadId: string) => Promise<void> | void
  /** The chat shown changed: a new one started, another was chosen, or none. */
  readonly onThreadShown?: (threadId: string | null) => void
  /** Opens the chat on the full conversation page. */
  readonly onOpenThread?: (threadId: string) => void
}

/**
 * A chat floating at the bottom right of a page whose App fills the page, as ChatGPT Desktop's
 * workspace pages show one. The first message creates an ordinary chat that stays here; the page
 * remembers it until another chat is chosen or a new one is started.
 */
export function WorkspaceChat(props: WorkspaceChatProps) {
  const chat = useWorkspaceThread(props.workspaceKey)
  const recorded = chat.data ?? null
  const shown = recorded ?? (chat.isSuccess ? (props.fallbackThreadId ?? null) : null)
  const [session, setSession] = useState<{ id: number; threadId: string | null }>({
    id: 0,
    threadId: shown,
  })
  /** The chat the open session shows, including one it just created. */
  const sessionThread = useRef<string | null>(shown)
  const { onThreadShown } = props

  useEffect(() => {
    if (!chat.isSuccess || shown === sessionThread.current) return
    sessionThread.current = shown
    setSession((current) => ({ id: current.id + 1, threadId: shown }))
  }, [chat.isSuccess, shown])
  useEffect(() => {
    if (chat.isSuccess) onThreadShown?.(session.threadId)
  }, [chat.isSuccess, onThreadShown, session.threadId])

  if (!props.workspaceKey || !chat.isSuccess) return null
  return (
    <WorkspaceChatSession
      key={session.id}
      {...props}
      recorded={session.threadId === recorded}
      threadId={session.threadId}
      workspaceKey={props.workspaceKey}
      onCreated={async (threadId) => {
        sessionThread.current = threadId
        await props.onThreadCreated?.(threadId)
        await setWorkspaceThread(props.workspaceKey as string, threadId)
        onThreadShown?.(threadId)
      }}
    />
  )
}

function WorkspaceChatSession({
  agentId,
  onCreated,
  onOpenThread,
  placeholder,
  recorded,
  threadId,
  workspaceKey,
}: WorkspaceChatProps & {
  /** Whether the page already records this chat, rather than showing a fallback. */
  readonly recorded: boolean
  readonly threadId: string | null
  readonly workspaceKey: string
  readonly onCreated: (threadId: string) => Promise<void>
}) {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const [controller] = useState(
    () =>
      new ThreadConversationController({
        agentId,
        ...(threadId ? { initialThreadId: threadId } : {}),
        onThreadCreated: onCreated,
      })
  )
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  )
  const [draft, setDraft] = useState("")
  const [prompt, setPrompt] = useAtom(workspaceThreadPromptAtom)
  useEffect(() => {
    if (prompt?.workspaceKey !== workspaceKey || threadId) return
    setDraft(prompt.text)
    setPrompt(null)
  }, [prompt, setPrompt, threadId, workspaceKey])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [minimized, setMinimized] = useState(false)

  useEffect(() => {
    void controller.connect()
    return () => controller.dispose()
  }, [controller])

  const thread = snapshot.thread
  const open = (id: string) =>
    onOpenThread ? onOpenThread(id) : void navigate({ search: { thread: id }, to: "/" })
  const markdownHost = useThreadMarkdownHost({
    openFile: () => thread && open(thread.id),
    openFilesPanel: () => thread && open(thread.id),
    openReviewPanel: () => thread && open(thread.id),
    openThread: open,
    sendFollowUp: (prompt) => void controller.submit([{ text: prompt, type: "text" }], "send"),
    threadId: thread?.id ?? null,
  })
  const busy = Boolean(thread?.activeTurn)
  const send = async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setError(null)
    try {
      await controller.submit([{ text, type: "text" }], busy ? "steer" : "send")
      // Writing in a fallback chat makes it the page's chat.
      if (threadId && !recorded) await setWorkspaceThread(workspaceKey, threadId)
      setDraft("")
      setMinimized(false)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setSending(false)
    }
  }
  const expanded = Boolean(thread) && !minimized
  const title =
    thread?.title?.trim() || i18n._(msg({ id: "workspaceChat.untitled", message: "New chat" }))

  return (
    <div
      className={cn(
        "absolute right-4 bottom-4 z-30 flex w-[min(420px,calc(100%-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-background/95 shadow-lg backdrop-blur",
        expanded && "h-[min(560px,calc(100%-2rem))]"
      )}
      data-slot="workspace-thread"
    >
      {thread || threadId ? (
        <div className="flex h-10 shrink-0 items-center gap-1 border-border/70 border-b px-2">
          <ThreadPicker current={thread} title={title} workspaceKey={workspaceKey} />
          <div className="ml-auto flex items-center">
            <Button
              aria-label={i18n._(msg({ id: "workspaceChat.newChat", message: "New chat" }))}
              size="icon-sm"
              type="button"
              variant="ghost"
              onClick={() => void setWorkspaceThread(workspaceKey, null)}
            >
              <SquarePen className="size-4" />
            </Button>
            {thread ? (
              <Button
                aria-label={i18n._(
                  msg({ id: "workspaceChat.openFull", message: "Open in full chat" })
                )}
                size="icon-sm"
                type="button"
                variant="ghost"
                onClick={() => open(thread.id)}
              >
                <Maximize2 className="size-4" />
              </Button>
            ) : null}
            <Button
              aria-label={
                minimized
                  ? i18n._(msg({ id: "workspaceChat.expand", message: "Show chat" }))
                  : i18n._(msg({ id: "workspaceChat.minimize", message: "Hide chat" }))
              }
              aria-expanded={!minimized}
              size="icon-sm"
              type="button"
              variant="ghost"
              onClick={() => setMinimized((value) => !value)}
            >
              {minimized ? (
                <ChevronDown className="size-4 rotate-180" />
              ) : (
                <Minus className="size-4" />
              )}
            </Button>
          </div>
        </div>
      ) : null}
      {expanded ? (
        <ChatMarkdownHostContext.Provider value={markdownHost}>
          <div className="relative min-h-0 flex-1">
            <VirtualTimeline
              activeTurnId={thread?.activeTurn?.id ?? null}
              codex={agentId === "codex" && thread?.agentId === "codex"}
              hasOlder={snapshot.hasOlder}
              items={snapshot.items}
              loading={snapshot.loadState === "loading"}
              loadingOlder={snapshot.loadingOlder}
              onLoadOlder={() => void controller.loadOlder()}
            />
          </div>
          {thread && thread.pendingInteractions.length > 0 ? (
            <div className="flex items-center gap-2 border-border/70 border-t px-3 py-2 text-xs">
              <span className="text-muted-foreground">
                <Trans id="workspaceChat.waiting">This chat is waiting for your answer.</Trans>
              </span>
              <Button
                className="ml-auto"
                size="sm"
                type="button"
                variant="outline"
                onClick={() => open(thread.id)}
              >
                <Trans id="workspaceChat.answer">Answer</Trans>
              </Button>
            </div>
          ) : null}
        </ChatMarkdownHostContext.Provider>
      ) : null}
      <div className={cn("shrink-0", expanded && "border-border/70 border-t")}>
        <ChatComposerFrame className="rounded-none border-0 shadow-none focus-within:ring-0">
          <ChatComposerForm
            onSubmit={(event) => {
              event.preventDefault()
              void send()
            }}
          >
            {thread ? <ExtensionContextAttachments threadId={thread.id} /> : null}
            <ChatComposerBody className="min-h-10 py-1">
              <ChatComposerTextarea
                aria-label={i18n._(msg({ id: "extension.global.composer", message: "Message" }))}
                className="min-h-9 text-sm"
                disabled={sending}
                placeholder={placeholder}
                rows={1}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
            </ChatComposerBody>
            <ChatComposerFooter className="min-h-9 pb-1.5">
              <ChatComposerUtilityBar>
                {error ? (
                  <span className="truncate text-destructive" role="alert">
                    {error}
                  </span>
                ) : null}
              </ChatComposerUtilityBar>
              <ChatComposerSubmit
                disabled={!busy && (!draft.trim() || sending)}
                size="icon-sm"
                status={sending ? "submitted" : busy && !draft.trim() ? "streaming" : "ready"}
                stopLabel={i18n._(msg({ id: "chat.prompt.stop", message: "Stop" }))}
                submitLabel={i18n._(msg({ id: "extension.global.send", message: "Send" }))}
                onStop={() => void controller.cancel()}
              />
            </ChatComposerFooter>
          </ChatComposerForm>
        </ChatComposerFrame>
      </div>
    </div>
  )
}

/** The chat's title, opening a list of recent chats to show here instead. */
function ThreadPicker({
  current,
  title,
  workspaceKey,
}: Readonly<{ current: ThreadView | null; title: string; workspaceKey: string }>) {
  const { i18n } = useLingui()
  const [open, setOpen] = useState(false)
  const recent = useQuery({
    enabled: open,
    queryFn: async () =>
      (
        await (
          await ensureCypheriaClient()
        ).threads.list({
          archived: false,
          limit: 20,
          sortDirection: "desc",
          sortKey: "recencyAt",
        })
      ).data,
    queryKey: ["workspace-thread", "recent-threads"],
  })
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={i18n._(msg({ id: "workspaceChat.choose", message: "Choose a chat" }))}
            className="min-w-0 max-w-64 justify-start"
            size="sm"
            type="button"
            variant="ghost"
          />
        }
      >
        <span className="truncate">{title}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-muted-foreground text-xs">
          <Trans id="workspaceChat.recent">Recent chats</Trans>
        </DropdownMenuLabel>
        {(recent.data ?? []).map((thread) => (
          <DropdownMenuItem
            key={thread.id}
            disabled={thread.id === current?.id}
            onClick={() => void setWorkspaceThread(workspaceKey, thread.id)}
          >
            <span className="truncate">
              {thread.title?.trim() ||
                i18n._(msg({ id: "workspaceChat.untitled", message: "New chat" }))}
            </span>
          </DropdownMenuItem>
        ))}
        {recent.isSuccess && recent.data.length === 0 ? (
          <DropdownMenuItem disabled>
            <Trans id="workspaceChat.noRecent">No chats yet</Trans>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void setWorkspaceThread(workspaceKey, null)}>
          <Trans id="workspaceChat.newChat">New chat</Trans>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
