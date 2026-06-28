import { StyleSheet, Text } from "react-native";
interface TextComponentProps {}
export function TextComponent({}: TextComponentProps) {
  return <Text style={styles.text}>Hello RN Canvas</Text>;
}
const styles = StyleSheet.create({
  text: {
    fontFamily: "Inter",
    fontSize: 14,
    color: "#111111"
  }
});
