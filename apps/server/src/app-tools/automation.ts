import type { Schedule, ScheduleCadence, ScheduleTarget } from "@cypheria/protocol"
import type { v2 } from "@cypheria/protocol/codex-types"

/**
 * `automation_update`: recurring automations as Codex sees them in the official desktop. A `cron`
 * automation starts a new Thread for each run and a `heartbeat` automation wakes an existing
 * Thread; both are Server Schedules. Schedules use RRULE strings in the tool and cadences
 * (interval or five-field cron, in the Server's time zone) in storage.
 */

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const
const ALLOWED_PARTS = new Set(["FREQ", "INTERVAL", "BYDAY", "BYHOUR", "BYMINUTE", "BYMONTHDAY"])

export class AutomationInputError extends Error {}

const integers = (value: string | undefined, min: number, max: number, key: string): number[] => {
  const numbers = (value ?? "").split(",").map((entry) => Number(entry))
  if (
    numbers.length === 0 ||
    numbers.some((entry) => !Number.isInteger(entry) || entry < min || entry > max)
  ) {
    throw new AutomationInputError(`${key} must list integers from ${min} to ${max}.`)
  }
  return numbers
}

/** Converts the supported RRULE forms into a cadence. Anything else is rejected with a reason. */
export const rruleToCadence = (rrule: string): ScheduleCadence => {
  const source = rrule.trim().replace(/^RRULE:/iu, "")
  if (/DTSTART/iu.test(source)) {
    throw new AutomationInputError(
      "DTSTART is not supported. Encode wall-clock times with BYDAY, BYHOUR, and BYMINUTE; they apply in the Server's time zone."
    )
  }
  const parts = new Map<string, string>()
  for (const segment of source.split(";").filter(Boolean)) {
    const [key = "", value = ""] = segment.split("=")
    const name = key.toUpperCase()
    if (!ALLOWED_PARTS.has(name) || !value) {
      throw new AutomationInputError(
        `RRULE part ${key || segment} is not supported. Use FREQ with INTERVAL, BYDAY, BYHOUR, BYMINUTE, or BYMONTHDAY.`
      )
    }
    parts.set(name, value.toUpperCase())
  }
  const frequency = parts.get("FREQ")
  const interval = parts.has("INTERVAL")
    ? (integers(parts.get("INTERVAL"), 1, 10_000, "INTERVAL")[0] as number)
    : 1
  const minute = parts.has("BYMINUTE")
    ? (integers(parts.get("BYMINUTE"), 0, 59, "BYMINUTE")[0] as number)
    : null
  const hours = parts.has("BYHOUR") ? integers(parts.get("BYHOUR"), 0, 23, "BYHOUR") : null
  const requireNoOthers = (...allowed: string[]): void => {
    for (const key of parts.keys()) {
      if (key !== "FREQ" && !allowed.includes(key)) {
        throw new AutomationInputError(`${key} is not supported with FREQ=${frequency}.`)
      }
    }
  }
  const requireWallClock = (): { hours: number[]; minute: number } => {
    if (!hours) throw new AutomationInputError(`FREQ=${frequency} needs BYHOUR.`)
    return { hours, minute: minute ?? 0 }
  }
  switch (frequency) {
    case "MINUTELY":
      requireNoOthers("INTERVAL")
      return { everyMs: interval * 60_000, type: "interval" }
    case "HOURLY":
      requireNoOthers("INTERVAL", "BYMINUTE")
      if (minute === null) return { everyMs: interval * 3_600_000, type: "interval" }
      return {
        expression: `${minute} ${interval === 1 ? "*" : `*/${interval}`} * * *`,
        type: "cron",
      }
    case "DAILY": {
      requireNoOthers("INTERVAL", "BYHOUR", "BYMINUTE")
      if (interval !== 1) throw new AutomationInputError("FREQ=DAILY supports only INTERVAL=1.")
      const clock = requireWallClock()
      return { expression: `${clock.minute} ${clock.hours.join(",")} * * *`, type: "cron" }
    }
    case "WEEKLY": {
      requireNoOthers("INTERVAL", "BYDAY", "BYHOUR", "BYMINUTE")
      if (interval !== 1) throw new AutomationInputError("FREQ=WEEKLY supports only INTERVAL=1.")
      const days = (parts.get("BYDAY") ?? "")
        .split(",")
        .map((day) => WEEKDAYS.indexOf(day as never))
      if (days.length === 0 || days.some((day) => day < 0)) {
        throw new AutomationInputError("FREQ=WEEKLY needs BYDAY with days such as MO,WE,FR.")
      }
      const clock = requireWallClock()
      return {
        expression: `${clock.minute} ${clock.hours.join(",")} * * ${[...new Set(days)].sort().join(",")}`,
        type: "cron",
      }
    }
    case "MONTHLY": {
      requireNoOthers("INTERVAL", "BYMONTHDAY", "BYHOUR", "BYMINUTE")
      if (interval !== 1) throw new AutomationInputError("FREQ=MONTHLY supports only INTERVAL=1.")
      if (!parts.has("BYMONTHDAY")) throw new AutomationInputError("FREQ=MONTHLY needs BYMONTHDAY.")
      const days = integers(parts.get("BYMONTHDAY"), 1, 31, "BYMONTHDAY")
      const clock = requireWallClock()
      return {
        expression: `${clock.minute} ${clock.hours.join(",")} ${days.join(",")} * *`,
        type: "cron",
      }
    }
    default:
      throw new AutomationInputError("FREQ must be MINUTELY, HOURLY, DAILY, WEEKLY, or MONTHLY.")
  }
}

/** The RRULE a cadence round-trips to, or null when it was not written through this tool. */
export const cadenceToRrule = (cadence: ScheduleCadence): string | null => {
  if (cadence.type === "interval") {
    if (cadence.everyMs % 3_600_000 === 0)
      return `FREQ=HOURLY;INTERVAL=${cadence.everyMs / 3_600_000}`
    if (cadence.everyMs % 60_000 === 0) return `FREQ=MINUTELY;INTERVAL=${cadence.everyMs / 60_000}`
    return null
  }
  if (cadence.type !== "cron") return null
  const [minute, hour, day, month, weekday] = cadence.expression.trim().split(/\s+/u)
  if (month !== "*" || !minute || !hour || !day || !weekday) return null
  const list = /^\d+(,\d+)*$/u
  if (!/^\d+$/u.test(minute)) return null
  const step = /^\*\/(\d+)$/u.exec(hour)
  if (hour === "*" && day === "*" && weekday === "*") return `FREQ=HOURLY;BYMINUTE=${minute}`
  if (step && day === "*" && weekday === "*") {
    return `FREQ=HOURLY;INTERVAL=${step[1]};BYMINUTE=${minute}`
  }
  if (!list.test(hour)) return null
  const clock = `BYHOUR=${hour};BYMINUTE=${minute}`
  if (day === "*" && weekday === "*") return `FREQ=DAILY;${clock}`
  if (day === "*" && list.test(weekday)) {
    const names = weekday.split(",").map((entry) => WEEKDAYS[Number(entry) % 7])
    return names.every(Boolean) ? `FREQ=WEEKLY;BYDAY=${names.join(",")};${clock}` : null
  }
  if (weekday === "*" && list.test(day)) return `FREQ=MONTHLY;BYMONTHDAY=${day};${clock}`
  return null
}

export const AUTOMATION_UPDATE_SPEC: v2.DynamicToolSpec = {
  description:
    "Create, view, update, or delete a recurring automation. A heartbeat automation wakes a thread on a schedule and continues in that thread; a cron automation starts a new task for each run. Schedules are RRULE strings. Times are wall-clock times in the Server's time zone, so do not include DTSTART. Supported forms are FREQ=MINUTELY or HOURLY with INTERVAL (HOURLY also takes BYMINUTE), and DAILY, WEEKLY, or MONTHLY with BYHOUR, BYMINUTE, and BYDAY or BYMONTHDAY.",
  inputSchema: {
    additionalProperties: false,
    properties: {
      destination: {
        description:
          "Optional automation destination. Use thread for heartbeat automations attached to the current local thread.",
        enum: ["thread"],
        type: "string",
      },
      id: {
        description:
          "Automation id. Required for mode=view, mode=update, and mode=delete. Omit for mode=create.",
        minLength: 1,
        type: "string",
      },
      kind: {
        description:
          "Use heartbeat so recurring runs continue in this thread. Use cron only when the user explicitly wants a new task for each run. Required for mode=create.",
        enum: ["cron", "heartbeat"],
        type: "string",
      },
      mode: { enum: ["view", "create", "update", "delete"], type: "string" },
      name: {
        description:
          "Short human-readable automation name. If the user does not provide one, choose a concise name.",
        minLength: 1,
        type: "string",
      },
      projectId: {
        description:
          "Cron automations only. The target project id, or null for a task without a project. Use list_projects to find project ids.",
        minLength: 1,
        type: ["string", "null"],
      },
      prompt: {
        description:
          "The automation prompt. Describe only the task itself; do not include schedule, workspace, or thread details because those are provided separately. Keep it self-sufficient, include output expectations when useful, and do not ask it to write a file or announce nothing to do unless the user explicitly asked for that.",
        minLength: 1,
        type: "string",
      },
      rrule: {
        description:
          "RRULE schedule string. Interpret requested times in the user's locale and encode them directly with FREQ, BYDAY, BYHOUR, and BYMINUTE; do not include DTSTART or convert to UTC. Preserve the existing value for unrelated updates.",
        minLength: 1,
        type: "string",
      },
      status: {
        description:
          "One of ACTIVE or PAUSED. Default to ACTIVE unless the user asks to start paused.",
        enum: ["ACTIVE", "PAUSED"],
        type: "string",
      },
      targetThreadId: {
        description:
          "Target thread id for heartbeat automations. Prefer destination=thread for the current thread instead of inventing or copying raw thread ids.",
        minLength: 1,
        type: "string",
      },
    },
    required: ["mode"],
    type: "object",
  },
  name: "automation_update",
  type: "function",
}

export type AutomationSchedules = {
  create(input: {
    cadence: ScheduleCadence
    name?: string | null
    target: ScheduleTarget
  }): Promise<Schedule>
  delete(scheduleId: string): Promise<void>
  get(scheduleId: string): Promise<Schedule>
  pause(scheduleId: string): Promise<Schedule>
  resume(scheduleId: string): Promise<Schedule>
  update(input: {
    cadence?: ScheduleCadence
    name?: string | null
    scheduleId: string
    target?: ScheduleTarget
  }): Promise<Schedule>
}

export type AutomationOptions = {
  /** Agent of a new cron Thread when the caller does not name one. */
  readonly defaultAgentId: string
  /** Agent that runs the calling Thread. */
  readonly agentOf: (threadId: string) => Promise<string | undefined>
  /** Working directory of a Project; throws when it does not exist. */
  readonly projectRoot: (projectId: string) => Promise<string>
  readonly schedules: AutomationSchedules
}

const optionalString = (value: unknown, key: string): string | undefined => {
  if (value === undefined || value === null) return undefined
  if (typeof value !== "string" || value.trim() === "") {
    throw new AutomationInputError(`${key} must be a non-empty string.`)
  }
  return value.trim()
}

const present = (automation: Schedule): Record<string, unknown> => ({
  cadence: automation.cadence,
  id: automation.id,
  kind: automation.target.type === "thread" ? "heartbeat" : "cron",
  lastRunAt: automation.lastRunAt,
  name: automation.name,
  nextRunAt: automation.nextRunAt,
  prompt:
    automation.target.type === "web3"
      ? undefined
      : automation.target.content
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join("\n"),
  rrule: cadenceToRrule(automation.cadence),
  status:
    automation.status === "active"
      ? "ACTIVE"
      : automation.status === "paused"
        ? "PAUSED"
        : "COMPLETED",
  ...(automation.target.type === "thread" ? { targetThreadId: automation.target.threadId } : {}),
  ...(automation.target.type === "new-thread" ? { cwd: automation.target.cwd ?? null } : {}),
})

/** Executes `automation_update` for the calling Thread. */
export class AutomationTool {
  readonly #options: AutomationOptions

  constructor(options: AutomationOptions) {
    this.#options = options
  }

  async call(args: Record<string, unknown>, callerThreadId: string | undefined): Promise<unknown> {
    switch (args.mode) {
      case "view":
        return present(await this.#existing(args))
      case "delete": {
        const { id } = await this.#existing(args)
        await this.#options.schedules.delete(id)
        return { deleted: true, id }
      }
      case "create":
        return this.#create(args, callerThreadId)
      case "update":
        return this.#update(args, callerThreadId)
      default:
        throw new AutomationInputError("mode must be view, create, update, or delete.")
    }
  }

  async #existing(args: Record<string, unknown>): Promise<Schedule> {
    const id = optionalString(args.id, "id")
    if (!id) throw new AutomationInputError(`id is required for mode=${String(args.mode)}.`)
    const automation = await this.#options.schedules.get(id)
    if (automation.target.type === "web3") {
      throw new AutomationInputError("That schedule is not an automation.")
    }
    return automation
  }

  async #cwd(projectId: unknown): Promise<string | null> {
    if (projectId === undefined || projectId === null) return null
    return this.#options.projectRoot(optionalString(projectId, "projectId") as string)
  }

  async #create(
    args: Record<string, unknown>,
    callerThreadId: string | undefined
  ): Promise<unknown> {
    const name = optionalString(args.name, "name")
    const prompt = optionalString(args.prompt, "prompt")
    const rrule = optionalString(args.rrule, "rrule")
    if (!name || !prompt || !rrule) {
      throw new AutomationInputError("name, prompt, and rrule are required for mode=create.")
    }
    const cadence = rruleToCadence(rrule)
    const content = [{ text: prompt, type: "text" as const }]
    let target: ScheduleTarget
    if (args.kind === "heartbeat") {
      const threadId =
        optionalString(args.targetThreadId, "targetThreadId") ??
        (args.destination === "thread" ? callerThreadId : undefined)
      if (!threadId) {
        throw new AutomationInputError("Missing targetThreadId or destination=thread.")
      }
      target = { content, threadId, type: "thread" }
    } else if (args.kind === "cron") {
      const agentId =
        (callerThreadId ? await this.#options.agentOf(callerThreadId) : undefined) ??
        this.#options.defaultAgentId
      target = {
        agentId: agentId as never,
        content,
        cwd: await this.#cwd(args.projectId),
        title: name,
        type: "new-thread",
      }
    } else {
      throw new AutomationInputError("kind must be heartbeat or cron.")
    }
    const created = await this.#options.schedules.create({ cadence, name, target })
    const settled =
      args.status === "PAUSED" ? await this.#options.schedules.pause(created.id) : created
    return present(settled)
  }

  async #update(
    args: Record<string, unknown>,
    callerThreadId: string | undefined
  ): Promise<unknown> {
    const current = await this.#existing(args)
    const kind = current.target.type === "thread" ? "heartbeat" : "cron"
    if (args.kind !== undefined && args.kind !== kind) {
      throw new AutomationInputError("An automation cannot change kind.")
    }
    const name = optionalString(args.name, "name")
    const prompt = optionalString(args.prompt, "prompt")
    const rrule = optionalString(args.rrule, "rrule")
    let target: ScheduleTarget | undefined
    if (current.target.type === "thread") {
      const threadId =
        optionalString(args.targetThreadId, "targetThreadId") ??
        (args.destination === "thread" ? callerThreadId : undefined)
      if (prompt || threadId) {
        target = {
          content: prompt ? [{ text: prompt, type: "text" }] : current.target.content,
          threadId: threadId ?? current.target.threadId,
          type: "thread",
        }
      }
    } else if (current.target.type === "new-thread") {
      if (prompt || name || args.projectId !== undefined) {
        target = {
          ...current.target,
          content: prompt ? [{ text: prompt, type: "text" }] : current.target.content,
          cwd:
            args.projectId === undefined
              ? (current.target.cwd ?? null)
              : await this.#cwd(args.projectId),
          title: name ?? current.target.title ?? null,
        }
      }
    }
    const updated = await this.#options.schedules.update({
      ...(rrule ? { cadence: rruleToCadence(rrule) } : {}),
      ...(name ? { name } : {}),
      scheduleId: current.id,
      ...(target ? { target } : {}),
    })
    if (args.status === "PAUSED" && updated.status === "active") {
      return present(await this.#options.schedules.pause(updated.id))
    }
    if (args.status === "ACTIVE" && updated.status === "paused") {
      return present(await this.#options.schedules.resume(updated.id))
    }
    return present(updated)
  }
}
