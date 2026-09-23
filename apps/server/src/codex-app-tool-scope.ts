import { z } from "zod"

const metadata = z
  .object({
    connectorId: z.string().optional(),
    connector_id: z.string().optional(),
    link_id: z.string().optional(),
    _codex_apps: z
      .object({ resource_uri: z.string(), synthetic_link: z.boolean().nullish() })
      .passthrough(),
  })
  .passthrough()

export type CodexAppToolScope = {
  connectorId: string
  accountLinkId: string
  resourceUri: string
}

/** Accept only an account-bound target tool whose metadata agrees on connector, link and action. */
export const codexAppToolScope = (toolName: string, value: unknown): CodexAppToolScope | null => {
  const parsed = metadata.safeParse(value)
  if (!parsed.success || parsed.data._codex_apps.synthetic_link === true) return null
  const connectorId = (parsed.data.connectorId ?? parsed.data.connector_id)?.trim()
  const [namespace, action] = toolName.split(".")
  if (!connectorId || !namespace || !action || toolName !== `${namespace}.${action}`) return null
  const resourceUri = parsed.data._codex_apps.resource_uri
  const segments = resourceUri.split("/")
  if (
    segments.length !== 4 ||
    segments[0] !== "" ||
    segments[1] !== connectorId ||
    !segments[2] ||
    segments[3] !== action ||
    (parsed.data.link_id !== undefined && parsed.data.link_id !== segments[2])
  )
    return null
  return { connectorId, accountLinkId: segments[2], resourceUri }
}
