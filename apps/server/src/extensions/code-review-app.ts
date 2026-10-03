import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { bundledMarketplaceDirectory } from "../integration/plugin-utils.js"

/**
 * The Code Review App's HTML: the bundled `code-review` plugin's `dist/app.html`, in the checkout's
 * `plugins/` or the built Server's marketplace.
 */
export const readCodeReviewAppHtml = async (): Promise<string> => {
  const marketplace = await bundledMarketplaceDirectory(".agents/plugins/marketplace.json")
  try {
    return await readFile(join(marketplace, "code-review", "dist", "app.html"), "utf8")
  } catch {
    throw new Error(
      "The Code Review App is not built. Run `pnpm --filter @cypheria/code-review build`."
    )
  }
}
