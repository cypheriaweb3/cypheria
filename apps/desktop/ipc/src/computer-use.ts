import { z } from "zod"

import { BrowserCallOutcomeSchema, McpAppCallSchema } from "./browser.js"

const IPC_VERSION = 1 as const

export const CYPHERIA_COMPUTER_USE_CHANNELS = {
  chromeImplementationTypeSet: "computer-use.chrome-implementation-type.set",
  computerBackendSet: "computer-use.computer-backend.set",
  driverRestart: "computer-use.driver.restart",
  mcpAppExecute: "computer-use.mcp-app.execute",
  permissionRequest: "computer-use.permission.request",
  statusRead: "computer-use.status.read",
} as const

const contract = <const C extends string, Req extends z.ZodType, Res extends z.ZodType>(
  channel: C,
  request: Req,
  response: Res
) => ({ channel, namespace: "computerUse" as const, request, response, version: IPC_VERSION })

/**
 * How this device drives the person's Chromium browsers: the Cypheria extension (`extension`) or
 * the Chrome DevTools Protocol (`cdp`). It stays on the device: the Server and Agents only see
 * `chrome` browsers.
 */
export const ChromeImplementationTypeSchema = z.enum(["extension", "cdp"])
export type ChromeImplementationType = z.infer<typeof ChromeImplementationTypeSchema>

/**
 * How this device drives native apps: the cua-driver service Cypheria ships (`cua-driver`), or
 * the Computer Use runtime of the person's installed ChatGPT on macOS (`codex`).
 */
export const ComputerBackendSchema = z.enum(["cua-driver", "codex"])
export type ComputerBackend = z.infer<typeof ComputerBackendSchema>

/** The Cypheria extension on this device: its native host and the connected browser profiles. */
export const BrowserExtensionStatusSchema = z
  .object({
    /** Whether the native host is installed under the Cypheria home. */
    host: z.enum(["installed", "missing", "pending"]),
    hostErrors: z.array(z.string()),
    /** The browser families (or Windows registry keys) the host is registered with. */
    registeredBrowsers: z.array(z.string()),
    endpointError: z.string().nullable(),
    /** The extension IDs the host accepts. */
    extensionIds: z.array(z.string()),
    /** The unpacked extension in development builds, to load from the browser's extensions page. */
    unpackedPath: z.string().nullable(),
    browsers: z.array(
      z.object({ family: z.string(), name: z.string(), extensionVersion: z.string() }).strict()
    ),
  })
  .strict()
export type BrowserExtensionStatus = z.infer<typeof BrowserExtensionStatusSchema>

/**
 * What Desktop knows about Computer Use on this device: its name, which device backends it can
 * serve, whether the embedded cua-driver service runs, and, on macOS, the grants Cypheria holds.
 * `null` means the platform has no such permission.
 */
export const ComputerUseStatusSchema = z
  .object({
    accessibility: z.boolean().nullable(),
    /** The name the Server shows for this device, such as its host name. */
    deviceName: z.string().min(1),
    driver: z.enum(["running", "stopped", "missing", "unsupported"]),
    driverError: z.string().nullable(),
    screenRecording: z
      .enum(["granted", "denied", "not-determined", "restricted", "unknown"])
      .nullable(),
    /** Whether this device can drive the person's external browsers and its native apps. */
    capabilities: z.object({ chrome: z.boolean(), computer: z.boolean() }).strict(),
    /** The selected `chrome` implementation type, and the types this build offers. */
    chromeImplementationType: z
      .object({
        available: z.array(ChromeImplementationTypeSchema),
        selected: ChromeImplementationTypeSchema,
      })
      .strict(),
    browserExtension: BrowserExtensionStatusSchema,
    /** The selected native app backend, and what this device found of ChatGPT's runtime. */
    computerBackend: z
      .object({
        available: z.array(ComputerBackendSchema),
        selected: ComputerBackendSchema,
        codex: z
          .object({
            /** Why the runtime cannot serve this device; null when it can. */
            unavailableReason: z.string().nullable(),
            version: z.string().nullable(),
            /** Codex Computer Use.app, which holds its own Accessibility and Screen Recording grants. */
            serviceApp: z.string().nullable(),
          })
          .strict()
          .nullable(),
      })
      .strict(),
  })
  .strict()
export type ComputerUseStatus = z.infer<typeof ComputerUseStatusSchema>

export const computerUseStatusReadContract = contract(
  CYPHERIA_COMPUTER_USE_CHANNELS.statusRead,
  z.object({}).strict(),
  ComputerUseStatusSchema
)
export const computerUsePermissionRequestContract = contract(
  CYPHERIA_COMPUTER_USE_CHANNELS.permissionRequest,
  z.object({ permission: z.enum(["accessibility", "screen-recording"]) }).strict(),
  ComputerUseStatusSchema
)
export const computerUseDriverRestartContract = contract(
  CYPHERIA_COMPUTER_USE_CHANNELS.driverRestart,
  z.object({}).strict(),
  ComputerUseStatusSchema
)

export const computerUseChromeImplementationTypeSetContract = contract(
  CYPHERIA_COMPUTER_USE_CHANNELS.chromeImplementationTypeSet,
  z.object({ type: ChromeImplementationTypeSchema }).strict(),
  ComputerUseStatusSchema
)

export const computerUseComputerBackendSetContract = contract(
  CYPHERIA_COMPUTER_USE_CHANNELS.computerBackendSet,
  z.object({ backend: ComputerBackendSchema }).strict(),
  ComputerUseStatusSchema
)

/** Runs one browser API member in a mounted MCP App, identified by its sandbox origin. */
export const computerUseMcpAppExecuteContract = contract(
  CYPHERIA_COMPUTER_USE_CHANNELS.mcpAppExecute,
  McpAppCallSchema,
  BrowserCallOutcomeSchema
)
