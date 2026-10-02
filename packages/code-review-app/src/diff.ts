/** The file sections of a unified diff, each with its post-change path. */
export const fileSections = (patch: string): { path: string; text: string }[] =>
  patch
    .split(/^(?=diff --git )/mu)
    .filter((text) => text.startsWith("diff --git "))
    .map((text) => {
      const header =
        /^\+\+\+ b\/(.+)$/mu.exec(text)?.[1] ?? /^diff --git a\/.+ b\/(.+)$/mu.exec(text)?.[1] ?? ""
      return { path: header.trim(), text }
    })
