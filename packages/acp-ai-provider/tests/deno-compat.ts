import { test } from "vitest"

type DenoTestContext = {
  step: (name: string, body: () => unknown | Promise<unknown>) => Promise<void>
}

export const Deno = {
  test(name: string, body: (context: DenoTestContext) => unknown | Promise<unknown>): void {
    test(name, async () => {
      await body({
        step: async (_name, stepBody) => {
          await stepBody()
        },
      })
    })
  },
}
