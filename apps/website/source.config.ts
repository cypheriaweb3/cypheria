import { defineConfig } from "fumadocs-mdx/config"
import { websiteDocsUrl } from "./src/lib/docs-links"

type MarkdownNode = {
  children?: MarkdownNode[]
  type?: string
  url?: string
}

function remarkWebsiteDocLinks() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode): void => {
      if ((node.type === "link" || node.type === "image") && node.url) {
        node.url = websiteDocsUrl(node.url)
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
