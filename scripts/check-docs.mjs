import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, extname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const failures = []

const listRepositoryFiles = () =>
  execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)
    .filter((path) => existsSync(resolve(repositoryRoot, path)))

const repositoryFiles = listRepositoryFiles()
const documentationFiles = repositoryFiles.filter((path) => [".md", ".mdx"].includes(extname(path)))

const report = (path, message) => failures.push(`${path}: ${message}`)
const read = (path) => readFileSync(resolve(repositoryRoot, path), "utf8")

const stripFencedCode = (source) => source.replace(/^(```|~~~)[\s\S]*?^\1.*$/gm, "")

const slugBase = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-")

const headings = (source) => {
  const counts = new Map()
  const values = new Set()
  for (const match of stripFencedCode(source).matchAll(/^(#{1,6})\s+(.+?)\s*#*$/gm)) {
    const base = slugBase(match[2])
    const count = counts.get(base) ?? 0
    counts.set(base, count + 1)
    values.add(count === 0 ? base : `${base}-${count}`)
  }
  return values
}

const headingLevels = (source) =>
  [...stripFencedCode(source).matchAll(/^(#{1,6})\s+.+$/gm)].map((match) => match[1].length)

const splitLinkTarget = (raw) => {
  let target = raw.trim()
  if (target.startsWith("<") && target.includes(">")) target = target.slice(1, target.indexOf(">"))
  else target = target.split(/\s+["']/u)[0]
  const hashIndex = target.indexOf("#")
  return hashIndex < 0
    ? { fragment: "", pathname: target }
    : { fragment: target.slice(hashIndex + 1), pathname: target.slice(0, hashIndex) }
}

for (const path of documentationFiles) {
  const source = read(path)
  const withoutCode = stripFencedCode(source)

  if (/^> (?:Status: Current implementation|状态：当前实现)/mu.test(source)) {
    report(path, "current implementation status markers are redundant")
  }

  for (const forbidden of ["arch" + "mage", "pa" + "seo"]) {
    if (source.toLowerCase().includes(forbidden))
      report(path, `contains forbidden historical name: ${forbidden}`)
  }

  for (const match of withoutCode.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const rawTarget = match[1]
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(rawTarget)) continue
    const { pathname, fragment } = splitLinkTarget(rawTarget)
    let targetPath = path
    if (pathname) {
      try {
        targetPath = decodeURIComponent(pathname)
      } catch {
        report(path, `link has invalid percent encoding: ${rawTarget}`)
        continue
      }
      targetPath = resolve(repositoryRoot, dirname(path), targetPath)
      if (!existsSync(targetPath)) {
        report(path, `broken relative link: ${rawTarget}`)
        continue
      }
    } else {
      targetPath = resolve(repositoryRoot, path)
    }

    if (
      fragment &&
      statSync(targetPath).isFile() &&
      [".md", ".mdx"].includes(extname(targetPath))
    ) {
      const decodedFragment = decodeURIComponent(fragment).toLowerCase()
      if (!headings(readFileSync(targetPath, "utf8")).has(decodedFragment)) {
        report(path, `broken local anchor: ${rawTarget}`)
      }
    }
  }
}

const companionCandidates = documentationFiles.filter(
  (path) =>
    !path.endsWith(".zh-CN.md") &&
    !path.endsWith(".zh-CN.mdx") &&
    (path === "README.md" ||
      /^docs\/[^/]+\.mdx?$/u.test(path) ||
      /^(?:apps|packages)\/[^/]+\/README\.md$/u.test(path))
)

for (const englishPath of companionCandidates) {
  const extension = extname(englishPath)
  const chinesePath = `${englishPath.slice(0, -extension.length)}.zh-CN${extension}`
  if (!documentationFiles.includes(chinesePath)) {
    report(englishPath, `missing Chinese companion: ${chinesePath}`)
    continue
  }
  const englishLevels = headingLevels(read(englishPath))
  const chineseLevels = headingLevels(read(chinesePath))
  if (JSON.stringify(englishLevels) !== JSON.stringify(chineseLevels)) {
    report(englishPath, `heading topology differs from ${chinesePath}`)
  }
}

for (const path of ["docs/todo.md", "docs/todo.zh-CN.md"]) {
  if (/^\s*- \[[xX]\]/mu.test(read(path))) report(path, "contains completed checklist history")
}

const generatedCheck = spawnSync(
  process.execPath,
  ["packages/protocol/scripts/generate-codex-app-server-api-docs.mjs", "--check"],
  { cwd: repositoryRoot, encoding: "utf8" }
)
if (generatedCheck.status !== 0) {
  failures.push(
    `generated Codex API reference drift:\n${generatedCheck.stderr || generatedCheck.stdout}`.trim()
  )
}

if (failures.length > 0) {
  console.error(
    `Documentation check failed (${failures.length}):\n${failures.map((item) => `- ${item}`).join("\n")}`
  )
  process.exitCode = 1
} else {
  console.log(`Documentation check passed for ${documentationFiles.length} Markdown/MDX files.`)
}
