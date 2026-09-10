/// <reference types="expo/types" />

declare namespace NodeJS {
  interface ProcessEnv {
    readonly EXPO_PUBLIC_CYPHERIA_SERVER_URL?: string
  }
}
