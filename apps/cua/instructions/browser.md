Use the first matching browser option from the user's request:

For a tab @-mention (`mention=tab-v1`), pass the complete `plugin://...` URL to get the referenced tab:

```javascript
let tab = await cua.getTab({ mention: tabMentionUrl });
```

For an existing tab identified by URL in a known browser:

```javascript
let tab = await cua.getTab({ url }, { browser: browserId });
```

For a known tab ID (`id` or `providerTabId`) and browser:

```javascript
let tab = await cua.getTab(tabId, { browser: browserId });
```

To open a URL in a named browser, pass its ID or name directly; do not call `getBrowser` first:

```javascript
let tab = await cua.createBrowserTab(browserId, url, browserOptions);
```

For a known URL, only when the user has not named a browser:

```javascript
let browser = await cua.getBrowser({ url });
```

Browser IDs and options:
