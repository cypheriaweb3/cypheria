import { z } from "zod"

export const ConnectionProxyProtocolSchema = z.enum(["http", "https", "socks5"])
export type ConnectionProxyProtocol = z.infer<typeof ConnectionProxyProtocolSchema>

const ManualConnectionProxySettingsSchema = z
  .object({
    bypass: z.string().max(2048),
    host: z
      .string()
      .trim()
      .min(1)
      .max(253)
      .refine((host) => !/[\s/?#@]/u.test(host), "Enter a host without a scheme or path."),
    mode: z.literal("manual"),
    password: z.string().max(1024),
    port: z.number().int().min(1).max(65_535),
    protocol: ConnectionProxyProtocolSchema,
    username: z.string().max(1024),
  })
  .strict()

export const ConnectionProxySettingsSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("system") }).strict(),
  z.object({ mode: z.literal("direct") }).strict(),
  ManualConnectionProxySettingsSchema,
])
export type ConnectionProxySettings = z.infer<typeof ConnectionProxySettingsSchema>

export const ConnectionProxyTestResultSchema = z
  .object({
    latencyMs: z.number().int().nonnegative(),
    message: z.string().min(1),
    ok: z.boolean(),
    statusCode: z.number().int().min(100).max(599).optional(),
  })
  .strict()
export type ConnectionProxyTestResult = z.infer<typeof ConnectionProxyTestResultSchema>

export const HarnessIdSchema = z.enum(["grok-build", "cursor", "gemini", "hermes", "opencode"])
export type HarnessId = z.infer<typeof HarnessIdSchema>

export const HarnessFileSnapshotSchema = z
  .object({
    modifiedAt: z.string().datetime(),
    path: z.string(),
    size: z.number().int().nonnegative(),
  })
  .strict()

export const HarnessInstallReceiptSchema = z
  .object({
    architecture: z.string().min(1),
    changedFiles: z.array(HarnessFileSnapshotSchema),
    executable: z.string().min(1),
    executableSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    harnessId: HarnessIdSchema,
    installedAt: z.string().datetime(),
    installer: z.string().min(1),
    installerArguments: z.array(z.string()),
    installerSource: z.string().min(1),
    managedEnvironment: z.record(z.string(), z.string()),
    platform: z.string().min(1),
    version: z.string().min(1),
  })
  .strict()
export type HarnessInstallReceipt = z.infer<typeof HarnessInstallReceiptSchema>

export const HarnessViewSchema = z
  .object({
    description: z.string().min(1),
    displayName: z.string().min(1),
    enabled: z.boolean(),
    executablePath: z.string().min(1),
    id: HarnessIdSchema,
    installState: z.enum(["notInstalled", "installing", "installed", "failed"]),
    installedVersion: z.string().nullable(),
    availableVersion: z.string().nullable(),
    lastUpdateCheckAt: z.string().datetime().nullable(),
    managedHome: z.string().min(1),
    receiptPath: z.string().nullable(),
    terminalHints: z.array(z.string().min(1)),
    updateAvailable: z.boolean(),
    updateCheck: z.enum(["supported", "nativeAuto", "unsupported"]),
  })
  .strict()
export type HarnessView = z.infer<typeof HarnessViewSchema>

export const HarnessIdRequestSchema = z.object({ id: HarnessIdSchema }).strict()
export const HarnessEnabledRequestSchema = z
  .object({ enabled: z.boolean(), id: HarnessIdSchema })
  .strict()
export const HarnessTerminalOpenRequestSchema = z
  .object({ cwd: z.string().min(1).optional(), id: HarnessIdSchema })
  .strict()
export const HarnessTerminalSessionSchema = z
  .object({ harnessId: HarnessIdSchema, terminalId: z.string().uuid(), title: z.string().min(1) })
  .strict()
export type HarnessTerminalSession = z.infer<typeof HarnessTerminalSessionSchema>
export const HarnessTerminalIdSchema = z.object({ terminalId: z.string().uuid() }).strict()
export const HarnessTerminalWriteSchema = HarnessTerminalIdSchema.extend({
  data: z.string().max(65_536),
}).strict()
export const HarnessTerminalResizeSchema = HarnessTerminalIdSchema.extend({
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(1).max(300),
}).strict()

export const HarnessEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      harnessId: HarnessIdSchema,
      message: z.string(),
      type: z.enum(["install.progress", "install.completed", "install.failed"]),
    })
    .strict(),
  z
    .object({ data: z.string(), terminalId: z.string().uuid(), type: z.literal("terminal.output") })
    .strict(),
  z
    .object({
      exitCode: z.number().int(),
      terminalId: z.string().uuid(),
      type: z.literal("terminal.exited"),
    })
    .strict(),
])
export type HarnessEvent = z.infer<typeof HarnessEventSchema>
