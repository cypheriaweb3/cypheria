import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/settings/account")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/connections" })
  },
})
