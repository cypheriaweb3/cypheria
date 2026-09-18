import { randomUUID } from "node:crypto"
import { chmod, mkdir, open, rename, unlink } from "node:fs/promises"
import { dirname, join } from "node:path"

const syncDirectory = async (directory: string): Promise<void> => {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(directory, "r")
    await handle.sync()
  } catch (error) {
    if (process.platform !== "win32") {
      throw error
    }
  } finally {
    await handle?.close()
  }
}

export const writeFileAtomically = async (
  targetPath: string,
  data: string | Uint8Array
): Promise<void> => {
  const directory = dirname(targetPath)
  const temporaryPath = join(directory, `.${randomUUID()}.tmp`)
  await mkdir(directory, { recursive: true, mode: 0o700 })

  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporaryPath, "wx", 0o600)
    await handle.writeFile(data)
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporaryPath, targetPath)
    await chmod(targetPath, 0o600)
    await syncDirectory(directory)
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

export const deleteFileAtomically = async (targetPath: string): Promise<void> => {
  const directory = dirname(targetPath)
  const tombstonePath = join(directory, `.${randomUUID()}.deleting`)
  await rename(targetPath, tombstonePath)
  await syncDirectory(directory)
  await unlink(tombstonePath)
  await syncDirectory(directory)
}
