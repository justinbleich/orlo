import { StyleSheet, Text, View } from "react-native";
interface ViewComponentProps {
  state?: "Default" | "Hover" | "Pressed" | "Disabled";
}
export function ViewComponent({
  state = "Default"
}: ViewComponentProps) {
  return <View style={[styles.view, styles[`view_state_${state}`]]}><Text style={[styles.text, styles[`text_state_${state}`]]}>Text</Text></View>;
}
const styles = StyleSheet.create({
  view: {
    height: 144,
    alignSelf: "stretch",
    justifyContent: "center",
    alignItems: "flex-start"
  },
  view_state_Hover: {
    backgroundColor: "#d2d0d0"
  },
  text: {
    fontFamily: "Inter",
    fontSize: 14,
    color: "#111111",
    textAlign: "center",
    alignSelf: "stretch"
  },
  text_state_Hover: {
    backgroundColor: "#706b6b"
  }
});
