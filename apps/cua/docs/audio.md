## Computer audio

```js
await cua.computer.start_audio_recording({ max_duration_ms: 5000 });
// Perform desktop actions while recording.
var audio = await cua.computer.stop_audio_recording();
await nodeRepl.emitAudio(audio.data_url);
```

- Recording captures the sound the computer plays, not the microphone. The user approves it before it starts.
- `max_duration_ms` defaults to 60000 and supports up to 300000. Keep recordings as short as the task allows; long ones are large.
- Only ChatGPT's Computer Use on macOS records audio. Elsewhere both calls throw.
