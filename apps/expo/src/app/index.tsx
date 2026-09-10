import { Stack } from "expo-router"
import Head from "expo-router/head"
import { StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { useServerClient } from "@/client/use-server-client"

export default function HomeScreen() {
  const server = useServerClient()
  const connected = server.state === "connected"

  return (
    <>
      <Stack.Screen options={{ title: "Cypheria" }} />
      <Head>
        <title>Cypheria</title>
        <meta content="Cypheria client for secure Web3 and agent workflows" name="description" />
      </Head>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <View style={styles.header}>
            <View style={[styles.statusDot, connected && styles.statusDotConnected]} />
            <Text style={styles.eyebrow}>CYPHERIA CLIENT</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.title}>Your Web3 workspace, everywhere.</Text>
            <Text style={styles.body}>
              This minimal Expo shell targets iOS, Android, and web through the same server
              protocol.
            </Text>
            <View style={styles.rule} />
            <Text style={styles.label}>SERVER</Text>
            <Text style={styles.value}>{server.state}</Text>
            {server.info ? (
              <Text style={styles.detail}>
                {server.info.id} · runtime {server.info.runtimeState}
              </Text>
            ) : null}
            {server.error ? <Text style={styles.error}>{server.error}</Text> : null}
          </View>
        </View>
      </SafeAreaView>
    </>
  )
}

const styles = StyleSheet.create({
  body: { color: "#59615d", fontSize: 17, lineHeight: 27, maxWidth: 560 },
  card: {
    backgroundColor: "#fff",
    borderColor: "#dedfd9",
    borderRadius: 18,
    borderWidth: 1,
    maxWidth: 720,
    padding: 32,
    width: "100%",
  },
  container: { flex: 1, gap: 24, justifyContent: "center", padding: 24 },
  detail: { color: "#7a817d", fontSize: 13, marginTop: 8 },
  error: { color: "#9c3e35", fontSize: 13, marginTop: 8 },
  eyebrow: { color: "#69716d", fontSize: 12, fontWeight: "700", letterSpacing: 1.4 },
  header: { alignItems: "center", flexDirection: "row", gap: 10 },
  label: { color: "#8a918d", fontSize: 11, fontWeight: "700", letterSpacing: 1.2 },
  rule: { backgroundColor: "#e8e8e4", height: 1, marginVertical: 28 },
  safeArea: { backgroundColor: "#f4f3ef", flex: 1 },
  statusDot: { backgroundColor: "#b8bcb9", borderRadius: 5, height: 10, width: 10 },
  statusDotConnected: { backgroundColor: "#4f8b71" },
  title: {
    color: "#1e2522",
    fontSize: 36,
    fontWeight: "600",
    letterSpacing: -1.1,
    lineHeight: 43,
    marginBottom: 16,
  },
  value: { color: "#26302b", fontSize: 17, fontWeight: "600", marginTop: 7 },
})
