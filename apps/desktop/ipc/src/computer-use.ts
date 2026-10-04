import { BrowserMcpAppActionSchema } from "@cypheria/protocol"
import { z } from "zod"

const IPC_VERSION = 1 as const

export const CYPHERIA_COMPUTER_USE_CHANNELS = {
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
 * What Desktop knows about Computer Use on this device: its name, which device surfaces it can
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
    surfaces: z.object({ browsers: z.boolean(), computer: z.boolean() }).strict(),
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

/** The sandbox origin of a mounted MCP App, which identifies its frames in the main window. */
export const McpAppSandboxOriginSchema = z
  .string()
  .regex(/^cypheria-sandbox:\/\/[a-z0-9]{1,63}\/?$/u)

export const McpAppExecuteResultSchema = z
  .object({
    dataBase64: z.string().min(1).optional(),
    mimeType: z.literal("image/png").optional(),
    snapshot: z.string().optional(),
  })
  .strict()
export type McpAppExecuteResult = z.infer<typeof McpAppExecuteResultSchema>

export const computerUseMcpAppExecuteContract = contract(
  CYPHERIA_COMPUTER_USE_CHANNELS.mcpAppExecute,
  z
    .object({
      action: BrowserMcpAppActionSchema,
      appId: z.string().min(1).max(256),
      origin: McpAppSandboxOriginSchema,
    })
    .strict(),
  McpAppExecuteResultSchema
)
