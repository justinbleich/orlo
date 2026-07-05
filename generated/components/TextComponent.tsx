import { StyleSheet, Text } from "react-native";
interface TextComponentProps {}
export function TextComponent({}: TextComponentProps) {
  return <Text style={styles.text}>A guided checklist for the first session.</Text>;
}
const styles = StyleSheet.create({
  text: {
    fontFamily: "Inter",
    fontSize: 16,
    lineHeight: 22,
    color: "#667085"
  }
});
