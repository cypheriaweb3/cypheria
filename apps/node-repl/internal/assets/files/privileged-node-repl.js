// Trusted-only Node REPL host bridge and privileged capabilities.

const { Buffer } = require("node:buffer");
const {
  createPrivilegedNodeReplConfig,
} = require("./privileged-node-repl-config.js");
const {
  isPlainObject,
  makeRejectedThenable,
  toByteArray,
  trackExecBackgroundOperation,
} = require("./worker-runtime.js");

function createLifecycleHandlers(name, concurrent = false) {
  const hooks = new Set();
  return {
    add(options) {
      if (
        !isPlainObject(options) ||
        typeof options.run !== "function" ||
        !Number.isSafeInteger(options.timeoutMs) ||
        options.timeoutMs <= 0
      ) {
        throw new Error(
          `nodeRepl.${name} expected { run: function, timeoutMs: positive integer }`,
        );
      }
      const hook = { run: options.run, timeoutMs: options.timeoutMs };
      hooks.add(hook);
      return () => hooks.delete(hook);
    },
    async run(event) {
      const runHandler = async ({ run, timeoutMs }) => {
        let timer;
        try {
          await Promise.race([
            Promise.resolve().then(() => run(event)),
            new Promise((resolve) => {
              timer = setTimeout(resolve, timeoutMs);
            }),
          ]);
        } catch {
          // Hooks are best-effort side effects.
        } finally {
          clearTimeout(timer);
        }
      };
      if (concurrent) {
        await Promise.all([...hooks].map(runHandler));
      } else {
        for (const hook of [...hooks]) await runHandler(hook);
      }
    },
  };
}

function createPrivilegedHostOperations({
  execContext,
  pendingRequests,
  send,
}) {
  let elicitationCounter = 0;
  let authenticatedFetchCounter = 0;

  function createElicitation(request) {
    let execState;
    try {
      execState = execContext.getCurrent();
      if (!execState.formElicitationSupported) {
        throw new Error(
          "nodeRepl.createElicitation is unavailable because the MCP client does not support form elicitation",
        );
      }
    } catch (error) {
      return makeRejectedThenable(error);
    }
    const operation = (async () => {
      const value = await request;
      if (!isPlainObject(value)) {
        throw new Error("nodeRepl.createElicitation expected a request object");
      }
      if (
        Object.keys(value).some(
          (key) =>
            key !== "message" && key !== "meta" && key !== "requestedSchema",
        )
      ) {
        throw new Error(
          "nodeRepl.createElicitation received an unsupported value",
        );
      }
      if (
        typeof value.message !== "string" ||
        value.message.trim().length === 0
      ) {
        throw new Error(
          "nodeRepl.createElicitation expected a non-empty message",
        );
      }
      if (value.meta != null && !isPlainObject(value.meta)) {
        throw new Error("nodeRepl.createElicitation meta must be an object");
      }
      const id = `${execState.id}-elicitation-${elicitationCounter++}`;
      send({
        type: "elicit",
        id,
        exec_id: execState.id,
        message: value.message,
        requested_schema:
          value.requestedSchema == null
            ? { type: "object", properties: {} }
            : structuredClone(value.requestedSchema),
        meta: value.meta == null ? null : structuredClone(value.meta),
      });
      return new Promise((resolve, reject) => {
        pendingRequests.set(id, (response) => {
          if (!response.ok) {
            reject(new Error(response.error || "createElicitation failed"));
            return;
          }
          resolve({
            action: response.action,
            content: response.content ?? null,
            _meta: response._meta ?? null,
          });
        });
      });
    })();
    return trackExecBackgroundOperation(execState, operation);
  }

  function authenticatedFetch(input, init) {
    let execState;
    try {
      execState = execContext.getAsync();
    } catch (error) {
      return makeRejectedThenable(error);
    }
    const operation = (async () => {
      if (typeof Request !== "function" || typeof Response !== "function") {
        throw new Error("nodeRepl.fetch requires Request and Response globals");
      }
      const request = new Request(await input, init);
      const body = Buffer.from(await request.arrayBuffer());
      const id = `${execState.id}-authenticated-fetch-${authenticatedFetchCounter++}`;
      const payload = {
        method: request.method,
        url: request.url,
        headers: Array.from(request.headers.entries()).map(([name, value]) => ({
          name,
          value,
        })),
      };
      if (body.length > 0) {
        payload.body_base64 = body.toString("base64");
      }
      send({
        type: "authenticated_fetch",
        id,
        exec_id: execState.id,
        request: payload,
      });
      return new Promise((resolve, reject) => {
        pendingRequests.set(id, (result) => {
          if (!result.ok) {
            reject(new Error(result.error || "nodeRepl.fetch failed"));
            return;
          }
          if (!result.response) {
            reject(new Error("nodeRepl.fetch did not return a response"));
            return;
          }
          const status = Number(result.response.status);
          const responseBody =
            result.response.body_base64 && ![204, 205, 304].includes(status)
              ? Buffer.from(result.response.body_base64, "base64")
              : null;
          resolve(
            new Response(responseBody, {
              headers: (result.response.headers ?? []).map((header) => [
                header.name,
                header.value,
              ]),
              status,
              statusText: result.response.status_text ?? "",
            }),
          );
        });
      });
    })();
    // Trusted libraries issue best-effort background fetches without awaiting
    // them, so fetches must not extend the current exec's drain set.
    void operation.catch(() => {});
    return operation;
  }

  return { authenticatedFetch, createElicitation };
}

function createNativePipeBridge({ execContext, send }) {
  const pendingRequests = new Map();
  const connections = new Map();
  // A peer may close before its connect response resumes in JavaScript.
  const pendingClosures = new Map();
  let requestCounter = 0;

  function request(op, payload = {}) {
    const id = `native-pipe-${requestCounter++}`;
    send({
      type: "native_pipe_request",
      id,
      op,
      ...payload,
    });
    return new Promise((resolve, reject) => {
      pendingRequests.set(id, (message) => {
        if (!message.ok) {
          reject(new Error(message.error || "native pipe request failed"));
          return;
        }
        resolve(message.result);
      });
    });
  }

  function queueListener(listener, ...args) {
    void Promise.resolve()
      .then(() => listener(...args))
      .catch(() => {});
  }

  function closeConnection(connection, error) {
    if (connection.closed) {
      return;
    }
    connection.closed = true;
    connection.error = error;
    execContext.run(connection.execState, () => {
      if (error) {
        for (const listener of connection.listeners.error) {
          queueListener(listener, error);
        }
      }
      for (const listener of connection.listeners.close) {
        queueListener(listener);
      }
    });
  }

  const nativePipe = Object.freeze({
    async createConnection(pipePath) {
      if (typeof pipePath !== "string" || pipePath.length === 0) {
        throw new Error("native pipe path must be a non-empty string");
      }
      const result = await request("connect", { path: pipePath });
      const connectionId =
        result &&
        typeof result === "object" &&
        typeof result.connection_id === "string"
          ? result.connection_id
          : null;
      if (!connectionId) {
        throw new Error(
          "native pipe connect returned an invalid connection id",
        );
      }
      const connection = {
        execState: execContext.getAsync(),
        listeners: { data: new Set(), close: new Set(), error: new Set() },
        closed: pendingClosures.has(connectionId),
        error: pendingClosures.get(connectionId) ?? null,
      };
      pendingClosures.delete(connectionId);
      if (!connection.closed) {
        connections.set(connectionId, connection);
      }
      return Object.freeze({
        write(data) {
          if (connection.closed) {
            return;
          }
          const current = execContext.getOptional();
          if (current != null) {
            connection.execState = current;
          }
          const bytes = toByteArray(data);
          if (!bytes) {
            throw new Error("native pipe write expected bytes");
          }
          void request("write", {
            connection_id: connectionId,
            data_base64: Buffer.from(bytes).toString("base64"),
          }).catch((error) => {
            // Either a rejected write or a close event is terminal.
            closeConnection(
              connection,
              error instanceof Error ? error : new Error(String(error)),
            );
          });
        },
        on(event, listener) {
          if (event !== "data" && event !== "close" && event !== "error") {
            throw new Error(`unsupported native pipe event: ${String(event)}`);
          }
          if (typeof listener !== "function") {
            throw new Error("native pipe event listener must be a function");
          }
          if (connection.listeners[event].has(listener)) {
            return;
          }
          connection.listeners[event].add(listener);
          // Terminal events remain observable to listeners attached late.
          if (event === "error" && connection.error) {
            queueListener(listener, connection.error);
          }
          if (event === "close" && connection.closed) {
            queueListener(listener);
          }
        },
        off(event, listener) {
          if (event !== "data" && event !== "close" && event !== "error") {
            throw new Error(`unsupported native pipe event: ${String(event)}`);
          }
          connection.listeners[event].delete(listener);
        },
        end() {
          void request("close", { connection_id: connectionId }).catch(
            () => {},
          );
        },
      });
    },
  });

  function handleMessage(message) {
    if (message.type === "native_pipe_response") {
      const resolver = pendingRequests.get(message.id);
      if (resolver) {
        pendingRequests.delete(message.id);
        resolver(message);
      }
      return true;
    }
    if (message.type === "native_pipe_data") {
      const connection = connections.get(message.connection_id);
      if (connection) {
        const data = Buffer.from(message.data_base64, "base64");
        execContext.run(connection.execState, () => {
          for (const listener of connection.listeners.data) {
            listener(data);
          }
        });
      }
      return true;
    }
    if (message.type === "native_pipe_closed") {
      const connection = connections.get(message.connection_id);
      const error = message.error ? new Error(message.error) : null;
      if (!connection) {
        pendingClosures.set(message.connection_id, error);
      } else {
        connections.delete(message.connection_id);
        closeConnection(connection, error);
      }
      return true;
    }
    return false;
  }

  return { handleMessage, nativePipe };
}

function createPrivilegedNodeReplBridge({
  addAfterSubmittedCodeHook,
  addTurnEndedHandler,
  authenticatedFetch,
  createElicitation,
  env,
  getCurrentExecState,
  nativePipe,
  nodeRepl,
  pendingRequests,
  send,
  telemetryBridge,
}) {
  let privilegedNodeReplRequestCounter = 0;

  function sendPrivileged(execState, message) {
    send({
      ...message,
      exec_id: execState.id,
    });
  }

  function handlePrivilegedNodeReplOperation(operationName, buildPayload) {
    let execState;
    try {
      execState = getCurrentExecState();
    } catch (error) {
      return makeRejectedThenable(error);
    }

    const operation = (async () => {
      const payload = await buildPayload();
      const id = `${execState.id}-privileged-node-repl-${privilegedNodeReplRequestCounter++}`;
      sendPrivileged(execState, {
        ...payload,
        id,
      });
      return new Promise((resolve, reject) => {
        pendingRequests.set(id, (res) => {
          if (!res.ok) {
            reject(new Error(res.error || `${operationName} failed`));
            return;
          }
          resolve(Object.hasOwn(res, "value") ? res.value : {});
        });
      });
    })();

    return trackExecBackgroundOperation(execState, operation);
  }

  function withSuspendedTimeout(fn) {
    let execState;
    try {
      execState = getCurrentExecState();
      if (typeof fn !== "function") {
        throw new Error("nodeRepl.withSuspendedTimeout expected a function");
      }
    } catch (error) {
      return makeRejectedThenable(error);
    }

    const operation = (async () => {
      sendPrivileged(execState, {
        type: "suspend_timeout",
      });
      try {
        return await fn();
      } finally {
        sendPrivileged(execState, {
          type: "resume_timeout",
        });
      }
    })();

    return trackExecBackgroundOperation(execState, operation);
  }

  const privilegedNodeReplConfig = createPrivilegedNodeReplConfig({
    handlePrivilegedNodeReplOperation,
    isPlainObject,
  });
  const launchServices = Object.freeze({
    openApplication(target) {
      return handlePrivilegedNodeReplOperation(
        "nodeRepl.launchServices.openApplication",
        async () => {
          const normalized = normalizeLaunchServicesTarget(
            await target,
            isPlainObject,
          );
          return {
            type: "launch_services_action",
            action: "open_application",
            application_path: normalized.applicationPath,
            bundle_identifier: normalized.bundleIdentifier,
          };
        },
      );
    },
  });

  const privilegedNodeReplProperties = {
    addTurnEndedHandler: {
      configurable: false,
      enumerable: true,
      value: addTurnEndedHandler,
      writable: false,
    },
    addAfterSubmittedCodeHook: {
      configurable: false,
      enumerable: true,
      value: addAfterSubmittedCodeHook,
      writable: false,
    },
    gaasBrowserConfig: {
      configurable: false,
      enumerable: true,
      get() {
        return getCurrentExecState().gaasBrowserConfig;
      },
    },
    launchServices: {
      configurable: false,
      enumerable: true,
      value: launchServices,
      writable: false,
    },
    config: {
      configurable: false,
      enumerable: true,
      value: privilegedNodeReplConfig,
      writable: false,
    },
    env: {
      configurable: false,
      enumerable: true,
      value: env,
      writable: false,
    },
    createElicitation: {
      configurable: false,
      enumerable: true,
      value(request) {
        return createElicitation(request);
      },
      writable: false,
    },
    fetch: {
      configurable: false,
      enumerable: true,
      value(input, init) {
        return authenticatedFetch(input, init);
      },
      writable: false,
    },
    setResponseMeta: {
      configurable: false,
      enumerable: true,
      value(meta) {
        const execState = getCurrentExecState();
        if (!isPlainObject(meta)) {
          throw new Error("nodeRepl.setResponseMeta expected a plain object");
        }
        const previous = execState.responseMeta;
        const responseMeta = previous
          ? { ...previous, ...structuredClone(meta) }
          : structuredClone(meta);
        execState.responseMeta = responseMeta;
        send({
          type: "response_meta",
          id: execState.id,
          response_meta: responseMeta,
        });
      },
      writable: false,
    },
    nativePipe: {
      configurable: false,
      enumerable: true,
      value: nativePipe,
      writable: false,
    },
    otel: {
      configurable: false,
      enumerable: true,
      writable: false,
      value: Object.freeze({
        log(name, attributes = {}) {
          try {
            sendPrivileged(getCurrentExecState(), {
              type: "otel_log",
              name,
              attributes,
            });
          } catch {
            // Audit export is best effort and must not affect the operation.
          }
        },
      }),
    },
    emitContentItem: {
      configurable: false,
      enumerable: true,
      value(text) {
        if (typeof text !== "string") {
          throw new Error("nodeRepl.emitContentItem expected a string");
        }
        getCurrentExecState().contentItems.push(text);
      },
      writable: false,
    },
    withSuspendedTimeout: {
      configurable: false,
      enumerable: true,
      value: withSuspendedTimeout,
      writable: false,
    },
  };
  if (telemetryBridge !== null) {
    privilegedNodeReplProperties.telemetry = {
      configurable: false,
      enumerable: true,
      value: telemetryBridge,
      writable: false,
    };
  }
  return Object.freeze(Object.create(nodeRepl, privilegedNodeReplProperties));
}

function normalizeLaunchServicesTarget(target, isPlainObject) {
  if (!isPlainObject(target)) {
    throw new Error(
      "nodeRepl.launchServices.openApplication expected a target object",
    );
  }
  const unexpectedKeys = Object.keys(target).filter(
    (key) => key !== "applicationPath" && key !== "bundleIdentifier",
  );
  if (unexpectedKeys.length > 0) {
    throw new Error(
      "nodeRepl.launchServices.openApplication received an unsupported target",
    );
  }
  const applicationPath = nonEmptyString(target.applicationPath);
  const bundleIdentifier = nonEmptyString(target.bundleIdentifier);
  if ((applicationPath == null) === (bundleIdentifier == null)) {
    throw new Error(
      "nodeRepl.launchServices.openApplication expected exactly one of applicationPath or bundleIdentifier",
    );
  }
  return { applicationPath, bundleIdentifier };
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function createPrivilegedWorkerRuntime({
  env,
  runtime,
  telemetryBridge = null,
}) {
  const { execContext, pendingRequests, send } = runtime;
  const afterSubmittedCodeHooks = createLifecycleHandlers(
    "addAfterSubmittedCodeHook",
  );
  const turnEndedHandlers = createLifecycleHandlers(
    "addTurnEndedHandler",
    true,
  );
  const nativePipeBridge = createNativePipeBridge({
    execContext,
    send,
  });
  const { authenticatedFetch, createElicitation } =
    createPrivilegedHostOperations({ execContext, pendingRequests, send });

  return {
    afterSubmittedCodeHooks,
    turnEndedHandlers,
    nativePipeBridge,
    nodeRepl: createPrivilegedNodeReplBridge({
      addAfterSubmittedCodeHook: afterSubmittedCodeHooks.add,
      addTurnEndedHandler: turnEndedHandlers.add,
      authenticatedFetch,
      createElicitation,
      env,
      getCurrentExecState: execContext.getCurrent,
      nativePipe: nativePipeBridge.nativePipe,
      nodeRepl: runtime.nodeRepl,
      pendingRequests,
      send,
      telemetryBridge,
    }),
  };
}

module.exports = { createPrivilegedWorkerRuntime };
