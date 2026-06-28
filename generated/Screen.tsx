import { StyleSheet, View } from "react-native";
export default function Screen() {
  return <View style={styles.view} />;
}
const styles = StyleSheet.create({
  view: {
    width: 390,
    height: 844,
    backgroundColor: "#ffffff",
    flexDirection: "column",
    padding: 16,
    gap: 12
  }
});
