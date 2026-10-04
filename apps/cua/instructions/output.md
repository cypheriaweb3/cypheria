To add other content to the tool result, use `nodeRepl.write(value)` for text or other values and `await nodeRepl.emitImage(image)` for images. Entry points, snapshots, and screenshots already display their documentation or state; do not wrap their results in `write` or `emitImage`.

If your context begins with a summary of an earlier computer use task, call `await cua.rewriteDocumentation()` before continuing it so you have the complete documentation again.
