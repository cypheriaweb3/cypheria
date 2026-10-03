import { type ExtensionCatalog, ExtensionCatalogSchema } from "@cypheria/protocol"
import { atomWithValidatedStorage } from "@cypheria/storage/jotai"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useAtom } from "jotai"
import { useEffect } from "react"

import { ensureCypheriaClient } from "../../cypheria-client.js"
import { desktopClientStorage } from "../../storage.js"

export const EXTENSION_CATALOG_QUERY_KEY = ["extensions", "catalog"] as const

/** The last catalog, so the Sidebar shows plugin entry points before Agents start. */
const cachedCatalogAtom = atomWithValidatedStorage<ExtensionCatalog | null>(
  "extensions.catalog",
  null,
  desktopClientStorage.keyValue,
  ExtensionCatalogSchema.nullable(),
  { getOnInit: true, version: 1 }
)

/** The Plugin Extensions catalog, refreshed when the Server announces a new revision. */
export function useExtensionCatalog(): ExtensionCatalog | null {
  const queryClient = useQueryClient()
  const [cached, setCached] = useAtom(cachedCatalogAtom)
  const query = useQuery({
    queryFn: async () => {
      const catalog = await (await ensureCypheriaClient()).extensions.catalog()
      void setCached(catalog)
      return catalog
    },
    queryKey: EXTENSION_CATALOG_QUERY_KEY,
    retry: false,
    staleTime: 30_000,
  })
  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    let disposed = false
    void ensureCypheriaClient().then((client) => {
      if (disposed) return
      unsubscribe = client.on("extension.catalog.updated.notification", () => {
        void queryClient.invalidateQueries({ queryKey: EXTENSION_CATALOG_QUERY_KEY })
      })
    })
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [queryClient])
  return query.data ?? cached
}

/** A plugin's display name from its `<plugin>@<marketplace>` ID. */
export const pluginName = (pluginId: string | null): string | null =>
  pluginId ? (pluginId.split("@")[0] ?? pluginId) : null
