/**
 * Dependency-free browser constants shared by Electron main, the renderer, and the sandboxed guest
 * preloads. Keep this module free of imports so guest preload bundles stay small.
 */

/** Shared web profile. Web tabs keep ordinary signed-in state and never receive a wallet. */
export const CYPHERIA_WEB_BROWSER_PARTITION = "persist:cypheria-browser"
/** Shared dApp profile. dApp tabs receive the wallet provider and filtered third-party cookies. */
export const CYPHERIA_DAPP_BROWSER_PARTITION = "persist:cypheria-dapp-browser"

export const CYPHERIA_BROWSER_CHANNELS = {
  activeSet: "browser.active.set",
  attachedRegister: "browser.attached.register",
  automationExecute: "browser.automation.execute",
  dataClear: "browser.data.clear",
  devToolsOpen: "browser.devtools.open",
  focus: "browser.focus",
  liveList: "browser.live.list",
  newTabRequested: "browser.new-tab.requested",
  reservedShortcut: "browser.shortcut.reserved",
  shortcutInput: "browser.shortcut.input",
  shortcutPolicySet: "browser.shortcut-policy.set",
  unregister: "browser.unregister",
} as const

/** Channels between Electron main and the sandboxed preload running inside browser tabs. */
export const CYPHERIA_BROWSER_GUEST_CHANNELS = {
  keyboardPolicy: "browser.guest.keyboard-policy",
  keyboardPolicyRequest: "browser.guest.keyboard-policy.request",
  shortcutInput: "browser.guest.shortcut-input",
} as const
