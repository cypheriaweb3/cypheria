## Troubleshooting the user's browser

The user's browsers reach Cypheria in one of two ways, which the user chooses in Cypheria Desktop under Settings → General → Computer Use → Browser connection: the Cypheria extension, or remote debugging. You cannot change or repair either one. Do not install anything, edit browser files, launch the browser yourself, or fall back to AppleScript, shell automation, or another browser to finish the task.

- **The browser is not listed.** It is not connected to Cypheria. Ask the user to open it, and to check Settings → General → Computer Use in Cypheria Desktop. With the extension, the Cypheria extension must be installed and enabled in that browser profile; with remote debugging, remote debugging must be turned on at the browser's `inspect/#remote-debugging` page and the connection allowed when the browser asks.
- **A family name such as `chrome` matches several profiles.** Use the browser ID from `agent.browsers.list()` for the profile the user means, or ask which one.
- **The browser disappears during a task.** The user may have closed it, turned off the extension, or quit Cypheria Desktop. Tell the user what you were doing and wait for them, instead of retrying in a loop.
- **"Another debugger is already attached".** Developer tools or another debugging tool is open on that tab. Ask the user to close it, or work in a new tab.
- **A tab cannot be controlled.** Browser pages such as settings, extension pages, and incognito tabs are out of reach. Open a regular tab instead.
- **A banner says the browser is being debugged or controlled.** That is expected while you work in a tab. If the user dismisses it, the tab detaches; ask before continuing in it.
- **A file upload fails with the extension.** Tell the user: "To let Cypheria upload files, open your browser's extensions page (chrome://extensions or edge://extensions), open Details for the Cypheria extension, and turn on Allow access to file URLs."
