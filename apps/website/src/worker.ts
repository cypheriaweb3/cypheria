import handler, { createServerEntry } from "@tanstack/react-start/server-entry"

const securityHeaders = {
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; upgrade-insecure-requests",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const

export default createServerEntry({
  async fetch(request) {
    const response = await handler.fetch(request)
    const headers = new Headers(response.headers)
    for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value)
    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    })
  },
})
