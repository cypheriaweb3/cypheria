const CODEX_AUDIO_ACCEPT = [
  "audio/m4a",
  "audio/mp3",
  "audio/mpeg",
  "audio/ogg",
  "audio/mp4",
  "audio/wave",
  "audio/wav",
  "audio/webm",
].join(",")

const NO_MEDIA_ACCEPT = "application/x-cypheria-no-media-input"

export type ComposerMediaCapabilities = {
  accept: string
  audio: boolean
  canAttach: boolean
  image: boolean
}

export const composerMediaCapabilities = (
  inputModalities: readonly string[]
): ComposerMediaCapabilities => {
  const image = inputModalities.includes("image")
  const audio = inputModalities.includes("audio")
  return {
    accept:
      [image ? "image/*" : null, audio ? CODEX_AUDIO_ACCEPT : null]
        .filter((value): value is string => Boolean(value))
        .join(",") || NO_MEDIA_ACCEPT,
    audio,
    canAttach: image || audio,
    image,
  }
}
