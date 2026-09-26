import type { IpcRendererEvent } from "electron"
import { contextBridge, ipcRenderer, webUtils } from "electron"
import type {
  AppearanceFontOption,
  AppHealthStatus,
  AppMetadata,
  BrowserSessionOpenResult,
  CypheriaPreloadApi,
  OpenTarget,
} from "../../ipc/src/index.js"
import {
  AppearanceSettingsWriteSchema,
  CYPHERIA_APPEARANCE_ARGUMENT_PREFIX,
  CYPHERIA_DEVELOPMENT_ARGUMENT_PREFIX,
  CYPHERIA_IPC_CHANNELS,
  CYPHERIA_LANGUAGE_ARGUMENT_PREFIX,
  CYPHERIA_WINDOW_ROLE_ARGUMENT_PREFIX,
  LanguageBootstrapSchema,
  StorageKeyValueChangeSchema,
} from "../../ipc/src/index.js"

const readBootstrapAppearance = () => {
  const argument = process.argv.find((value) =>
    value.startsWith(CYPHERIA_APPEARANCE_ARGUMENT_PREFIX)
  )
  if (!argument) {
    throw new Error("Cypheria appearance bootstrap argument is missing")
  }

  const encodedAppearance = argument.slice(CYPHERIA_APPEARANCE_ARGUMENT_PREFIX.length)
  return AppearanceSettingsWriteSchema.parse(JSON.parse(decodeURIComponent(encodedAppearance)))
}

const readBootstrapLanguage = () => {
  const argument = process.argv.find((value) => value.startsWith(CYPHERIA_LANGUAGE_ARGUMENT_PREFIX))
  if (!argument) {
    throw new Error("Cypheria language bootstrap argument is missing")
  }

  const encodedLanguage = argument.slice(CYPHERIA_LANGUAGE_ARGUMENT_PREFIX.length)
  return LanguageBootstrapSchema.parse(JSON.parse(decodeURIComponent(encodedLanguage)))
}

const readBootstrapDevelopment = () =>
  process.argv.some((value) => value === `${CYPHERIA_DEVELOPMENT_ARGUMENT_PREFIX}1`)

const readWindowRole = (): "main" | "popout" =>
  process.argv.some((value) => value === `${CYPHERIA_WINDOW_ROLE_ARGUMENT_PREFIX}popout`)
    ? "popout"
    : "main"

const invoke = <T>(channel: string): Promise<T> => ipcRenderer.invoke(channel) as Promise<T>

const cypheriaApi: CypheriaPreloadApi = {
  bootstrap: {
    appearance: readBootstrapAppearance(),
    development: readBootstrapDevelopment(),
    language: readBootstrapLanguage(),
    windowRole: readWindowRole(),
  },
  app: {
    platform: process.platform,
    getHealth: () => invoke<AppHealthStatus>(CYPHERIA_IPC_CHANNELS.appHealthCheck),
    getMetadata: () => invoke<AppMetadata>(CYPHERIA_IPC_CHANNELS.appMetadataRead),
    pickDirectory: () => invoke(CYPHERIA_IPC_CHANNELS.appDirectoryPick),
    pickSoundFile: () => invoke(CYPHERIA_IPC_CHANNELS.appSoundPick),
    openExternal: (url) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.appExternalOpen, { url }),
    openConfig: () => invoke(CYPHERIA_IPC_CHANNELS.appConfigOpen),
    revealProject: (projectId) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.appProjectReveal, { projectId }),
    openProject: (projectId) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.appProjectOpen, { projectId }),
    gitFileAction: (input) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.appGitFileAction, input),
  },
  browser: {
    openDapp: (url) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.browserSessionOpen, {
        url,
      }) as Promise<BrowserSessionOpenResult>,
  },
  storage: {
    attachments: {
      getPathForFile: (file) => webUtils.getPathForFile(file),
      copyFileUri: (storageKey, uri) =>
        ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageAttachmentCopyFile, {
          storageKey,
          uri,
        }),
      delete: (storageKey) =>
        ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageAttachmentDelete, { storageKey }),
      list: () => invoke(CYPHERIA_IPC_CHANNELS.storageAttachmentList),
      listPage: (request) =>
        ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageAttachmentListPage, request),
      read: (storageKey) =>
        ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageAttachmentRead, { storageKey }),
      stat: (storageKey) =>
        ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageAttachmentStat, { storageKey }),
      write: (storageKey, bytes) =>
        ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageAttachmentWrite, {
          storageKey,
          bytes,
        }),
    },
    keyValue: {
      getItem: (key) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageKeyValueGet, { key }),
      setItem: (key, value) =>
        ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageKeyValueSet, { key, value }),
      removeItem: (key) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageKeyValueRemove, { key }),
      listPage: (request) =>
        ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageKeyValueListPage, request),
      onChanged: (handler) => {
        const listener = (_event: IpcRendererEvent, rawChange: unknown): void => {
          handler(StorageKeyValueChangeSchema.parse(rawChange))
        }
        ipcRenderer.on(CYPHERIA_IPC_CHANNELS.storageKeyValueChanged, listener)
        return () => ipcRenderer.off(CYPHERIA_IPC_CHANNELS.storageKeyValueChanged, listener)
      },
    },
    replica: {
      open: () => invoke(CYPHERIA_IPC_CHANNELS.storageReplicaOpen),
      read: (scopeId, entityTypes, entityIds) =>
        ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageReplicaRead, {
          scopeId,
          entityTypes,
          ...(entityIds ? { entityIds } : {}),
        }),
      readAll: () => invoke(CYPHERIA_IPC_CHANNELS.storageReplicaReadAll),
      listPage: (request) =>
        ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageReplicaListPage, request),
      apply: (changes) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageReplicaApply, changes),
      deleteScope: (scopeId) =>
        ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageReplicaDeleteScope, { scopeId }),
      renameScope: (oldScopeId, newScopeId) =>
        ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageReplicaRenameScope, {
          oldScopeId,
          newScopeId,
        }),
      clear: () => invoke(CYPHERIA_IPC_CHANNELS.storageReplicaClear),
    },
  },
  settings: {
    listOpenTargets: () => invoke<OpenTarget[]>(CYPHERIA_IPC_CHANNELS.settingsOpenTargetsList),
    listNotificationSounds: () =>
      invoke<string[]>(CYPHERIA_IPC_CHANNELS.settingsNotificationSoundsList),
    previewNotificationSound: () =>
      invoke<{ played: boolean }>(CYPHERIA_IPC_CHANNELS.settingsNotificationSoundPreview),
    listAppearanceFonts: () =>
      invoke<AppearanceFontOption[]>(CYPHERIA_IPC_CHANNELS.settingsAppearanceFontsList),
  },
}

contextBridge.exposeInMainWorld("cypheria", cypheriaApi)
