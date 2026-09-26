import type { ThreadAttachmentRecord, ThreadAttachmentType } from "@cypheria/protocol"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"

import { cypheriaClient, ensureCypheriaClient } from "./cypheria-client.js"

export const threadAttachmentQueryKey = ["thread-attachments"] as const

export const listAllThreadAttachments = async (
  attachmentType?: ThreadAttachmentType
): Promise<ThreadAttachmentRecord[]> => {
  const client = await ensureCypheriaClient()
  const data: ThreadAttachmentRecord[] = []
  let cursor: string | null = null
  do {
    const page = await client.threads.attachments.list({
      attachmentType,
      cursor,
      limit: 200,
    })
    data.push(...page.data)
    cursor = page.nextCursor
  } while (cursor)
  return data
}

export const useThreadAttachments = (attachmentType?: ThreadAttachmentType) => {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: [...threadAttachmentQueryKey, attachmentType ?? "all"],
    queryFn: () => listAllThreadAttachments(attachmentType),
  })

  useEffect(
    () =>
      cypheriaClient.threads.attachments.subscribe(() => {
        void queryClient.invalidateQueries({ queryKey: threadAttachmentQueryKey })
      }),
    [queryClient]
  )

  return query
}
