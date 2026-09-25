import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { Provider as JotaiProvider } from "jotai"
import { SafeAreaProvider } from "react-native-safe-area-context"

export default function RootLayout() {
  return (
    <JotaiProvider>
      <SafeAreaProvider>
        <Stack screenOptions={{ headerShown: false }} />
        <StatusBar style="auto" />
      </SafeAreaProvider>
    </JotaiProvider>
  )
}
