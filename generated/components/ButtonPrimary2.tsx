import { Pressable, StyleSheet, Text } from "react-native";
interface ButtonPrimary2Props {}
export function ButtonPrimary2({}: ButtonPrimary2Props) {
  return <Pressable style={styles.pressable}><Text style={styles.text}>Start planning</Text></Pressable>;
}
const styles = StyleSheet.create({
  pressable: {
    width: 295,
    height: 56,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center"
  },
  text: {
    fontFamily: "Inter",
    fontSize: 15,
    color: "#FFFFFF",
    fontWeight: "600",
    textAlign: "center"
  }
});
