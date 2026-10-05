import { join } from "node:path"

/**
 * Where Codex saves the images a session generates: `$CODEX_HOME/generated_images/<session>/`,
 * with the session ID reduced to the characters Codex keeps in the directory name.
 */
export const codexGeneratedImagesDir = (codexHome: string, sessionId: string): string =>
  join(
    codexHome,
    "generated_images",
    sessionId.replace(/[^A-Za-z0-9_-]/gu, "_") || "generated_image"
  )
