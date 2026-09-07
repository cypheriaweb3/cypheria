export type PluginCatalogError = {
  readonly message: string
  readonly path: string
}

export const isRemotePluginCatalogAuthError = (error: PluginCatalogError): boolean =>
  error.path === "catalog:app-server" &&
  (/chatgpt authentication required for remote plugin catalog/i.test(error.message) ||
    (/remote plugin catalog/i.test(error.message) && /401(?: unauthorized)?/i.test(error.message)))
