import { readdir, readFile, writeFile } from "node:fs/promises"
import { extname, join } from "node:path"
import { fileURLToPath } from "node:url"

const generatedDirectory = fileURLToPath(new URL("../src/generated/", import.meta.url))

const visit = async (directory) => {
  let replacements = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      replacements += await visit(path)
      continue
    }
    if (!entry.isFile() || extname(entry.name) !== ".ts") continue

    const before = await readFile(path, "utf8")
    const matches = before.match(/\bbigint\b/gu)
    if (!matches) continue
    await writeFile(path, before.replaceAll(/\bbigint\b/gu, "number"))
    replacements += matches.length
  }
  return replacements
}

const replacements = await visit(generatedDirectory)
console.log(`Normalized ${replacements} generated 64-bit integer type(s) to JSON number.`)
