import { existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { basename, extname, join } from "node:path"

/** A free path in `dir` for `filename`, adding a counter before the extension when taken. */
export const freePath = (dir: string, filename: string): string => {
  const name = basename(filename) || "download"
  const extension = extname(name)
  const stem = name.slice(0, name.length - extension.length)
  let candidate = join(dir, name)
  for (let counter = 1; existsSync(candidate); counter++) {
    candidate = join(dir, `${stem} (${counter})${extension}`)
  }
  return candidate
}

/** Saves a file into `dir` under a free name and returns its path. */
export const saveFile = async (
  dir: string,
  filename: string,
  data: Uint8Array
): Promise<string> => {
  const path = freePath(dir, filename)
  await writeFile(path, data, { flag: "wx" })
  return path
}
