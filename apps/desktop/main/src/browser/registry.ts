// Adapted from Paseo (Apache-2.0), https://github.com/getpaseo/paseo,
// packages/desktop/src/features/browser-webviews/registry.ts.
export type BrowserKind = "web" | "dapp"

export interface BrowserScopeRegistration {
  browserId: string
  kind: BrowserKind
  scopeId: string
}

export interface BrowserWebContentsRegistration {
  browserId: string
  hostWebContentsId: number
}

export class BrowserWebviewRegistry {
  private readonly registrationsByWebContentsId = new Map<number, BrowserWebContentsRegistration>()
  private readonly webContentsIdsByHostAndBrowserId = new Map<string, number>()
  private readonly scopeIdsByBrowserId = new Map<string, string>()
  private readonly kindsByBrowserId = new Map<string, BrowserKind>()
  private readonly activeBrowserIdsByHostWindow = new Map<number, Map<string, string>>()

  public registerWebContents(input: {
    webContentsId: number
    browserId: string
    hostWebContentsId: number
  }): void {
    const hostBrowserKey = this.hostBrowserKey(input.hostWebContentsId, input.browserId)
    const replacedWebContentsId = this.webContentsIdsByHostAndBrowserId.get(hostBrowserKey)
    const existingRegistration = this.registrationsByWebContentsId.get(input.webContentsId)
    if (
      replacedWebContentsId === input.webContentsId &&
      existingRegistration?.browserId === input.browserId &&
      existingRegistration.hostWebContentsId === input.hostWebContentsId
    ) {
      return
    }
    if (replacedWebContentsId !== undefined && replacedWebContentsId !== input.webContentsId) {
      this.removeWebContents(replacedWebContentsId, { preserveActiveBrowser: true })
    }
    if (this.registrationsByWebContentsId.has(input.webContentsId)) {
      this.removeWebContents(input.webContentsId)
    }

    this.registrationsByWebContentsId.set(input.webContentsId, {
      browserId: input.browserId,
      hostWebContentsId: input.hostWebContentsId,
    })
    this.webContentsIdsByHostAndBrowserId.set(hostBrowserKey, input.webContentsId)
  }

  public unregisterWebContents(webContentsId: number): void {
    if (!this.registrationsByWebContentsId.has(webContentsId)) {
      return
    }

    this.removeWebContents(webContentsId)
  }

  public getBrowserIdForWebContents(webContentsId: number): string | null {
    return this.registrationsByWebContentsId.get(webContentsId)?.browserId ?? null
  }

  public getRegistrationForWebContents(
    webContentsId: number
  ): BrowserWebContentsRegistration | null {
    return this.registrationsByWebContentsId.get(webContentsId) ?? null
  }

  public getWebContentsIdForBrowserInHostWindow(
    hostWebContentsId: number,
    browserId: string
  ): number | null {
    return (
      this.webContentsIdsByHostAndBrowserId.get(
        this.hostBrowserKey(hostWebContentsId, browserId)
      ) ?? null
    )
  }

  public listBrowserIds(): string[] {
    return Array.from(
      new Set(Array.from(this.registrationsByWebContentsId.values(), ({ browserId }) => browserId))
    ).sort()
  }

  public registerScope(input: BrowserScopeRegistration): void {
    this.scopeIdsByBrowserId.set(input.browserId, input.scopeId)
    this.kindsByBrowserId.set(input.browserId, input.kind)
  }

  public getKind(browserId: string): BrowserKind | null {
    return this.kindsByBrowserId.get(browserId) ?? null
  }

  public unregisterBrowser(browserId: string): void {
    for (const [webContentsId, registration] of this.registrationsByWebContentsId) {
      if (registration.browserId === browserId) {
        this.registrationsByWebContentsId.delete(webContentsId)
        this.webContentsIdsByHostAndBrowserId.delete(
          this.hostBrowserKey(registration.hostWebContentsId, browserId)
        )
      }
    }
    this.scopeIdsByBrowserId.delete(browserId)
    this.kindsByBrowserId.delete(browserId)
    this.deleteActiveBrowserReferences(browserId)
  }

  public unregisterBrowserFromHost(hostWebContentsId: number, browserId: string): void {
    const webContentsId = this.getWebContentsIdForBrowserInHostWindow(hostWebContentsId, browserId)
    if (webContentsId !== null) {
      this.unregisterWebContents(webContentsId)
    }
  }

  public getScopeId(browserId: string): string | null {
    return this.scopeIdsByBrowserId.get(browserId) ?? null
  }

  public hasBrowserInOtherHostWindow(hostWebContentsId: number, browserId: string): boolean {
    for (const registration of this.registrationsByWebContentsId.values()) {
      if (
        registration.browserId === browserId &&
        registration.hostWebContentsId !== hostWebContentsId
      ) {
        return true
      }
    }
    return false
  }

  public unregisterHostWebContents(hostWebContentsId: number): void {
    for (const [webContentsId, registration] of this.registrationsByWebContentsId) {
      if (registration.hostWebContentsId === hostWebContentsId) {
        this.unregisterWebContents(webContentsId)
      }
    }
    this.activeBrowserIdsByHostWindow.delete(hostWebContentsId)
  }

  public listBrowserIdsForScope(scopeId: string): string[] {
    return this.listBrowserIds().filter(
      (browserId) => this.scopeIdsByBrowserId.get(browserId) === scopeId
    )
  }

  public setScopeActiveBrowser(input: {
    hostWebContentsId: number
    scopeId: string
    browserId: string | null
  }): void {
    if (input.browserId === null) {
      const activeBrowserIdsByScope = this.activeBrowserIdsByHostWindow.get(input.hostWebContentsId)
      if (!activeBrowserIdsByScope) {
        return
      }
      activeBrowserIdsByScope.delete(input.scopeId)
      if (activeBrowserIdsByScope.size === 0) {
        this.activeBrowserIdsByHostWindow.delete(input.hostWebContentsId)
      }
      return
    }
    if (this.hasBrowser(input.browserId)) {
      this.scopeIdsByBrowserId.set(input.browserId, input.scopeId)
    }
    const activeBrowserIdsByScope =
      this.activeBrowserIdsByHostWindow.get(input.hostWebContentsId) ?? new Map<string, string>()
    activeBrowserIdsByScope.delete(input.scopeId)
    activeBrowserIdsByScope.set(input.scopeId, input.browserId)
    this.activeBrowserIdsByHostWindow.delete(input.hostWebContentsId)
    this.activeBrowserIdsByHostWindow.set(input.hostWebContentsId, activeBrowserIdsByScope)
  }

  public getActiveBrowserIdForHostWindow(hostWebContentsId: number): string | null {
    return (
      Array.from(this.activeBrowserIdsByHostWindow.get(hostWebContentsId)?.values() ?? []).at(-1) ??
      null
    )
  }

  public getActiveBrowserIdForScopeInHostWindow(
    hostWebContentsId: number,
    scopeId: string
  ): string | null {
    return this.activeBrowserIdsByHostWindow.get(hostWebContentsId)?.get(scopeId) ?? null
  }

  public getMostRecentActiveBrowserIdForScope(scopeId: string): string | null {
    const activeBrowserIdsByHostWindow = Array.from(this.activeBrowserIdsByHostWindow.values())
    for (let index = activeBrowserIdsByHostWindow.length - 1; index >= 0; index -= 1) {
      const browserId = activeBrowserIdsByHostWindow[index]?.get(scopeId)
      if (browserId) {
        return browserId
      }
    }
    return null
  }

  private deleteActiveBrowserReferences(browserId: string): void {
    for (const [hostWebContentsId, activeBrowserIdsByScope] of this.activeBrowserIdsByHostWindow) {
      for (const [scopeId, activeBrowserId] of activeBrowserIdsByScope) {
        if (activeBrowserId === browserId) {
          activeBrowserIdsByScope.delete(scopeId)
        }
      }
      if (activeBrowserIdsByScope.size === 0) {
        this.activeBrowserIdsByHostWindow.delete(hostWebContentsId)
      }
    }
  }

  private deleteActiveBrowserReferencesInHostWindow(
    browserId: string,
    hostWebContentsId: number
  ): void {
    const activeBrowserIdsByScope = this.activeBrowserIdsByHostWindow.get(hostWebContentsId)
    if (!activeBrowserIdsByScope) {
      return
    }
    for (const [scopeId, activeBrowserId] of activeBrowserIdsByScope) {
      if (activeBrowserId === browserId) {
        activeBrowserIdsByScope.delete(scopeId)
      }
    }
    if (activeBrowserIdsByScope.size === 0) {
      this.activeBrowserIdsByHostWindow.delete(hostWebContentsId)
    }
  }

  private removeWebContents(
    webContentsId: number,
    options: { preserveActiveBrowser?: boolean } = {}
  ): void {
    const registration = this.registrationsByWebContentsId.get(webContentsId)
    if (!registration) {
      return
    }
    const { browserId, hostWebContentsId } = registration

    this.registrationsByWebContentsId.delete(webContentsId)
    this.webContentsIdsByHostAndBrowserId.delete(this.hostBrowserKey(hostWebContentsId, browserId))

    if (
      !options.preserveActiveBrowser &&
      !this.hasBrowserInHostWindow(browserId, hostWebContentsId)
    ) {
      this.deleteActiveBrowserReferencesInHostWindow(browserId, hostWebContentsId)
    }
  }

  private hasBrowser(browserId: string): boolean {
    return Array.from(this.registrationsByWebContentsId.values()).some(
      (registration) => registration.browserId === browserId
    )
  }

  private hasBrowserInHostWindow(browserId: string, hostWebContentsId: number): boolean {
    return this.webContentsIdsByHostAndBrowserId.has(
      this.hostBrowserKey(hostWebContentsId, browserId)
    )
  }

  private hostBrowserKey(hostWebContentsId: number, browserId: string): string {
    return `${hostWebContentsId}:${browserId}`
  }
}
