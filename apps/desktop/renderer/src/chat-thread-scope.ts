import { Chat } from "@ai-sdk/react"
import type { PromptInputAttachment } from "@cypheria/ui/ai-elements/prompt-input"
import type { ChatInit, ChatStatus } from "ai"

import type { CodexUiMessage } from "../../ipc/src/index.js"
import { composerPromptDraftStore } from "./chat-composer-drafts.js"
import { type CodexChatOptions, CodexIpcChatTransport } from "./codex-chat.js"

export const MAX_RETAINED_CHAT_THREAD_SCOPES = 20

type RetainableThreadScope = {
  readonly dispose?: () => void
  readonly status: ChatStatus
}

type RetainedScopeRecord<TScope extends RetainableThreadScope> = {
  readonly aliases: Set<string>
  mounted: number
  readonly scope: TScope
}

export class RetainedThreadScopeCache<TScope extends RetainableThreadScope> {
  readonly #byAlias = new Map<string, RetainedScopeRecord<TScope>>()
  readonly #byScope = new Map<TScope, RetainedScopeRecord<TScope>>()

  constructor(private readonly maxRetained = MAX_RETAINED_CHAT_THREAD_SCOPES) {}

  acquire(alias: string, create: () => TScope): TScope {
    const retained = this.#byAlias.get(alias)
    if (retained) {
      this.#touch(retained)
      return retained.scope
    }

    const record: RetainedScopeRecord<TScope> = {
      aliases: new Set([alias]),
      mounted: 0,
      scope: create(),
    }
    this.#byAlias.set(alias, record)
    this.#byScope.set(record.scope, record)
    this.#prune(record.scope)
    return record.scope
  }

  addAlias(scope: TScope, alias: string): void {
    const record = this.#byScope.get(scope)
    if (!record) return
    const previous = this.#byAlias.get(alias)
    if (previous && previous !== record) {
      previous.aliases.delete(alias)
      if (previous.aliases.size === 0) this.#remove(previous)
    }
    record.aliases.add(alias)
    this.#byAlias.set(alias, record)
    this.#touch(record)
  }

  mount(scope: TScope): () => void {
    const record = this.#byScope.get(scope)
    if (!record) return () => undefined
    record.mounted += 1
    this.#touch(record)
    let mounted = true
    return () => {
      if (!mounted) return
      mounted = false
      record.mounted = Math.max(0, record.mounted - 1)
      this.#touch(record)
      this.#prune()
    }
  }

  notifyStatusChanged(scope: TScope): void {
    const record = this.#byScope.get(scope)
    if (!record) return
    this.#touch(record)
    this.#prune()
  }

  get size(): number {
    return this.#byScope.size
  }

  has(alias: string): boolean {
    return this.#byAlias.has(alias)
  }

  #isEvictable(record: RetainedScopeRecord<TScope>): boolean {
    return (
      record.mounted === 0 &&
      record.scope.status !== "submitted" &&
      record.scope.status !== "streaming"
    )
  }

  #prune(protectedScope?: TScope): void {
    while (this.#byScope.size > this.maxRetained) {
      const oldest = Array.from(this.#byScope.values()).find(
        (record) => record.scope !== protectedScope && this.#isEvictable(record)
      )
      if (!oldest) return
      this.#remove(oldest)
    }
  }

  #remove(record: RetainedScopeRecord<TScope>): void {
    this.#byScope.delete(record.scope)
    for (const alias of record.aliases) {
      if (this.#byAlias.get(alias) === record) this.#byAlias.delete(alias)
    }
    record.scope.dispose?.()
  }

  #touch(record: RetainedScopeRecord<TScope>): void {
    this.#byScope.delete(record.scope)
    this.#byScope.set(record.scope, record)
  }
}

type CodexChatFinish = NonNullable<ChatInit<CodexUiMessage>["onFinish"]>
type CodexChatError = NonNullable<ChatInit<CodexUiMessage>["onError"]>

export type CodexChatThreadScopeBindings = {
  readonly initialComposerText?: string
  readonly onError?: CodexChatError
  readonly onFinish?: CodexChatFinish
  readonly onThreadCreated?: (threadId: string) => void
  readonly options: CodexChatOptions
}

export type CodexChatThreadScope = RetainableThreadScope & {
  readonly addComposerAlias: (alias: string) => void
  readonly chat: Chat<CodexUiMessage>
  bindings: CodexChatThreadScopeBindings
  composerAttachments: PromptInputAttachment[]
  composerText: string
  readonly dispose: () => void
  readonly setComposerAttachments: (attachments: PromptInputAttachment[]) => void
  readonly setComposerText: (text: string) => void
  readonly transport: CodexIpcChatTransport
}

const retainedCodexChatScopes = new RetainedThreadScopeCache<CodexChatThreadScope>()

export const acquireCodexChatThreadScope = (
  alias: string,
  bindings: CodexChatThreadScopeBindings
): CodexChatThreadScope => {
  const scope = retainedCodexChatScopes.acquire(alias, () => {
    let createdScope: CodexChatThreadScope
    const composerAliases = new Set([alias])
    const transport = new CodexIpcChatTransport(
      () => createdScope.bindings.options,
      (threadId) => {
        createdScope.addComposerAlias(threadId)
        createdScope.bindings.onThreadCreated?.(threadId)
      }
    )
    const chat = new Chat<CodexUiMessage>({
      id: alias,
      onError: (error) => {
        createdScope.bindings.onError?.(error)
        retainedCodexChatScopes.notifyStatusChanged(createdScope)
      },
      onFinish: (event) => {
        createdScope.bindings.onFinish?.(event)
        retainedCodexChatScopes.notifyStatusChanged(createdScope)
      },
      transport,
    })
    const initialComposerText =
      composerPromptDraftStore.get(alias) ?? bindings.initialComposerText ?? ""
    createdScope = {
      addComposerAlias: (composerAlias) => {
        retainedCodexChatScopes.addAlias(createdScope, composerAlias)
        composerAliases.add(composerAlias)
        composerPromptDraftStore.set(composerAliases, createdScope.composerText)
      },
      bindings,
      chat,
      composerAttachments: [],
      composerText: initialComposerText,
      dispose: () => {
        for (const attachment of createdScope.composerAttachments) {
          if (attachment.url.startsWith("blob:")) URL.revokeObjectURL(attachment.url)
        }
        createdScope.composerAttachments = []
      },
      get status() {
        return chat.status
      },
      setComposerAttachments: (attachments) => {
        createdScope.composerAttachments = attachments
      },
      setComposerText: (text) => {
        createdScope.composerText = text
        composerPromptDraftStore.set(composerAliases, text)
      },
      transport,
    }
    if (initialComposerText) composerPromptDraftStore.set(composerAliases, initialComposerText)
    return createdScope
  })
  scope.bindings = bindings
  return scope
}

export const mountCodexChatThreadScope = (scope: CodexChatThreadScope): (() => void) =>
  retainedCodexChatScopes.mount(scope)
