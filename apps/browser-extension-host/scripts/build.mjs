import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Builds the native messaging host into dist/<platform>-<arch>/, the layout Desktop copies and
// installs from. `--all` cross-compiles every platform Desktop ships for.
const TARGETS = [
  ["darwin", "arm64"],
  ["darwin", "amd64"],
  ["linux", "arm64"],
  ["linux", "amd64"],
  ["windows", "arm64"],
  ["windows", "amd64"],
]
const NODE_PLATFORM = { darwin: "darwin", linux: "linux", windows: "win32" }
const NODE_ARCH = { amd64: "x64", arm64: "arm64" }
const GO_OS = { darwin: "darwin", linux: "linux", win32: "windows" }
const GO_ARCH = { arm64: "arm64", x64: "amd64" }

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
const targets = process.argv.includes("--all")
  ? TARGETS
  : [[GO_OS[process.platform], GO_ARCH[process.arch]]]

for (const [goos, goarch] of targets) {
  const name = goos === "windows" ? "cypheria-browser-host.exe" : "cypheria-browser-host"
  const output = join("dist", `${NODE_PLATFORM[goos]}-${NODE_ARCH[goarch]}`, name)
  execFileSync(
    "go",
    [
      "build",
      "-trimpath",
      "-ldflags",
      `-s -w -X main.version=${version}`,
      "-o",
      output,
      "./cmd/cypheria-browser-host",
    ],
    { env: { ...process.env, CGO_ENABLED: "0", GOARCH: goarch, GOOS: goos }, stdio: "inherit" }
  )
  console.log(`Built ${output}`)
}
