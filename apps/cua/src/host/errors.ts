/** A refusal or failure the host reports to model code as an ordinary error message. */
export class CuaHostError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "CuaHostError"
    this.code = code
  }
}
