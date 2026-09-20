import { createFileRoute } from "@tanstack/react-router"
import { DetailPage } from "@/components/marketing"
import { localizedHead } from "@/lib/metadata"

export const Route = createFileRoute("/security")({
  component: () => <DetailPage kind="security" locale="en" />,
  head: () =>
    localizedHead({
      description:
        "Understand Cypheria trust boundaries, signing policy, isolation, relay encryption, and audit.",
      locale: "en",
      path: "/security",
      title: "Security — Cypheria",
    }),
})
