import { Pressable, StyleSheet, Text } from "react-native";
import { theme } from "../theme";
interface PressableComponentProps {
  state?: "Default" | "Hover" | "Pressed" | "Disabled";
}
export function PressableComponent({
  state = "Default"
}: PressableComponentProps) {
  return <Pressable style={[styles.pressable, styles[`pressable_state_${state}`]]}><Text style={styles.text}>Next</Text></Pressable>;
}
const styles = StyleSheet.create({
  pressable: {
    padding: theme.spacing.space1,
    backgroundColor: "#3a3a45",
    borderRadius: theme.spacing["full.radius"],
    position: "absolute",
    left: 16,
    bottom: 40,
    height: 64,
    right: 16,
    justifyContent: "center",
    alignItems: "center"
  },
  pressable_state_Hover: {
    backgroundColor: "rgba(58, 58, 69, 0.776)"
  },
  text: {
    fontFamily: "Inter",
    fontSize: theme.fontSize.text2,
    color: theme.color.color1,
    textAlign: "center",
    fontWeight: "600"
  }
});
