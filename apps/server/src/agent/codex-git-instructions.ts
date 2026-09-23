import type { GitSettings } from "@cypheria/protocol"

export const codexGitInstructions = (settings: GitSettings): string | undefined => {
  const sections: string[] = []
  if (settings.branchPrefix.trim()) {
    sections.push(
      `When you create a Git branch and the user has not specified a name, start its name with ${JSON.stringify(settings.branchPrefix)}.`
    )
  }
  if (settings.commitInstructions.trim()) {
    sections.push(`Git commit instructions:\n${settings.commitInstructions.trim()}`)
  }
  if (settings.prInstructions.trim()) {
    sections.push(`Pull request instructions:\n${settings.prInstructions.trim()}`)
  }
  return sections.length ? sections.join("\n\n") : undefined
}
