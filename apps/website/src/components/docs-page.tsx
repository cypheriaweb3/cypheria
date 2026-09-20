import { notFound } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { useFumadocsLoader } from "fumadocs-core/source/client"
import { DocsLayout } from "fumadocs-ui/layouts/docs"
import { DocsBody, DocsPage } from "fumadocs-ui/layouts/docs/page"
import { Suspense, use } from "react"
import { DocsNavActions } from "@/components/docs-nav-actions"
import { useMDXComponents } from "@/components/mdx"
import type { WebsiteLocale } from "@/lib/i18n"
import { baseOptions } from "@/lib/layout.shared"
import { docs, source } from "@/lib/source"

export interface DocsPageData {
  description?: string
  pageTree: Awaited<ReturnType<typeof source.serializePageTree>>
  path: string
  title: string
  url: string
}

export const loadDocsPage = createServerFn({ method: "GET" })
  .inputValidator((input: { locale: WebsiteLocale; slugs: string[] }) => input)
  .handler(async ({ data }): Promise<DocsPageData> => {
    const page = source.getPage(data.slugs, data.locale)
    if (!page) throw notFound()
    return {
      description: page.data.description,
      pageTree: await source.serializePageTree(source.getPageTree(data.locale)),
      path: page.path,
      title: page.data.title,
      url: page.url,
    }
  })

function Content({ path }: { path: string }) {
  const page = docs.getPage(path)
  if (!page) throw new Error(`Unknown documentation page: ${path}`)
  const { toc } = use(page.load())
  const MDX = page.body

  return (
    <DocsPage toc={toc}>
      <DocsBody>
        <MDX components={useMDXComponents()} />
      </DocsBody>
    </DocsPage>
  )
}

export function WebsiteDocsPage({ data, locale }: { data: DocsPageData; locale: WebsiteLocale }) {
  const resolved = useFumadocsLoader(data)
  return (
    <DocsLayout
      {...baseOptions(locale)}
      sidebar={{ footer: <DocsNavActions /> }}
      tree={resolved.pageTree}
    >
      <Suspense>
        <Content path={resolved.path} />
      </Suspense>
    </DocsLayout>
  )
}
