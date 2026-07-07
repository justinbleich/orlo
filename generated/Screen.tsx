import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { PressableComponent } from "./components/PressableComponent";
import { TextComponent } from "./components/TextComponent";
import { theme } from "./theme";
export default function Screen() {
  return <View style={styles.view}><Image style={styles.image} source={{
      uri: ""
    }} resizeMode={"cover"} /><Pressable style={styles.pressable}><Text style={styles.text}>Start planning</Text></Pressable><TextComponent /><PressableComponent /></View>;
}
const styles = StyleSheet.create({
  view: {
    width: 390,
    height: 844,
    backgroundColor: "#ffffff",
    flexDirection: "column",
    padding: 16,
    paddingTop: 64,
    paddingBottom: 48,
    gap: 14
  },
  image: {
    height: 144,
    alignSelf: "stretch",
    borderRadius: theme.spacing.space1,
    backgroundColor: theme.color.canvas
  },
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
