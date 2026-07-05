import { StyleSheet, View } from "react-native";
export default function Hero() {
  return <View style={styles.view} />;
}
const styles = StyleSheet.create({
  view: {
    width: 390,
    height: 844,
    backgroundColor: "#ffffff",
    flexDirection: "column",
    padding: 16,
    paddingTop: 64,
    paddingBottom: 48
  }
});
