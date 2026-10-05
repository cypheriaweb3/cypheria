import { defineConfig } from "wxt"

// The manifest `key` fixes the extension ID, which the native messaging host's
// `allowed_origins` lists. Store builds receive their own IDs, added to that list on publication.
export default defineConfig({
  manifest: {
    action: { default_title: "Cypheria" },
    description: "Lets Cypheria agents work in your browser tabs.",
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqgvme5jpbrsCNV8ANrS+ZjQLFX317PlPdd8SPQ4ZJtVOXMrRL9NTKEy4WIM0qK8uPvYRgsU/2xzI/atd+wf5tUxbwJveSs9UoyQwaANb4gN9FMPAXgSe5OtWrl2Qk1E6GQCYcgBK+FYgGQp/ertQfPnPWREqOj3gIq6SoMjt5VbSxctJphZGzy04SlB4JS8n7Xl1Fy2FQMWXHRBoBYsh2IFPTuk4KVGfMOBqEl3Losg/0bYegrb43Sohpi+6vN6gaBtwZdrfYXxOgOfoWK9NyGfxcne+ci5SN+Px/favhdgDmrhKyIciI5iGBNptaZAUXPg0lJrH/RdViBuL303vqwIDAQAB",
    minimum_chrome_version: "120",
    name: "Cypheria",
    permissions: [
      "alarms",
      "debugger",
      "downloads",
      "nativeMessaging",
      "storage",
      "tabGroups",
      "tabs",
    ],
  },
  manifestVersion: 3,
})
