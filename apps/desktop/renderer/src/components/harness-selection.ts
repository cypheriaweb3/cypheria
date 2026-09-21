import type { AgentCatalogEntry, AgentId } from "@cypheria/protocol"
import { Index } from "flexsearch"

export const resolveAvailableHarnessId = (
  value: unknown,
  available: readonly Pick<AgentCatalogEntry, "id">[]
): AgentId | undefined => {
  if (typeof value !== "string") return undefined
  return available.find((agent) => agent.id === value)?.id
}

export interface InMemorySearch<T> {
  search: (query: string) => T[]
}

/**
 * Builds a small, renderer-local FlexSearch index for command-palette choices.
 * The source order is preserved when there is no query; populated queries use
 * FlexSearch's relevance order without sending catalog or provider data away.
 */
export const createInMemorySearch = <T extends { id: string }>(
  items: readonly T[],
  getSearchText: (item: T) => string
): InMemorySearch<T> => {
  const index = new Index({ cache: true, tokenize: "full" })
  const itemsById = new Map<string, T>()

  for (const item of items) {
    itemsById.set(item.id, item)
    index.add(item.id, getSearchText(item))
  }

  return {
    search(query) {
      const normalizedQuery = query.trim()
      if (!normalizedQuery) return [...items]

      return index.search(normalizedQuery, { limit: items.length }).flatMap((id) => {
        const item = itemsById.get(String(id))
        return item ? [item] : []
      })
    },
  }
}
