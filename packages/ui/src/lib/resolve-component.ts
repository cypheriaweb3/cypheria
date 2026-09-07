import type { ComponentType } from "react"

export const resolveComponent = <Props>(moduleValue: unknown): ComponentType<Props> => {
  let candidate = moduleValue

  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof candidate !== "object" || candidate === null || !("default" in candidate)) {
      break
    }
    candidate = candidate.default
  }

  return candidate as ComponentType<Props>
}
