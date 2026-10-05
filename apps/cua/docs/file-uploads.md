## File uploads

Upload through the page's file chooser. Start waiting for it before you click the control that opens it:

```javascript
const chooser = tab.playwright.waitForEvent("filechooser", { timeoutMs: 10000 });
await tab.playwright.locator('input[type="file"]').click();
const picked = await chooser;
await picked.setFiles(["data/report.pdf"]);
```

- Click the file input itself when the page has one; click a button or label only when it opens the chooser.
- Files must be inside the task's working directory. Relative paths resolve from it; anything outside it, including through symbolic links, is refused.
- Check `picked.isMultiple()` before passing several files.
- There is no `locator.setInputFiles()`; use the chooser.
- Never fall back to the operating system's file dialog. When an upload fails in the user's browser, read `chrome-troubleshooting`.
