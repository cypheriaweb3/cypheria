## Screenshots

- Tab screenshots (`getScreenshot()` on a tab and `tab.screenshot()`) are PNG; app screenshots may be JPEG. `tab.screenshot({ fullPage: true })` captures the whole page; `clip` captures a region.
- Screenshots you take for yourself do not reach the user. When the user asks for a screenshot, or a screenshot shows the result of testing their site, show it with `await nodeRepl.emitImage(image)` and describe what it shows in your answer.
- When testing a site the user is developing, show screenshots of the key states you verified.
- Never show screenshots of pages with passwords, payment details, or other secrets the user did not ask you to capture.
