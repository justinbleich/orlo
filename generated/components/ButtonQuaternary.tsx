import { Pressable, StyleSheet, Text } from "react-native";
interface ButtonQuaternaryProps {
  label?: string;
  disabled?: boolean;
  state?: "default" | "hover" | "pressed" | "disabled";
}
export function ButtonQuaternary({
  label = "Pressable",
  disabled = false,
  state = "default"
}: ButtonQuaternaryProps) {
  return <Pressable style={[styles.pressable, styles[`pressable_state_${state}`]]}><Text style={styles.text}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({
  pressable: {
    borderRadius: 8,
    minHeight: 44,
    padding: 12,
    alignItems: "center",
    justifyContent: "center",
    width: 100,
    height: 40,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 0,
    borderColor: "#CBD5E1",
    backgroundColor: "#2563EB"
  },
  pressable_state_hover: {
    backgroundColor: "#2159d4"
  },
  pressable_state_pressed: {
    backgroundColor: "#1d4db7"
  },
  pressable_state_disabled: {
    opacity: 0.5
  },
  text: {
    fontWeight: "600",
    textAlign: "center",
    fontFamily: "Inter",
    fontSize: 14,
    color: "#FFFFFF"
  }
});
