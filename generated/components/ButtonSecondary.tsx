import { Pressable, StyleSheet, Text } from "react-native";
interface ButtonSecondaryProps {
  label?: string;
  state?: "default" | "hover" | "pressed" | "disabled";
}
export function ButtonSecondary({
  label = "Pressable",
  state = "default"
}: ButtonSecondaryProps) {
  return <Pressable style={styles.pressable}><Text style={styles.text}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({
  pressable: {
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    minHeight: 44,
    padding: 12,
    alignItems: "center",
    justifyContent: "center",
    width: 100,
    height: 40,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#CBD5E1"
  },
  text: {
    fontWeight: "600",
    textAlign: "center",
    fontFamily: "Inter",
    fontSize: 14,
    color: "#FFFFFF"
  }
});
