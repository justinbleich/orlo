import { StyleSheet, Text, View } from "react-native";
import { theme } from "./theme";
export default function Home() {
  return <View style={styles.view}><Text style={styles.text}>Pulseboard</Text><Text style={styles.text2}>A small Expo Router workspace for trying Studio flows, sidecars, tokens, and sync.</Text><View style={styles.view2}><Text style={styles.text3}>Activation</Text><Text style={styles.text4}>68%</Text></View></View>;
}
const styles = StyleSheet.create({
  view: {
    width: 390,
    height: 844,
    backgroundColor: theme.color.canvas,
    flexDirection: "column",
    padding: 32,
    paddingTop: 64,
    gap: 24
  },
  text: {
    fontFamily: "Inter",
    fontSize: 32,
    fontWeight: "700",
    color: "#111827"
  },
  text2: {
    fontFamily: "Inter",
    fontSize: 16,
    lineHeight: 22,
    color: "#667085"
  },
  view2: {
    backgroundColor: "#FFFFFF",
    borderColor: "#DADFE8",
    borderRadius: 12,
    borderWidth: 1,
    padding: 20,
    gap: 6
  },
  text3: {
    fontFamily: "Inter",
    fontSize: 13,
    fontWeight: "600",
    color: "#667085"
  },
  text4: {
    fontFamily: "Inter",
    fontSize: 30,
    fontWeight: "800",
    color: "#0F8A5F"
  }
});
