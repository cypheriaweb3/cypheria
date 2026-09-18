import type { ScheduleCadence } from "@cypheria/protocol"

type Field = { any: boolean; values: ReadonlySet<number> }

const ranges = {
  day: [1, 31],
  hour: [0, 23],
  minute: [0, 59],
  month: [1, 12],
  weekday: [0, 7],
} as const

const parseNumber = (value: string, min: number, max: number): number => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Cron value ${value} must be between ${min} and ${max}`)
  }
  return parsed
}

const parseField = (source: string, [min, max]: readonly [number, number]): Field => {
  const values = new Set<number>()
  for (const segment of source.split(",")) {
    const [base = "", stepSource] = segment.split("/")
    const step = stepSource === undefined ? 1 : parseNumber(stepSource, 1, max - min + 1)
    const [start, end] =
      base === "*"
        ? [min, max]
        : base.includes("-")
          ? (() => {
              const [from = "", to = ""] = base.split("-")
              return [parseNumber(from, min, max), parseNumber(to, min, max)]
            })()
          : [parseNumber(base, min, max), parseNumber(base, min, max)]
    if (start > end) throw new Error(`Invalid descending cron range: ${base}`)
    for (let value = start; value <= end; value += step) values.add(value === 7 ? 0 : value)
  }
  return { any: source === "*", values }
}

type CronParts = {
  day: Field
  hour: Field
  minute: Field
  month: Field
  weekday: Field
}

const parseCron = (expression: string): CronParts => {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error("Cron expression must contain five fields")
  return {
    day: parseField(parts[2] as string, ranges.day),
    hour: parseField(parts[1] as string, ranges.hour),
    minute: parseField(parts[0] as string, ranges.minute),
    month: parseField(parts[3] as string, ranges.month),
    weekday: parseField(parts[4] as string, ranges.weekday),
  }
}

const dateParts = (timestamp: number, timezone?: string) => {
  if (!timezone) {
    const date = new Date(timestamp)
    return {
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      month: date.getMonth() + 1,
      weekday: date.getDay(),
    }
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
    minute: "numeric",
    month: "numeric",
    timeZone: timezone,
    weekday: "short",
  })
  const parts = Object.fromEntries(
    formatter.formatToParts(timestamp).map((part) => [part.type, part.value])
  )
  const weekdays: Record<string, number> = {
    Fri: 5,
    Mon: 1,
    Sat: 6,
    Sun: 0,
    Thu: 4,
    Tue: 2,
    Wed: 3,
  }
  return {
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    month: Number(parts.month),
    weekday: weekdays[parts.weekday ?? ""] ?? -1,
  }
}

export const nextCronRun = (expression: string, after: number, timezone?: string): number => {
  if (timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0)
    } catch {
      throw new Error(`Invalid cron timezone: ${timezone}`)
    }
  }
  const cron = parseCron(expression)
  let candidate = Math.floor(after / 60_000) * 60_000 + 60_000
  const limit = candidate + 366 * 24 * 60 * 60_000
  for (; candidate <= limit; candidate += 60_000) {
    const value = dateParts(candidate, timezone)
    const dayMatches = cron.day.values.has(value.day)
    const weekdayMatches = cron.weekday.values.has(value.weekday)
    const calendarDayMatches =
      cron.day.any && cron.weekday.any
        ? true
        : cron.day.any
          ? weekdayMatches
          : cron.weekday.any
            ? dayMatches
            : dayMatches || weekdayMatches
    if (
      cron.minute.values.has(value.minute) &&
      cron.hour.values.has(value.hour) &&
      cron.month.values.has(value.month) &&
      calendarDayMatches
    ) {
      return candidate
    }
  }
  throw new Error("Cron expression has no occurrence in the next 366 days")
}

export const initialRunAt = (cadence: ScheduleCadence, now: number): number => {
  if (cadence.type === "once") return new Date(cadence.at).getTime()
  if (cadence.type === "interval") return now + cadence.everyMs
  return nextCronRun(cadence.expression, now, cadence.timezone)
}

export const nextRunAfter = (
  cadence: ScheduleCadence,
  scheduledFor: number,
  now: number
): number | null => {
  if (cadence.type === "once") return null
  if (cadence.type === "interval") {
    let next = scheduledFor + cadence.everyMs
    while (next <= now) next += cadence.everyMs
    return next
  }
  let next = nextCronRun(cadence.expression, scheduledFor, cadence.timezone)
  while (next <= now) next = nextCronRun(cadence.expression, next, cadence.timezone)
  return next
}
