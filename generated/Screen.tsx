import { StyleSheet, Text, View } from "react-native";
export default function Screen() {
  return <View style={styles.view}><Text style={styles.text}>Hello RN Canvas</Text></View>;
}
const styles = StyleSheet.create({
  view: {
    width: 390,
    height: 844,
    backgroundColor: "#ffffff",
    flexDirection: "column",
    padding: 16,
    gap: 12
  },
  text: {
    fontFamily: "Inter",
    fontSize: 14,
    color: "#111111"
  }
});
