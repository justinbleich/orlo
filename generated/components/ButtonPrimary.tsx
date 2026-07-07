import { Pressable, StyleSheet } from "react-native";
interface ButtonPrimaryProps {}
export function ButtonPrimary({}: ButtonPrimaryProps) {
  return <Pressable style={styles.pressable} />;
}
const styles = StyleSheet.create({
  pressable: {
    width: 295,
    height: 56,
    backgroundColor: "#2563EB",
    borderRadius: 16
  }
});
