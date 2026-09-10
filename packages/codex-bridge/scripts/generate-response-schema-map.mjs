import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

const packageRoot = resolve(import.meta.dirname, "..")
const responseMapPath = resolve(packageRoot, "src/response-map.ts")
const outputPath = resolve(packageRoot, "src/generated-schema/client-response-map.json")
const serverOutputPath = resolve(packageRoot, "src/generated-schema/server-response-map.json")
const source = await readFile(responseMapPath, "utf8")
const [clientSection, serverSection] = source.split(
  "/** Compile-time mapping from every server-initiated request"
)
const entries = (section) =>
  [...section.matchAll(/readonly (?:"([^"]+)"|(\w+)):\s+(?:v2\.)?(\w+)/g)]
    .map((match) => [match[1] ?? match[2], match[3]])
    .sort(([left], [right]) => left.localeCompare(right))
const clientEntries = entries(clientSection)
const serverEntries = entries(serverSection)

await mkdir(dirname(outputPath), { recursive: true })
await Promise.all([
  writeFile(outputPath, `${JSON.stringify(Object.fromEntries(clientEntries), null, 2)}\n`),
  writeFile(serverOutputPath, `${JSON.stringify(Object.fromEntries(serverEntries), null, 2)}\n`),
])
console.log(
  `Generated response schema mappings for ${clientEntries.length} client and ${serverEntries.length} server request methods.`
)
