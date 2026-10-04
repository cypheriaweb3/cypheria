External browsers (`@Chrome`, `@Edge`, `@Brave`, and other Chromium browsers) are the user's own browsers with their signed-in sessions. Use them only when the task needs that existing state:

```javascript
let tab = await cua.browsers.getTab({ mention: tabMentionUrl }); // a `plugin://chrome@cypheria-bundled?mention=tab-v1&...` link
let browser = await cua.browsers.get("chrome");                  // then browser.tabs() to find a user tab and browser.claimTab(id)
let tab = await (await cua.browsers.get("chrome")).newTab(url);
```
