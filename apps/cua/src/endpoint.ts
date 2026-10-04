import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** macOS limits a Unix socket path to 104 bytes including the terminator; Linux to 108. */
const MAX_SOCKET_PATH = 100

/**
 * The private endpoint of the cua-driver daemon that Desktop hosts. Desktop starts the daemon
 * there and the Server connects to it, so both derive it from the same Cypheria home.
 */
export const cuaDriverEndpoint = (
  cypheriaHome: string,
  platform: NodeJS.Platform = process.platform
): string => {
  const digest = createHash("sha256").update(cypheriaHome).digest("hex").slice(0, 12)
  if (platform === "win32") return `\\\\.\\pipe\\cypheria-cua-driver-${digest}`
  const preferred = join(cypheriaHome, "run", "cua-driver.sock")
  if (Buffer.byteLength(preferred) <= MAX_SOCKET_PATH) return preferred
  return join(tmpdir(), `cypheria-cua-${digest}.sock`)
}
