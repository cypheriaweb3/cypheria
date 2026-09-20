/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly CYPHERIA_SITE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "*.po" {
  import type { Messages } from "@lingui/core"
  export const messages: Messages
}
