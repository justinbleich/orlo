import { Pressable, StyleSheet, Text } from "react-native";
interface AddTaskProps {
  label?: string;
  disabled?: boolean;
  state?: "default" | "hover" | "pressed" | "disabled";
  onPress?: () => void;
}
export function AddTask({
  label = "Add task",
  disabled = false,
  state = "default",
  onPress
}: AddTaskProps) {
  return <Pressable onPress={onPress} style={[styles.pressable, styles[`pressable_state_${state}`]]}><Text style={styles.text}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({
  pressable: {
    borderRadius: 12,
    minHeight: 44,
    padding: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111827",
    paddingVertical: 14,
    paddingHorizontal: 20
  },
  pressable_state_hover: {
    backgroundColor: "#0f1623"
  },
  pressable_state_pressed: {
    backgroundColor: "#0d131e"
  },
  pressable_state_disabled: {
    opacity: 0.5
  },
  text: {
    fontWeight: "600",
    textAlign: "center",
    fontFamily: "Inter",
    fontSize: 15,
    color: "#FFFFFF"
  }
});
