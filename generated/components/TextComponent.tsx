import { StyleSheet, Text } from "react-native";
interface TextComponentProps {
  textColor: string;
  size?: "Small" | "Medium" | "Large";
}
export function TextComponent({
  textColor,
  size = "Small"
}: TextComponentProps) {
  return <Text style={[styles.text, styles[`text_size_${size}`], {
    color: textColor
  }]}>A guided checklist for the first session.</Text>;
}
const styles = StyleSheet.create({
  text: {
    fontFamily: "Inter",
    fontSize: 16,
    lineHeight: 22,
    color: "#667085"
  },
  text_size_Medium: {
    fontSize: 18
  }
});
