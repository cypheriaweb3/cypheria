export interface StoragePageRequest {
  readonly cursor?: string | null
  readonly limit?: number
  readonly query?: string
}

export interface StoragePage<Item> {
  readonly items: readonly Item[]
  readonly nextCursor: string | null
}

export interface NormalizedStoragePageRequest {
  readonly cursor: string | null
  readonly limit: number
  readonly query: string
}

export const normalizeStoragePageRequest = (
  request: StoragePageRequest = {}
): NormalizedStoragePageRequest => {
  const limit = request.limit ?? 30
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Storage page limit must be an integer between 1 and 100.")
  }
  return {
    cursor: request.cursor ?? null,
    limit,
    query: request.query?.trim().toLocaleLowerCase() ?? "",
  }
}

export const encodeStorageCursor = (parts: readonly string[]): string =>
  encodeURIComponent(JSON.stringify(parts))

export const decodeStorageCursor = (cursor: string | null, size: number): string[] | null => {
  if (cursor === null) return null
  try {
    const decoded: unknown = JSON.parse(decodeURIComponent(cursor))
    if (
      !Array.isArray(decoded) ||
      decoded.length !== size ||
      decoded.some((part) => typeof part !== "string")
    ) {
      throw new Error("Invalid storage cursor.")
    }
    return decoded as string[]
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid storage cursor.") throw error
    throw new Error("Invalid storage cursor.", { cause: error })
  }
}

export const createTextPreview = (
  value: string,
  maximumCharacters = 240
): { preview: string; length: number; truncated: boolean } => {
  const length = [...value].length
  if (length <= maximumCharacters) return { preview: value, length, truncated: false }
  return {
    preview: [...value].slice(0, maximumCharacters).join(""),
    length,
    truncated: true,
  }
}
