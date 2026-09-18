import type {
  Schedule,
  ScheduleClientMessage,
  ScheduleRun,
  ScheduleServerMessage,
} from "@cypheria/protocol"

import type { RequestOptions } from "./request-options.js"
import type { ServerClient } from "./server-client.js"

type Payload<T extends ScheduleClientMessage["type"]> = Extract<
  ScheduleClientMessage,
  { type: T }
>["payload"]

type ResultPayload<T> =
  | { ok: true; value: T }
  | { error: { code: string; message: string }; ok: false }

const unwrap = <T>(message: ScheduleServerMessage): T => {
  const payload = message.payload as ResultPayload<T>
  if (payload.ok) return payload.value
  const error = new Error(payload.error.message)
  error.name = payload.error.code
  throw error
}

export interface ScheduleActions {
  create(input: Payload<"schedule.create.request">, options?: RequestOptions): Promise<Schedule>
  delete(scheduleId: string, options?: RequestOptions): Promise<void>
  get(scheduleId: string, options?: RequestOptions): Promise<Schedule>
  list(options?: RequestOptions): Promise<Schedule[]>
  listRuns(scheduleId: string, limit?: number, options?: RequestOptions): Promise<ScheduleRun[]>
  pause(scheduleId: string, options?: RequestOptions): Promise<Schedule>
  resume(scheduleId: string, options?: RequestOptions): Promise<Schedule>
  run(scheduleId: string, options?: RequestOptions): Promise<ScheduleRun>
  update(input: Payload<"schedule.update.request">, options?: RequestOptions): Promise<Schedule>
}

export const createScheduleActions = (client: ServerClient): ScheduleActions => {
  const request = async <T>(
    type: ScheduleClientMessage["type"],
    payload: unknown,
    options?: RequestOptions
  ): Promise<T> => unwrap<T>(await client.requestSchedule(type, payload, options))

  return {
    create: (input, options) => request("schedule.create.request", input, options),
    delete: async (scheduleId, options) => {
      await request("schedule.delete.request", { scheduleId }, options)
    },
    get: (scheduleId, options) => request("schedule.get.request", { scheduleId }, options),
    list: (options) => request("schedule.list.request", {}, options),
    listRuns: (scheduleId, limit = 100, options) =>
      request("schedule.runs.list.request", { limit, scheduleId }, options),
    pause: (scheduleId, options) => request("schedule.pause.request", { scheduleId }, options),
    resume: (scheduleId, options) => request("schedule.resume.request", { scheduleId }, options),
    run: (scheduleId, options) => request("schedule.run.request", { scheduleId }, options),
    update: (input, options) => request("schedule.update.request", input, options),
  }
}
