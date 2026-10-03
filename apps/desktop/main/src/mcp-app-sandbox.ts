/**
 * The MCP App sandbox. Each App runs on its own `cypheria-sandbox://<id>/` origin, which serves
 * only this proxy page. The renderer embeds the proxy in a sandboxed iframe and sends it the App
 * document with `ui/notifications/sandbox-resource-ready`; the proxy loads it into an inner frame
 * and relays every other message, following the MCP Apps sandbox proxy flow. Like ChatGPT Desktop's
 * sandbox origin, the App never shares an origin with the renderer or another App, and it receives
 * no preload, Node.js, or Cypheria IPC.
 */

export const MCP_APP_SANDBOX_SCHEME = "cypheria-sandbox"

/** A sandbox origin's host: lowercase letters and digits, so it is a valid DNS label. */
const SANDBOX_HOST = /^[a-z0-9]{1,63}$/u

/** Flags the inner App frame gets when the host does not choose them. */
const DEFAULT_APP_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"

const proxyScript = `(() => {
  const host = window.parent;
  let app = null;
  const features = { camera: "camera", clipboardWrite: "clipboard-write", geolocation: "geolocation", microphone: "microphone" };
  const load = (params) => {
    if (app || !params || typeof params.html !== "string") return;
    app = document.createElement("iframe");
    app.setAttribute("sandbox", typeof params.sandbox === "string" ? params.sandbox : ${JSON.stringify(DEFAULT_APP_SANDBOX)});
    const allowed = Object.keys(params.permissions || {}).flatMap((name) => features[name] ? [features[name]] : []);
    if (allowed.length > 0) app.setAttribute("allow", allowed.join("; "));
    app.srcdoc = params.html;
    document.body.appendChild(app);
  };
  window.addEventListener("message", (event) => {
    if (event.source === host) {
      const message = event.data;
      if (message && message.method === "ui/notifications/sandbox-resource-ready") {
        load(message.params);
        return;
      }
      if (app && app.contentWindow) app.contentWindow.postMessage(message, "*");
    } else if (app && event.source === app.contentWindow) {
      host.postMessage(event.data, "*");
    }
  });
  host.postMessage({ jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready", params: {} }, "*");
})();`

/**
 * The proxy page. It sets no Content-Security-Policy because the App frame inherits it: the host
 * puts the App's own policy, from its resource metadata, into the App document instead.
 */
export const MCP_APP_SANDBOX_PROXY_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>html,body,iframe{margin:0;padding:0;border:0;width:100%;height:100%;overflow:hidden;background:transparent;display:block}</style>
  </head>
  <body><script>${proxyScript}</script></body>
</html>`

/** Answers sandbox origin requests: the proxy page at `/`, and nothing else. */
export const handleMcpAppSandboxRequest = (requestUrl: string): Response => {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return new Response(null, { status: 400 })
  }
  if (!SANDBOX_HOST.test(url.hostname) || url.pathname !== "/") {
    return new Response(null, { status: 404 })
  }
  return new Response(MCP_APP_SANDBOX_PROXY_HTML, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

/**
 * Whether a frame inside an App may go to `url`: Apps stay on their sandbox origin and inline
 * documents. Links leave through `ui/open-link`, which the host opens.
 */
export const isAllowedSandboxNavigation = (url: string): boolean =>
  url.startsWith(`${MCP_APP_SANDBOX_SCHEME}://`) || url === "about:blank" || url === "about:srcdoc"
