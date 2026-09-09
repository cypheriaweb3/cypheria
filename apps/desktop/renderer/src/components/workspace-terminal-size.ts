const minimumColumns = 2
const maximumColumns = 500
const minimumRows = 1
const maximumRows = 300

const normalizeDimension = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? Math.trunc(value) : minimum))

export const normalizeWorkspaceTerminalSize = (cols: number, rows: number) => ({
  cols: normalizeDimension(cols, minimumColumns, maximumColumns),
  rows: normalizeDimension(rows, minimumRows, maximumRows),
})
