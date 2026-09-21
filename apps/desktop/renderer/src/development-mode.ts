export const resolveDesktopDevelopment = (
  runtimeDevelopment: boolean | undefined,
  viteDevelopment = import.meta.env.DEV
) => runtimeDevelopment ?? viteDevelopment

export const isDesktopDevelopment = () =>
  resolveDesktopDevelopment(globalThis.window?.cypheria?.bootstrap.development)

export const filterDevelopmentItems = <T extends { readonly developmentOnly?: boolean }>(
  items: readonly T[],
  development: boolean
) => items.filter((item) => development || !item.developmentOnly)
