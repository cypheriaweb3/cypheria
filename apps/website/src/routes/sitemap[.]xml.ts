import { createFileRoute } from "@tanstack/react-router"
import { prerenderPaths, siteUrl } from "@/lib/site-routes"

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () => {
        const paths = prerenderPaths.filter(
          (path) => !path.startsWith("/api/") && !path.endsWith("404") && path !== "/sitemap.xml"
        )
        const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths
          .map((path) => `  <url><loc>${siteUrl}${path}</loc></url>`)
          .join("\n")}\n</urlset>\n`
        return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } })
      },
    },
  },
})
