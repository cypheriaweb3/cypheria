/** The longest computer audio recording, as ChatGPT's Computer Use allows. */
export const MAX_AUDIO_RECORDING_MS = 300_000

/**
 * How much of a recording one `apps.audio.read` returns. Device results cross the Server's
 * message limit, so a recording comes back in pieces; a multiple of 3 keeps the base64 of the
 * pieces concatenable.
 */
export const AUDIO_CHUNK_BYTES = 384 * 1024
