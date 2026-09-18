import { join } from "node:path"

export const getCodexConfigPath = (codexHome: string): string => join(codexHome, "config.toml")
