type ChromiumCommandLine = {
  appendSwitch(name: string, value?: string): void
}

export const DISABLED_CHROMIUM_FEATURES = [
  "CompressionDictionaryTransport",
  "CompressionDictionaryTransportBackend",
] as const

export const configureChromiumFeatures = (commandLine: ChromiumCommandLine): void => {
  commandLine.appendSwitch("disable-features", DISABLED_CHROMIUM_FEATURES.join(","))
}
