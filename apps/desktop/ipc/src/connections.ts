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
