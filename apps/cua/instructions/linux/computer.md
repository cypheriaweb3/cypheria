For native Linux apps, by the exact window ID of an open window from `await cua.listWindows()`:

```javascript
let app = await cua.getApp({ windowId: 123 });
```
