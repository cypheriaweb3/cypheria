import { relative, resolve } from "node:path"
import { defineConfig } from "fumadocs-mdx/config"
import { websiteDocsUrl } from "./src/lib/docs-links"

type MarkdownNode = {
  children?: MarkdownNode[]
  type?: string
  url?: string
}

const DOCS_DIR = resolve(import.meta.dirname, "../../docs")

function remarkWebsiteDocLinks() {
  return (tree: MarkdownNode, file: { path?: string }) => {
    const from = file.path ? relative(DOCS_DIR, file.path).split("\\").join("/") : undefined
    const visit = (node: MarkdownNode): void => {
      if ((node.type === "link" || node.type === "image") && node.url) {
        node.url = websiteDocsUrl(node.url, from)
      }
      node.children?.forEach(visit)
    }
    visit(tree)
  }
}

export default defineConfig({
  mdxOptions: {
    remarkPlugins: (plugins) => [remarkWebsiteDocLinks, ...plugins],
  },
})
