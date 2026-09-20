import { createFileRoute } from "@tanstack/react-router"
import { type DocsPageData, loadDocsPage, WebsiteDocsPage } from "@/components/docs-page"
import { localizedHead } from "@/lib/metadata"
import { docs } from "@/lib/source"

export const Route = createFileRoute("/zh-CN/docs/$")({
  component: Page,
  head: ({ loaderData }) => {
    const data = loaderData as DocsPageData | undefined
    return localizedHead({
      description: data?.description ?? "Cypheria 中文文档。",
      locale: "zh-CN",
      path: data?.url?.replace(/^\/zh-CN/u, "") ?? "/docs",
      title: `${data?.title ?? "文档"} — Cypheria`,
    })
  },
  loader: async ({ params }): Promise<DocsPageData> => {
    const data = await loadDocsPage({
      data: { locale: "zh-CN", slugs: params._splat?.split("/") ?? [] },
    })
    await docs.getPage(data.path)?.preload()
    return data
  },
})

function Page() {
  return <WebsiteDocsPage data={Route.useLoaderData()} locale="zh-CN" />
}
