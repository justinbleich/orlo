import { FIXTURE_IMAGE_URI } from "@rn-canvas/fixture";
import { StatusBar } from "expo-status-bar";
import { Image, StyleSheet, Text, View } from "react-native";

/** Native ground-truth render of the Phase 0 fixture (Yoga via RN). */
export default function App() {
  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.frame}>
        <Text style={styles.label}>Hello RN Canvas</Text>
        <Image source={{ uri: FIXTURE_IMAGE_URI }} style={styles.logo} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f0f0f0",
    alignItems: "center",
    justifyContent: "center",
  },
  frame: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    width: 320,
    height: 120,
    backgroundColor: "#ffffff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  label: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111111",
  },
  logo: {
    width: 48,
    height: 48,
  },
});
