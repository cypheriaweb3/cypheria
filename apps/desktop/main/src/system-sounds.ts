import { readdir } from "node:fs/promises"
import { join } from "node:path"

const soundFilePattern = /\.(aiff|aif|caf|wav)$/i

export const listSystemNotificationSounds = async (
  directory = "/System/Library/Sounds",
  platform = process.platform
): Promise<string[]> => {
  if (platform !== "darwin") return []
  const files = await readdir(directory)
  return [
    ...new Set(
      files
        .filter((file) => soundFilePattern.test(file))
        .map((file) => file.slice(0, file.lastIndexOf(".")))
    ),
  ].sort((left, right) => left.localeCompare(right))
}

export const findSystemNotificationSoundFile = async (
  name: string,
  directory = "/System/Library/Sounds",
  platform = process.platform
): Promise<string | null> => {
  if (platform !== "darwin") return null
  const files = await readdir(directory)
  const file = files.find(
    (candidate) =>
      soundFilePattern.test(candidate) && candidate.slice(0, candidate.lastIndexOf(".")) === name
  )
  return file ? join(directory, file) : null
}
