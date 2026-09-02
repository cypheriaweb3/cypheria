import {
  automationRunIdSchema,
  automationTaskIdSchema,
  automationTaskRunSchema,
  automationTaskSchema,
  automationTaskStatusSchema,
  createAutomationTaskInputSchema,
} from "@cypheria/automation-core"
import { signingIntentSchema } from "@cypheria/wallet-core"
import {
  dappSessionSchema,
  walletProviderRequestSchema,
  walletProviderResponseSchema,
} from "@cypheria/wallet-provider"
import { z } from "zod"
import {
  type CodexAccountView,
  CodexAccountViewSchema,
  type CodexChatEvent,
  CodexChatInterruptSchema,
  type CodexChatStart,
  type CodexChatStartResult,
  CodexChatStartResultSchema,
  CodexChatStartSchema,
  CodexLoginCancelSchema,
  type CodexLoginRequest,
  CodexLoginRequestSchema,
  type CodexLoginResult,
  CodexLoginResultSchema,
  CodexModelListRequestSchema,
  type CodexModelSettings,
  CodexModelSettingsSchema,
  type CodexModelView,
  CodexModelViewSchema,
  CodexThreadListRequestSchema,
  type CodexThreadView,
  CodexThreadViewSchema,
} from "./codex.js"

export * from "./codex.js"

export const IPC_PROTOCOL_VERSION = 1

export const ipcNamespaces = [
  "app",
  "runtime",
  "codex",
  "wallet",
  "chain",
  "browser",
  "dapp",
  "policy",
  "automation",
  "approval",
  "settings",
  "audit",
] as const

export const IpcNamespaceSchema = z.enum(ipcNamespaces)
export type IpcNamespace = z.infer<typeof IpcNamespaceSchema>

export const CYPHERIA_IPC_CHANNELS = {
  appHealthCheck: "app.health.check",
  appMetadataRead: "app.metadata.read",
  approvalRequestDecide: "approval.request.decide",
  approvalRequestsList: "approval.requests.list",
  automationRunGet: "automation.run.get",
  automationRunList: "automation.run.list",
  automationRunStart: "automation.run.start",
  automationTaskCreate: "automation.task.create",
  automationTaskGet: "automation.task.get",
  automationTaskList: "automation.task.list",
  automationTaskPause: "automation.task.pause",
  automationTaskResume: "automation.task.resume",
  browserSessionOpen: "browser.session.open",
  codexAccountLoginCancel: "codex.account.login.cancel",
  codexAccountLoginStart: "codex.account.login.start",
  codexAccountLogout: "codex.account.logout",
  codexAccountRead: "codex.account.read",
  codexChatEvent: "codex.chat.event",
  codexChatInterrupt: "codex.chat.interrupt",
  codexChatStart: "codex.chat.start",
  codexEvent: "codex.event",
  codexModelList: "codex.model.list",
  codexModelSettingsRead: "codex.model.settings.read",
  codexModelSettingsWrite: "codex.model.settings.write",
  codexThreadList: "codex.thread.list",
  dappProviderRequest: "dapp.provider.request",
  dappProviderEvent: "dapp.provider.event",
  runtimeInfoRead: "runtime.info.read",
  settingsAppearanceFontsList: "settings.appearance.fonts.list",
  settingsAppearanceRead: "settings.appearance.read",
  settingsAppearanceWrite: "settings.appearance.write",
} as const

export type CypheriaIpcChannel = (typeof CYPHERIA_IPC_CHANNELS)[keyof typeof CYPHERIA_IPC_CHANNELS]

export const EmptyPayloadSchema = z.object({}).strict()
export type EmptyPayload = z.infer<typeof EmptyPayloadSchema>

export const RuntimeInfoSchema = z
  .object({
    codex: z
      .object({
        listenUrl: z.string().url(),
        state: z.enum(["ready", "starting", "stopped", "stopping"]),
      })
      .strict()
      .optional(),
    codexHome: z.string().min(1),
    cypheriaHome: z.string().min(1),
    directories: z
      .object({
        automation: z.string().min(1),
        browser: z.string().min(1),
        cache: z.string().min(1),
        config: z.string().min(1),
        db: z.string().min(1),
        logs: z.string().min(1),
        vault: z.string().min(1),
      })
      .strict(),
  })
  .strict()
export type RuntimeInfo = z.infer<typeof RuntimeInfoSchema>

export const AppMetadataSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
  })
  .strict()
export type AppMetadata = z.infer<typeof AppMetadataSchema>

export const AppHealthStatusSchema = z
  .object({
    checkedAt: z.string().datetime(),
    protocolVersion: z.literal(IPC_PROTOCOL_VERSION),
    status: z.literal("ok"),
  })
  .strict()
export type AppHealthStatus = z.infer<typeof AppHealthStatusSchema>

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)

export const AppearanceThemeModeSchema = z.enum(["dark", "light", "system"])
export type AppearanceThemeMode = z.infer<typeof AppearanceThemeModeSchema>

export const AppearanceDiffMarkerStyleSchema = z.enum(["color", "symbols"])
export type AppearanceDiffMarkerStyle = z.infer<typeof AppearanceDiffMarkerStyleSchema>

export const AppearanceReducedMotionPreferenceSchema = z.enum(["system", "on", "off"])
export type AppearanceReducedMotionPreference = z.infer<
  typeof AppearanceReducedMotionPreferenceSchema
>

export const AppearanceCodeThemeIdSchema = z.enum([
  "absolutely",
  "ayu",
  "catppuccin",
  "codex",
  "dracula",
  "everforest",
  "github",
  "gruvbox",
  "linear",
  "lobster",
  "material",
  "matrix",
  "monokai",
  "night-owl",
  "nord",
  "notion",
  "one",
  "oscurange",
  "proof",
  "raycast",
  "rose-pine",
  "sentry",
  "solarized",
  "temple",
  "tokyo-night",
  "vercel",
  "vscode-plus",
  "xcode",
])
export type AppearanceCodeThemeId = z.infer<typeof AppearanceCodeThemeIdSchema>

export const AppearanceChromeThemeSchema = z
  .object({
    accent: HexColorSchema,
    accentSource: z.enum(["chatgpt", "custom"]).optional(),
    contrast: z.number().min(0).max(100),
    fonts: z
      .object({
        code: z.string().min(1),
        codeFace: z
          .object({
            family: z.string().min(1),
            fullName: z.string().min(1).optional(),
            postscriptName: z.string().min(1).optional(),
          })
          .strict()
          .optional(),
        ui: z.string().min(1),
        uiFace: z
          .object({
            family: z.string().min(1),
            fullName: z.string().min(1).optional(),
            postscriptName: z.string().min(1).optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    ink: HexColorSchema,
    opaqueWindows: z.boolean(),
    semanticColors: z
      .object({
        diffAdded: HexColorSchema,
        diffRemoved: HexColorSchema,
        skill: HexColorSchema,
      })
      .strict(),
    surface: HexColorSchema,
  })
  .strict()
export type AppearanceChromeTheme = z.infer<typeof AppearanceChromeThemeSchema>

export const AppearanceSettingsSchema = z
  .object({
    theme: AppearanceThemeModeSchema,
    lightThemeId: AppearanceCodeThemeIdSchema,
    darkThemeId: AppearanceCodeThemeIdSchema,
    lightTheme: AppearanceChromeThemeSchema,
    darkTheme: AppearanceChromeThemeSchema,
    uiFontSize: z.number().min(11).max(16),
    codeFontSize: z.number().min(8).max(24),
    diffMarkerStyle: AppearanceDiffMarkerStyleSchema,
    reducedMotionPreference: AppearanceReducedMotionPreferenceSchema,
    useFontSmoothing: z.boolean(),
    usePointerCursors: z.boolean(),
    configPath: z.string().min(1),
  })
  .strict()
export type AppearanceSettings = z.infer<typeof AppearanceSettingsSchema>
export const AppearanceSettingsWriteSchema = AppearanceSettingsSchema.omit({ configPath: true })
export type AppearanceSettingsWrite = z.infer<typeof AppearanceSettingsWriteSchema>
export const CYPHERIA_APPEARANCE_ARGUMENT_PREFIX = "--cypheria-appearance="

export const AppearanceFontFaceSchema = z
  .object({
    family: z.string().min(1),
    fullName: z.string().min(1).optional(),
    postscriptName: z.string().min(1).optional(),
    style: z.string().min(1).optional(),
  })
  .strict()
export type AppearanceFontFace = z.infer<typeof AppearanceFontFaceSchema>

export const AppearanceFontOptionSchema = z
  .object({
    faces: z.array(AppearanceFontFaceSchema),
    family: z.string().min(1),
    styles: z.array(z.string().min(1)),
  })
  .strict()
export type AppearanceFontOption = z.infer<typeof AppearanceFontOptionSchema>

export const ApprovalRequestStatusSchema = z.enum(["approved", "expired", "pending", "rejected"])
export type ApprovalRequestStatus = z.infer<typeof ApprovalRequestStatusSchema>

export const SigningIntentRecordSchema = z
  .object({
    approvalId: z.string().min(1).optional(),
    decision: z.enum(["allow", "deny", "require-human-approval"]),
    decisionId: z.string().min(1),
    expiresAt: z.iso.datetime(),
    intent: signingIntentSchema,
    matchedPolicyId: z.string().min(1).optional(),
    mode: z.enum(["conditional-auto-signing", "human-approval", "read-only"]),
    payloadHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    revision: z.number().int().positive(),
    source: z.enum(["agent", "automation", "dapp"]),
    status: z.enum(["approved", "expired", "pending-approval", "rejected"]),
    updatedAt: z.iso.datetime(),
  })
  .strict()
export type SigningIntentRecord = z.infer<typeof SigningIntentRecordSchema>

export const ApprovalRequestRecordSchema = z
  .object({
    expiresAt: z.iso.datetime(),
    id: z.string().regex(/^approval_[A-Za-z0-9][A-Za-z0-9_-]*$/u),
    intentId: z.string().regex(/^signing_intent_[A-Za-z0-9][A-Za-z0-9_-]*$/u),
    requestedAt: z.iso.datetime(),
    resolvedAt: z.iso.datetime().optional(),
    reviewer: z.string().min(1).optional(),
    revision: z.number().int().positive(),
    status: ApprovalRequestStatusSchema,
  })
  .strict()
export type ApprovalRequestRecord = z.infer<typeof ApprovalRequestRecordSchema>

export const ApprovalRequestViewSchema = z
  .object({
    approval: ApprovalRequestRecordSchema,
    intent: SigningIntentRecordSchema,
  })
  .strict()
export type ApprovalRequestView = z.infer<typeof ApprovalRequestViewSchema>

export const ApprovalRequestsListSchema = z
  .object({ status: ApprovalRequestStatusSchema.optional() })
  .strict()
export type ApprovalRequestsList = z.infer<typeof ApprovalRequestsListSchema>

export const ApprovalRequestDecideSchema = z
  .object({
    approvalId: z.string().regex(/^approval_[A-Za-z0-9][A-Za-z0-9_-]*$/u),
    decision: z.enum(["approved", "rejected"]),
    expectedRevision: z.number().int().positive(),
    reviewer: z.string().min(1).max(256),
  })
  .strict()
export type ApprovalRequestDecide = z.infer<typeof ApprovalRequestDecideSchema>

export const BrowserSessionOpenSchema = z.object({ url: z.url() }).strict()
export type BrowserSessionOpen = z.infer<typeof BrowserSessionOpenSchema>

export const BrowserSessionOpenResultSchema = z
  .object({ session: dappSessionSchema, webContentsId: z.number().int().positive() })
  .strict()
export type BrowserSessionOpenResult = z.infer<typeof BrowserSessionOpenResultSchema>

export const AutomationTaskViewSchema = z
  .object({ runs: z.array(automationTaskRunSchema), task: automationTaskSchema })
  .strict()
export type AutomationTaskView = z.infer<typeof AutomationTaskViewSchema>

export const AutomationTaskListSchema = z
  .object({ status: automationTaskStatusSchema.optional() })
  .strict()
export type AutomationTaskList = z.infer<typeof AutomationTaskListSchema>

export const AutomationTaskIdInputSchema = z.object({ taskId: automationTaskIdSchema }).strict()
export type AutomationTaskIdInput = z.infer<typeof AutomationTaskIdInputSchema>

export const AutomationRunIdInputSchema = z.object({ runId: automationRunIdSchema }).strict()
export type AutomationRunIdInput = z.infer<typeof AutomationRunIdInputSchema>

export const AutomationTaskTransitionSchema = AutomationTaskIdInputSchema.extend({
  expectedRevision: z.number().int().positive().optional(),
}).strict()
export type AutomationTaskTransition = z.infer<typeof AutomationTaskTransitionSchema>

export const AutomationRunListSchema = z
  .object({ taskId: automationTaskIdSchema.optional() })
  .strict()
export type AutomationRunList = z.infer<typeof AutomationRunListSchema>

export const IpcRequestEnvelopeSchema = z
  .object({
    channel: z.string().min(1),
    correlationId: z.string().min(1).optional(),
    payload: z.unknown(),
    version: z.literal(IPC_PROTOCOL_VERSION),
  })
  .strict()
export type IpcRequestEnvelope = z.infer<typeof IpcRequestEnvelopeSchema>

export const IpcErrorCodeSchema = z.enum([
  "BAD_REQUEST",
  "FORBIDDEN",
  "NOT_FOUND",
  "INTERNAL_ERROR",
  "UNAVAILABLE",
  "VALIDATION_ERROR",
])
export type IpcErrorCode = z.infer<typeof IpcErrorCodeSchema>

export const IpcErrorEnvelopeSchema = z
  .object({
    correlationId: z.string().min(1).optional(),
    error: z
      .object({
        code: IpcErrorCodeSchema,
        details: z.unknown().optional(),
        message: z.string().min(1),
      })
      .strict(),
    ok: z.literal(false),
    version: z.literal(IPC_PROTOCOL_VERSION),
  })
  .strict()
export type IpcErrorEnvelope = z.infer<typeof IpcErrorEnvelopeSchema>

export const createIpcSuccessEnvelopeSchema = <TPayload extends z.ZodType>(
  payloadSchema: TPayload
) =>
  z
    .object({
      correlationId: z.string().min(1).optional(),
      ok: z.literal(true),
      payload: payloadSchema,
      version: z.literal(IPC_PROTOCOL_VERSION),
    })
    .strict()

export type IpcSuccessEnvelope<TPayload> = {
  readonly correlationId?: string
  readonly ok: true
  readonly payload: TPayload
  readonly version: typeof IPC_PROTOCOL_VERSION
}

export type IpcResponseEnvelope<TPayload> = IpcSuccessEnvelope<TPayload> | IpcErrorEnvelope

export const IpcEventEnvelopeSchema = z
  .object({
    correlationId: z.string().min(1).optional(),
    event: z.string().min(1),
    namespace: IpcNamespaceSchema,
    payload: z.unknown(),
    timestamp: z.string().datetime(),
    version: z.literal(IPC_PROTOCOL_VERSION),
  })
  .strict()
export type IpcEventEnvelope = z.infer<typeof IpcEventEnvelopeSchema>

export const CodexEventTypeSchema = z.enum([
  "codex.error",
  "codex.lifecycle",
  "codex.notification",
  "codex.serverRequest",
  "codex.stderr",
])
export type CodexEventType = z.infer<typeof CodexEventTypeSchema>

export const CodexLifecyclePayloadSchema = z
  .object({
    state: z.string().min(1),
  })
  .strict()
export type CodexLifecyclePayload = z.infer<typeof CodexLifecyclePayloadSchema>

export const CodexMessagePayloadSchema = z
  .object({
    method: z.string().min(1),
    params: z.unknown().optional(),
  })
  .strict()
export type CodexMessagePayload = z.infer<typeof CodexMessagePayloadSchema>

export const CodexErrorPayloadSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict()
export type CodexErrorPayload = z.infer<typeof CodexErrorPayloadSchema>

export const CodexStderrPayloadSchema = z
  .object({
    line: z.string(),
  })
  .strict()
export type CodexStderrPayload = z.infer<typeof CodexStderrPayloadSchema>

export const CodexEventPayloadSchema = z.union([
  CodexLifecyclePayloadSchema,
  CodexMessagePayloadSchema,
  CodexErrorPayloadSchema,
  CodexStderrPayloadSchema,
])
export type CodexEventPayload = z.infer<typeof CodexEventPayloadSchema>

export const CodexEventEnvelopeSchema = IpcEventEnvelopeSchema.extend({
  event: CodexEventTypeSchema,
  namespace: z.literal("codex"),
  payload: CodexEventPayloadSchema,
}).strict()
export type CodexEventEnvelope = z.infer<typeof CodexEventEnvelopeSchema>

export type IpcContract<TRequestPayload, TResponsePayload> = {
  readonly channel: CypheriaIpcChannel
  readonly namespace: IpcNamespace
  readonly request: z.ZodType<TRequestPayload>
  readonly response: z.ZodType<TResponsePayload>
  readonly version: typeof IPC_PROTOCOL_VERSION
}

export const appMetadataReadContract = {
  channel: CYPHERIA_IPC_CHANNELS.appMetadataRead,
  namespace: "app",
  request: EmptyPayloadSchema,
  response: AppMetadataSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, AppMetadata>

export const appHealthCheckContract = {
  channel: CYPHERIA_IPC_CHANNELS.appHealthCheck,
  namespace: "app",
  request: EmptyPayloadSchema,
  response: AppHealthStatusSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, AppHealthStatus>

export const approvalRequestsListContract = {
  channel: CYPHERIA_IPC_CHANNELS.approvalRequestsList,
  namespace: "approval",
  request: ApprovalRequestsListSchema,
  response: z.array(ApprovalRequestViewSchema),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<ApprovalRequestsList, ApprovalRequestView[]>

export const approvalRequestDecideContract = {
  channel: CYPHERIA_IPC_CHANNELS.approvalRequestDecide,
  namespace: "approval",
  request: ApprovalRequestDecideSchema,
  response: ApprovalRequestViewSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<ApprovalRequestDecide, ApprovalRequestView>

export const browserSessionOpenContract = {
  channel: CYPHERIA_IPC_CHANNELS.browserSessionOpen,
  namespace: "browser",
  request: BrowserSessionOpenSchema,
  response: BrowserSessionOpenResultSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<BrowserSessionOpen, BrowserSessionOpenResult>

export const dappProviderRequestContract = {
  channel: CYPHERIA_IPC_CHANNELS.dappProviderRequest,
  namespace: "dapp",
  request: walletProviderRequestSchema,
  response: walletProviderResponseSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<
  z.input<typeof walletProviderRequestSchema>,
  z.output<typeof walletProviderResponseSchema>
>

export const automationTaskCreateContract = {
  channel: CYPHERIA_IPC_CHANNELS.automationTaskCreate,
  namespace: "automation",
  request: createAutomationTaskInputSchema,
  response: automationTaskSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<
  z.input<typeof createAutomationTaskInputSchema>,
  z.output<typeof automationTaskSchema>
>

export const automationTaskListContract = {
  channel: CYPHERIA_IPC_CHANNELS.automationTaskList,
  namespace: "automation",
  request: AutomationTaskListSchema,
  response: z.array(automationTaskSchema),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<AutomationTaskList, z.output<typeof automationTaskSchema>[]>

export const automationTaskGetContract = {
  channel: CYPHERIA_IPC_CHANNELS.automationTaskGet,
  namespace: "automation",
  request: AutomationTaskIdInputSchema,
  response: AutomationTaskViewSchema.optional(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<AutomationTaskIdInput, AutomationTaskView | undefined>

export const automationTaskPauseContract = {
  channel: CYPHERIA_IPC_CHANNELS.automationTaskPause,
  namespace: "automation",
  request: AutomationTaskTransitionSchema,
  response: automationTaskSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<AutomationTaskTransition, z.output<typeof automationTaskSchema>>

export const automationTaskResumeContract = {
  ...automationTaskPauseContract,
  channel: CYPHERIA_IPC_CHANNELS.automationTaskResume,
} satisfies IpcContract<AutomationTaskTransition, z.output<typeof automationTaskSchema>>

export const automationRunStartContract = {
  channel: CYPHERIA_IPC_CHANNELS.automationRunStart,
  namespace: "automation",
  request: AutomationTaskIdInputSchema,
  response: automationTaskRunSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<AutomationTaskIdInput, z.output<typeof automationTaskRunSchema>>

export const automationRunGetContract = {
  channel: CYPHERIA_IPC_CHANNELS.automationRunGet,
  namespace: "automation",
  request: AutomationRunIdInputSchema,
  response: automationTaskRunSchema.optional(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<AutomationRunIdInput, z.output<typeof automationTaskRunSchema> | undefined>

export const automationRunListContract = {
  channel: CYPHERIA_IPC_CHANNELS.automationRunList,
  namespace: "automation",
  request: AutomationRunListSchema,
  response: z.array(automationTaskRunSchema),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<AutomationRunList, z.output<typeof automationTaskRunSchema>[]>

export const runtimeInfoReadContract = {
  channel: CYPHERIA_IPC_CHANNELS.runtimeInfoRead,
  namespace: "runtime",
  request: EmptyPayloadSchema,
  response: RuntimeInfoSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, RuntimeInfo>

export const settingsAppearanceReadContract = {
  channel: CYPHERIA_IPC_CHANNELS.settingsAppearanceRead,
  namespace: "settings",
  request: EmptyPayloadSchema,
  response: AppearanceSettingsSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, AppearanceSettings>

export const settingsAppearanceWriteContract = {
  channel: CYPHERIA_IPC_CHANNELS.settingsAppearanceWrite,
  namespace: "settings",
  request: AppearanceSettingsWriteSchema,
  response: AppearanceSettingsSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<AppearanceSettingsWrite, AppearanceSettings>

export const settingsAppearanceFontsListContract = {
  channel: CYPHERIA_IPC_CHANNELS.settingsAppearanceFontsList,
  namespace: "settings",
  request: EmptyPayloadSchema,
  response: z.array(AppearanceFontOptionSchema),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, AppearanceFontOption[]>

export const codexAccountReadContract = {
  channel: CYPHERIA_IPC_CHANNELS.codexAccountRead,
  namespace: "codex",
  request: EmptyPayloadSchema,
  response: CodexAccountViewSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, CodexAccountView>

export const codexAccountLoginStartContract = {
  channel: CYPHERIA_IPC_CHANNELS.codexAccountLoginStart,
  namespace: "codex",
  request: CodexLoginRequestSchema,
  response: CodexLoginResultSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<CodexLoginRequest, CodexLoginResult>

export const codexAccountLoginCancelContract = {
  channel: CYPHERIA_IPC_CHANNELS.codexAccountLoginCancel,
  namespace: "codex",
  request: CodexLoginCancelSchema,
  response: z.object({ cancelled: z.boolean() }).strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<{ loginId: string }, { cancelled: boolean }>

export const codexAccountLogoutContract = {
  channel: CYPHERIA_IPC_CHANNELS.codexAccountLogout,
  namespace: "codex",
  request: EmptyPayloadSchema,
  response: z.object({ loggedOut: z.boolean() }).strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, { loggedOut: boolean }>

export const codexModelListContract = {
  channel: CYPHERIA_IPC_CHANNELS.codexModelList,
  namespace: "codex",
  request: CodexModelListRequestSchema,
  response: z.array(CodexModelViewSchema),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<{ includeHidden?: boolean }, CodexModelView[]>

export const codexModelSettingsReadContract = {
  channel: CYPHERIA_IPC_CHANNELS.codexModelSettingsRead,
  namespace: "codex",
  request: EmptyPayloadSchema,
  response: CodexModelSettingsSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, CodexModelSettings>

export const codexModelSettingsWriteContract = {
  channel: CYPHERIA_IPC_CHANNELS.codexModelSettingsWrite,
  namespace: "codex",
  request: CodexModelSettingsSchema,
  response: CodexModelSettingsSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<CodexModelSettings, CodexModelSettings>

export const codexThreadListContract = {
  channel: CYPHERIA_IPC_CHANNELS.codexThreadList,
  namespace: "codex",
  request: CodexThreadListRequestSchema,
  response: z.array(CodexThreadViewSchema),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<{ archived?: boolean; searchTerm?: string }, CodexThreadView[]>

export const codexChatStartContract = {
  channel: CYPHERIA_IPC_CHANNELS.codexChatStart,
  namespace: "codex",
  request: CodexChatStartSchema,
  response: CodexChatStartResultSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<CodexChatStart, CodexChatStartResult>

export const codexChatInterruptContract = {
  channel: CYPHERIA_IPC_CHANNELS.codexChatInterrupt,
  namespace: "codex",
  request: CodexChatInterruptSchema,
  response: z.object({ interrupted: z.boolean() }).strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<{ requestId: string }, { interrupted: boolean }>

export const ipcContracts = {
  appHealthCheck: appHealthCheckContract,
  appMetadataRead: appMetadataReadContract,
  approvalRequestDecide: approvalRequestDecideContract,
  approvalRequestsList: approvalRequestsListContract,
  automationRunGet: automationRunGetContract,
  automationRunList: automationRunListContract,
  automationRunStart: automationRunStartContract,
  automationTaskCreate: automationTaskCreateContract,
  automationTaskGet: automationTaskGetContract,
  automationTaskList: automationTaskListContract,
  automationTaskPause: automationTaskPauseContract,
  automationTaskResume: automationTaskResumeContract,
  browserSessionOpen: browserSessionOpenContract,
  codexAccountLoginCancel: codexAccountLoginCancelContract,
  codexAccountLoginStart: codexAccountLoginStartContract,
  codexAccountLogout: codexAccountLogoutContract,
  codexAccountRead: codexAccountReadContract,
  codexChatInterrupt: codexChatInterruptContract,
  codexChatStart: codexChatStartContract,
  codexModelList: codexModelListContract,
  codexModelSettingsRead: codexModelSettingsReadContract,
  codexModelSettingsWrite: codexModelSettingsWriteContract,
  codexThreadList: codexThreadListContract,
  dappProviderRequest: dappProviderRequestContract,
  runtimeInfoRead: runtimeInfoReadContract,
  settingsAppearanceFontsList: settingsAppearanceFontsListContract,
  settingsAppearanceRead: settingsAppearanceReadContract,
  settingsAppearanceWrite: settingsAppearanceWriteContract,
} as const

export type CypheriaPreloadApi = {
  readonly bootstrap: {
    readonly appearance: AppearanceSettingsWrite
  }
  readonly app: {
    readonly platform: NodeJS.Platform
    readonly getHealth: () => Promise<AppHealthStatus>
    readonly getMetadata: () => Promise<AppMetadata>
  }
  readonly codex: {
    readonly cancelLogin: (loginId: string) => Promise<{ cancelled: boolean }>
    readonly getAccount: () => Promise<CodexAccountView>
    readonly getModelSettings: () => Promise<CodexModelSettings>
    readonly interruptChat: (requestId: string) => Promise<{ interrupted: boolean }>
    readonly listModels: (includeHidden?: boolean) => Promise<CodexModelView[]>
    readonly listThreads: (options?: {
      archived?: boolean
      searchTerm?: string
    }) => Promise<CodexThreadView[]>
    readonly login: (request: CodexLoginRequest) => Promise<CodexLoginResult>
    readonly logout: () => Promise<{ loggedOut: boolean }>
    readonly onChatEvent: (handler: (event: CodexChatEvent) => void) => () => void
    readonly onEvent: (handler: (event: CodexEventEnvelope) => void) => () => void
    readonly setModelSettings: (settings: CodexModelSettings) => Promise<CodexModelSettings>
    readonly startChat: (request: CodexChatStart) => Promise<CodexChatStartResult>
  }
  readonly browser: {
    readonly openDapp: (url: string) => Promise<BrowserSessionOpenResult>
  }
  readonly automation: {
    readonly createTask: (
      input: z.input<typeof createAutomationTaskInputSchema>
    ) => Promise<z.output<typeof automationTaskSchema>>
    readonly getRun: (
      runId: string
    ) => Promise<z.output<typeof automationTaskRunSchema> | undefined>
    readonly getTask: (taskId: string) => Promise<AutomationTaskView | undefined>
    readonly listRuns: (taskId?: string) => Promise<z.output<typeof automationTaskRunSchema>[]>
    readonly listTasks: (
      status?: z.output<typeof automationTaskStatusSchema>
    ) => Promise<z.output<typeof automationTaskSchema>[]>
    readonly pauseTask: (
      taskId: string,
      expectedRevision?: number
    ) => Promise<z.output<typeof automationTaskSchema>>
    readonly resumeTask: (
      taskId: string,
      expectedRevision?: number
    ) => Promise<z.output<typeof automationTaskSchema>>
    readonly runTask: (taskId: string) => Promise<z.output<typeof automationTaskRunSchema>>
  }
  readonly runtime: {
    readonly getInfo: () => Promise<RuntimeInfo>
  }
  readonly settings: {
    readonly getAppearance: () => Promise<AppearanceSettings>
    readonly listAppearanceFonts: () => Promise<AppearanceFontOption[]>
    readonly setAppearance: (settings: AppearanceSettingsWrite) => Promise<AppearanceSettings>
  }
}
