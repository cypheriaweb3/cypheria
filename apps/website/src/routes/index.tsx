import { createFileRoute } from "@tanstack/react-router"
import { HomePage } from "@/components/marketing"
import { localizedHead } from "@/lib/metadata"

export const Route = createFileRoute("/")({
  component: () => <HomePage locale="en" />,
  head: () =>
    localizedHead({
      description: "A local-first workspace for agents, wallets, and the web.",
      locale: "en",
      path: "/",
      title: "Cypheria — Local agents. One trusted workspace.",
    }),
})
