import { createFileRoute } from "@tanstack/react-router"
import { DetailPage } from "@/components/marketing"
import { localizedHead } from "@/lib/metadata"

export const Route = createFileRoute("/product")({
  component: () => <DetailPage kind="product" locale="en" />,
  head: () =>
    localizedHead({
      description:
        "Explore the Cypheria workspace, Agent lifecycle, tools, schedules, and clients.",
      locale: "en",
      path: "/product",
      title: "Product — Cypheria",
    }),
})
