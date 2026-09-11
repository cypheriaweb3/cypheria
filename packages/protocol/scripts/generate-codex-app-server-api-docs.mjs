import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const packageRoot = resolve(import.meta.dirname, "..")
const repositoryRoot = resolve(packageRoot, "../..")
const generatedRoot = resolve(packageRoot, "src/generated/codex/ts")
const schemaRoot = resolve(packageRoot, "src/generated/codex/schema")

const rootSchema = JSON.parse(
  await readFile(resolve(schemaRoot, "codex_app_server_protocol.schemas.json"), "utf8")
)
const v2Schema = JSON.parse(
  await readFile(resolve(schemaRoot, "codex_app_server_protocol.v2.schemas.json"), "utf8")
)
const definitions = {
  ...v2Schema.definitions,
  ...rootSchema.definitions,
  ...(rootSchema.definitions.v2 ?? {}),
}

const readUnion = async (fileName, includeId) => {
  const source = await readFile(resolve(generatedRoot, fileName), "utf8")
  const imports = new Map(
    [...source.matchAll(/import type \{ (\w+) \} from "([^"]+)";/g)].map((match) => [
      match[1],
      match[2],
    ])
  )
  const pattern = includeId
    ? /\{ "method": "([^"]+)", id: RequestId, params(\?)?: ([^,]+), \}/g
    : /\{ "method": "([^"]+)", "params": (\w+) \}/g

  return [...source.matchAll(pattern)].map((match) => ({
    method: match[1],
    optionalParams: includeId && Boolean(match[2]),
    paramType: includeId ? match[3].replace(/ \| undefined$/, "") : match[2],
    source: imports.get(includeId ? match[3].match(/\w+/)?.[0] : match[2]),
  }))
}

const clientRequests = await readUnion("ClientRequest.ts", true)
const serverRequests = await readUnion("ServerRequest.ts", true)
const serverNotifications = await readUnion("ServerNotification.ts", false)
const responseMapSource = await readFile(
  resolve(packageRoot, "src/generated/codex/response-map.ts"),
  "utf8"
)
const [clientResponseSection, serverResponseSection] = responseMapSource.split(
  "/** Compile-time mapping from every server-initiated request"
)
const parseResponseMap = (source) =>
  new Map(
    [...source.matchAll(/readonly (?:"([^"]+)"|(\w+)):\s+(?:v2\.)?(\w+)/g)].map((match) => [
      match[1] ?? match[2],
      match[3],
    ])
  )
const clientResponses = parseResponseMap(clientResponseSection)
const serverResponses = parseResponseMap(serverResponseSection)

const collectProperties = (schema, seen = new Set()) => {
  if (!schema || seen.has(schema)) return []
  seen.add(schema)
  if (schema.$ref) return collectProperties(definitions[schema.$ref.split("/").at(-1)], seen)
  if (schema.properties) {
    const required = new Set(schema.required ?? [])
    return Object.keys(schema.properties).map((name) => `${name}${required.has(name) ? "" : "?"}`)
  }
  for (const key of ["oneOf", "anyOf", "allOf"]) {
    if (schema[key]) {
      return [...new Set(schema[key].flatMap((item) => collectProperties(item, seen)))]
    }
  }
  return []
}

const fallbackFields = {
  GetAuthStatusParams: ["includeToken?", "refreshToken?"],
  GetAuthStatusResponse: ["authMethod?", "authToken?", "requiresOpenaiAuth?"],
  GetConversationSummaryParams: ["rolloutPath | conversationId"],
  GetConversationSummaryResponse: ["summary"],
  GitDiffToRemoteParams: ["cwd"],
  GitDiffToRemoteResponse: ["sha", "diff"],
}

const shape = (typeName, optional = false, language = "en") => {
  if (typeName === "undefined") {
    return language === "en" ? "`undefined` (omit `params`)" : "`undefined`（省略 `params`）"
  }
  if (typeName === "null") return "`null`"
  const schema = definitions[typeName]
  const fields = collectProperties(schema).length
    ? collectProperties(schema)
    : (fallbackFields[typeName] ?? [])
  const suffix = optional
    ? language === "en"
      ? "; `params` itself is optional"
      : "；`params` 本身可省略"
    : ""
  if (fields.length)
    return `\`${typeName}\`: ${fields.map((field) => `\`${field}\``).join(", ")}${suffix}`
  if (schema?.type === "object") return `\`${typeName}\`: \`{}\`${suffix}`
  return `\`${typeName}\`${suffix}`
}

const enActions = {
  add: "Add",
  appendAudio: "Append audio to",
  appendSpeech: "Append speech to",
  appendText: "Append text to",
  archive: "Archive",
  cancel: "Cancel",
  checkout: "Check out",
  clean: "Clean",
  clear: "Clear",
  consume: "Consume",
  create: "Create",
  decrement_elicitation: "Decrement elicitation state for",
  delete: "Delete",
  detect: "Detect",
  disable: "Disable",
  discover: "Discover",
  enable: "Enable",
  fork: "Fork",
  get: "Read",
  getMetadata: "Read metadata for",
  import: "Import",
  increment_elicitation: "Increment elicitation state for",
  info: "Read information for",
  inject_items: "Inject history items into",
  install: "Install",
  installed: "List installed",
  interrupt: "Interrupt",
  kill: "Kill",
  list: "List",
  listVoices: "List voices for",
  login: "Start login for",
  move: "Move",
  read: "Read",
  readDirectory: "Read directory",
  readFile: "Read file",
  reconcile: "Reconcile",
  recordHistory: "Record import history for",
  reload: "Reload",
  remove: "Remove",
  reorder: "Reorder",
  resize: "Resize",
  resizePty: "Resize PTY for",
  resume: "Resume",
  revert: "Revert",
  revoke: "Revoke",
  rollback: "Roll back",
  save: "Save",
  search: "Search",
  searchOccurrences: "Search occurrences in",
  set: "Set",
  setup: "Set up",
  setupStart: "Start setup for",
  shellCommand: "Run a shell command in",
  spawn: "Spawn",
  start: "Start",
  status: "Read status for",
  stop: "Stop",
  terminate: "Terminate",
  uninstall: "Uninstall",
  unarchive: "Unarchive",
  unsubscribe: "Unsubscribe from",
  update: "Update",
  updateTargets: "Update sharing targets for",
  upgrade: "Upgrade",
  write: "Write",
  writeFile: "Write file",
  writeStdin: "Write stdin to",
  copy: "Copy within",
  createDirectory: "Create a directory in",
  watch: "Watch",
  unwatch: "Stop watching",
  steer: "Steer",
  reset: "Reset",
  readHistories: "Read import histories for",
  sendAddCreditsNudgeEmail: "Send an add-credits nudge email for",
  sessionStart: "Start a session for",
  sessionUpdate: "Update a session for",
  sessionStop: "Stop a session for",
  readiness: "Read readiness for",
}
const zhActions = {
  add: "添加",
  appendAudio: "追加音频到",
  appendSpeech: "追加语音文本到",
  appendText: "追加文本到",
  archive: "归档",
  cancel: "取消",
  checkout: "检出",
  clean: "清理",
  clear: "清除",
  consume: "消费",
  create: "创建",
  decrement_elicitation: "减少外部交互计数",
  delete: "删除",
  detect: "检测",
  disable: "禁用",
  discover: "发现",
  enable: "启用",
  fork: "分叉",
  get: "读取",
  getMetadata: "读取元数据",
  import: "导入",
  increment_elicitation: "增加外部交互计数",
  info: "读取信息",
  inject_items: "注入历史条目到",
  install: "安装",
  installed: "列出已安装项",
  interrupt: "中断",
  kill: "终止",
  list: "列出",
  listVoices: "列出语音",
  login: "开始登录",
  move: "移动",
  read: "读取",
  readDirectory: "读取目录",
  readFile: "读取文件",
  reconcile: "对账并修复",
  recordHistory: "记录导入历史",
  reload: "重新加载",
  remove: "移除",
  reorder: "重排",
  resize: "调整尺寸",
  resizePty: "调整 PTY 尺寸",
  resume: "恢复",
  revert: "还原",
  revoke: "撤销授权",
  rollback: "回滚",
  save: "保存",
  search: "搜索",
  searchOccurrences: "搜索出现位置",
  set: "设置",
  setup: "配置",
  setupStart: "开始配置",
  shellCommand: "执行线程 Shell 命令",
  spawn: "启动进程",
  start: "启动",
  status: "读取状态",
  stop: "停止",
  terminate: "终止",
  uninstall: "卸载",
  unarchive: "取消归档",
  unsubscribe: "取消订阅",
  update: "更新",
  updateTargets: "更新共享目标",
  upgrade: "升级",
  write: "写入",
  writeFile: "写入文件",
  writeStdin: "写入标准输入",
  copy: "复制",
  createDirectory: "创建目录",
  watch: "监听",
  unwatch: "停止监听",
  steer: "引导",
  reset: "重置",
  readHistories: "读取导入历史",
  sendAddCreditsNudgeEmail: "发送充值提示邮件",
  sessionStart: "启动会话",
  sessionUpdate: "更新会话",
  sessionStop: "停止会话",
  readiness: "读取就绪状态",
}
const subjectNames = {
  account: ["account", "账户"],
  app: ["apps", "应用"],
  collaborationMode: ["collaboration modes", "协作模式"],
  command: ["sandboxed command", "沙箱命令"],
  config: ["configuration", "配置"],
  configRequirements: ["configuration requirements", "配置要求"],
  environment: ["environment", "执行环境"],
  experimentalFeature: ["experimental feature", "实验功能"],
  externalAgentConfig: ["external agent configuration", "外部 Agent 配置"],
  feedback: ["feedback", "反馈"],
  fs: ["filesystem", "文件系统"],
  fuzzyFileSearch: ["fuzzy file search", "模糊文件搜索"],
  hooks: ["hooks", "Hook"],
  marketplace: ["marketplace", "市场源"],
  mcpServer: ["MCP server", "MCP Server"],
  memory: ["memory", "记忆"],
  model: ["models", "模型"],
  modelProvider: ["model provider", "模型提供方"],
  permissionProfile: ["permission profiles", "权限配置"],
  plugin: ["plugins", "插件"],
  process: ["unsandboxed process", "非沙箱进程"],
  project: ["project", "项目"],
  remoteControl: ["remote control", "远程控制"],
  review: ["review", "审查"],
  server: ["server", "服务器"],
  skills: ["skills", "技能"],
  thread: ["thread", "任务线程"],
  threadSection: ["thread section", "任务分区"],
  turn: ["turn", "轮次"],
  windows: ["Windows", "Windows"],
  windowsSandbox: ["Windows sandbox", "Windows 沙箱"],
}

const specialPurposes = {
  initialize: [
    "Negotiate client capabilities and initialize the connection.",
    "协商客户端能力并初始化连接。",
  ],
  getConversationSummary: [
    "Read a legacy conversation summary by rollout path or conversation id.",
    "按 rollout 路径或会话 ID 读取旧版会话摘要。",
  ],
  gitDiffToRemote: [
    "Compute the Git diff from the working tree to its remote base.",
    "计算工作树相对远端基线的 Git diff。",
  ],
  getAuthStatus: [
    "Read the legacy authentication state and optionally return/refresh the token.",
    "读取旧版认证状态，并可选择返回或刷新令牌。",
  ],
  "server/diagnostics": [
    "Read process-local diagnostics without content data.",
    "读取不含内容数据的进程级诊断信息。",
  ],
  "account/login/start": [
    "Start an API-key, ChatGPT, or external-token login flow.",
    "启动 API key、ChatGPT 或外部令牌登录流程。",
  ],
  "thread/approveGuardianDeniedAction": [
    "Approve an action previously denied by Guardian.",
    "批准此前被 Guardian 拒绝的动作。",
  ],
  "item/commandExecution/requestApproval": [
    "Ask the client to approve a command execution.",
    "请求客户端批准命令执行。",
  ],
  "item/fileChange/requestApproval": [
    "Ask the client to approve file changes.",
    "请求客户端批准文件改动。",
  ],
  "item/tool/requestUserInput": [
    "Ask the client to collect structured user input for a tool.",
    "请求客户端为工具调用收集结构化用户输入。",
  ],
  "item/permissions/requestApproval": [
    "Ask the client to approve additional permissions.",
    "请求客户端批准额外权限。",
  ],
  "item/tool/call": [
    "Ask the client to execute a registered dynamic tool.",
    "请求客户端执行已注册的动态工具。",
  ],
  "mcpServer/elicitation/request": [
    "Ask the client to answer an MCP elicitation.",
    "请求客户端响应 MCP elicitation。",
  ],
  "account/chatgptAuthTokens/refresh": [
    "Ask the client to refresh ChatGPT authentication tokens.",
    "请求客户端刷新 ChatGPT 认证令牌。",
  ],
  "attestation/generate": [
    "Ask the client to generate a fresh attestation token.",
    "请求客户端生成新的 attestation 令牌。",
  ],
  "currentTime/read": [
    "Read time from the client-owned external clock.",
    "从客户端拥有的外部时钟读取时间。",
  ],
  applyPatchApproval: ["Legacy request for patch approval.", "旧版补丁审批请求。"],
  execCommandApproval: ["Legacy request for command execution approval.", "旧版命令执行审批请求。"],
}

const purpose = (method, language) => {
  if (specialPurposes[method]) return specialPurposes[method][language === "en" ? 0 : 1]
  const parts = method.split("/")
  const subject = subjectNames[parts[0]]?.[language === "en" ? 0 : 1] ?? parts[0]
  const actionKey = parts.at(-1)
  const action = (language === "en" ? enActions : zhActions)[actionKey]
  const qualifier = parts.slice(1, -1).join("/")
  if (language === "en")
    return action
      ? `${action} ${qualifier ? `${subject} ${qualifier}` : subject}.`
      : `Perform ${method}.`
  return action ? `${action}${subject}${qualifier ? `的 ${qualifier}` : ""}。` : `执行 ${method}。`
}

const notificationPurpose = (method, language) =>
  language === "en" ? `Reports the \`${method}\` event.` : `推送 \`${method}\` 事件。`

const legacyMethods = new Set(["getConversationSummary", "gitDiffToRemote", "getAuthStatus"])
const groupKey = (method) => (legacyMethods.has(method) ? "legacy" : method.split("/")[0])
const groupTitles = Object.fromEntries(
  Object.entries(subjectNames).map(([key, [en, zh]]) => [
    key,
    [en[0].toUpperCase() + en.slice(1), zh],
  ])
)
groupTitles.initialize = ["Initialization", "初始化"]
groupTitles.legacy = ["Legacy helpers", "旧版辅助 API"]

const renderGroups = (items, language, row) => {
  const groups = new Map()
  for (const item of items) {
    const key = groupKey(item.method)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  return [...groups]
    .map(([key, values]) => {
      const title = groupTitles[key]?.[language === "en" ? 0 : 1] ?? key
      return `### ${title}\n\n${values.map(row).join("\n")}`
    })
    .join("\n\n")
}

const requestRow = (responses, language) => (item) => {
  const response = responses.get(item.method)
  const inputLabel = language === "en" ? "Input" : "入参"
  const outputLabel = language === "en" ? "Output" : "出参"
  return `- \`${item.method}\` — ${purpose(item.method, language)} ${inputLabel}: ${shape(item.paramType, item.optionalParams, language)}. ${outputLabel}: ${shape(response, false, language)}.`
}
const notificationRow = (language) => (item) =>
  `- \`${item.method}\` — ${notificationPurpose(item.method, language)} ${language === "en" ? "Payload" : "载荷"}: ${shape(item.paramType, false, language)}.`

const english = `# Codex App Server API reference\n\nThis document analyzes the generated protocol currently committed under \`packages/protocol/src/generated/codex\`. It covers the complete API surface generated with experimental definitions enabled: ${clientRequests.length} client requests, ${serverRequests.length} server-initiated requests, ${serverNotifications.length} server notifications, and one client notification.\n\nThe protocol uses JSON-RPC-style messages. Client requests contain \`id\`, \`method\`, and method-specific \`params\`; server requests use the same shape in the reverse direction; notifications have no \`id\`; successful responses contain \`id\` and \`result\`; errors contain \`id\` and \`error\`. A trailing \`?\` below marks an optional top-level field. The generated type named before each field list is the source of truth for nested structures and enum values.\n\n## Client requests (${clientRequests.length})\n\n${renderGroups(clientRequests, "en", requestRow(clientResponses, "en"))}\n\n## Server-initiated requests (${serverRequests.length})\n\nThese are reverse RPC calls. The client must return the listed response rather than treating them as notifications.\n\n${renderGroups(serverRequests, "en", requestRow(serverResponses, "en"))}\n\n## Server notifications (${serverNotifications.length})\n\n${renderGroups(serverNotifications, "en", notificationRow("en"))}\n\n## Client notification (1)\n\n- \`initialized\` — Sent after a successful \`initialize\` response to indicate that the client is ready. It has no \`id\`, \`params\`, or response.\n`

const chinese = `# Codex App Server API 参考\n\n本文分析当前提交在 \`packages/protocol/src/generated/codex\` 下的自动生成协议，覆盖启用实验定义后生成的完整 API：${clientRequests.length} 个客户端请求、${serverRequests.length} 个服务端反向请求、${serverNotifications.length} 个服务端通知，以及 1 个客户端通知。\n\n协议采用 JSON-RPC 风格消息。客户端请求包含 \`id\`、\`method\` 和各方法专用的 \`params\`；服务端反向请求使用相同结构但方向相反；通知没有 \`id\`；成功响应包含 \`id\` 和 \`result\`；错误响应包含 \`id\` 和 \`error\`。下文顶层字段名后的 \`?\` 表示可选。字段列表前的生成类型名是嵌套结构和枚举值的最终依据。\n\n## 客户端请求（${clientRequests.length}）\n\n${renderGroups(clientRequests, "zh", requestRow(clientResponses, "zh"))}\n\n## 服务端反向请求（${serverRequests.length}）\n\n这些是反向 RPC；客户端必须返回列出的响应，不能把它们当作普通通知。\n\n${renderGroups(serverRequests, "zh", requestRow(serverResponses, "zh"))}\n\n## 服务端通知（${serverNotifications.length}）\n\n${renderGroups(serverNotifications, "zh", notificationRow("zh"))}\n\n## 客户端通知（1）\n\n- \`initialized\` — 成功收到 \`initialize\` 响应后发送，表示客户端已准备就绪；没有 \`id\`、\`params\` 或响应。\n`

const englishDocument = english.replace(
  "The protocol uses JSON-RPC-style messages.",
  "The Cypheria client protocol exposes this complete surface with mechanically generated dotted names under `agent.codex`. Slash separators become dots, camel-case segments become snake case, and the message direction is explicit: `.request`, `.response`, or `.notification`. Every dotted message has a method-specific Zod schema derived from the generated JSON Schema and statically paired with the matching generated Codex TypeScript type. These message contracts are exported from `@cypheria/protocol`, while raw generated Codex types are isolated behind `@cypheria/protocol/codex-types`.\n\nThe protocol uses JSON-RPC-style messages."
)
const chineseDocument = chinese.replace(
  "协议采用 JSON-RPC 风格消息。",
  "Cypheria client protocol 通过 `agent.codex` 下机械生成的 dotted name 暴露这套完整 API。Slash separator 转为 dot，camel-case segment 转为 snake case，并以 `.request`、`.response` 或 `.notification` 明确消息方向。每种 dotted message 都有从 generated JSON Schema 派生的专用 Zod schema，并在静态类型上与对应 generated Codex TypeScript type 配对。这些 message contract 从 `@cypheria/protocol` 导出，原始 generated Codex type 则隔离在 `@cypheria/protocol/codex-types`。\n\n协议采用 JSON-RPC 风格消息。"
)

await writeFile(resolve(repositoryRoot, "docs/codex-app-server-api.md"), englishDocument)
await writeFile(resolve(repositoryRoot, "docs/codex-app-server-api.zh-CN.md"), chineseDocument)
console.log(
  `Generated English and Chinese API references for ${clientRequests.length + serverRequests.length + serverNotifications.length + 1} protocol methods.`
)
