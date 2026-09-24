// GENERATED CODE! DO NOT MODIFY BY HAND!
// biome-ignore-all format: Keep the generated ACP registry compact and reviewable.
// Run `pnpm --filter @cypheria/protocol generate:agent-acp-messages` after updating the ACP SDK.

import * as acpV1Zod from "@agentclientprotocol/sdk/zod"
import * as acpV2Zod from "@agentclientprotocol/sdk/experimental/v2/zod"
import type { z } from "zod"
import { acpNotificationSchema, acpRequestSchema, acpResponseSchema } from "../../agent/acp-schema-registry.ts"

type SchemaOutput<Schemas extends Readonly<Record<string, z.ZodType>>> = z.output<Schemas[keyof Schemas]>

const schemasByMethod = <
  Definitions extends Readonly<Record<string, Record<Key, z.ZodType>>>,
  Key extends string,
>(definitions: Definitions, key: Key): { readonly [Method in keyof Definitions]: Definitions[Method][Key] } =>
  Object.fromEntries(Object.entries(definitions).map(([method, definition]) => [method, definition[key]])) as {
    readonly [Method in keyof Definitions]: Definitions[Method][Key]
  }

export const AGENT_ACP_V1_CLIENT_RPC = {
  "initialize": { request: "agent.acp.initialize.request", response: "agent.acp.initialize.response", requestSchema: acpRequestSchema(1, "agent.acp.initialize.request", acpV1Zod.zInitializeRequest), responseSchema: acpResponseSchema(1, "agent.acp.initialize.response", acpV1Zod.zInitializeResponse, false) },
  "session/new": { request: "agent.acp.session.new.request", response: "agent.acp.session.new.response", requestSchema: acpRequestSchema(1, "agent.acp.session.new.request", acpV1Zod.zNewSessionRequest), responseSchema: acpResponseSchema(1, "agent.acp.session.new.response", acpV1Zod.zNewSessionResponse, false) },
  "session/load": { request: "agent.acp.session.load.request", response: "agent.acp.session.load.response", requestSchema: acpRequestSchema(1, "agent.acp.session.load.request", acpV1Zod.zLoadSessionRequest), responseSchema: acpResponseSchema(1, "agent.acp.session.load.response", acpV1Zod.zLoadSessionResponse, true) },
  "session/fork": { request: "agent.acp.session.fork.request", response: "agent.acp.session.fork.response", requestSchema: acpRequestSchema(1, "agent.acp.session.fork.request", acpV1Zod.zForkSessionRequest), responseSchema: acpResponseSchema(1, "agent.acp.session.fork.response", acpV1Zod.zForkSessionResponse, false) },
  "session/list": { request: "agent.acp.session.list.request", response: "agent.acp.session.list.response", requestSchema: acpRequestSchema(1, "agent.acp.session.list.request", acpV1Zod.zListSessionsRequest), responseSchema: acpResponseSchema(1, "agent.acp.session.list.response", acpV1Zod.zListSessionsResponse, false) },
  "session/delete": { request: "agent.acp.session.delete.request", response: "agent.acp.session.delete.response", requestSchema: acpRequestSchema(1, "agent.acp.session.delete.request", acpV1Zod.zDeleteSessionRequest), responseSchema: acpResponseSchema(1, "agent.acp.session.delete.response", acpV1Zod.zDeleteSessionResponse, true) },
  "session/resume": { request: "agent.acp.session.resume.request", response: "agent.acp.session.resume.response", requestSchema: acpRequestSchema(1, "agent.acp.session.resume.request", acpV1Zod.zResumeSessionRequest), responseSchema: acpResponseSchema(1, "agent.acp.session.resume.response", acpV1Zod.zResumeSessionResponse, false) },
  "session/close": { request: "agent.acp.session.close.request", response: "agent.acp.session.close.response", requestSchema: acpRequestSchema(1, "agent.acp.session.close.request", acpV1Zod.zCloseSessionRequest), responseSchema: acpResponseSchema(1, "agent.acp.session.close.response", acpV1Zod.zCloseSessionResponse, true) },
  "session/set_mode": { request: "agent.acp.session.set_mode.request", response: "agent.acp.session.set_mode.response", requestSchema: acpRequestSchema(1, "agent.acp.session.set_mode.request", acpV1Zod.zSetSessionModeRequest), responseSchema: acpResponseSchema(1, "agent.acp.session.set_mode.response", acpV1Zod.zSetSessionModeResponse, true) },
  "session/set_config_option": { request: "agent.acp.session.set_config_option.request", response: "agent.acp.session.set_config_option.response", requestSchema: acpRequestSchema(1, "agent.acp.session.set_config_option.request", acpV1Zod.zSetSessionConfigOptionRequest), responseSchema: acpResponseSchema(1, "agent.acp.session.set_config_option.response", acpV1Zod.zSetSessionConfigOptionResponse, false) },
  "authenticate": { request: "agent.acp.authenticate.request", response: "agent.acp.authenticate.response", requestSchema: acpRequestSchema(1, "agent.acp.authenticate.request", acpV1Zod.zAuthenticateRequest), responseSchema: acpResponseSchema(1, "agent.acp.authenticate.response", acpV1Zod.zAuthenticateResponse, true) },
  "providers/list": { request: "agent.acp.providers.list.request", response: "agent.acp.providers.list.response", requestSchema: acpRequestSchema(1, "agent.acp.providers.list.request", acpV1Zod.zListProvidersRequest), responseSchema: acpResponseSchema(1, "agent.acp.providers.list.response", acpV1Zod.zListProvidersResponse, false) },
  "providers/set": { request: "agent.acp.providers.set.request", response: "agent.acp.providers.set.response", requestSchema: acpRequestSchema(1, "agent.acp.providers.set.request", acpV1Zod.zSetProviderRequest), responseSchema: acpResponseSchema(1, "agent.acp.providers.set.response", acpV1Zod.zSetProviderResponse, true) },
  "providers/disable": { request: "agent.acp.providers.disable.request", response: "agent.acp.providers.disable.response", requestSchema: acpRequestSchema(1, "agent.acp.providers.disable.request", acpV1Zod.zDisableProviderRequest), responseSchema: acpResponseSchema(1, "agent.acp.providers.disable.response", acpV1Zod.zDisableProviderResponse, true) },
  "logout": { request: "agent.acp.logout.request", response: "agent.acp.logout.response", requestSchema: acpRequestSchema(1, "agent.acp.logout.request", acpV1Zod.zLogoutRequest), responseSchema: acpResponseSchema(1, "agent.acp.logout.response", acpV1Zod.zLogoutResponse, true) },
  "session/prompt": { request: "agent.acp.session.prompt.request", response: "agent.acp.session.prompt.response", requestSchema: acpRequestSchema(1, "agent.acp.session.prompt.request", acpV1Zod.zPromptRequest), responseSchema: acpResponseSchema(1, "agent.acp.session.prompt.response", acpV1Zod.zPromptResponse, false) },
  "nes/start": { request: "agent.acp.nes.start.request", response: "agent.acp.nes.start.response", requestSchema: acpRequestSchema(1, "agent.acp.nes.start.request", acpV1Zod.zStartNesRequest), responseSchema: acpResponseSchema(1, "agent.acp.nes.start.response", acpV1Zod.zStartNesResponse, false) },
  "nes/suggest": { request: "agent.acp.nes.suggest.request", response: "agent.acp.nes.suggest.response", requestSchema: acpRequestSchema(1, "agent.acp.nes.suggest.request", acpV1Zod.zSuggestNesRequest), responseSchema: acpResponseSchema(1, "agent.acp.nes.suggest.response", acpV1Zod.zSuggestNesResponse, false) },
  "nes/close": { request: "agent.acp.nes.close.request", response: "agent.acp.nes.close.response", requestSchema: acpRequestSchema(1, "agent.acp.nes.close.request", acpV1Zod.zCloseNesRequest), responseSchema: acpResponseSchema(1, "agent.acp.nes.close.response", acpV1Zod.zCloseNesResponse, true) },
} as const
export const AGENT_ACP_V1_SERVER_RPC = {
  "session/request_permission": { request: "agent.acp.session.request_permission.request", response: "agent.acp.session.request_permission.response", requestSchema: acpRequestSchema(1, "agent.acp.session.request_permission.request", acpV1Zod.zRequestPermissionRequest), responseSchema: acpResponseSchema(1, "agent.acp.session.request_permission.response", acpV1Zod.zRequestPermissionResponse, false) },
  "fs/write_text_file": { request: "agent.acp.fs.write_text_file.request", response: "agent.acp.fs.write_text_file.response", requestSchema: acpRequestSchema(1, "agent.acp.fs.write_text_file.request", acpV1Zod.zWriteTextFileRequest), responseSchema: acpResponseSchema(1, "agent.acp.fs.write_text_file.response", acpV1Zod.zWriteTextFileResponse, true) },
  "fs/read_text_file": { request: "agent.acp.fs.read_text_file.request", response: "agent.acp.fs.read_text_file.response", requestSchema: acpRequestSchema(1, "agent.acp.fs.read_text_file.request", acpV1Zod.zReadTextFileRequest), responseSchema: acpResponseSchema(1, "agent.acp.fs.read_text_file.response", acpV1Zod.zReadTextFileResponse, false) },
  "terminal/create": { request: "agent.acp.terminal.create.request", response: "agent.acp.terminal.create.response", requestSchema: acpRequestSchema(1, "agent.acp.terminal.create.request", acpV1Zod.zCreateTerminalRequest), responseSchema: acpResponseSchema(1, "agent.acp.terminal.create.response", acpV1Zod.zCreateTerminalResponse, false) },
  "terminal/output": { request: "agent.acp.terminal.output.request", response: "agent.acp.terminal.output.response", requestSchema: acpRequestSchema(1, "agent.acp.terminal.output.request", acpV1Zod.zTerminalOutputRequest), responseSchema: acpResponseSchema(1, "agent.acp.terminal.output.response", acpV1Zod.zTerminalOutputResponse, false) },
  "terminal/release": { request: "agent.acp.terminal.release.request", response: "agent.acp.terminal.release.response", requestSchema: acpRequestSchema(1, "agent.acp.terminal.release.request", acpV1Zod.zReleaseTerminalRequest), responseSchema: acpResponseSchema(1, "agent.acp.terminal.release.response", acpV1Zod.zReleaseTerminalResponse, true) },
  "terminal/wait_for_exit": { request: "agent.acp.terminal.wait_for_exit.request", response: "agent.acp.terminal.wait_for_exit.response", requestSchema: acpRequestSchema(1, "agent.acp.terminal.wait_for_exit.request", acpV1Zod.zWaitForTerminalExitRequest), responseSchema: acpResponseSchema(1, "agent.acp.terminal.wait_for_exit.response", acpV1Zod.zWaitForTerminalExitResponse, false) },
  "terminal/kill": { request: "agent.acp.terminal.kill.request", response: "agent.acp.terminal.kill.response", requestSchema: acpRequestSchema(1, "agent.acp.terminal.kill.request", acpV1Zod.zKillTerminalRequest), responseSchema: acpResponseSchema(1, "agent.acp.terminal.kill.response", acpV1Zod.zKillTerminalResponse, true) },
  "elicitation/create": { request: "agent.acp.elicitation.create.request", response: "agent.acp.elicitation.create.response", requestSchema: acpRequestSchema(1, "agent.acp.elicitation.create.request", acpV1Zod.zCreateElicitationRequest), responseSchema: acpResponseSchema(1, "agent.acp.elicitation.create.response", acpV1Zod.zCreateElicitationResponse, false) },
} as const
export const AGENT_ACP_V1_CLIENT_NOTIFICATIONS = {
  "session/cancel": { notification: "agent.acp.session.cancel.notification", schema: acpNotificationSchema(1, "agent.acp.session.cancel.notification", acpV1Zod.zCancelNotification) },
  "document/didOpen": { notification: "agent.acp.document.did_open.notification", schema: acpNotificationSchema(1, "agent.acp.document.did_open.notification", acpV1Zod.zDidOpenDocumentNotification) },
  "document/didChange": { notification: "agent.acp.document.did_change.notification", schema: acpNotificationSchema(1, "agent.acp.document.did_change.notification", acpV1Zod.zDidChangeDocumentNotification) },
  "document/didClose": { notification: "agent.acp.document.did_close.notification", schema: acpNotificationSchema(1, "agent.acp.document.did_close.notification", acpV1Zod.zDidCloseDocumentNotification) },
  "document/didSave": { notification: "agent.acp.document.did_save.notification", schema: acpNotificationSchema(1, "agent.acp.document.did_save.notification", acpV1Zod.zDidSaveDocumentNotification) },
  "document/didFocus": { notification: "agent.acp.document.did_focus.notification", schema: acpNotificationSchema(1, "agent.acp.document.did_focus.notification", acpV1Zod.zDidFocusDocumentNotification) },
  "nes/accept": { notification: "agent.acp.nes.accept.notification", schema: acpNotificationSchema(1, "agent.acp.nes.accept.notification", acpV1Zod.zAcceptNesNotification) },
  "nes/reject": { notification: "agent.acp.nes.reject.notification", schema: acpNotificationSchema(1, "agent.acp.nes.reject.notification", acpV1Zod.zRejectNesNotification) },
} as const
export const AGENT_ACP_V1_SERVER_NOTIFICATIONS = {
  "session/update": { notification: "agent.acp.session.update.notification", schema: acpNotificationSchema(1, "agent.acp.session.update.notification", acpV1Zod.zSessionNotification) },
  "elicitation/complete": { notification: "agent.acp.elicitation.complete.notification", schema: acpNotificationSchema(1, "agent.acp.elicitation.complete.notification", acpV1Zod.zCompleteElicitationNotification) },
} as const

export const AGENT_ACP_V1_CLIENT_REQUEST_SCHEMAS = schemasByMethod(AGENT_ACP_V1_CLIENT_RPC, "requestSchema")
export const AGENT_ACP_V1_SERVER_RESPONSE_SCHEMAS = schemasByMethod(AGENT_ACP_V1_CLIENT_RPC, "responseSchema")
export const AGENT_ACP_V1_SERVER_REQUEST_SCHEMAS = schemasByMethod(AGENT_ACP_V1_SERVER_RPC, "requestSchema")
export const AGENT_ACP_V1_CLIENT_RESPONSE_SCHEMAS = schemasByMethod(AGENT_ACP_V1_SERVER_RPC, "responseSchema")
export const AGENT_ACP_V1_CLIENT_NOTIFICATION_SCHEMAS = schemasByMethod(AGENT_ACP_V1_CLIENT_NOTIFICATIONS, "schema")
export const AGENT_ACP_V1_SERVER_NOTIFICATION_SCHEMAS = schemasByMethod(AGENT_ACP_V1_SERVER_NOTIFICATIONS, "schema")

export type AgentAcpV1ClientRequest = SchemaOutput<typeof AGENT_ACP_V1_CLIENT_REQUEST_SCHEMAS>
export type AgentAcpV1ServerResponse = SchemaOutput<typeof AGENT_ACP_V1_SERVER_RESPONSE_SCHEMAS>
export type AgentAcpV1ServerRequest = SchemaOutput<typeof AGENT_ACP_V1_SERVER_REQUEST_SCHEMAS>
export type AgentAcpV1ClientResponse = SchemaOutput<typeof AGENT_ACP_V1_CLIENT_RESPONSE_SCHEMAS>
export type AgentAcpV1ClientNotification = SchemaOutput<typeof AGENT_ACP_V1_CLIENT_NOTIFICATION_SCHEMAS>
export type AgentAcpV1ServerNotification = SchemaOutput<typeof AGENT_ACP_V1_SERVER_NOTIFICATION_SCHEMAS>

export const AGENT_ACP_V2_CLIENT_RPC = {
  "initialize": { request: "agent.acp.initialize.request", response: "agent.acp.initialize.response", requestSchema: acpRequestSchema(2, "agent.acp.initialize.request", acpV2Zod.zInitializeRequest), responseSchema: acpResponseSchema(2, "agent.acp.initialize.response", acpV2Zod.zInitializeResponse, false) },
  "auth/login": { request: "agent.acp.auth.login.request", response: "agent.acp.auth.login.response", requestSchema: acpRequestSchema(2, "agent.acp.auth.login.request", acpV2Zod.zLoginAuthRequest), responseSchema: acpResponseSchema(2, "agent.acp.auth.login.response", acpV2Zod.zLoginAuthResponse, true) },
  "providers/list": { request: "agent.acp.providers.list.request", response: "agent.acp.providers.list.response", requestSchema: acpRequestSchema(2, "agent.acp.providers.list.request", acpV2Zod.zListProvidersRequest), responseSchema: acpResponseSchema(2, "agent.acp.providers.list.response", acpV2Zod.zListProvidersResponse, false) },
  "providers/set": { request: "agent.acp.providers.set.request", response: "agent.acp.providers.set.response", requestSchema: acpRequestSchema(2, "agent.acp.providers.set.request", acpV2Zod.zSetProviderRequest), responseSchema: acpResponseSchema(2, "agent.acp.providers.set.response", acpV2Zod.zSetProviderResponse, true) },
  "providers/disable": { request: "agent.acp.providers.disable.request", response: "agent.acp.providers.disable.response", requestSchema: acpRequestSchema(2, "agent.acp.providers.disable.request", acpV2Zod.zDisableProviderRequest), responseSchema: acpResponseSchema(2, "agent.acp.providers.disable.response", acpV2Zod.zDisableProviderResponse, true) },
  "session/new": { request: "agent.acp.session.new.request", response: "agent.acp.session.new.response", requestSchema: acpRequestSchema(2, "agent.acp.session.new.request", acpV2Zod.zNewSessionRequest), responseSchema: acpResponseSchema(2, "agent.acp.session.new.response", acpV2Zod.zNewSessionResponse, false) },
  "session/set_config_option": { request: "agent.acp.session.set_config_option.request", response: "agent.acp.session.set_config_option.response", requestSchema: acpRequestSchema(2, "agent.acp.session.set_config_option.request", acpV2Zod.zSetSessionConfigOptionRequest), responseSchema: acpResponseSchema(2, "agent.acp.session.set_config_option.response", acpV2Zod.zSetSessionConfigOptionResponse, false) },
  "session/prompt": { request: "agent.acp.session.prompt.request", response: "agent.acp.session.prompt.response", requestSchema: acpRequestSchema(2, "agent.acp.session.prompt.request", acpV2Zod.zPromptRequest), responseSchema: acpResponseSchema(2, "agent.acp.session.prompt.response", acpV2Zod.zPromptResponse, false) },
  "mcp/message": { request: "agent.acp.mcp.message.request", response: "agent.acp.mcp.message.response", requestSchema: acpRequestSchema(2, "agent.acp.mcp.message.request", acpV2Zod.zMessageMcpRequest), responseSchema: acpResponseSchema(2, "agent.acp.mcp.message.response", acpV2Zod.zMessageMcpResponse, false) },
  "session/list": { request: "agent.acp.session.list.request", response: "agent.acp.session.list.response", requestSchema: acpRequestSchema(2, "agent.acp.session.list.request", acpV2Zod.zListSessionsRequest), responseSchema: acpResponseSchema(2, "agent.acp.session.list.response", acpV2Zod.zListSessionsResponse, false) },
  "session/delete": { request: "agent.acp.session.delete.request", response: "agent.acp.session.delete.response", requestSchema: acpRequestSchema(2, "agent.acp.session.delete.request", acpV2Zod.zDeleteSessionRequest), responseSchema: acpResponseSchema(2, "agent.acp.session.delete.response", acpV2Zod.zDeleteSessionResponse, true) },
  "session/fork": { request: "agent.acp.session.fork.request", response: "agent.acp.session.fork.response", requestSchema: acpRequestSchema(2, "agent.acp.session.fork.request", acpV2Zod.zForkSessionRequest), responseSchema: acpResponseSchema(2, "agent.acp.session.fork.response", acpV2Zod.zForkSessionResponse, false) },
  "session/resume": { request: "agent.acp.session.resume.request", response: "agent.acp.session.resume.response", requestSchema: acpRequestSchema(2, "agent.acp.session.resume.request", acpV2Zod.zResumeSessionRequest), responseSchema: acpResponseSchema(2, "agent.acp.session.resume.response", acpV2Zod.zResumeSessionResponse, false) },
  "session/close": { request: "agent.acp.session.close.request", response: "agent.acp.session.close.response", requestSchema: acpRequestSchema(2, "agent.acp.session.close.request", acpV2Zod.zCloseSessionRequest), responseSchema: acpResponseSchema(2, "agent.acp.session.close.response", acpV2Zod.zCloseSessionResponse, true) },
  "auth/logout": { request: "agent.acp.auth.logout.request", response: "agent.acp.auth.logout.response", requestSchema: acpRequestSchema(2, "agent.acp.auth.logout.request", acpV2Zod.zLogoutAuthRequest), responseSchema: acpResponseSchema(2, "agent.acp.auth.logout.response", acpV2Zod.zLogoutAuthResponse, true) },
  "nes/start": { request: "agent.acp.nes.start.request", response: "agent.acp.nes.start.response", requestSchema: acpRequestSchema(2, "agent.acp.nes.start.request", acpV2Zod.zStartNesRequest), responseSchema: acpResponseSchema(2, "agent.acp.nes.start.response", acpV2Zod.zStartNesResponse, false) },
  "nes/suggest": { request: "agent.acp.nes.suggest.request", response: "agent.acp.nes.suggest.response", requestSchema: acpRequestSchema(2, "agent.acp.nes.suggest.request", acpV2Zod.zSuggestNesRequest), responseSchema: acpResponseSchema(2, "agent.acp.nes.suggest.response", acpV2Zod.zSuggestNesResponse, false) },
  "nes/close": { request: "agent.acp.nes.close.request", response: "agent.acp.nes.close.response", requestSchema: acpRequestSchema(2, "agent.acp.nes.close.request", acpV2Zod.zCloseNesRequest), responseSchema: acpResponseSchema(2, "agent.acp.nes.close.response", acpV2Zod.zCloseNesResponse, true) },
} as const
export const AGENT_ACP_V2_SERVER_RPC = {
  "session/request_permission": { request: "agent.acp.session.request_permission.request", response: "agent.acp.session.request_permission.response", requestSchema: acpRequestSchema(2, "agent.acp.session.request_permission.request", acpV2Zod.zRequestPermissionRequest), responseSchema: acpResponseSchema(2, "agent.acp.session.request_permission.response", acpV2Zod.zRequestPermissionResponse, false) },
  "mcp/connect": { request: "agent.acp.mcp.connect.request", response: "agent.acp.mcp.connect.response", requestSchema: acpRequestSchema(2, "agent.acp.mcp.connect.request", acpV2Zod.zConnectMcpRequest), responseSchema: acpResponseSchema(2, "agent.acp.mcp.connect.response", acpV2Zod.zConnectMcpResponse, false) },
  "mcp/message": { request: "agent.acp.mcp.message.request", response: "agent.acp.mcp.message.response", requestSchema: acpRequestSchema(2, "agent.acp.mcp.message.request", acpV2Zod.zMessageMcpRequest), responseSchema: acpResponseSchema(2, "agent.acp.mcp.message.response", acpV2Zod.zMessageMcpResponse, false) },
  "mcp/disconnect": { request: "agent.acp.mcp.disconnect.request", response: "agent.acp.mcp.disconnect.response", requestSchema: acpRequestSchema(2, "agent.acp.mcp.disconnect.request", acpV2Zod.zDisconnectMcpRequest), responseSchema: acpResponseSchema(2, "agent.acp.mcp.disconnect.response", acpV2Zod.zDisconnectMcpResponse, true) },
  "elicitation/create": { request: "agent.acp.elicitation.create.request", response: "agent.acp.elicitation.create.response", requestSchema: acpRequestSchema(2, "agent.acp.elicitation.create.request", acpV2Zod.zCreateElicitationRequest), responseSchema: acpResponseSchema(2, "agent.acp.elicitation.create.response", acpV2Zod.zCreateElicitationResponse, false) },
} as const
export const AGENT_ACP_V2_CLIENT_NOTIFICATIONS = {
  "session/cancel": { notification: "agent.acp.session.cancel.notification", schema: acpNotificationSchema(2, "agent.acp.session.cancel.notification", acpV2Zod.zCancelSessionNotification) },
  "mcp/message": { notification: "agent.acp.mcp.message.notification", schema: acpNotificationSchema(2, "agent.acp.mcp.message.notification", acpV2Zod.zMessageMcpNotification) },
  "document/didOpen": { notification: "agent.acp.document.did_open.notification", schema: acpNotificationSchema(2, "agent.acp.document.did_open.notification", acpV2Zod.zDidOpenDocumentNotification) },
  "document/didChange": { notification: "agent.acp.document.did_change.notification", schema: acpNotificationSchema(2, "agent.acp.document.did_change.notification", acpV2Zod.zDidChangeDocumentNotification) },
  "document/didClose": { notification: "agent.acp.document.did_close.notification", schema: acpNotificationSchema(2, "agent.acp.document.did_close.notification", acpV2Zod.zDidCloseDocumentNotification) },
  "document/didSave": { notification: "agent.acp.document.did_save.notification", schema: acpNotificationSchema(2, "agent.acp.document.did_save.notification", acpV2Zod.zDidSaveDocumentNotification) },
  "document/didFocus": { notification: "agent.acp.document.did_focus.notification", schema: acpNotificationSchema(2, "agent.acp.document.did_focus.notification", acpV2Zod.zDidFocusDocumentNotification) },
  "nes/accept": { notification: "agent.acp.nes.accept.notification", schema: acpNotificationSchema(2, "agent.acp.nes.accept.notification", acpV2Zod.zAcceptNesNotification) },
  "nes/reject": { notification: "agent.acp.nes.reject.notification", schema: acpNotificationSchema(2, "agent.acp.nes.reject.notification", acpV2Zod.zRejectNesNotification) },
} as const
export const AGENT_ACP_V2_SERVER_NOTIFICATIONS = {
  "session/update": { notification: "agent.acp.session.update.notification", schema: acpNotificationSchema(2, "agent.acp.session.update.notification", acpV2Zod.zUpdateSessionNotification) },
  "mcp/message": { notification: "agent.acp.mcp.message.notification", schema: acpNotificationSchema(2, "agent.acp.mcp.message.notification", acpV2Zod.zMessageMcpNotification) },
  "elicitation/complete": { notification: "agent.acp.elicitation.complete.notification", schema: acpNotificationSchema(2, "agent.acp.elicitation.complete.notification", acpV2Zod.zCompleteElicitationNotification) },
} as const

export const AGENT_ACP_V2_CLIENT_REQUEST_SCHEMAS = schemasByMethod(AGENT_ACP_V2_CLIENT_RPC, "requestSchema")
export const AGENT_ACP_V2_SERVER_RESPONSE_SCHEMAS = schemasByMethod(AGENT_ACP_V2_CLIENT_RPC, "responseSchema")
export const AGENT_ACP_V2_SERVER_REQUEST_SCHEMAS = schemasByMethod(AGENT_ACP_V2_SERVER_RPC, "requestSchema")
export const AGENT_ACP_V2_CLIENT_RESPONSE_SCHEMAS = schemasByMethod(AGENT_ACP_V2_SERVER_RPC, "responseSchema")
export const AGENT_ACP_V2_CLIENT_NOTIFICATION_SCHEMAS = schemasByMethod(AGENT_ACP_V2_CLIENT_NOTIFICATIONS, "schema")
export const AGENT_ACP_V2_SERVER_NOTIFICATION_SCHEMAS = schemasByMethod(AGENT_ACP_V2_SERVER_NOTIFICATIONS, "schema")

export type AgentAcpV2ClientRequest = SchemaOutput<typeof AGENT_ACP_V2_CLIENT_REQUEST_SCHEMAS>
export type AgentAcpV2ServerResponse = SchemaOutput<typeof AGENT_ACP_V2_SERVER_RESPONSE_SCHEMAS>
export type AgentAcpV2ServerRequest = SchemaOutput<typeof AGENT_ACP_V2_SERVER_REQUEST_SCHEMAS>
export type AgentAcpV2ClientResponse = SchemaOutput<typeof AGENT_ACP_V2_CLIENT_RESPONSE_SCHEMAS>
export type AgentAcpV2ClientNotification = SchemaOutput<typeof AGENT_ACP_V2_CLIENT_NOTIFICATION_SCHEMAS>
export type AgentAcpV2ServerNotification = SchemaOutput<typeof AGENT_ACP_V2_SERVER_NOTIFICATION_SCHEMAS>
