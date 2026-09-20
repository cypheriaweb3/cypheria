import { createFileRoute } from "@tanstack/react-router"
import { type DocsPageData, loadDocsPage, WebsiteDocsPage } from "@/components/docs-page"
import { localizedHead } from "@/lib/metadata"
import { docs } from "@/lib/source"

export const Route = createFileRoute("/docs/$")({
  component: Page,
  head: ({ loaderData }) => {
    const data = loaderData as DocsPageData | undefined
    return localizedHead({
      description: data?.description ?? "Cypheria documentation.",
      locale: "en",
      path: data?.url ?? "/docs",
      title: `${data?.title ?? "Documentation"} — Cypheria`,
    })
  },
  loader: async ({ params }): Promise<DocsPageData> => {
    const data = await loadDocsPage({
      data: { locale: "en", slugs: params._splat?.split("/") ?? [] },
    })
    await docs.getPage(data.path)?.preload()
    return data
  },
})

function Page() {
  return <WebsiteDocsPage data={Route.useLoaderData()} locale="en" />
}
