import {
  CYPHERIA_WEBSOCKET_PATH,
  createConnectionOfferUrl,
  HttpLifecycleRequestSchema,
  HttpRuntimeRequestSchema,
  type RelayPairingOfferResponse,
} from "@cypheria/protocol"
import type { CypheriaRuntimeMethod } from "@cypheria/runtime"
import { upgradeWebSocket } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { zValidator } from "@hono/zod-validator"
import { type Context, Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { cors } from "hono/cors"
import type { Logger } from "pino"

import {
  hasCypheriaProtocol,
  isAuthorized,
  isOriginAllowed,
  readBearerToken,
  readWebSocketToken,
} from "./auth.js"
import type { CypheriaServerConfig } from "./config.js"
import { ClientSession, type SessionHost } from "./session/client-session.js"
import type { ConnectionRegistry } from "./session/connection-registry.js"

export type HttpAppHost = SessionHost & {
  getRelayPairingOffer(): RelayPairingOfferResponse | undefined
  isReady(): boolean
}

export type CreateHttpAppOptions = {
  config: CypheriaServerConfig
  host: HttpAppHost
  logger: Logger
  registry: ConnectionRegistry
}

const jsonError = (message: string, code = "REQUEST_FAILED") => ({
  error: { code, message },
})

export function createHttpApp(options: CreateHttpAppOptions): Hono {
  const { config, host, logger, registry } = options
  const app = new Hono()

  app.onError((error, context) => {
    logger.error({ err: error, path: context.req.path }, "HTTP request failed")
    return context.json(jsonError("Internal server error", "INTERNAL_ERROR"), 500)
  })

  app.use(
    "/api/*",
    cors({
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      origin: (origin) => (config.allowedOrigins.includes(origin) ? origin : undefined),
    })
  )

  app.get("/api/v1/health", (context) =>
    context.json({ checkedAt: new Date().toISOString(), status: "ok" })
  )
  app.get("/api/v1/ready", (context) =>
    host.isReady() ? context.json({ status: "ready" }) : context.json({ status: "not-ready" }, 503)
  )

  app.use("/api/v1/*", async (context, next) => {
    if (
      context.req.path === "/api/v1/health" ||
      context.req.path === "/api/v1/ready" ||
      context.req.path === CYPHERIA_WEBSOCKET_PATH
    ) {
      return next()
    }

    const token = readBearerToken(context.req.header("authorization"))
    if (!isAuthorized(token, config.authToken)) {
      return context.json(jsonError("Bearer token is required", "AUTHENTICATION_REQUIRED"), 401)
    }
    return next()
  })

  app.get("/api/v1/status", (context) => context.json(host.getInfo()))
  app.get("/api/v1/diagnostics", (context) => context.json(host.getDiagnostics()))
  app.get("/api/v1/relay/pairing-offer", (context) => {
    const pairing = host.getRelayPairingOffer()
    if (!pairing) {
      return context.json(jsonError("Relay is not enabled", "RELAY_DISABLED"), 409)
    }
    return context.json({ ...pairing, url: createConnectionOfferUrl(pairing.offer) })
  })

  app.post(
    "/api/v1/runtime/request",
    bodyLimit({
      maxSize: config.maxMessageBytes,
      onError: (context) => context.json(jsonError("Request body is too large"), 413),
    }),
    zValidator("json", HttpRuntimeRequestSchema, (result, context) => {
      if (!result.success) return context.json(jsonError("Invalid runtime request"), 400)
      return undefined
    }),
    async (context) => {
      const request = context.req.valid("json")
      try {
        const result = await host.requestRuntime(
          request.method as CypheriaRuntimeMethod,
          request.params
        )
        return context.json({ result: result ?? null })
      } catch (error) {
        const message = error instanceof Error ? error.message : "Runtime request failed"
        return context.json(jsonError(message), 422)
      }
    }
  )

  for (const action of ["restart", "shutdown"] as const) {
    app.post(`/api/v1/lifecycle/${action}`, bodyLimit({ maxSize: 16 * 1024 }), async (context) => {
      let input: unknown = {}
      try {
        const body = await context.req.text()
        if (body) input = JSON.parse(body)
      } catch {
        return context.json(jsonError("Invalid lifecycle request"), 400)
      }
      const parsed = HttpLifecycleRequestSchema.safeParse(input)
      if (!parsed.success) return context.json(jsonError("Invalid lifecycle request"), 400)
      const request = parsed.data
      queueMicrotask(() => host.requestLifecycle(action, request.reason))
      return context.json({ accepted: true, action }, 202)
    })
  }

  app.use(CYPHERIA_WEBSOCKET_PATH, async (context, next) => {
    const protocols = context.req.header("sec-websocket-protocol")
    const token = readWebSocketToken(protocols)
    const origin = context.req.header("origin")
    const allowedOrigins =
      config.allowedOrigins.length > 0 ? config.allowedOrigins : [new URL(context.req.url).origin]

    if (!hasCypheriaProtocol(protocols)) {
      registry.reject()
      return context.json(jsonError("Cypheria WebSocket protocol is required"), 426)
    }
    if (!isOriginAllowed(origin, allowedOrigins)) {
      registry.reject()
      return context.json(jsonError("Origin is not allowed", "ORIGIN_NOT_ALLOWED"), 403)
    }
    if (!isAuthorized(token, config.authToken)) {
      registry.reject()
      return context.json(jsonError("WebSocket token is required", "AUTHENTICATION_REQUIRED"), 401)
    }
    return next()
  })

  app.get(
    CYPHERIA_WEBSOCKET_PATH,
    upgradeWebSocket(
      () => {
        let session: ClientSession | undefined
        return {
          onClose: () => session?.transportClosed(),
          onMessage: (event) => {
            if (!session) return
            if (typeof event.data !== "string") {
              session.close(1003, "Only JSON text messages are supported")
              return
            }
            if (Buffer.byteLength(event.data) > config.maxMessageBytes) {
              session.close(1009, "Message is too large")
              return
            }
            void session.receive(event.data)
          },
          onOpen: (_event, socket) => {
            session = new ClientSession({
              helloTimeoutMs: config.sessionHelloTimeoutMs,
              host,
              onClose: (closedSession) => registry.remove(closedSession.id),
              transport: {
                close: (code, reason) => socket.close(code, reason),
                send: (data) => socket.send(data),
              },
            })
            registry.add(session)
          },
        }
      },
      {
        onError: (error) => logger.warn({ err: error }, "WebSocket upgrade failed"),
      }
    )
  )

  app.all("/api/*", (context) => context.json(jsonError("API route not found", "NOT_FOUND"), 404))

  if (config.webAppEnabled) {
    const cacheHeaders = (path: string, context: Context) => {
      const fingerprintedAsset = path.replaceAll("\\", "/").includes("/_expo/static/")
      context.header(
        "Cache-Control",
        fingerprintedAsset ? "public, max-age=31536000, immutable" : "no-cache"
      )
    }
    app.use("*", serveStatic({ onFound: cacheHeaders, root: config.webAppDir }))
    app.get("*", serveStatic({ onFound: cacheHeaders, path: "index.html", root: config.webAppDir }))
  }

  app.notFound((context) => context.json(jsonError("Route not found", "NOT_FOUND"), 404))
  return app
}
