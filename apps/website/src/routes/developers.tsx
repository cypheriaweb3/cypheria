import { createFileRoute } from "@tanstack/react-router"
import { DetailPage } from "@/components/marketing"
import { localizedHead } from "@/lib/metadata"

export const Route = createFileRoute("/developers")({
  component: () => <DetailPage kind="developers" locale="en" />,
  head: () =>
    localizedHead({
      description: "Cypheria architecture, repository, development commands, and documentation.",
      locale: "en",
      path: "/developers",
      title: "Developers — Cypheria",
    }),
})
