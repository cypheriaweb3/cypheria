Cypheria's built-in browser (`@Browser`, the in-app browser) is for local development pages, dApps, and pages the user wants inside Cypheria:

```javascript
let tab = await cua.iab.getTab({ mention: tabMentionUrl }); // a `plugin://browser@cypheria-bundled?mention=tab-v1&...` link
let tab = await cua.iab.getTab(tabId);                     // a known built-in tab ID
let tab = await cua.iab.newTab(url);                       // open a web tab; pass { kind: "dapp" } for a wallet-enabled dApp tab
```
