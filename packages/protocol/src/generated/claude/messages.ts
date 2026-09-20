// GENERATED CODE! DO NOT MODIFY BY HAND!
// biome-ignore-all format: Keep the generated Claude Agent SDK registry reviewable.
// Run `pnpm --filter @cypheria/protocol generate:agent-claude-code-messages` after updating the SDK.

import type { SDKAPIRetryMessage, SDKAssistantMessage, SDKAuthStatusMessage, SDKBackgroundTasksChangedMessage, SDKCommandsChangedMessage, SDKCompactBoundaryMessage, SDKControlRequestProgressMessage, SDKConversationResetMessage, SDKElicitationCompleteMessage, SDKFilesPersistedEvent, SDKHookProgressMessage, SDKHookResponseMessage, SDKHookStartedMessage, SDKInformationalMessage, SDKLocalCommandOutputMessage, SDKMemoryRecallMessage, SDKMirrorErrorMessage, SDKModelRefusalFallbackMessage, SDKModelRefusalNoFallbackMessage, SDKNotificationMessage, SDKPartialAssistantMessage, SDKPermissionDeniedMessage, SDKPluginInstallMessage, SDKPromptSuggestionMessage, SDKRateLimitEvent, SDKResultError, SDKResultSuccess, SDKSessionStateChangedMessage, SDKStatusMessage, SDKSystemMessage, SDKTaskNotificationMessage, SDKTaskProgressMessage, SDKTaskStartedMessage, SDKTaskUpdatedMessage, SDKThinkingTokensMessage, SDKToolProgressMessage, SDKToolUseSummaryMessage, SDKUserMessage, SDKUserMessageReplay, SDKWorkerShuttingDownMessage } from "@anthropic-ai/claude-agent-sdk"
import type { z } from "zod"
import { claudeDiscriminatedUnion, claudeSdkMessageNotificationSchema } from "../../agent/claude-schema-registry.ts"

export const CLAUDE_AGENT_SDK_VERSION = "0.3.278" as const
export const CLAUDE_AGENT_SDK_OPTION_KEYS = ["abortController", "additionalDirectories", "agent", "agentProgressSummaries", "agents", "allowDangerouslySkipPermissions", "allowedTools", "betas", "canUseTool", "continue", "cwd", "debug", "debugFile", "disallowedTools", "effort", "enableFileCheckpointing", "env", "executable", "executableArgs", "extraArgs", "fallbackModel", "forkSession", "forwardSubagentText", "hooks", "includeHookEvents", "includePartialMessages", "loadTimeoutMs", "managedSettings", "maxBudgetUsd", "maxThinkingTokens", "maxTurns", "mcpServers", "model", "onElicitation", "onUserDialog", "outputFormat", "pathToClaudeCodeExecutable", "perTaskStopAffordance", "permissionMode", "permissionPromptToolName", "permissionPrompts", "persistSession", "planModeInstructions", "pluginDelivery", "plugins", "projectConfigRoot", "promptSuggestions", "resume", "resumeDropsTurn", "resumeSessionAt", "sandbox", "sessionId", "sessionStore", "sessionStoreFlush", "settingSources", "settings", "skills", "spawnClaudeCodeProcess", "stderr", "strictMcpConfig", "supportedDialogKinds", "systemPrompt", "taskBudget", "thinking", "title", "toolAliases", "toolConfig", "tools"] as const
export const CLAUDE_AGENT_SDK_QUERY_METHODS = ["accountInfo", "applyFlagSettings", "backgroundTasks", "close", "getContextUsage", "initializationResult", "interrupt", "mcpServerStatus", "readFile", "reconnectMcpServer", "reinitialize", "reloadOutputStyles", "reloadPlugins", "reloadSkills", "rewindFiles", "seedReadState", "setMaxThinkingTokens", "setMcpPermissionModeOverride", "setMcpServers", "setModel", "setPermissionMode", "stopTask", "streamInput", "supportedAgents", "supportedCommands", "supportedModels", "toggleMcpServer", "updateSettings", "usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET"] as const
export const CLAUDE_AGENT_SDK_TOP_LEVEL_FUNCTIONS = ["createSdkMcpServer", "deleteSession", "filterEscalatingDefaultMode", "foldSessionSummary", "forkSession", "getSessionInfo", "getSessionMessages", "getSubagentMessages", "importSessionToStore", "listSessions", "listSubagents", "query", "renameSession", "resolveSettings", "startup", "tagSession", "tool"] as const

export const AgentClaudeAssistantNotificationSchema = claudeSdkMessageNotificationSchema<SDKAssistantMessage, "agent.claude.assistant.notification">(
  "agent.claude.assistant.notification",
  "assistant",
  [] as const,
  undefined
)
export type AgentClaudeAssistantNotification = z.infer<typeof AgentClaudeAssistantNotificationSchema>

export const AgentClaudeUserNotificationSchema = claudeSdkMessageNotificationSchema<SDKUserMessage, "agent.claude.user.notification">(
  "agent.claude.user.notification",
  "user",
  [] as const,
  "live"
)
export type AgentClaudeUserNotification = z.infer<typeof AgentClaudeUserNotificationSchema>

export const AgentClaudeUserReplayNotificationSchema = claudeSdkMessageNotificationSchema<SDKUserMessageReplay, "agent.claude.user_replay.notification">(
  "agent.claude.user_replay.notification",
  "user",
  [] as const,
  "replay"
)
export type AgentClaudeUserReplayNotification = z.infer<typeof AgentClaudeUserReplayNotificationSchema>

export const AgentClaudeResultSuccessNotificationSchema = claudeSdkMessageNotificationSchema<SDKResultSuccess, "agent.claude.result.success.notification">(
  "agent.claude.result.success.notification",
  "result",
  ["success"] as const,
  undefined
)
export type AgentClaudeResultSuccessNotification = z.infer<typeof AgentClaudeResultSuccessNotificationSchema>

export const AgentClaudeResultErrorNotificationSchema = claudeSdkMessageNotificationSchema<SDKResultError, "agent.claude.result.error.notification">(
  "agent.claude.result.error.notification",
  "result",
  ["error_during_execution", "error_max_turns", "error_max_budget_usd", "error_max_structured_output_retries"] as const,
  undefined
)
export type AgentClaudeResultErrorNotification = z.infer<typeof AgentClaudeResultErrorNotificationSchema>

export const AgentClaudeSystemInitNotificationSchema = claudeSdkMessageNotificationSchema<SDKSystemMessage, "agent.claude.system.init.notification">(
  "agent.claude.system.init.notification",
  "system",
  ["init"] as const,
  undefined
)
export type AgentClaudeSystemInitNotification = z.infer<typeof AgentClaudeSystemInitNotificationSchema>

export const AgentClaudeStreamEventNotificationSchema = claudeSdkMessageNotificationSchema<SDKPartialAssistantMessage, "agent.claude.stream_event.notification">(
  "agent.claude.stream_event.notification",
  "stream_event",
  [] as const,
  undefined
)
export type AgentClaudeStreamEventNotification = z.infer<typeof AgentClaudeStreamEventNotificationSchema>

export const AgentClaudeSystemCompactBoundaryNotificationSchema = claudeSdkMessageNotificationSchema<SDKCompactBoundaryMessage, "agent.claude.system.compact_boundary.notification">(
  "agent.claude.system.compact_boundary.notification",
  "system",
  ["compact_boundary"] as const,
  undefined
)
export type AgentClaudeSystemCompactBoundaryNotification = z.infer<typeof AgentClaudeSystemCompactBoundaryNotificationSchema>

export const AgentClaudeSystemStatusNotificationSchema = claudeSdkMessageNotificationSchema<SDKStatusMessage, "agent.claude.system.status.notification">(
  "agent.claude.system.status.notification",
  "system",
  ["status"] as const,
  undefined
)
export type AgentClaudeSystemStatusNotification = z.infer<typeof AgentClaudeSystemStatusNotificationSchema>

export const AgentClaudeSystemApiRetryNotificationSchema = claudeSdkMessageNotificationSchema<SDKAPIRetryMessage, "agent.claude.system.api_retry.notification">(
  "agent.claude.system.api_retry.notification",
  "system",
  ["api_retry"] as const,
  undefined
)
export type AgentClaudeSystemApiRetryNotification = z.infer<typeof AgentClaudeSystemApiRetryNotificationSchema>

export const AgentClaudeSystemControlRequestProgressNotificationSchema = claudeSdkMessageNotificationSchema<SDKControlRequestProgressMessage, "agent.claude.system.control_request_progress.notification">(
  "agent.claude.system.control_request_progress.notification",
  "system",
  ["control_request_progress"] as const,
  undefined
)
export type AgentClaudeSystemControlRequestProgressNotification = z.infer<typeof AgentClaudeSystemControlRequestProgressNotificationSchema>

export const AgentClaudeSystemModelRefusalFallbackNotificationSchema = claudeSdkMessageNotificationSchema<SDKModelRefusalFallbackMessage, "agent.claude.system.model_refusal_fallback.notification">(
  "agent.claude.system.model_refusal_fallback.notification",
  "system",
  ["model_refusal_fallback"] as const,
  undefined
)
export type AgentClaudeSystemModelRefusalFallbackNotification = z.infer<typeof AgentClaudeSystemModelRefusalFallbackNotificationSchema>

export const AgentClaudeSystemModelRefusalNoFallbackNotificationSchema = claudeSdkMessageNotificationSchema<SDKModelRefusalNoFallbackMessage, "agent.claude.system.model_refusal_no_fallback.notification">(
  "agent.claude.system.model_refusal_no_fallback.notification",
  "system",
  ["model_refusal_no_fallback"] as const,
  undefined
)
export type AgentClaudeSystemModelRefusalNoFallbackNotification = z.infer<typeof AgentClaudeSystemModelRefusalNoFallbackNotificationSchema>

export const AgentClaudeSystemLocalCommandOutputNotificationSchema = claudeSdkMessageNotificationSchema<SDKLocalCommandOutputMessage, "agent.claude.system.local_command_output.notification">(
  "agent.claude.system.local_command_output.notification",
  "system",
  ["local_command_output"] as const,
  undefined
)
export type AgentClaudeSystemLocalCommandOutputNotification = z.infer<typeof AgentClaudeSystemLocalCommandOutputNotificationSchema>

export const AgentClaudeSystemHookStartedNotificationSchema = claudeSdkMessageNotificationSchema<SDKHookStartedMessage, "agent.claude.system.hook_started.notification">(
  "agent.claude.system.hook_started.notification",
  "system",
  ["hook_started"] as const,
  undefined
)
export type AgentClaudeSystemHookStartedNotification = z.infer<typeof AgentClaudeSystemHookStartedNotificationSchema>

export const AgentClaudeSystemHookProgressNotificationSchema = claudeSdkMessageNotificationSchema<SDKHookProgressMessage, "agent.claude.system.hook_progress.notification">(
  "agent.claude.system.hook_progress.notification",
  "system",
  ["hook_progress"] as const,
  undefined
)
export type AgentClaudeSystemHookProgressNotification = z.infer<typeof AgentClaudeSystemHookProgressNotificationSchema>

export const AgentClaudeSystemHookResponseNotificationSchema = claudeSdkMessageNotificationSchema<SDKHookResponseMessage, "agent.claude.system.hook_response.notification">(
  "agent.claude.system.hook_response.notification",
  "system",
  ["hook_response"] as const,
  undefined
)
export type AgentClaudeSystemHookResponseNotification = z.infer<typeof AgentClaudeSystemHookResponseNotificationSchema>

export const AgentClaudeSystemPluginInstallNotificationSchema = claudeSdkMessageNotificationSchema<SDKPluginInstallMessage, "agent.claude.system.plugin_install.notification">(
  "agent.claude.system.plugin_install.notification",
  "system",
  ["plugin_install"] as const,
  undefined
)
export type AgentClaudeSystemPluginInstallNotification = z.infer<typeof AgentClaudeSystemPluginInstallNotificationSchema>

export const AgentClaudeToolProgressNotificationSchema = claudeSdkMessageNotificationSchema<SDKToolProgressMessage, "agent.claude.tool_progress.notification">(
  "agent.claude.tool_progress.notification",
  "tool_progress",
  [] as const,
  undefined
)
export type AgentClaudeToolProgressNotification = z.infer<typeof AgentClaudeToolProgressNotificationSchema>

export const AgentClaudeAuthStatusNotificationSchema = claudeSdkMessageNotificationSchema<SDKAuthStatusMessage, "agent.claude.auth_status.notification">(
  "agent.claude.auth_status.notification",
  "auth_status",
  [] as const,
  undefined
)
export type AgentClaudeAuthStatusNotification = z.infer<typeof AgentClaudeAuthStatusNotificationSchema>

export const AgentClaudeSystemTaskNotificationSchema = claudeSdkMessageNotificationSchema<SDKTaskNotificationMessage, "agent.claude.system.task_notification.notification">(
  "agent.claude.system.task_notification.notification",
  "system",
  ["task_notification"] as const,
  undefined
)
export type AgentClaudeSystemTaskNotification = z.infer<typeof AgentClaudeSystemTaskNotificationSchema>

export const AgentClaudeSystemTaskStartedNotificationSchema = claudeSdkMessageNotificationSchema<SDKTaskStartedMessage, "agent.claude.system.task_started.notification">(
  "agent.claude.system.task_started.notification",
  "system",
  ["task_started"] as const,
  undefined
)
export type AgentClaudeSystemTaskStartedNotification = z.infer<typeof AgentClaudeSystemTaskStartedNotificationSchema>

export const AgentClaudeSystemTaskUpdatedNotificationSchema = claudeSdkMessageNotificationSchema<SDKTaskUpdatedMessage, "agent.claude.system.task_updated.notification">(
  "agent.claude.system.task_updated.notification",
  "system",
  ["task_updated"] as const,
  undefined
)
export type AgentClaudeSystemTaskUpdatedNotification = z.infer<typeof AgentClaudeSystemTaskUpdatedNotificationSchema>

export const AgentClaudeSystemTaskProgressNotificationSchema = claudeSdkMessageNotificationSchema<SDKTaskProgressMessage, "agent.claude.system.task_progress.notification">(
  "agent.claude.system.task_progress.notification",
  "system",
  ["task_progress"] as const,
  undefined
)
export type AgentClaudeSystemTaskProgressNotification = z.infer<typeof AgentClaudeSystemTaskProgressNotificationSchema>

export const AgentClaudeSystemBackgroundTasksChangedNotificationSchema = claudeSdkMessageNotificationSchema<SDKBackgroundTasksChangedMessage, "agent.claude.system.background_tasks_changed.notification">(
  "agent.claude.system.background_tasks_changed.notification",
  "system",
  ["background_tasks_changed"] as const,
  undefined
)
export type AgentClaudeSystemBackgroundTasksChangedNotification = z.infer<typeof AgentClaudeSystemBackgroundTasksChangedNotificationSchema>

export const AgentClaudeSystemThinkingTokensNotificationSchema = claudeSdkMessageNotificationSchema<SDKThinkingTokensMessage, "agent.claude.system.thinking_tokens.notification">(
  "agent.claude.system.thinking_tokens.notification",
  "system",
  ["thinking_tokens"] as const,
  undefined
)
export type AgentClaudeSystemThinkingTokensNotification = z.infer<typeof AgentClaudeSystemThinkingTokensNotificationSchema>

export const AgentClaudeSystemSessionStateChangedNotificationSchema = claudeSdkMessageNotificationSchema<SDKSessionStateChangedMessage, "agent.claude.system.session_state_changed.notification">(
  "agent.claude.system.session_state_changed.notification",
  "system",
  ["session_state_changed"] as const,
  undefined
)
export type AgentClaudeSystemSessionStateChangedNotification = z.infer<typeof AgentClaudeSystemSessionStateChangedNotificationSchema>

export const AgentClaudeSystemWorkerShuttingDownNotificationSchema = claudeSdkMessageNotificationSchema<SDKWorkerShuttingDownMessage, "agent.claude.system.worker_shutting_down.notification">(
  "agent.claude.system.worker_shutting_down.notification",
  "system",
  ["worker_shutting_down"] as const,
  undefined
)
export type AgentClaudeSystemWorkerShuttingDownNotification = z.infer<typeof AgentClaudeSystemWorkerShuttingDownNotificationSchema>

export const AgentClaudeSystemCommandsChangedNotificationSchema = claudeSdkMessageNotificationSchema<SDKCommandsChangedMessage, "agent.claude.system.commands_changed.notification">(
  "agent.claude.system.commands_changed.notification",
  "system",
  ["commands_changed"] as const,
  undefined
)
export type AgentClaudeSystemCommandsChangedNotification = z.infer<typeof AgentClaudeSystemCommandsChangedNotificationSchema>

export const AgentClaudeSystemNotificationSchema = claudeSdkMessageNotificationSchema<SDKNotificationMessage, "agent.claude.system.notification.notification">(
  "agent.claude.system.notification.notification",
  "system",
  ["notification"] as const,
  undefined
)
export type AgentClaudeSystemNotification = z.infer<typeof AgentClaudeSystemNotificationSchema>

export const AgentClaudeSystemFilesPersistedNotificationSchema = claudeSdkMessageNotificationSchema<SDKFilesPersistedEvent, "agent.claude.system.files_persisted.notification">(
  "agent.claude.system.files_persisted.notification",
  "system",
  ["files_persisted"] as const,
  undefined
)
export type AgentClaudeSystemFilesPersistedNotification = z.infer<typeof AgentClaudeSystemFilesPersistedNotificationSchema>

export const AgentClaudeToolUseSummaryNotificationSchema = claudeSdkMessageNotificationSchema<SDKToolUseSummaryMessage, "agent.claude.tool_use_summary.notification">(
  "agent.claude.tool_use_summary.notification",
  "tool_use_summary",
  [] as const,
  undefined
)
export type AgentClaudeToolUseSummaryNotification = z.infer<typeof AgentClaudeToolUseSummaryNotificationSchema>

export const AgentClaudeSystemMemoryRecallNotificationSchema = claudeSdkMessageNotificationSchema<SDKMemoryRecallMessage, "agent.claude.system.memory_recall.notification">(
  "agent.claude.system.memory_recall.notification",
  "system",
  ["memory_recall"] as const,
  undefined
)
export type AgentClaudeSystemMemoryRecallNotification = z.infer<typeof AgentClaudeSystemMemoryRecallNotificationSchema>

export const AgentClaudeRateLimitEventNotificationSchema = claudeSdkMessageNotificationSchema<SDKRateLimitEvent, "agent.claude.rate_limit_event.notification">(
  "agent.claude.rate_limit_event.notification",
  "rate_limit_event",
  [] as const,
  undefined
)
export type AgentClaudeRateLimitEventNotification = z.infer<typeof AgentClaudeRateLimitEventNotificationSchema>

export const AgentClaudeSystemElicitationCompleteNotificationSchema = claudeSdkMessageNotificationSchema<SDKElicitationCompleteMessage, "agent.claude.system.elicitation_complete.notification">(
  "agent.claude.system.elicitation_complete.notification",
  "system",
  ["elicitation_complete"] as const,
  undefined
)
export type AgentClaudeSystemElicitationCompleteNotification = z.infer<typeof AgentClaudeSystemElicitationCompleteNotificationSchema>

export const AgentClaudeSystemPermissionDeniedNotificationSchema = claudeSdkMessageNotificationSchema<SDKPermissionDeniedMessage, "agent.claude.system.permission_denied.notification">(
  "agent.claude.system.permission_denied.notification",
  "system",
  ["permission_denied"] as const,
  undefined
)
export type AgentClaudeSystemPermissionDeniedNotification = z.infer<typeof AgentClaudeSystemPermissionDeniedNotificationSchema>

export const AgentClaudePromptSuggestionNotificationSchema = claudeSdkMessageNotificationSchema<SDKPromptSuggestionMessage, "agent.claude.prompt_suggestion.notification">(
  "agent.claude.prompt_suggestion.notification",
  "prompt_suggestion",
  [] as const,
  undefined
)
export type AgentClaudePromptSuggestionNotification = z.infer<typeof AgentClaudePromptSuggestionNotificationSchema>

export const AgentClaudeSystemMirrorErrorNotificationSchema = claudeSdkMessageNotificationSchema<SDKMirrorErrorMessage, "agent.claude.system.mirror_error.notification">(
  "agent.claude.system.mirror_error.notification",
  "system",
  ["mirror_error"] as const,
  undefined
)
export type AgentClaudeSystemMirrorErrorNotification = z.infer<typeof AgentClaudeSystemMirrorErrorNotificationSchema>

export const AgentClaudeSystemInformationalNotificationSchema = claudeSdkMessageNotificationSchema<SDKInformationalMessage, "agent.claude.system.informational.notification">(
  "agent.claude.system.informational.notification",
  "system",
  ["informational"] as const,
  undefined
)
export type AgentClaudeSystemInformationalNotification = z.infer<typeof AgentClaudeSystemInformationalNotificationSchema>

export const AgentClaudeConversationResetNotificationSchema = claudeSdkMessageNotificationSchema<SDKConversationResetMessage, "agent.claude.conversation_reset.notification">(
  "agent.claude.conversation_reset.notification",
  "conversation_reset",
  [] as const,
  undefined
)
export type AgentClaudeConversationResetNotification = z.infer<typeof AgentClaudeConversationResetNotificationSchema>

export const AGENT_CLAUDE_SDK_NOTIFICATIONS = {
  "SDKAssistantMessage": { notification: "agent.claude.assistant.notification", payloadSubtypes: [] as const, payloadType: "assistant", replay: undefined, schema: AgentClaudeAssistantNotificationSchema },
  "SDKUserMessage": { notification: "agent.claude.user.notification", payloadSubtypes: [] as const, payloadType: "user", replay: "live", schema: AgentClaudeUserNotificationSchema },
  "SDKUserMessageReplay": { notification: "agent.claude.user_replay.notification", payloadSubtypes: [] as const, payloadType: "user", replay: "replay", schema: AgentClaudeUserReplayNotificationSchema },
  "SDKResultSuccess": { notification: "agent.claude.result.success.notification", payloadSubtypes: ["success"] as const, payloadType: "result", replay: undefined, schema: AgentClaudeResultSuccessNotificationSchema },
  "SDKResultError": { notification: "agent.claude.result.error.notification", payloadSubtypes: ["error_during_execution", "error_max_turns", "error_max_budget_usd", "error_max_structured_output_retries"] as const, payloadType: "result", replay: undefined, schema: AgentClaudeResultErrorNotificationSchema },
  "SDKSystemMessage": { notification: "agent.claude.system.init.notification", payloadSubtypes: ["init"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemInitNotificationSchema },
  "SDKPartialAssistantMessage": { notification: "agent.claude.stream_event.notification", payloadSubtypes: [] as const, payloadType: "stream_event", replay: undefined, schema: AgentClaudeStreamEventNotificationSchema },
  "SDKCompactBoundaryMessage": { notification: "agent.claude.system.compact_boundary.notification", payloadSubtypes: ["compact_boundary"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemCompactBoundaryNotificationSchema },
  "SDKStatusMessage": { notification: "agent.claude.system.status.notification", payloadSubtypes: ["status"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemStatusNotificationSchema },
  "SDKAPIRetryMessage": { notification: "agent.claude.system.api_retry.notification", payloadSubtypes: ["api_retry"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemApiRetryNotificationSchema },
  "SDKControlRequestProgressMessage": { notification: "agent.claude.system.control_request_progress.notification", payloadSubtypes: ["control_request_progress"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemControlRequestProgressNotificationSchema },
  "SDKModelRefusalFallbackMessage": { notification: "agent.claude.system.model_refusal_fallback.notification", payloadSubtypes: ["model_refusal_fallback"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemModelRefusalFallbackNotificationSchema },
  "SDKModelRefusalNoFallbackMessage": { notification: "agent.claude.system.model_refusal_no_fallback.notification", payloadSubtypes: ["model_refusal_no_fallback"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemModelRefusalNoFallbackNotificationSchema },
  "SDKLocalCommandOutputMessage": { notification: "agent.claude.system.local_command_output.notification", payloadSubtypes: ["local_command_output"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemLocalCommandOutputNotificationSchema },
  "SDKHookStartedMessage": { notification: "agent.claude.system.hook_started.notification", payloadSubtypes: ["hook_started"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemHookStartedNotificationSchema },
  "SDKHookProgressMessage": { notification: "agent.claude.system.hook_progress.notification", payloadSubtypes: ["hook_progress"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemHookProgressNotificationSchema },
  "SDKHookResponseMessage": { notification: "agent.claude.system.hook_response.notification", payloadSubtypes: ["hook_response"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemHookResponseNotificationSchema },
  "SDKPluginInstallMessage": { notification: "agent.claude.system.plugin_install.notification", payloadSubtypes: ["plugin_install"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemPluginInstallNotificationSchema },
  "SDKToolProgressMessage": { notification: "agent.claude.tool_progress.notification", payloadSubtypes: [] as const, payloadType: "tool_progress", replay: undefined, schema: AgentClaudeToolProgressNotificationSchema },
  "SDKAuthStatusMessage": { notification: "agent.claude.auth_status.notification", payloadSubtypes: [] as const, payloadType: "auth_status", replay: undefined, schema: AgentClaudeAuthStatusNotificationSchema },
  "SDKTaskNotificationMessage": { notification: "agent.claude.system.task_notification.notification", payloadSubtypes: ["task_notification"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemTaskNotificationSchema },
  "SDKTaskStartedMessage": { notification: "agent.claude.system.task_started.notification", payloadSubtypes: ["task_started"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemTaskStartedNotificationSchema },
  "SDKTaskUpdatedMessage": { notification: "agent.claude.system.task_updated.notification", payloadSubtypes: ["task_updated"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemTaskUpdatedNotificationSchema },
  "SDKTaskProgressMessage": { notification: "agent.claude.system.task_progress.notification", payloadSubtypes: ["task_progress"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemTaskProgressNotificationSchema },
  "SDKBackgroundTasksChangedMessage": { notification: "agent.claude.system.background_tasks_changed.notification", payloadSubtypes: ["background_tasks_changed"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemBackgroundTasksChangedNotificationSchema },
  "SDKThinkingTokensMessage": { notification: "agent.claude.system.thinking_tokens.notification", payloadSubtypes: ["thinking_tokens"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemThinkingTokensNotificationSchema },
  "SDKSessionStateChangedMessage": { notification: "agent.claude.system.session_state_changed.notification", payloadSubtypes: ["session_state_changed"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemSessionStateChangedNotificationSchema },
  "SDKWorkerShuttingDownMessage": { notification: "agent.claude.system.worker_shutting_down.notification", payloadSubtypes: ["worker_shutting_down"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemWorkerShuttingDownNotificationSchema },
  "SDKCommandsChangedMessage": { notification: "agent.claude.system.commands_changed.notification", payloadSubtypes: ["commands_changed"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemCommandsChangedNotificationSchema },
  "SDKNotificationMessage": { notification: "agent.claude.system.notification.notification", payloadSubtypes: ["notification"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemNotificationSchema },
  "SDKFilesPersistedEvent": { notification: "agent.claude.system.files_persisted.notification", payloadSubtypes: ["files_persisted"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemFilesPersistedNotificationSchema },
  "SDKToolUseSummaryMessage": { notification: "agent.claude.tool_use_summary.notification", payloadSubtypes: [] as const, payloadType: "tool_use_summary", replay: undefined, schema: AgentClaudeToolUseSummaryNotificationSchema },
  "SDKMemoryRecallMessage": { notification: "agent.claude.system.memory_recall.notification", payloadSubtypes: ["memory_recall"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemMemoryRecallNotificationSchema },
  "SDKRateLimitEvent": { notification: "agent.claude.rate_limit_event.notification", payloadSubtypes: [] as const, payloadType: "rate_limit_event", replay: undefined, schema: AgentClaudeRateLimitEventNotificationSchema },
  "SDKElicitationCompleteMessage": { notification: "agent.claude.system.elicitation_complete.notification", payloadSubtypes: ["elicitation_complete"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemElicitationCompleteNotificationSchema },
  "SDKPermissionDeniedMessage": { notification: "agent.claude.system.permission_denied.notification", payloadSubtypes: ["permission_denied"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemPermissionDeniedNotificationSchema },
  "SDKPromptSuggestionMessage": { notification: "agent.claude.prompt_suggestion.notification", payloadSubtypes: [] as const, payloadType: "prompt_suggestion", replay: undefined, schema: AgentClaudePromptSuggestionNotificationSchema },
  "SDKMirrorErrorMessage": { notification: "agent.claude.system.mirror_error.notification", payloadSubtypes: ["mirror_error"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemMirrorErrorNotificationSchema },
  "SDKInformationalMessage": { notification: "agent.claude.system.informational.notification", payloadSubtypes: ["informational"] as const, payloadType: "system", replay: undefined, schema: AgentClaudeSystemInformationalNotificationSchema },
  "SDKConversationResetMessage": { notification: "agent.claude.conversation_reset.notification", payloadSubtypes: [] as const, payloadType: "conversation_reset", replay: undefined, schema: AgentClaudeConversationResetNotificationSchema },
} as const

export type AgentClaudeSdkNotification =
  | AgentClaudeAssistantNotification
  | AgentClaudeUserNotification
  | AgentClaudeUserReplayNotification
  | AgentClaudeResultSuccessNotification
  | AgentClaudeResultErrorNotification
  | AgentClaudeSystemInitNotification
  | AgentClaudeStreamEventNotification
  | AgentClaudeSystemCompactBoundaryNotification
  | AgentClaudeSystemStatusNotification
  | AgentClaudeSystemApiRetryNotification
  | AgentClaudeSystemControlRequestProgressNotification
  | AgentClaudeSystemModelRefusalFallbackNotification
  | AgentClaudeSystemModelRefusalNoFallbackNotification
  | AgentClaudeSystemLocalCommandOutputNotification
  | AgentClaudeSystemHookStartedNotification
  | AgentClaudeSystemHookProgressNotification
  | AgentClaudeSystemHookResponseNotification
  | AgentClaudeSystemPluginInstallNotification
  | AgentClaudeToolProgressNotification
  | AgentClaudeAuthStatusNotification
  | AgentClaudeSystemTaskNotification
  | AgentClaudeSystemTaskStartedNotification
  | AgentClaudeSystemTaskUpdatedNotification
  | AgentClaudeSystemTaskProgressNotification
  | AgentClaudeSystemBackgroundTasksChangedNotification
  | AgentClaudeSystemThinkingTokensNotification
  | AgentClaudeSystemSessionStateChangedNotification
  | AgentClaudeSystemWorkerShuttingDownNotification
  | AgentClaudeSystemCommandsChangedNotification
  | AgentClaudeSystemNotification
  | AgentClaudeSystemFilesPersistedNotification
  | AgentClaudeToolUseSummaryNotification
  | AgentClaudeSystemMemoryRecallNotification
  | AgentClaudeRateLimitEventNotification
  | AgentClaudeSystemElicitationCompleteNotification
  | AgentClaudeSystemPermissionDeniedNotification
  | AgentClaudePromptSuggestionNotification
  | AgentClaudeSystemMirrorErrorNotification
  | AgentClaudeSystemInformationalNotification
  | AgentClaudeConversationResetNotification

export const AgentClaudeSdkNotificationSchema = claudeDiscriminatedUnion<AgentClaudeSdkNotification>([
  AgentClaudeAssistantNotificationSchema,
  AgentClaudeUserNotificationSchema,
  AgentClaudeUserReplayNotificationSchema,
  AgentClaudeResultSuccessNotificationSchema,
  AgentClaudeResultErrorNotificationSchema,
  AgentClaudeSystemInitNotificationSchema,
  AgentClaudeStreamEventNotificationSchema,
  AgentClaudeSystemCompactBoundaryNotificationSchema,
  AgentClaudeSystemStatusNotificationSchema,
  AgentClaudeSystemApiRetryNotificationSchema,
  AgentClaudeSystemControlRequestProgressNotificationSchema,
  AgentClaudeSystemModelRefusalFallbackNotificationSchema,
  AgentClaudeSystemModelRefusalNoFallbackNotificationSchema,
  AgentClaudeSystemLocalCommandOutputNotificationSchema,
  AgentClaudeSystemHookStartedNotificationSchema,
  AgentClaudeSystemHookProgressNotificationSchema,
  AgentClaudeSystemHookResponseNotificationSchema,
  AgentClaudeSystemPluginInstallNotificationSchema,
  AgentClaudeToolProgressNotificationSchema,
  AgentClaudeAuthStatusNotificationSchema,
  AgentClaudeSystemTaskNotificationSchema,
  AgentClaudeSystemTaskStartedNotificationSchema,
  AgentClaudeSystemTaskUpdatedNotificationSchema,
  AgentClaudeSystemTaskProgressNotificationSchema,
  AgentClaudeSystemBackgroundTasksChangedNotificationSchema,
  AgentClaudeSystemThinkingTokensNotificationSchema,
  AgentClaudeSystemSessionStateChangedNotificationSchema,
  AgentClaudeSystemWorkerShuttingDownNotificationSchema,
  AgentClaudeSystemCommandsChangedNotificationSchema,
  AgentClaudeSystemNotificationSchema,
  AgentClaudeSystemFilesPersistedNotificationSchema,
  AgentClaudeToolUseSummaryNotificationSchema,
  AgentClaudeSystemMemoryRecallNotificationSchema,
  AgentClaudeRateLimitEventNotificationSchema,
  AgentClaudeSystemElicitationCompleteNotificationSchema,
  AgentClaudeSystemPermissionDeniedNotificationSchema,
  AgentClaudePromptSuggestionNotificationSchema,
  AgentClaudeSystemMirrorErrorNotificationSchema,
  AgentClaudeSystemInformationalNotificationSchema,
  AgentClaudeConversationResetNotificationSchema,
])
