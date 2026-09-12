/** Cancellation and deadline controls shared by every correlated client request. */
export type RequestOptions = {
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

export const assertRequestTimeout = (timeoutMs: number | undefined): void => {
  if (
    timeoutMs !== undefined &&
    (!Number.isFinite(timeoutMs) || !Number.isInteger(timeoutMs) || timeoutMs <= 0)
  ) {
    throw new TypeError("timeoutMs must be a positive integer")
  }
}
