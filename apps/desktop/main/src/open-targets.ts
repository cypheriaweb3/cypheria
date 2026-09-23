import { execFile } from "node:child_process"
import { promisify } from "node:util"

import type { OpenTarget } from "../../ipc/src/index.js"

const execFileAsync = promisify(execFile)

const macApplications = [
  ["vscode", "Visual Studio Code"],
  ["vscode-insiders", "Visual Studio Code - Insiders"],
  ["cursor", "Cursor"],
  ["windsurf", "Windsurf"],
  ["zed", "Zed"],
  ["sublime", "Sublime Text"],
  ["xcode", "Xcode"],
  ["textmate", "TextMate"],
  ["bbedit", "BBEdit"],
  ["webstorm", "WebStorm"],
  ["intellij", "IntelliJ IDEA"],
  ["android-studio", "Android Studio"],
  ["nova", "Nova"],
] as const

export const listOpenTargets = async (): Promise<OpenTarget[]> => {
  const targets: OpenTarget[] = [
    { id: "system", label: "Default app" },
    {
      id: "reveal",
      label: process.platform === "darwin" ? "Reveal in Finder" : "Reveal in file manager",
    },
  ]
  if (process.platform !== "darwin") return targets

  const availability = await Promise.all(
    macApplications.map(async ([id, label]) => {
      try {
        await execFileAsync("open", ["-Ra", label])
        return { id, label }
      } catch {
        return null
      }
    })
  )
  return [
    ...targets,
    ...availability.filter((target): target is NonNullable<typeof target> => target !== null),
  ]
}

export const getOpenTargetApplication = (id: string): string | null =>
  macApplications.find(([candidate]) => candidate === id)?.[1] ?? null
