import { expect } from "vitest"

export function assertEquals(actual: unknown, expected: unknown): void {
  expect(actual).toEqual(expected)
}

export function assertExists<T>(value: T): asserts value is NonNullable<T> {
  expect(value).not.toBeNull()
  expect(value).not.toBeUndefined()
}

export async function assertRejects(
  operation: () => Promise<unknown>,
  ErrorType: new (...args: never[]) => Error = Error,
  messageIncludes?: string
): Promise<void> {
  let rejection: unknown
  try {
    await operation()
  } catch (error) {
    rejection = error
  }

  expect(rejection).toBeInstanceOf(ErrorType)
  if (messageIncludes !== undefined) {
    expect((rejection as Error).message).toContain(messageIncludes)
  }
}
