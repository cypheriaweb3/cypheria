/**
 * An error the model should read. `code` is stable for hosts and tests; `retryable` says whether
 * the same call may simply run again because nothing happened.
 */
export class EngineError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, options: { retryable?: boolean } = {}) {
    super(message)
    this.name = "EngineError"
    this.code = code
    this.retryable = options.retryable ?? false
  }
}

export const staleIndex = (index: number) =>
  new EngineError(
    "stale_index",
    `Element ${index} is not in the latest accessibility state. Call getAXState() and use a fresh index.`,
    { retryable: true }
  )
