import { Link, Stack } from "expo-router"
import { StyleSheet, Text, View } from "react-native"

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Not found" }} />
      <View style={styles.container}>
        <Text style={styles.title}>This page does not exist.</Text>
        <Link href="/" style={styles.link}>
          Return to Cypheria
        </Link>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    backgroundColor: "#f4f3ef",
    flex: 1,
    gap: 16,
    justifyContent: "center",
  },
  link: { color: "#315d50", fontSize: 16 },
  title: { color: "#1e2522", fontSize: 22, fontWeight: "600" },
})
