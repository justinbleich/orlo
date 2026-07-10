import { Pressable, StyleSheet, Text } from "react-native";
interface ButtonPrimaryProps {}
export function ButtonPrimary({}: ButtonPrimaryProps) {
  return <Pressable style={styles.pressable}><Text style={styles.text}>Pressable</Text></Pressable>;
}
const styles = StyleSheet.create({
  pressable: {
    width: 295,
    height: 56,
    backgroundColor: "#2563EB",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center"
  },
  text: {
    fontFamily: "Inter",
    fontSize: 14,
    color: "#111827",
    textAlign: "center"
  }
});
