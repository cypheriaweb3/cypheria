import { z } from "zod"

export const WorkspaceTerminalOpenRequestSchema = z
  .object({ projectId: z.string().min(1).optional() })
  .strict()

export const WorkspaceTerminalSessionSchema = z
  .object({
    cwd: z.string().min(1),
    terminalId: z.string().uuid(),
    title: z.string().min(1),
  })
  .strict()
export type WorkspaceTerminalSession = z.infer<typeof WorkspaceTerminalSessionSchema>

export const WorkspaceTerminalIdSchema = z.object({ terminalId: z.string().uuid() }).strict()

export const WorkspaceTerminalWriteSchema = WorkspaceTerminalIdSchema.extend({
  data: z.string().max(65_536),
}).strict()

export const WorkspaceTerminalResizeSchema = WorkspaceTerminalIdSchema.extend({
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(1).max(300),
}).strict()

export const WorkspaceTerminalEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      data: z.string(),
      terminalId: z.string().uuid(),
      type: z.literal("terminal.output"),
    })
    .strict(),
  z
    .object({
      exitCode: z.number().int(),
      terminalId: z.string().uuid(),
      type: z.literal("terminal.exited"),
    })
    .strict(),
])
export type WorkspaceTerminalEvent = z.infer<typeof WorkspaceTerminalEventSchema>
