import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { connect } from "node:net"
import { homedir } from "node:os"
import { join } from "node:path"

import { BROWSER_FAMILIES, BROWSER_FAMILY_INFO, type BrowserFamily } from "../../families.ts"

/** Where one browser family keeps its default user data and executable on this platform. */
export type BrowserInstallation = {
  readonly family: BrowserFamily
  readonly name: string
  readonly userDataDir: string
  readonly executables: readonly string[]
}

type Paths = { readonly data: string; readonly executables: readonly string[] }

const macApp = (home: string, app: string, binary: string) => [
  `/Applications/${app}.app/Contents/MacOS/${binary}`,
  join(home, "Applications", `${app}.app`, "Contents", "MacOS", binary),
]

const platformPaths = (
  platform: NodeJS.Platform,
  home: string,
  env: NodeJS.ProcessEnv
): Record<BrowserFamily, Paths> | null => {
  if (platform === "darwin") {
    const support = join(home, "Library", "Application Support")
    return {
      brave: {
        data: join(support, "BraveSoftware", "Brave-Browser"),
        executables: macApp(home, "Brave Browser", "Brave Browser"),
      },
      chrome: {
        data: join(support, "Google", "Chrome"),
        executables: macApp(home, "Google Chrome", "Google Chrome"),
      },
      chromium: {
        data: join(support, "Chromium"),
        executables: macApp(home, "Chromium", "Chromium"),
      },
      edge: {
        data: join(support, "Microsoft Edge"),
        executables: macApp(home, "Microsoft Edge", "Microsoft Edge"),
      },
      opera: {
        data: join(support, "com.operasoftware.Opera"),
        executables: macApp(home, "Opera", "Opera"),
      },
      vivaldi: { data: join(support, "Vivaldi"), executables: macApp(home, "Vivaldi", "Vivaldi") },
    }
  }
  if (platform === "linux") {
    const config = env.XDG_CONFIG_HOME || join(home, ".config")
    const bins = (...names: string[]) =>
      names.flatMap((name) => [`/usr/bin/${name}`, `/usr/local/bin/${name}`, `/snap/bin/${name}`])
    return {
      brave: {
        data: join(config, "BraveSoftware", "Brave-Browser"),
        executables: bins("brave-browser", "brave"),
      },
      chrome: {
        data: join(config, "google-chrome"),
        executables: bins("google-chrome", "google-chrome-stable"),
      },
      chromium: {
        data: join(config, "chromium"),
        executables: bins("chromium", "chromium-browser"),
      },
      edge: {
        data: join(config, "microsoft-edge"),
        executables: bins("microsoft-edge", "microsoft-edge-stable"),
      },
      opera: { data: join(config, "opera"), executables: bins("opera") },
      vivaldi: { data: join(config, "vivaldi"), executables: bins("vivaldi", "vivaldi-stable") },
    }
  }
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || join(home, "AppData", "Local")
    const roaming = env.APPDATA || join(home, "AppData", "Roaming")
    const programs = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], local].filter(
      (entry): entry is string => Boolean(entry)
    )
    const exe = (...relative: string[]) => programs.map((root) => join(root, ...relative))
    return {
      brave: {
        data: join(local, "BraveSoftware", "Brave-Browser", "User Data"),
        executables: exe("BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      },
      chrome: {
        data: join(local, "Google", "Chrome", "User Data"),
        executables: exe("Google", "Chrome", "Application", "chrome.exe"),
      },
      chromium: {
        data: join(local, "Chromium", "User Data"),
        executables: exe("Chromium", "Application", "chrome.exe"),
      },
      edge: {
        data: join(local, "Microsoft", "Edge", "User Data"),
        executables: exe("Microsoft", "Edge", "Application", "msedge.exe"),
      },
      opera: {
        data: join(roaming, "Opera Software", "Opera Stable"),
        executables: exe("Programs", "Opera", "opera.exe"),
      },
      vivaldi: {
        data: join(local, "Vivaldi", "User Data"),
        executables: exe("Vivaldi", "Application", "vivaldi.exe"),
      },
    }
  }
  return null
}

/** The browser families this platform supports, with their default locations. */
export const browserInstallations = (
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env
): BrowserInstallation[] => {
  const paths = platformPaths(platform, home, env)
  if (!paths) return []
  return BROWSER_FAMILIES.map((family) => ({
    executables: paths[family].executables,
    family,
    name: BROWSER_FAMILY_INFO[family].displayName,
    userDataDir: paths[family].data,
  }))
}

export const isInstalled = (installation: BrowserInstallation): boolean =>
  installation.executables.some((path) => existsSync(path)) || existsSync(installation.userDataDir)

/** A browser's DevTools endpoint, which it publishes while remote debugging is on. */
export type DevToolsEndpoint = { readonly port: number; readonly webSocketUrl: string }

/**
 * Reads `DevToolsActivePort` from a user data directory: the port on its first line and the
 * browser target path on its second. A browser writes it when remote debugging is enabled, for
 * example from its `inspect/#remote-debugging` page, and removes it on a clean exit.
 */
export const readDevToolsActivePort = async (
  userDataDir: string
): Promise<DevToolsEndpoint | null> => {
  let contents: string
  try {
    contents = await readFile(join(userDataDir, "DevToolsActivePort"), "utf8")
  } catch {
    return null
  }
  const [portLine, pathLine] = contents.split(/\r?\n/u)
  const port = Number(portLine)
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return null
  const path = pathLine?.trim()
  if (!path?.startsWith("/devtools/browser/")) return null
  return { port, webSocketUrl: `ws://127.0.0.1:${port}${path}` }
}

/** Whether something listens on the loopback port; a crashed browser leaves a stale file. */
export const isPortOpen = (port: number, timeoutMs = 500): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port })
    const done = (open: boolean) => {
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once("connect", () => done(true))
    socket.once("error", () => done(false))
  })
